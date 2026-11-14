# -*- coding: utf-8 -*-
"""
Módulo de Agendamento Autónomo em Segundo Plano (Gexcel EVO e-Fatura).
Gere agendamentos recorrentes (diários, semanais, mensais) para varredura de anos inteiros,
com suporte resiliente a tarefas perdidas quando o computador esteve desligado (Misfire / Catch-Up).
"""

import os
import sys
import json
import time
import uuid
import sqlite3
import logging
import threading
from datetime import datetime, timedelta, timezone, date
from typing import Optional, List, Dict, Any

LOGGER = logging.getLogger("gexcel.efatura.scheduler")

def get_scheduler_db_path() -> str:
    """Retorna o caminho permanente da base de dados do agendador no disco local (%LOCALAPPDATA%\\GExcelAYD\\efatura_scheduler.db)."""
    local_app = os.environ.get("LOCALAPPDATA", "") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
    fallback_dir = os.path.join(local_app, "GExcelAYD")
    os.makedirs(fallback_dir, exist_ok=True)
    local_db = os.path.join(fallback_dir, "efatura_scheduler.db")

    # Se existir base antiga na pasta BdsefaturaV4/scheduler.db e local ainda não existir, migra transparentemente
    if not os.path.exists(local_db):
        try:
            import pb_client
            v4_dir = pb_client.obter_pasta_v4()
            rede_db = os.path.join(v4_dir, "scheduler.db") if v4_dir else ""
            if rede_db and os.path.exists(rede_db):
                import shutil
                shutil.copy2(rede_db, local_db)
                LOGGER.info("Agendamentos migrados da rede para o posto local: %s", local_db)
        except Exception:
            pass

    return local_db

def scheduler_db_connect(timeout: int = 30) -> sqlite3.Connection:
    """Abre conexão SQLite resiliente para a base de dados do agendador local com proteção de concorrência."""
    db_path = get_scheduler_db_path()
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=timeout)
    conn.execute(f"PRAGMA busy_timeout = {int(timeout * 1000)};")
    try:
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
    except Exception:
        conn.execute("PRAGMA journal_mode = DELETE;")
        conn.execute("PRAGMA synchronous = NORMAL;")
    return conn

_SCHEDULER_DB_INITIALIZED = False

def init_scheduler_db():
    """Inicializa as tabelas de tarefas e logs do agendador com modo resiliente (executa uma vez por processo)."""
    global _SCHEDULER_DB_INITIALIZED
    if _SCHEDULER_DB_INITIALIZED:
        return
    db_path = get_scheduler_db_path()
    try:
        with scheduler_db_connect(timeout=30) as conn:
            c = conn.cursor()
            
            c.execute("""
            CREATE TABLE IF NOT EXISTS efatura_agendamentos (
                id TEXT PRIMARY KEY,
                nome TEXT NOT NULL,
                nifs TEXT NOT NULL,
                ano INTEGER NOT NULL,
                meses TEXT NOT NULL,
                tipo TEXT NOT NULL,
                recorrencia TEXT NOT NULL,
                hora TEXT NOT NULL,
                dias_semana TEXT DEFAULT '',
                dia_mes INTEGER DEFAULT 1,
                politica_atraso TEXT NOT NULL DEFAULT 'auto_catchup',
                ativo INTEGER NOT NULL DEFAULT 1,
                proxima_execucao TEXT NOT NULL,
                ultima_execucao TEXT DEFAULT '',
                ultimo_status TEXT DEFAULT 'pendente',
                ultimo_resultado TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """)

            c.execute("""
            CREATE TABLE IF NOT EXISTS efatura_agendamentos_logs (
                id TEXT PRIMARY KEY,
                agendamento_id TEXT NOT NULL,
                nome_tarefa TEXT NOT NULL,
                ano INTEGER NOT NULL,
                tipo TEXT NOT NULL,
                total_empresas INTEGER NOT NULL DEFAULT 0,
                total_docs_obtidos INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                mensagem TEXT NOT NULL,
                detalhes TEXT DEFAULT '{}',
                iniciado_em TEXT NOT NULL,
                terminado_em TEXT NOT NULL,
                duracao_segundos REAL NOT NULL DEFAULT 0.0,
                FOREIGN KEY (agendamento_id) REFERENCES efatura_agendamentos(id) ON DELETE CASCADE
            );
            """)
            
            c.execute("CREATE INDEX IF NOT EXISTS idx_agendamentos_ativo ON efatura_agendamentos(ativo, proxima_execucao);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_logs_agendamento ON efatura_agendamentos_logs(agendamento_id, iniciado_em);")
            conn.commit()
            _SCHEDULER_DB_INITIALIZED = True
            LOGGER.info("Base de dados do agendador inicializada com sucesso: %s", db_path)
    except Exception as e:
        LOGGER.error("Erro ao inicializar base de dados do agendador: %s", e)

def calcular_proxima_execucao(
    recorrencia: str,
    hora_str: str,
    dias_semana_str: str = "",
    dia_mes: int = 1,
    base_dt: Optional[datetime] = None
) -> str:
    """
    Calcula a próxima data/hora ISO com base na regra de recorrência.
    hora_str: 'HH:MM' (ex: '03:00')
    """
    if base_dt is None:
        base_dt = datetime.now()

    try:
        parts = hora_str.strip().split(":")
        alvo_hora = int(parts[0])
        alvo_minuto = int(parts[1]) if len(parts) > 1 else 0
    except Exception:
        alvo_hora, alvo_minuto = 3, 0

    recorrencia = (recorrencia or "diaria").lower().strip()

    if recorrencia == "diaria":
        candidato = base_dt.replace(hour=alvo_hora, minute=alvo_minuto, second=0, microsecond=0)
        if candidato <= base_dt:
            candidato += timedelta(days=1)
        return candidato.strftime("%Y-%m-%d %H:%M:%S")

    elif recorrencia == "semanal":
        # dias_semana_str: ex "1,2,3,4,5" (1=Segunda, 7=Domingo)
        try:
            dias_permitidos = [int(x.strip()) for x in dias_semana_str.split(",") if x.strip()]
        except Exception:
            dias_permitidos = [1, 2, 3, 4, 5]
        if not dias_permitidos:
            dias_permitidos = [1, 2, 3, 4, 5]

        # Procurar o próximo dia permitido (até 14 dias para a frente)
        for offset in range(14):
            candidato = (base_dt + timedelta(days=offset)).replace(hour=alvo_hora, minute=alvo_minuto, second=0, microsecond=0)
            dia_iso = candidato.isoweekday() # 1=Mon, 7=Sun
            if dia_iso in dias_permitidos and candidato > base_dt:
                return candidato.strftime("%Y-%m-%d %H:%M:%S")
        return (base_dt + timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")

    elif recorrencia == "mensal":
        dia_alvo = max(1, min(28, int(dia_mes or 1)))
        try:
            candidato = base_dt.replace(day=dia_alvo, hour=alvo_hora, minute=alvo_minuto, second=0, microsecond=0)
            if candidato <= base_dt:
                # Avançar um mês
                mes = base_dt.month + 1
                ano = base_dt.year
                if mes > 12:
                    mes = 1
                    ano += 1
                candidato = candidato.replace(year=ano, month=mes)
            return candidato.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            return (base_dt + timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")

    elif recorrencia == "unica":
        candidato = base_dt.replace(hour=alvo_hora, minute=alvo_minuto, second=0, microsecond=0)
        if candidato <= base_dt:
            candidato += timedelta(days=1)
        return candidato.strftime("%Y-%m-%d %H:%M:%S")

    return (base_dt + timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")

# -------------------------------------------------------------------------
# OPERAÇÕES CRUD SOBRE TAREFAS AGENDADAS
# -------------------------------------------------------------------------

def criar_agendamento(dados: Dict[str, Any]) -> Dict[str, Any]:
    """Cria uma nova tarefa agendada persistente."""
    init_scheduler_db()
    task_id = str(uuid.uuid4())
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    nome = dados.get("nome", "Atualização Fiscal Anual").strip()
    nifs = dados.get("nifs") or ["TODOS"]
    if isinstance(nifs, str):
        try:
            nifs = json.loads(nifs)
        except Exception:
            nifs = [nifs]
    nifs_json = json.dumps(nifs, ensure_ascii=False)

    ano = int(dados.get("ano", datetime.now().year))
    meses = dados.get("meses") or list(range(1, 13))
    if isinstance(meses, str):
        try:
            meses = json.loads(meses)
        except Exception:
            meses = list(range(1, 13))
    meses_json = json.dumps(meses)

    tipo = dados.get("tipo", "ambos").lower()
    recorrencia = dados.get("recorrencia", "diaria").lower()
    hora = dados.get("hora", "03:00").strip()
    dias_semana = dados.get("dias_semana", "")
    dia_mes = int(dados.get("dia_mes", 1))
    politica = dados.get("politica_atraso", "auto_catchup")
    ativo = 1 if dados.get("ativo", True) else 0

    proxima = dados.get("proxima_execucao")
    if not proxima:
        proxima = calcular_proxima_execucao(recorrencia, hora, dias_semana, dia_mes)

    with scheduler_db_connect(timeout=30) as conn:
        c = conn.cursor()
        c.execute("""
        INSERT INTO efatura_agendamentos (
            id, nome, nifs, ano, meses, tipo, recorrencia, hora,
            dias_semana, dia_mes, politica_atraso, ativo,
            proxima_execucao, ultima_execucao, ultimo_status, ultimo_resultado,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            task_id, nome, nifs_json, ano, meses_json, tipo, recorrencia, hora,
            dias_semana, dia_mes, politica, ativo,
            proxima, "", "pendente", "{}",
            now_str, now_str
        ))
        conn.commit()

    return obter_agendamento(task_id) or {}

def listar_agendamentos() -> List[Dict[str, Any]]:
    """Lista todas as tarefas agendadas."""
    init_scheduler_db()
    rows = []
    try:
        with scheduler_db_connect(timeout=30) as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("SELECT * FROM efatura_agendamentos ORDER BY created_at DESC;")
            rows = c.fetchall()
    except Exception as e:
        LOGGER.warning(f"Aviso ao consultar agendamentos: {e}")
        return []
        
    resultado = []
    for r in rows:
        d = dict(r)
        try:
            d["nifs"] = json.loads(d["nifs"])
        except Exception:
            pass
        try:
            d["meses"] = json.loads(d["meses"])
        except Exception:
            pass
        try:
            d["ultimo_resultado"] = json.loads(d["ultimo_resultado"])
        except Exception:
            pass
        resultado.append(d)
    return resultado

def obter_agendamento(task_id: str) -> Optional[Dict[str, Any]]:
    """Obtém os detalhes de um agendamento específico."""
    init_scheduler_db()
    try:
        with scheduler_db_connect(timeout=30) as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("SELECT * FROM efatura_agendamentos WHERE id = ?;", (task_id,))
            row = c.fetchone()
            if not row:
                return None
            d = dict(row)
            try:
                d["nifs"] = json.loads(d["nifs"])
            except Exception:
                pass
            try:
                d["meses"] = json.loads(d["meses"])
            except Exception:
                pass
            try:
                d["ultimo_resultado"] = json.loads(d["ultimo_resultado"])
            except Exception:
                pass
            return d
    except Exception as e:
        LOGGER.warning(f"Aviso ao obter agendamento {task_id}: {e}")
        return None

def atualizar_agendamento(task_id: str, dados: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Atualiza campos configuráveis de uma tarefa agendada."""
    init_scheduler_db()
    db_path = get_scheduler_db_path()
    agora_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    campos = []
    valores = []

    for chave in [
        "nome", "tipo", "recorrencia", "hora", "dias_semana", "dia_mes",
        "politica_atraso", "ativo", "ultimo_status", "ultima_execucao",
        "ultimo_resultado", "proxima_execucao"
    ]:
        if chave in dados:
            v = dados[chave]
            if chave == "ultimo_resultado" and isinstance(v, (dict, list)):
                v = json.dumps(v, ensure_ascii=False)
            campos.append(f"{chave} = ?")
            valores.append(v)

    if "nifs" in dados:
        campos.append("nifs = ?")
        v = dados["nifs"]
        valores.append(json.dumps(v, ensure_ascii=False) if isinstance(v, list) else str(v))

    if "meses" in dados:
        campos.append("meses = ?")
        v = dados["meses"]
        valores.append(json.dumps(v) if isinstance(v, list) else str(v))

    if "ano" in dados:
        campos.append("ano = ?")
        valores.append(int(dados["ano"]))

    if "proxima_execucao" not in dados and ("recorrencia" in dados or "hora" in dados):
        rec = dados.get("recorrencia", "diaria")
        hr = dados.get("hora", "03:00")
        ds = dados.get("dias_semana", "")
        dm = int(dados.get("dia_mes", 1))
        prox = calcular_proxima_execucao(rec, hr, ds, dm)
        campos.append("proxima_execucao = ?")
        valores.append(prox)

    if not campos:
        return obter_agendamento(task_id)

    campos.append("updated_at = ?")
    valores.append(agora_str)
    valores.append(task_id)

    with scheduler_db_connect(timeout=30) as conn:
        c = conn.cursor()
        query = f"UPDATE efatura_agendamentos SET {', '.join(campos)} WHERE id = ?;"
        c.execute(query, valores)
        conn.commit()

    return obter_agendamento(task_id)

def eliminar_agendamento(task_id: str) -> bool:
    """Elimina um agendamento e o respetivo histórico de logs."""
    init_scheduler_db()
    with scheduler_db_connect(timeout=30) as conn:
        c = conn.cursor()
        c.execute("DELETE FROM efatura_agendamentos_logs WHERE agendamento_id = ?;", (task_id,))
        c.execute("DELETE FROM efatura_agendamentos WHERE id = ?;", (task_id,))
        conn.commit()
        return c.rowcount > 0

def toggle_agendamento(task_id: str) -> Optional[Dict[str, Any]]:
    """Alterna o estado ativo/pausado de uma tarefa."""
    task = obter_agendamento(task_id)
    if not task:
        return None
    novo_ativo = 0 if task.get("ativo", 1) == 1 else 1
    return atualizar_agendamento(task_id, {"ativo": novo_ativo})

def obter_tarefas_pendentes_confirmacao() -> List[Dict[str, Any]]:
    """Retorna tarefas que falharam a hora de execução com política 'perguntar'."""
    init_scheduler_db()
    with scheduler_db_connect(timeout=30) as conn:
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("""
        SELECT * FROM efatura_agendamentos 
        WHERE ativo = 1 AND ultimo_status = 'pendente_autorizacao'
        ORDER BY proxima_execucao ASC;
        """)
        rows = c.fetchall()
    
    return [dict(r) for r in rows]

def resolver_atraso_agendamento(task_id: str, acao: str) -> Optional[Dict[str, Any]]:
    """Resolve uma tarefa pendente de autorização (executar agora ou saltar para o próximo agendamento)."""
    t = obter_agendamento(task_id)
    if not t:
        return None
    
    if acao == "executar":
        atualizar_agendamento(task_id, {"ultimo_status": "pendente"})
        SCHEDULER_ENGINE.executar_agora_async(task_id)
        return obter_agendamento(task_id)
    else:
        # saltar
        agora = datetime.now()
        nova_prox = calcular_proxima_execucao(
            t["recorrencia"], t["hora"], t.get("dias_semana", ""), t.get("dia_mes", 1), base_dt=agora
        )
        return atualizar_agendamento(task_id, {
            "proxima_execucao": nova_prox,
            "ultimo_status": "saltado",
            "ultimo_resultado": json.dumps({"motivo": "Atraso saltado por decisão do utilizador na interface."})
        })

def listar_logs_agendamento(agendamento_id: Optional[str] = None, limite: int = 50) -> List[Dict[str, Any]]:
    """Devolve o histórico de execuções das tarefas agendadas."""
    init_scheduler_db()
    with scheduler_db_connect(timeout=30) as conn:
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        if agendamento_id:
            c.execute("""
            SELECT * FROM efatura_agendamentos_logs
            WHERE agendamento_id = ?
            ORDER BY iniciado_em DESC LIMIT ?;
            """, (agendamento_id, limite))
        else:
            c.execute("""
            SELECT * FROM efatura_agendamentos_logs
            ORDER BY iniciado_em DESC LIMIT ?;
            """, (limite,))
        rows = c.fetchall()

    logs = []
    for r in rows:
        d = dict(r)
        try:
            d["detalhes"] = json.loads(d["detalhes"])
        except Exception:
            pass
        logs.append(d)
    return logs

# -------------------------------------------------------------------------
# MOTOR DE EXECUÇÃO DE TAREFAS EM SEGUNDO PLANO
# -------------------------------------------------------------------------

class SchedulerEngine:
    """Motor autónomo em background que monitoriza e executa as tarefas agendadas."""

    def __init__(self, callback_iniciar_job=None):
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._callback_iniciar_job = callback_iniciar_job
        self._lock = threading.Lock()
        self._executando_tarefas = set()
        self._progresso_vivo: Dict[str, Any] = {}

    def set_callback_iniciar_job(self, fn):
        self._callback_iniciar_job = fn

    def obter_progresso_vivo(self) -> Dict[str, Any]:
        """Devolve um snapshot do progresso em tempo real das tarefas em curso."""
        with self._lock:
            return dict(self._progresso_vivo)

    def start(self):
        """Inicia a thread do agendador em background."""
        with self._lock:
            if self._running:
                return
            self._running = True
            init_scheduler_db()
            self._thread = threading.Thread(target=self._loop, daemon=True, name="GexcelSchedulerWorker")
            self._thread.start()
            LOGGER.info("Motor do Agendador de Tarefas iniciado em background.")

    def stop(self):
        """Sinaliza paragem limpa da thread do agendador."""
        with self._lock:
            self._running = False

    def _loop(self):
        """Ciclo de monitorização com verificação de agendamentos a cada 15 segundos."""
        # Pausa inicial de estabilização pós-arranque (permite que a rede e o Gexcel Auth fiquem operacionais)
        time.sleep(10)

        while self._running:
            try:
                self._verificar_e_disparar()
            except Exception as e:
                LOGGER.error("Erro no ciclo do agendador: %s", e)
            
            # Dormir 15 segundos entre rondas
            for _ in range(15):
                if not self._running:
                    break
                time.sleep(1)

    def _verificar_e_disparar(self):
        """Avalia tarefas ativas cujo horário atingiu ou excedeu a hora atual."""
        agora = datetime.now()
        agora_str = agora.strftime("%Y-%m-%d %H:%M:%S")

        tarefas = listar_agendamentos()
        for t in tarefas:
            if not t.get("ativo"):
                continue

            task_id = t["id"]
            if task_id in self._executando_tarefas:
                continue

            prox_str = t.get("proxima_execucao", "")
            if not prox_str:
                continue

            try:
                dt_prox = datetime.strptime(prox_str, "%Y-%m-%d %H:%M:%S")
            except Exception:
                continue

            # Se a data/hora agendada é no passado ou agora
            if dt_prox <= agora:
                diferenca_minutos = (agora - dt_prox).total_seconds() / 60.0
                politica = t.get("politica_atraso", "auto_catchup")

                # Se atraso for superior a 15 minutos (ex: PC estava desligado)
                if diferenca_minutos > 15:
                    LOGGER.info(
                        "Tarefa '%s' atrasada (agendada para %s, agora é %s, atraso=%.1f min). Política: %s",
                        t["nome"], prox_str, agora_str, diferenca_minutos, politica
                    )

                    if politica == "skip":
                        # Saltar: recalcula diretamente a próxima data
                        nova_prox = calcular_proxima_execucao(
                            t["recorrencia"], t["hora"], t.get("dias_semana", ""), t.get("dia_mes", 1), base_dt=agora
                        )
                        atualizar_agendamento(task_id, {
                            "proxima_execucao": nova_prox,
                            "ultimo_status": "saltado",
                            "ultimo_resultado": json.dumps({"motivo": "Computador desligado no horário agendado (skip)"})
                        })
                        continue

                    elif politica == "perguntar":
                        # Marca para pedir autorização na interface
                        atualizar_agendamento(task_id, {
                            "ultimo_status": "pendente_autorizacao"
                        })
                        continue

                    elif politica == "auto_catchup":
                        # Coalescing: executa agora uma única vez
                        LOGGER.info("A executar recuperação automática (auto_catchup) da tarefa '%s'", t["nome"])

                # Disparar execução da tarefa numa thread assíncrona
                self._executando_tarefas.add(task_id)
                threading.Thread(
                    target=self._executar_tarefa_agendada,
                    args=(t,),
                    daemon=True,
                    name=f"SchedulerTask-{task_id[:8]}"
                ).start()

    def _executar_tarefa_agendada(self, tarefa: Dict[str, Any]):
        """Executa todo o ciclo de varredura anual programada para as entidades da tarefa."""
        task_id = tarefa["id"]
        nome_tarefa = tarefa.get("nome", "Varredura Anual")
        ano = tarefa.get("ano", datetime.now().year)
        meses = tarefa.get("meses") or list(range(1, 13))
        tipo = tarefa.get("tipo", "ambos").lower()
        nifs = tarefa.get("nifs") or ["TODOS"]

        inicio_ts = time.time()
        iniciado_em = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Marcar estado em execução
        atualizar_agendamento(task_id, {"ultimo_status": "em_execucao"})

        with self._lock:
            self._progresso_vivo[task_id] = {
                "status": "a_iniciar",
                "nome": nome_tarefa,
                "nif_atual": "",
                "empresa_atual": "A preparar varredura...",
                "mes_atual": None,
                "ano": ano,
                "tipo": tipo,
                "total_empresas": 0,
                "empresas_concluidas": 0,
                "docs_obtidos": 0,
                "iniciado_em": iniciado_em
            }

        log_id = str(uuid.uuid4())
        total_docs_geral = 0
        empresas_processadas = []
        empresas_com_erro = []
        empresas_com_sucesso = 0
        houve_erro = False
        mensagem_final = "Concluído com sucesso"

        try:
            # 1. Resolver lista de NIFs a processar
            nifs_reais = []
            if "TODOS" in nifs:
                import pb_client
                try:
                    # Obter todas as entidades conhecidas com senhas configuradas (tCredenciais.xml ou SQLite)
                    entidades = pb_client.get_entidades_com_credenciais()
                    nifs_reais = [(e["nif"].strip(), e.get("nomecli", f"NIF {e['nif']}")) for e in entidades if e.get("nif")]
                except Exception as pe:
                    LOGGER.warning("Aviso ao carregar lista de todos os NIFs: %s", pe)
                    nifs_reais = []
            else:
                import pb_client
                nomes_map = {}
                try:
                    entidades = pb_client.get_entidades_com_credenciais()
                    nomes_map = {e["nif"].strip(): e.get("nomecli", f"NIF {e['nif']}") for e in entidades if e.get("nif")}
                except Exception:
                    pass
                for n in nifs:
                    n_str = str(n).strip()
                    nifs_reais.append((n_str, nomes_map.get(n_str, f"NIF {n_str}")))

            with self._lock:
                if task_id in self._progresso_vivo:
                    self._progresso_vivo[task_id]["total_empresas"] = len(nifs_reais)

            # Determinar tipos de operação
            tipos_operacao = ["compras", "vendas"] if tipo == "ambos" else [tipo]

            # 2. Varredura mês a mês para cada entidade
            for idx_emp, (nif_str, nome_ent) in enumerate(nifs_reais):
                docs_empresa = 0
                empresa_teve_erro = False
                for op in tipos_operacao:
                    for mes in sorted(meses):
                        with self._lock:
                            if task_id in self._progresso_vivo:
                                self._progresso_vivo[task_id].update({
                                    "status": "a_processar",
                                    "nif_atual": nif_str,
                                    "empresa_atual": nome_ent,
                                    "mes_atual": mes,
                                    "tipo_atual": op,
                                    "empresas_concluidas": idx_emp,
                                    "docs_obtidos": total_docs_geral + docs_empresa
                                })

                        dt_inicio = date(ano, mes, 1)
                        if mes == 12:
                            dt_fim = date(ano, 12, 31)
                        else:
                            dt_fim = date(ano, mes + 1, 1) - timedelta(days=1)

                        try:
                            if self._callback_iniciar_job:
                                docs_m = self._callback_iniciar_job(
                                    nif=nif_str,
                                    nome_entidade=nome_ent,
                                    data_inicio=dt_inicio,
                                    data_fim=dt_fim,
                                    tipo=op,
                                    reimportar_tudo=False
                                )
                                docs_empresa += (docs_m or 0)
                        except Exception as ee:
                            LOGGER.error("Erro na extração agendada NIF %s, %s/%s (%s): %s", nif_str, mes, ano, op, ee)
                            empresa_teve_erro = True
                            houve_erro = True

                if empresa_teve_erro:
                    empresas_com_erro.append(nif_str)
                else:
                    empresas_com_sucesso += 1

                total_docs_geral += docs_empresa
                with self._lock:
                    if task_id in self._progresso_vivo:
                        self._progresso_vivo[task_id]["docs_obtidos"] = total_docs_geral
                        self._progresso_vivo[task_id]["empresas_concluidas"] = idx_emp + 1

                empresas_processadas.append({
                    "nif": nif_str,
                    "nome": nome_ent,
                    "docs_novos": docs_empresa
                })

        except Exception as exc:
            houve_erro = True
            mensagem_final = f"Erro geral na tarefa: {exc}"
            LOGGER.exception("Falha catastrófica na tarefa agendada %s: %s", task_id, exc)
        finally:
            with self._lock:
                self._progresso_vivo.pop(task_id, None)
                self._executando_tarefas.discard(task_id)

        terminado_em = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        duracao = round(time.time() - inicio_ts, 1)

        # Determinação inteligente do estado final
        total_entidades_alvo = len(nifs_reais) if 'nifs_reais' in locals() and nifs_reais else len(empresas_processadas)
        if len(empresas_com_erro) == 0:
            status_final = "sucesso"
            if total_docs_geral == 0:
                mensagem_final = "Base já sincronizada (sem faturas novas neste período)"
            else:
                mensagem_final = f"Concluído com sucesso ({total_docs_geral} faturas novas obtidas)"
        else:
            if empresas_com_sucesso > 0:
                status_final = "parcial"
                mensagem_final = f"{empresas_com_sucesso}/{total_entidades_alvo} empresas verificadas com sucesso ({len(empresas_com_erro)} com aviso)"
            else:
                status_final = "erro"
                mensagem_final = f"Falha na verificação de todas as empresas ({len(empresas_com_erro)} erros)"

        resultado_json = json.dumps({
            "total_docs": total_docs_geral,
            "total_empresas": len(empresas_processadas),
            "empresas_sucesso": empresas_com_sucesso,
            "empresas_erro": len(empresas_com_erro),
            "duracao_segundos": duracao,
            "mensagem": mensagem_final,
            "sem_novidades": (total_docs_geral == 0 and len(empresas_com_erro) == 0),
            "empresas": empresas_processadas[:10]  # Resumo das primeiras 10
        }, ensure_ascii=False)

        # Recalcular próxima execução regular
        rec = tarefa.get("recorrencia", "diaria")
        if rec == "unica":
            nova_prox = tarefa.get("proxima_execucao")
            novo_ativo = 0
        else:
            nova_prox = calcular_proxima_execucao(
                rec, tarefa.get("hora", "03:00"), tarefa.get("dias_semana", ""), tarefa.get("dia_mes", 1)
            )
            novo_ativo = tarefa.get("ativo", 1)

        # Atualizar tarefa
        atualizar_agendamento(task_id, {
            "ultima_execucao": terminado_em,
            "ultimo_status": status_final,
            "ultimo_resultado": resultado_json,
            "proxima_execucao": nova_prox,
            "ativo": novo_ativo
        })

        # Registar no histórico de auditoria
        try:
            with scheduler_db_connect(timeout=30) as conn:
                c = conn.cursor()
                c.execute("""
                INSERT INTO efatura_agendamentos_logs (
                    id, agendamento_id, nome_tarefa, ano, tipo,
                    total_empresas, total_docs_obtidos, status, mensagem,
                    detalhes, iniciado_em, terminado_em, duracao_segundos
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    log_id, task_id, nome_tarefa, ano, tipo,
                    len(empresas_processadas), total_docs_geral, status_final, mensagem_final,
                    resultado_json, iniciado_em, terminado_em, duracao
                ))
                conn.commit()
        except Exception as le:
            LOGGER.error("Erro ao gravar log da tarefa agendada: %s", le)

    def executar_agora_async(self, task_id: str) -> bool:
        """Dispara imediatamente uma tarefa em background fora do seu horário."""
        tarefa = obter_agendamento(task_id)
        if not tarefa:
            return False
        with self._lock:
            if task_id in self._executando_tarefas:
                return False
            self._executando_tarefas.add(task_id)
            threading.Thread(
                target=self._executar_tarefa_agendada,
                args=(tarefa,),
                daemon=True,
                name=f"ManualSchedulerTask-{task_id[:8]}"
            ).start()
            return True

SCHEDULER_ENGINE = SchedulerEngine()
