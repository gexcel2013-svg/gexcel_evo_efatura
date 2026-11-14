# -*- coding: utf-8 -*-
"""
pipeline_worker.py - Motor de Segundo Plano Desacoplado (Gexcel EVO e-Fatura).
Gere a fila persistente de tarefas em segundo plano para:
1. Extração de Faturas Anuladas (Compras e Vendas) -> BdsefaturaV4/{NIF}/anuladas_{NIF}.db + Cofre Ledger.
2. Resolução de Nomes de Clientes Particulares em Vendas -> vendas_{NIF}.db + Cache + XML BdsefaturaV3.
3. Importações Agendadas Completas.

Proteções Ativas:
- Detetor de máquinas fracas (RAM <= 8GB / Modo Económico): estritamente 1 worker, libertação agressiva de RAM.
- Pausa imediata quando o Primeiro Plano (porta 8015) está ocupado.
- Prioridade de processo BELOW_NORMAL_PRIORITY_CLASS no Windows.
- Auto-encerramento ao fim de 60s sem tarefas (zero consumo em repouso).
"""

import os
import sys
import json
import time
import uuid
import sqlite3
import logging
import threading
import subprocess
import gc
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict, Any

LOGGER = logging.getLogger("gexcel.efatura.pipeline")

STATE_DIR = os.path.join(os.environ.get("LOCALAPPDATA", "") or os.path.join(os.path.expanduser("~"), "AppData", "Local"), "GexcelApps")
FOREGROUND_STATE_FILE = os.path.join(STATE_DIR, "efatura_foreground.state")
WORKER_PID_FILE = os.path.join(STATE_DIR, "efatura_pipeline_worker.pid")
PIPELINE_DB_PATH = os.path.join(STATE_DIR, "efatura_pipeline.db")

# -------------------------------------------------------------------------
# GESTÃO DE ESTADO DO PRIMEIRO PLANO (PAUSA INTELIGENTE)
# -------------------------------------------------------------------------

def sinalizar_primeiro_plano(busy: bool, nif: str = ""):
    """Sinaliza se o Primeiro Plano (Excel / Desktop UI) está a executar pedidos críticos."""
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        dados = {
            "busy": bool(busy),
            "nif": str(nif or "").strip(),
            "timestamp": int(time.time()),
            "pid": os.getpid()
        }
        tmp_file = FOREGROUND_STATE_FILE + f".{os.getpid()}.tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(dados, f)
        os.replace(tmp_file, FOREGROUND_STATE_FILE)
    except Exception as e:
        LOGGER.debug(f"Aviso ao sinalizar estado do primeiro plano: {e}")

def is_primeiro_plano_ocupado() -> bool:
    """Verifica se o Primeiro Plano está ativamente a utilizar o motor e a rede."""
    try:
        if not os.path.exists(FOREGROUND_STATE_FILE):
            return False
        with open(FOREGROUND_STATE_FILE, "r", encoding="utf-8") as f:
            dados = json.load(f)
        if not dados.get("busy"):
            return False
        # Proteção contra lock órfão (se tiver mais de 5 minutos, considera livre)
        if time.time() - dados.get("timestamp", 0) > 300:
            return False
        return True
    except Exception:
        return False

# -------------------------------------------------------------------------
# BASE DE DADOS DA FILA DE PIPELINE (SQLITE RESILIENTE)
# -------------------------------------------------------------------------

def pipeline_db_connect(timeout: int = 30) -> sqlite3.Connection:
    """Abre conexão SQLite resiliente para a fila do pipeline."""
    os.makedirs(os.path.dirname(PIPELINE_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(PIPELINE_DB_PATH, timeout=timeout)
    conn.execute(f"PRAGMA busy_timeout = {int(timeout * 1000)};")
    try:
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
    except Exception:
        conn.execute("PRAGMA journal_mode = DELETE;")
        conn.execute("PRAGMA synchronous = NORMAL;")
    return conn

_PIPELINE_DB_INIT = False

def init_pipeline_db():
    """Inicializa as tabelas da fila de tarefas em segundo plano."""
    global _PIPELINE_DB_INIT
    if _PIPELINE_DB_INIT:
        return
    try:
        with pipeline_db_connect(timeout=30) as conn:
            c = conn.cursor()
            c.execute("""
            CREATE TABLE IF NOT EXISTS pipeline_tarefas (
                id TEXT PRIMARY KEY,
                nif TEXT NOT NULL,
                nome_entidade TEXT,
                modulo TEXT NOT NULL,
                data_inicio TEXT NOT NULL,
                data_fim TEXT NOT NULL,
                tipo_tarefa TEXT NOT NULL,
                prioridade INTEGER DEFAULT 10,
                estado TEXT DEFAULT 'pendente',
                tentativas INTEGER DEFAULT 0,
                erro_msg TEXT DEFAULT '',
                detalhes TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """)
            c.execute("CREATE INDEX IF NOT EXISTS idx_pipe_estado ON pipeline_tarefas(estado, prioridade, created_at);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_pipe_nif ON pipeline_tarefas(nif, tipo_tarefa);")
            conn.commit()
            _PIPELINE_DB_INIT = True
    except Exception as e:
        LOGGER.error(f"Erro ao inicializar base da fila do pipeline: {e}")

def adicionar_tarefa(
    nif: str,
    nome_entidade: str,
    modulo: str,
    data_inicio: str,
    data_fim: str,
    tipo_tarefa: str,
    prioridade: int = 10,
    detalhes: Optional[Dict[str, Any]] = None
) -> str:
    """Insere uma tarefa na fila de segundo plano evitando duplicados pendentes idênticos."""
    init_pipeline_db()
    nif_clean = "".join(filter(str.isdigit, str(nif or "")))[:9]
    task_id = str(uuid.uuid4())
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    det_json = json.dumps(detalhes or {}, ensure_ascii=False)

    with pipeline_db_connect(timeout=30) as conn:
        c = conn.cursor()
        # Verificar se já existe exatamente a mesma tarefa pendente ou em curso
        c.execute("""
            SELECT id FROM pipeline_tarefas 
            WHERE nif = ? AND modulo = ? AND tipo_tarefa = ? AND data_inicio = ? AND data_fim = ?
              AND estado IN ('pendente', 'em_curso');
        """, (nif_clean, modulo, tipo_tarefa, str(data_inicio)[:10], str(data_fim)[:10]))
        row = c.fetchone()
        if row:
            return row[0]

        c.execute("""
            INSERT INTO pipeline_tarefas (
                id, nif, nome_entidade, modulo, data_inicio, data_fim,
                tipo_tarefa, prioridade, estado, tentativas, erro_msg,
                detalhes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente', 0, '', ?, ?, ?);
        """, (
            task_id, nif_clean, nome_entidade or "", modulo,
            str(data_inicio)[:10], str(data_fim)[:10],
            tipo_tarefa, prioridade, det_json, now_str, now_str
        ))
        conn.commit()
    return task_id

def adicionar_tarefas_pos_extracao(
    nif: str,
    nome_entidade: str,
    modulo: str,
    data_inicio: str,
    data_fim: str,
    tem_particulares_sem_nome: bool = False
):
    """
    Gatilho Automático do Primeiro Plano:
    Agenda tarefas em segundo plano e desperta o Worker se necessário.
    """
    nif_clean = "".join(filter(str.isdigit, str(nif or "")))[:9]
    is_vendas = str(modulo).lower() == "vendas"

    # Para anos < 2025, o Web Scraping direto já extrai todas as faturas (ativas + anuladas)
    # e não realiza enriquecimento de particulares. Não agenda segundo plano.
    try:
        ano_ini = int(str(data_inicio)[:4])
        if ano_ini < 2025:
            return
    except Exception:
        pass

    # 1. Tarefa de Faturas Anuladas (tanto compras como vendas)
    adicionar_tarefa(
        nif=nif_clean,
        nome_entidade=nome_entidade,
        modulo="vendas" if is_vendas else "compras",
        data_inicio=data_inicio,
        data_fim=data_fim,
        tipo_tarefa="scrape_anuladas",
        prioridade=5
    )

    # 2. Tarefa de Completar Nomes de Particulares (apenas vendas)
    if is_vendas and tem_particulares_sem_nome:
        adicionar_tarefa(
            nif=nif_clean,
            nome_entidade=nome_entidade,
            modulo="vendas",
            data_inicio=data_inicio,
            data_fim=data_fim,
            tipo_tarefa="completar_nomes_vendas",
            prioridade=10
        )

    # 3. Assegurar que o motor secundário está acordado
    garantir_worker_ativo()

def obter_status_pipeline() -> Dict[str, Any]:
    """Retorna o estado global da fila para a interface Desktop / Excel."""
    init_pipeline_db()
    with pipeline_db_connect(timeout=10) as conn:
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("""
            SELECT estado, COUNT(*) as qtd FROM pipeline_tarefas GROUP BY estado;
        """)
        contagens = {row["estado"]: row["qtd"] for row in c.fetchall()}

        c.execute("""
            SELECT * FROM pipeline_tarefas WHERE estado = 'em_curso' LIMIT 1;
        """)
        ativa = c.fetchone()
        tarefa_ativa = dict(ativa) if ativa else None

    return {
        "status": "sucesso",
        "worker_ativo": is_worker_processo_ativo(),
        "primeiro_plano_ocupado": is_primeiro_plano_ocupado(),
        "contagens": {
            "pendentes": contagens.get("pendente", 0),
            "em_curso": contagens.get("em_curso", 0),
            "concluidas": contagens.get("concluido", 0),
            "erros": contagens.get("erro", 0)
        },
        "tarefa_atual": tarefa_ativa
    }

# -------------------------------------------------------------------------
# CONTROLO DE PROCESSO DO WORKER (--worker)
# -------------------------------------------------------------------------

def is_worker_processo_ativo() -> bool:
    """Verifica se já existe um processo worker ativo a correr."""
    if not os.path.exists(WORKER_PID_FILE):
        return False
    try:
        with open(WORKER_PID_FILE, "r", encoding="utf-8") as f:
            pid = int(f.read().strip())
        if pid <= 0:
            return False
        if sys.platform == "win32":
            import ctypes
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            STILL_ACTIVE = 259
            h_proc = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not h_proc:
                return False
            exit_code = ctypes.c_ulong()
            ctypes.windll.kernel32.GetExitCodeProcess(h_proc, ctypes.byref(exit_code))
            ctypes.windll.kernel32.CloseHandle(h_proc)
            return exit_code.value == STILL_ACTIVE
        return True
    except Exception:
        return False

def registar_worker_pid(pid: int):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(WORKER_PID_FILE, "w", encoding="utf-8") as f:
            f.write(str(pid))
    except Exception:
        pass

def limpar_worker_pid():
    try:
        if os.path.exists(WORKER_PID_FILE):
            os.remove(WORKER_PID_FILE)
    except Exception:
        pass

def garantir_worker_ativo():
    """Dispara o processo secundário gevo_ef2026.exe --worker se não estiver em execução."""
    if is_worker_processo_ativo():
        return

    # Determinar comando de execução
    if getattr(sys, "frozen", False):
        cmd = [sys.executable, "--worker"]
    else:
        # Modo de desenvolvimento Python
        entry_script = os.path.abspath(sys.argv[0])
        cmd = [sys.executable, entry_script, "--worker"]

    creation_flags = 0
    if sys.platform == "win32":
        CREATE_NO_WINDOW = 0x08000000
        DETACHED_PROCESS = 0x00000008
        creation_flags = CREATE_NO_WINDOW | DETACHED_PROCESS

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=creation_flags,
            close_fds=True
        )
        registar_worker_pid(proc.pid)
        LOGGER.info(f"Processo de Segundo Plano lançado com sucesso (PID {proc.pid}).")
    except Exception as e:
        LOGGER.error(f"Falha ao disparar processo worker de segundo plano: {e}")

# -------------------------------------------------------------------------
# EXECUÇÃO DO CICLO DE VIDA DO WORKER
# -------------------------------------------------------------------------

def definir_prioridade_baixa_windows():
    """Configura o processo worker com prioridade BELOW_NORMAL no Windows."""
    if sys.platform == "win32":
        try:
            import ctypes
            BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
            ctypes.windll.kernel32.SetPriorityClass(
                ctypes.windll.kernel32.GetCurrentProcess(),
                BELOW_NORMAL_PRIORITY_CLASS
            )
        except Exception:
            pass

def is_computador_fraco() -> bool:
    """Deteta se a máquina é de baixa memória (<= 8GB RAM) ou tem poucos recursos livres."""
    if sys.platform == "win32":
        try:
            import ctypes
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ('dwLength', ctypes.c_ulong),
                    ('dwMemoryLoad', ctypes.c_ulong),
                    ('ullTotalPhys', ctypes.c_ulonglong),
                    ('ullAvailPhys', ctypes.c_ulonglong),
                    ('ullTotalPageFile', ctypes.c_ulonglong),
                    ('ullAvailPageFile', ctypes.c_ulonglong),
                    ('ullTotalVirtual', ctypes.c_ulonglong),
                    ('ullAvailVirtual', ctypes.c_ulonglong),
                    ('sullAvailExtendedVirtual', ctypes.c_ulonglong),
                ]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                total_gb = stat.ullTotalPhys / (1024 ** 3)
                avail_gb = stat.ullAvailPhys / (1024 ** 3)
                if total_gb <= 8.5 or avail_gb < 1.5:
                    return True
        except Exception:
            pass
    return False

def executar_worker_loop():
    """
    Loop Principal do Processo de Segundo Plano:
    - Executa tarefas ordenadas por prioridade.
    - Pausa automaticamente quando o Primeiro Plano estiver ocupado.
    - Encerra-se automaticamente ao fim de 60s ocioso sem tarefas.
    """
    registar_worker_pid(os.getpid())
    definir_prioridade_baixa_windows()
    init_pipeline_db()

    LOGGER.info(f"Worker de Segundo Plano iniciado (PID {os.getpid()}, Modo Fraco={is_computador_fraco()}).")
    tempo_vazio_inicio = None

    try:
        while True:
            # 1. Respeitar o Primeiro Plano: se o utilizador estiver a trabalhar, pausa
            if is_primeiro_plano_ocupado():
                time.sleep(2.0)
                continue

            # 2. Puxar próxima tarefa pendente
            tarefa = None
            with pipeline_db_connect(timeout=20) as conn:
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                c.execute("""
                    SELECT * FROM pipeline_tarefas 
                    WHERE estado = 'pendente' 
                    ORDER BY prioridade ASC, created_at ASC 
                    LIMIT 1;
                """)
                row = c.fetchone()
                if row:
                    tarefa = dict(row)
                    c.execute("""
                        UPDATE pipeline_tarefas 
                        SET estado = 'em_curso', updated_at = ? 
                        WHERE id = ?;
                    """, (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), tarefa["id"]))
                    conn.commit()

            # 3. Se não houver tarefas pendentes
            if not tarefa:
                if tempo_vazio_inicio is None:
                    tempo_vazio_inicio = time.time()
                elif time.time() - tempo_vazio_inicio >= 60:
                    # Fila vazia durante 60 segundos consecutivos -> auto-encerramento limpo
                    LOGGER.info("Fila vazia durante 60 segundos. Worker em auto-encerramento para libertar RAM.")
                    break
                time.sleep(2.0)
                continue

            # Reset do contador de ociosidade
            tempo_vazio_inicio = None

            # 4. Executar a Tarefa Selecionada
            sucesso, msg_erro = processar_tarefa_pipeline(tarefa)

            # 5. Atualizar o estado final da tarefa
            novo_estado = "concluido" if sucesso else "erro"
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with pipeline_db_connect(timeout=20) as conn:
                c = conn.cursor()
                c.execute("""
                    UPDATE pipeline_tarefas 
                    SET estado = ?, erro_msg = ?, tentativas = tentativas + 1, updated_at = ?
                    WHERE id = ?;
                """, (novo_estado, msg_erro or "", now_str, tarefa["id"]))
                conn.commit()

            # 6. Limpeza agressiva de memória em computadores fracos
            gc.collect()

    finally:
        limpar_worker_pid()
        LOGGER.info("Worker de Segundo Plano encerrado.")

# -------------------------------------------------------------------------
# PROCESSAMENTO ESPECÍFICO DE TAREFAS
# -------------------------------------------------------------------------

def processar_tarefa_pipeline(tarefa: Dict[str, Any]) -> tuple[bool, str]:
    """Encaminha e executa a tarefa específica de segundo plano."""
    tipo = tarefa.get("tipo_tarefa", "")
    nif = tarefa.get("nif", "")
    modulo = tarefa.get("modulo", "compras")
    d_ini = tarefa.get("data_inicio", "")
    d_fim = tarefa.get("data_fim", "")

    LOGGER.info(f"▶️ [WORKER TAREFA] {tipo} para NIF {nif} ({d_ini} a {d_fim}, {modulo})...")

    try:
        if tipo == "scrape_anuladas":
            return executar_tarefa_scrape_anuladas(nif, modulo, d_ini, d_fim)
        elif tipo == "completar_nomes_vendas":
            return executar_tarefa_completar_nomes_vendas(nif, d_ini, d_fim)
        elif tipo == "importacao_completa":
            return executar_tarefa_importacao_completa(tarefa)
        else:
            return False, f"Tipo de tarefa desconhecido: {tipo}"
    except Exception as e:
        LOGGER.exception(f"Erro ao processar tarefa {tipo} para NIF {nif}: {e}")
        return False, str(e)

def executar_tarefa_scrape_anuladas(nif: str, modulo: str, data_inicio: str, data_fim: str) -> tuple[bool, str]:
    """Extrai faturas anuladas via scraper e grava exclusivamente em anuladas_{NIF}.db + Cofre Ledger."""
    import pb_client
    import cofre_ledger
    from pathlib import Path

    sub, pwd = pb_client.get_credentials(nif)
    if not pwd:
        return False, "Senha AT não configurada."

    try:
        from efatura_scraper import iniciar_sessao_efatura, EFaturaCompras, EFaturaVendas, ExtratorDetalhes
    except ImportError:
        return False, "Módulo efatura_scraper não disponível."

    login_user = str(sub).strip() if sub and str(sub).strip() else str(nif)
    sessao = None
    try:
        sessao = iniciar_sessao_efatura(nif=login_user, password=pwd, headless=True, canal="msedge")
        is_vendas = str(modulo).lower() == "vendas"
        scraper = EFaturaVendas(sessao, visual=False) if is_vendas else EFaturaCompras(sessao, visual=False)

        # Consultar faturas com estado Cancelado
        faturas_anuladas = scraper.consultar_intervalo(str(data_inicio), str(data_fim), apenas_cancelados=True)
        if not faturas_anuladas:
            LOGGER.info(f"NIF {nif}: Nenhuma fatura anulada encontrada para {data_inicio} a {data_fim}.")
            return True, ""

        # Extrair detalhes
        extrator = ExtratorDetalhes(sessao, max_workers=2 if is_computador_fraco() else 4)
        linhas_extraidas = extrator.extrair_detalhes_lote(
            faturas_anuladas,
            nif_titular=nif,
            tipo_fluxo="vendas" if is_vendas else "compras"
        )

        # Gravar na base dedicada BdsefaturaV4/{NIF}/anuladas_{NIF}.db
        rows_to_save = [l.to_dict() for l in linhas_extraidas] if linhas_extraidas else [f.to_dict() for f in faturas_anuladas]
        pb_client.upsert_anuladas_direto(nif, rows_to_save, modulo=modulo)

        # Registar no Cofre Permanente de Estados
        try:
            cofre = cofre_ledger.CofreEstadosLedger()
            cofre.registar_e_confrontar(rows_to_save, nif_titular=nif)
        except Exception as cle:
            LOGGER.debug(f"Aviso no registo do Cofre Ledger: {cle}")

        LOGGER.info(f"✅ [ANULADAS CONCLUÍDO] NIF {nif}: {len(rows_to_save)} faturas anuladas gravadas em anuladas_{nif}.db.")
        return True, ""

    finally:
        if sessao:
            try:
                sessao.close()
            except Exception:
                pass

def executar_tarefa_completar_nomes_vendas(nif: str, data_inicio: str, data_fim: str) -> tuple[bool, str]:
    """Resolve os nomes de particulares em vendas, atualiza vendas_{NIF}.db, cache e XML BdsefaturaV3."""
    import pb_client
    import efatura_api
    import re
    import html

    sub, pwd = pb_client.get_credentials(nif)
    if not pwd:
        return False, "Senha AT não configurada."

    missing = pb_client.obter_nifs_vendas_sem_nome(nif)
    nomes_resolvidos = {}

    # 1. Resolver primeiro eventuais entidades coletivas/empresariais diferidas pelo orçamento síncrono
    coletivos = [
        cp_nif for cp_nif in missing.keys()
        if cp_nif and cp_nif[0] not in ("1", "2", "3") and cp_nif not in ("999999990", "999999999", "99999999")
    ]
    if coletivos:
        try:
            emp_nomes = pb_client.resolver_nifs_empresariais_lote(coletivos, max_workers=6, timeout_global=60.0)
            if emp_nomes:
                nomes_resolvidos.update(emp_nomes)
        except Exception as e_emp:
            LOGGER.debug(f"Aviso ao resolver coletivos em segundo plano ({nif}): {e_emp}")

    # 2. Filtrar particulares (1xx, 2xx, 3xx)
    particulares = {
        cp_nif: info for cp_nif, info in missing.items()
        if cp_nif and cp_nif[0] in ("1", "2", "3") and cp_nif not in ("999999990", "999999999", "99999999")
    }

    if not particulares:
        if nomes_resolvidos:
            pb_client.atualizar_nomes_vendas_db(nif, nomes_resolvidos)
            pb_client.atualizar_nomes_xml_legado(nif, nomes_resolvidos, data_inicio=data_inicio, data_fim=data_fim)
        LOGGER.info(f"NIF {nif}: Sem clientes particulares pendentes para resolver ({len(nomes_resolvidos)} coletivo(s) atualizado(s)).")
        return True, ""

    try:
        from efatura_scraper import iniciar_sessao_efatura, ExtratorDetalhes
    except ImportError:
        if nomes_resolvidos:
            pb_client.atualizar_nomes_vendas_db(nif, nomes_resolvidos)
            pb_client.atualizar_nomes_xml_legado(nif, nomes_resolvidos, data_inicio=data_inicio, data_fim=data_fim)
        return False, "Módulo efatura_scraper não disponível."

    login_user = str(sub).strip() if sub and str(sub).strip() else str(nif)
    sessao = None
    nomes_part_cache = {}

    try:
        sessao = iniciar_sessao_efatura(nif=login_user, password=pwd, headless=True, canal="msedge")
        extrator = ExtratorDetalhes(sessao)

        # Resolução cirúrgica com pausas seguras anti-bloqueio (1.5s - 2.5s)
        total_p = len(particulares)
        LOGGER.info(f"A resolver {total_p} particular(es) em segundo plano para NIF {nif}...")

        for idx, (cp_nif, info) in enumerate(particulares.items()):
            # Se entretanto o Primeiro Plano acordar, faz uma pausa de cortesia
            while is_primeiro_plano_ocupado():
                time.sleep(3.0)

            fat_num = str(info.get("fatura") or "").strip().lstrip("'")
            dt_fat = str(info.get("data") or "").strip()[:10]

            nome_encontrado = None
            try:
                # Pesquisa direta da fatura para obter o ID
                headers = {"Accept": "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest"}
                params = {"classeDocumentoFilter": "SI", "dataInicioFilter": dt_fat or str(data_inicio)[:10], "dataFimFilter": dt_fat or str(data_fim)[:10], "semRecibosVerdesFilter": "N"}
                r = extrator.session.get("https://faturas.portaldasfinancas.gov.pt/json/obterDocumentosEmitente.action", params=params, headers=headers, timeout=10)
                if r.status_code == 200:
                    dados_j = r.json()
                    for l in dados_j.get("linhas", []):
                        if str(l.get("nifAdquirente") or "").strip() == cp_nif:
                            id_doc = l.get("idDocumento")
                            dt_doc = l.get("dataEmissaoDocumento") or dt_fat
                            if id_doc:
                                url_det = f"https://faturas.portaldasfinancas.gov.pt/detalheDocumentoEmitente.action?idDocumento={id_doc}&dataEmissaoDocumento={dt_doc}"
                                r_det = extrator.session.get(url_det, timeout=8)
                                if r_det.status_code == 200:
                                    m = re.search(r'id=[\"\']nomeAdquirente[\"\'][^>]*>([^<]+)</span>', r_det.text)
                                    if m:
                                        nome_raw = html.unescape(m.group(1).strip())
                                        if nome_raw and nome_raw.lower() not in ("consumidor final", "consumidor final."):
                                            nome_encontrado = efatura_api.to_title_case(nome_raw)
                            break
            except Exception as e_p:
                LOGGER.debug(f"Aviso ao consultar NIF {cp_nif}: {e_p}")

            if nome_encontrado:
                nomes_resolvidos[cp_nif] = nome_encontrado
                nomes_part_cache[cp_nif] = nome_encontrado
                LOGGER.info(f"✅ [WORKER NOME RESOLVIDO] NIF {cp_nif} -> '{nome_encontrado}'")

            # Pausa de cortesia anti-bloqueio WAF
            time.sleep(2.0)

        if nomes_part_cache:
            pb_client.gravar_nomes_nifs_cache_lote(nomes_part_cache, origem="worker_detalhe")

        # 1. Atualizar base SQLite de vendas
        if nomes_resolvidos:
            pb_client.atualizar_nomes_vendas_db(nif, nomes_resolvidos)

            # 2. Atualizar todos os ficheiros XML correspondentes em BdsefaturaV3
            pb_client.atualizar_nomes_xml_legado(nif, nomes_resolvidos, data_inicio=data_inicio, data_fim=data_fim)

        LOGGER.info(f"✅ [NOMES CONCLUÍDO] NIF {nif}: {len(nomes_resolvidos)} cliente(s) atualizado(s) em SQLite e XML.")
        return True, ""

    finally:
        if sessao:
            try:
                sessao.close()
            except Exception:
                pass

def executar_tarefa_importacao_completa(tarefa: Dict[str, Any]) -> tuple[bool, str]:
    """Executa o ciclo completo de importação agendada (SOAP + Anuladas + Nomes Particulares + XML + SQLite)."""
    nif = tarefa.get("nif", "")
    d_ini = tarefa.get("data_inicio", "")
    d_fim = tarefa.get("data_fim", "")
    modulo = tarefa.get("modulo", "ambos")

    modulos = ["compras", "vendas"] if modulo == "ambos" else [modulo]
    sucesso_geral = True
    erros = []

    for mod in modulos:
        # 1. Extrair faturas normais via primeiro plano / rotina de agendamento
        try:
            import main
            req = main.ExtracaoRequest(
                nif=nif,
                data_inicio=d_ini,
                data_fim=d_fim,
                tipo=mod,
                reimportar_tudo=False,
                gerar_xml_legado=True,
                modo_saida="ambos"
            )
            main.extrair_faturas(req)
        except Exception as e_soap:
            erros.append(f"SOAP {mod}: {e_soap}")
            sucesso_geral = False

        # 2. Extrair faturas anuladas
        ok_a, err_a = executar_tarefa_scrape_anuladas(nif, mod, d_ini, d_fim)
        if not ok_a:
            erros.append(f"Anuladas {mod}: {err_a}")

        # 3. Se for vendas, completar nomes de particulares
        if mod == "vendas":
            ok_n, err_n = executar_tarefa_completar_nomes_vendas(nif, d_ini, d_fim)
            if not ok_n:
                erros.append(f"Nomes Vendas: {err_n}")

    return sucesso_geral, "; ".join(erros)
