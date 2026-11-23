import requests
import logging
import threading
import time
import concurrent.futures
from typing import Optional, Dict, Any, List

PB_URL = "http://127.0.0.1:8090"
LOGGER = logging.getLogger("gexcel.efatura.pb")

# Expressão SQL partilhada para contar documentos distintos sem fundir faturas diferentes que partilham ATCUD
_EXPR_DOC_DISTINTO_SQL = (
    "CASE WHEN fatura IS NOT NULL AND trim(fatura) != '' "
    "THEN id_fatura_unico || '|' || trim(fatura) "
    "ELSE id_fatura_unico END"
)

import sqlite3

_ORIG_SQLITE3_CONNECT = getattr(sqlite3, "_orig_connect", sqlite3.connect)

class _ClosingSQLiteConnection(sqlite3.Connection):
    """Garante que 'with sqlite3.connect(...) as conn:' faz commit/rollback E fecha imediatamente os file descriptors."""
    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            return super().__exit__(exc_type, exc_val, exc_tb)
        finally:
            try:
                self.close()
            except Exception:
                pass

def _auto_closing_sqlite_connect(*args, **kwargs):
    if "factory" not in kwargs or kwargs["factory"] is None:
        kwargs["factory"] = _ClosingSQLiteConnection
    return _ORIG_SQLITE3_CONNECT(*args, **kwargs)

sqlite3._orig_connect = _ORIG_SQLITE3_CONNECT
sqlite3.connect = _auto_closing_sqlite_connect

import base64
import os
import uuid
import xml.etree.ElementTree as ET
import re
import unicodedata
import hashlib
from datetime import datetime, timezone
import legado_bridge
from cofre_ledger import resolver_pasta_vault, obter_caminho_ledger, CofreEstadosLedger

def obter_pasta_dados_raiz(override_path: str = None) -> str:
    """
    Resolve a pasta de dados mestre do Centro de Dados ativo (onde residem tCredenciais.xml, BdsefaturaV3 e BdsRV).
    Prioridade 1: override_path explícito (passado pela interface cliente).
    Prioridade 2: Pasta antiga ou nova configurada no Centro de Dados ativo (auth_manager).
    Prioridade 3: Variável de ambiente GEXCEL_DADOS_DIR.
    Prioridade 4: Tag <EndDadosGexcelApps> de z-GexcelApps.ini via legado_bridge.
    Prioridade 5: Pasta Dropbox de desenvolvimento (ex: USERPROFILE\\Dropbox\\AA_MultiIntegrador).
    Prioridade 6: Subpasta ./Dados_GexcelApps adjacente à aplicação (modo portátil).
    """
    if override_path and os.path.exists(override_path):
        return os.path.abspath(override_path)

    if not override_path and not (os.environ.get("GEXCEL_DADOS_DIR") or "").strip():
        try:
            import workspace_context
            if workspace_context.is_cloud_zero_storage():
                return workspace_context.get_ephemeral_root_dir()
        except Exception:
            pass

    try:
        import auth_manager
        centro = auth_manager.obter_centro_dados_ativo()
        if centro:
            p_antiga = (centro.get("pasta_gexcel_antiga") or "").strip()
            if p_antiga and os.path.exists(p_antiga):
                return os.path.abspath(p_antiga)
            p_evo = (centro.get("pasta_evogex") or "").strip()
            if p_evo and os.path.exists(p_evo):
                return os.path.abspath(p_evo)
    except Exception:
        pass

    env_dir = os.environ.get("GEXCEL_DADOS_DIR")
    if env_dir and os.path.exists(env_dir):
        return os.path.abspath(env_dir)

    ini_dir = legado_bridge.obter_caminho_dados_gexcel()
    if ini_dir and os.path.exists(ini_dir):
        return os.path.abspath(ini_dir)

    user_profile = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    drop_cand = os.path.join(user_profile, "Dropbox", "AA_MultiIntegrador")
    if os.path.exists(drop_cand):
        return os.path.abspath(drop_cand)

    import sys
    base_dir = os.path.dirname(os.path.abspath(sys.executable)) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
    portable_dir = os.path.join(base_dir, "Dados_GexcelApps")
    os.makedirs(portable_dir, exist_ok=True)
    return os.path.abspath(portable_dir)

def obter_pasta_v4(override_path: str = None) -> str:
    """Retorna o caminho da pasta oficial BdsefaturaV4 do Centro de Dados ativo (priorizando sempre Dados_evoGex)."""
    if not override_path:
        env_dir = (os.environ.get("GEXCEL_DADOS_DIR") or "").strip()
        if env_dir and os.path.exists(env_dir):
            v4_env = os.path.join(env_dir, "BdsefaturaV4")
            os.makedirs(v4_env, exist_ok=True)
            return os.path.abspath(v4_env)

        try:
            import workspace_context
            if workspace_context.is_cloud_zero_storage():
                v4_ws = os.path.join(workspace_context.get_ephemeral_root_dir(), "BdsefaturaV4")
                os.makedirs(v4_ws, exist_ok=True)
                return os.path.abspath(v4_ws)
        except Exception:
            pass

        try:
            import auth_manager
            centro = auth_manager.obter_centro_dados_ativo()
            if centro:
                p_evo = (centro.get("pasta_evogex") or "").strip()
                p_antiga = (centro.get("pasta_gexcel_antiga") or "").strip()
                # Prioridade 1: se a pasta nova Dados_evoGex existe no disco (ou está configurada no Windows), grava SEMPRE lá!
                if p_evo and (os.path.exists(p_evo) or os.sys.platform == "win32"):
                    v4_evo = os.path.join(p_evo, "BdsefaturaV4")
                    os.makedirs(v4_evo, exist_ok=True)
                    return os.path.abspath(v4_evo)
                if p_antiga and os.path.exists(p_antiga):
                    v4_antiga = os.path.join(p_antiga, "BdsefaturaV4")
                    os.makedirs(v4_antiga, exist_ok=True)
                    return os.path.abspath(v4_antiga)
        except Exception:
            pass

        if os.sys.platform == "win32" and os.path.exists(r"C:\Dados_evoGex"):
            v4_padrao = r"C:\Dados_evoGex\BdsefaturaV4"
            os.makedirs(v4_padrao, exist_ok=True)
            return os.path.abspath(v4_padrao)

    raiz = obter_pasta_dados_raiz(override_path)
    v4_path = os.path.join(raiz, "BdsefaturaV4")
    os.makedirs(v4_path, exist_ok=True)
    return v4_path

def obter_db_controlo_path(override_path: str = None) -> str:
    """Retorna o caminho do mini-índice central controlo_geral.db."""
    v4 = obter_pasta_v4(override_path)
    return os.path.join(v4, "controlo_geral.db")

def obter_db_cliente_path(nif: str, tipo: str = "compras", override_path: str = None) -> str:
    """
    Retorna o caminho da base de dados particionada do cliente em BdsefaturaV4.
    Ex: <raiz>\\BdsefaturaV4\\501234567\\compras_501234567.db
        <raiz>\\BdsefaturaV4\\501234567\\vendas_501234567.db
    """
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if not nif_clean:
        nif_clean = "000000000"
    v4 = obter_pasta_v4(override_path)
    cliente_dir = os.path.join(v4, nif_clean)
    os.makedirs(cliente_dir, exist_ok=True)
    t_lower = str(tipo).strip().lower()
    if t_lower == "vendas":
        nome_ficheiro = f"vendas_{nif_clean}.db"
    elif t_lower == "anuladas":
        nome_ficheiro = f"anuladas_{nif_clean}.db"
    else:
        nome_ficheiro = f"compras_{nif_clean}.db"
    return os.path.join(cliente_dir, nome_ficheiro)

def resolver_pasta_dados() -> str:
    """Compatibilidade legada: devolve a pasta BdsefaturaV4."""
    return obter_pasta_v4()

BASE_CORE_DIR = obter_pasta_v4()
DB_PATH = obter_db_controlo_path()
DB_VENDAS_PATH = obter_db_controlo_path()


def _to_base62(raw_input: str, max_len: int = 20) -> str:
    """Gera hash criptográfico determinístico em Base62 (0-9A-Za-z) limitado a max_len."""
    h = hashlib.sha256(raw_input.encode('utf-8')).digest()
    num = int.from_bytes(h[:15], byteorder='big')
    b62_chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    res = []
    while num > 0:
        num, rem = divmod(num, 62)
        res.append(b62_chars[rem])
    s = ''.join(reversed(res)) if res else '0'
    s = s.rjust(max_len, '0')[:max_len]
    if s.isdigit():
        s = 'A' + s[:max_len - 1]
    return s[:max_len]


def gerar_chave_documento(nif: str, fatura: str, total_doc: float = 0.0, atcud: str = "", prefixo: str = "") -> str:
    """
    Gera o identificador único por documento (máx. 20 caracteres, compatível com prefixo FOIMP de 5 chars).
    Regras oficiais:
    1. Faturas com ATCUD:
       - Limpar traços e espaços;
       - Eliminar zeros à esquerda do número sequencial;
       - Se for 100% numérico: prefixar com 'A' (blindagem Excel);
       - Se já contiver letras: mantém inalterado;
       - Salvaguarda: se exceder 20 caracteres, corta à esquerda do número mantendo os dígitos finais.
    2. Faturas sem ATCUD (Legadas / Manuais):
       - Hash Base62 determinístico (NIF + Fatura + Total);
       - Se for 100% numérico: prefixar com 'A';
       - Comprimento estritamente <= 20 caracteres.
    """
    def _limpar_alfa(s: str) -> str:
        if not s:
            return ""
        s_norm = unicodedata.normalize('NFKD', str(s)).encode('ASCII', 'ignore').decode('utf-8')
        return re.sub(r'[^A-Z0-9]', '', s_norm.upper())

    atcud_str = str(atcud or '').strip()
    is_atcud_valido = False
    serie = ''
    numero = ''

    if atcud_str and '-' in atcud_str and atcud_str.upper() not in ('0', '0-0', 'NULL', 'NONE', '0 - 0', '0/0', '0/00'):
        parts = atcud_str.split('-', 1)
        serie = _limpar_alfa(parts[0]).lstrip('0')
        num_clean = _limpar_alfa(parts[1]).lstrip('0')
        if serie and num_clean and any(ch.isdigit() for ch in num_clean):
            is_atcud_valido = True
            numero = num_clean

    if is_atcud_valido:
        chave = f"{serie}{numero}"
        if chave and not chave[0].isdigit():
            chave = '0' + chave

        if len(chave) > 20:
            if serie and len(serie) < 20:
                has_zero = 1 if chave.startswith('0') else 0
                max_num_len = 20 - len(serie) - has_zero
                chave = f"{'0' if has_zero else ''}{serie}{numero[-max_num_len:]}"
            chave = chave[:20]

        if chave:
            return chave

    # Fallback determinístico sem ATCUD (Base62)
    nif_clean = re.sub(r'[^0-9]', '', str(nif or '')).strip()[:9]
    fat_clean = _limpar_alfa(str(fatura or ''))
    try:
        val_float = abs(float(total_doc or 0.0))
        tot_clean = str(int(round(val_float * 100)))
    except Exception:
        tot_clean = '0'

    raw_input = f"{nif_clean}|{fat_clean}|{tot_clean}"
    base_chave = _to_base62(raw_input, max_len=19)
    if base_chave and not base_chave[0].isdigit():
        return f"0{base_chave}"[:20]
    return base_chave[:20]

def gravar_nome_nif_cache(nif: str, nome: str, origem: str = "local"):
    """Regista um par NIF -> Nome na cache persistente de controlo_geral.db."""
    if not nif or not nome:
        return
    gravar_nomes_nifs_cache_lote({str(nif): str(nome)}, origem=origem)

def gravar_nomes_nifs_cache_lote(nomes_dict: dict, origem: str = "local"):
    """Regista múltiplos pares NIF -> Nome numa única transação SQLite (ideal para PCs lentos)."""
    if not nomes_dict:
        return
    now_iso = datetime.now().isoformat()
    batch = []
    for k_nif, v_nome in nomes_dict.items():
        if not k_nif or not v_nome:
            continue
        nif_clean = re.sub(r'[^0-9]', '', str(k_nif)).strip()
        nome_clean = str(v_nome).strip()
        if not nif_clean or not nome_clean or nif_clean in ("999999999", "999999990", "99999999"):
            continue
        if nome_clean.lower() in ("consumidor final", "consumidor final.", "[sem nome registado]"):
            continue
        batch.append((nif_clean, nome_clean, origem, now_iso))
    if not batch:
        return
    try:
        init_controlo_db()
        db_path = obter_db_controlo_path()
        with db_connect(db_path, timeout=15) as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO nif_nomes_cache (nif, nome, origem, updated_at) VALUES (?, ?, ?, ?)",
                batch
            )
            conn.commit()
    except Exception as e:
        LOGGER.debug(f"Erro ao gravar nif_nomes_cache em lote ({len(batch)} NIFs): {e}")

_CACHE_NOMES_MAPA = {}
_CACHE_NOMES_LOCK = threading.Lock()


def carregar_mapa_nomes_nifs_locais(nif_titular: str = None) -> dict:
    """
    Carrega em memória (num máximo de 3 queries únicas, com cache TTL de 60s) todos os nomes de NIFs
    já conhecidos em controlo_geral.db e nas bases de vendas/compras do cliente.
    Elimina dezenas de milhares de aberturas de SQLite linha a linha em PCs lentos.
    """
    ws_key = "local"
    try:
        import workspace_context
        if workspace_context.is_cloud_zero_storage():
            ws_key = workspace_context.get_current_ws_id()
    except Exception:
        pass
    cache_key = f"{ws_key}::{str(nif_titular or '').strip()}"
    now_ts = time.time()
    with _CACHE_NOMES_LOCK:
        cached = _CACHE_NOMES_MAPA.get(cache_key)
        if cached and (now_ts - cached[0]) < 60.0:
            return dict(cached[1])

    mapa = {}
    novos_para_cache = {}
    try:
        init_controlo_db()
        with db_connect(obter_db_controlo_path(), timeout=10) as conn:
            c = conn.cursor()
            c.execute("SELECT nif, nomecli FROM entidades_base WHERE nif != '' AND nomecli != ''")
            for r_nif, r_nome in c.fetchall():
                n_c = re.sub(r'[^0-9]', '', str(r_nif or "")).strip()
                nm_c = str(r_nome or "").strip()
                if n_c and nm_c and nm_c.lower() not in ("consumidor final", "consumidor final.", "[sem nome registado]"):
                    mapa[n_c] = nm_c
            c.execute("SELECT nif, nome FROM nif_nomes_cache WHERE nif != '' AND nome != ''")
            for r_nif, r_nome in c.fetchall():
                n_c = re.sub(r'[^0-9]', '', str(r_nif or "")).strip()
                nm_c = str(r_nome or "").strip()
                if n_c and nm_c and nm_c.lower() not in ("consumidor final", "consumidor final.", "[sem nome registado]"):
                    mapa[n_c] = nm_c
    except Exception as e:
        LOGGER.debug(f"Aviso ao carregar mapa de nomes de controlo_geral.db: {e}")

    if nif_titular:
        nif_tit_clean = re.sub(r'[^0-9]', '', str(nif_titular)).strip()[:9]
        if nif_tit_clean:
            for tipo_db, tabela in (("vendas", "efatura_vendas_linhas"), ("compras", "efatura_linhas")):
                try:
                    db_cli = obter_db_cliente_path(nif_tit_clean, tipo_db)
                    if os.path.exists(db_cli):
                        with db_connect(db_cli, timeout=10) as conn_cli:
                            c_cli = conn_cli.cursor()
                            c_cli.execute(
                                f"SELECT DISTINCT contraparte_nif, contraparte_nome FROM {tabela} "
                                "WHERE contraparte_nif != '' AND contraparte_nome != '' "
                                "AND lower(contraparte_nome) NOT IN ('consumidor final', 'consumidor final.', '[sem nome registado]')"
                            )
                            for r_nif, r_nome in c_cli.fetchall():
                                n_c = re.sub(r'[^0-9]', '', str(r_nif or "")).strip()
                                nm_c = str(r_nome or "").strip()
                                if n_c and nm_c and n_c not in mapa:
                                    mapa[n_c] = nm_c
                                    novos_para_cache[n_c] = nm_c
                except Exception as e_cli:
                    LOGGER.debug(f"Aviso ao carregar nomes locais de {tipo_db} ({nif_tit_clean}): {e_cli}")

    if novos_para_cache:
        gravar_nomes_nifs_cache_lote(novos_para_cache, origem="local_db")

    with _CACHE_NOMES_LOCK:
        _CACHE_NOMES_MAPA[cache_key] = (time.time(), dict(mapa))

    return mapa

def resolver_nome_nif_local(nif: str, cache_dict: dict = None, nif_titular: str = None) -> str:
    """Procura o nome de uma entidade na cache persistente central e tabelas locais."""
    if not nif:
        return "Consumidor final"
    nif_clean = re.sub(r'[^0-9]', '', str(nif)).strip()
    if not nif_clean or nif_clean in ("999999999", "999999990", "99999999"):
        return "Consumidor final"

    if cache_dict is not None and nif_clean in cache_dict:
        val = cache_dict[nif_clean]
        if val and val.lower() not in ("consumidor final", "consumidor final.", "[sem nome registado]"):
            return val
        return ""

    nome_encontrado = ""
    # 1. Consultar nif_nomes_cache em controlo_geral.db
    try:
        init_controlo_db()
        with db_connect(obter_db_controlo_path(), timeout=5) as conn:
            c = conn.cursor()
            c.execute("SELECT nome FROM nif_nomes_cache WHERE nif = ? AND nome != '' LIMIT 1", (nif_clean,))
            row = c.fetchone()
            if row and row[0]:
                c_nome = row[0].strip()
                if c_nome and c_nome.lower() not in ("consumidor final", "consumidor final.", "[sem nome registado]"):
                    nome_encontrado = c_nome

            if not nome_encontrado:
                # 2. Consultar entidades_base
                c.execute("SELECT nomecli FROM entidades_base WHERE (nif = ? OR nif_cc = ?) AND nomecli != '' LIMIT 1", (nif_clean, nif_clean))
                row2 = c.fetchone()
                if row2 and row2[0]:
                    nome_encontrado = row2[0].strip()
    except Exception as e:
        LOGGER.debug(f"Erro ao consultar cache de NIFs em controlo_geral.db: {e}")

    # 3. Se ainda não encontrado e tivermos nif_titular, consultar bases locais do cliente
    if not nome_encontrado and nif_titular:
        nif_tit_clean = re.sub(r'[^0-9]', '', str(nif_titular)).strip()[:9]
        if nif_tit_clean:
            # 3.1 Consultar vendas do cliente
            try:
                db_vendas = obter_db_cliente_path(nif_tit_clean, "vendas")
                if os.path.exists(db_vendas):
                    with db_connect(db_vendas, timeout=5) as conn_v:
                        c_v = conn_v.cursor()
                        c_v.execute(
                            "SELECT contraparte_nome FROM efatura_vendas_linhas "
                            "WHERE contraparte_nif = ? AND contraparte_nome != '' "
                            "AND lower(contraparte_nome) NOT IN ('consumidor final', 'consumidor final.', '[sem nome registado]') LIMIT 1",
                            (nif_clean,)
                        )
                        row_v = c_v.fetchone()
                        if row_v and row_v[0]:
                            nome_encontrado = row_v[0].strip()
            except Exception as ev:
                LOGGER.debug(f"Erro ao consultar vendas de {nif_tit_clean}: {ev}")

            # 3.2 Consultar compras do cliente
            if not nome_encontrado:
                try:
                    db_compras = obter_db_cliente_path(nif_tit_clean, "compras")
                    if os.path.exists(db_compras):
                        with db_connect(db_compras, timeout=5) as conn_c:
                            c_c = conn_c.cursor()
                            c_c.execute(
                                "SELECT contraparte_nome FROM efatura_linhas "
                                "WHERE contraparte_nif = ? AND contraparte_nome != '' "
                                "AND lower(contraparte_nome) NOT IN ('consumidor final', 'consumidor final.', '[sem nome registado]') LIMIT 1",
                                (nif_clean,)
                            )
                            row_c = c_c.fetchone()
                            if row_c and row_c[0]:
                                nome_encontrado = row_c[0].strip()
                except Exception as ec:
                    LOGGER.debug(f"Erro ao consultar compras de {nif_tit_clean}: {ec}")

    if cache_dict is not None:
        cache_dict[nif_clean] = nome_encontrado

    if nome_encontrado:
        # Gravar na cache central para consultas futuras imediatas
        gravar_nome_nif_cache(nif_clean, nome_encontrado, origem="local_db")

    return nome_encontrado

def atualizar_nomes_vendas_db(nif_titular: str, nomes_dict: dict):
    """Atualiza os nomes de contrapartes na base particionada de vendas do cliente numa única transação."""
    if not nif_titular or not nomes_dict:
        return
    nif_clean = re.sub(r'[^0-9]', '', str(nif_titular)).strip()[:9]
    db_path = obter_db_cliente_path(nif_clean, "vendas")
    if not os.path.exists(db_path):
        return
    lote_sem_registo = []
    lote_com_nome = []
    for cp_nif, nome in nomes_dict.items():
        if cp_nif and nome and str(nome).strip().lower() not in ("consumidor final", "consumidor final."):
            nome_val = str(nome).strip()
            if nome_val.lower() == "[sem nome registado]":
                lote_sem_registo.append((nome_val, cp_nif.strip()))
            else:
                lote_com_nome.append((nome_val, cp_nif.strip()))
    if not lote_sem_registo and not lote_com_nome:
        return
    try:
        with db_connect(db_path, timeout=30) as conn:
            c = conn.cursor()
            if lote_sem_registo:
                c.executemany(
                    "UPDATE efatura_vendas_linhas SET contraparte_nome = ? "
                    "WHERE contraparte_nif = ? AND (contraparte_nome IS NULL OR contraparte_nome = '' OR lower(contraparte_nome) IN ('consumidor final', 'consumidor final.'))",
                    lote_sem_registo
                )
            if lote_com_nome:
                c.executemany(
                    "UPDATE efatura_vendas_linhas SET contraparte_nome = ? "
                    "WHERE contraparte_nif = ? AND (contraparte_nome IS NULL OR contraparte_nome = '' OR lower(contraparte_nome) IN ('consumidor final', 'consumidor final.', '[sem nome registado]'))",
                    lote_com_nome
                )
            conn.commit()
    except Exception as e:
        LOGGER.warning(f"Aviso ao atualizar nomes na BD de vendas de {nif_clean}: {e}")

def init_anuladas_db(nif: str):
    """Inicializa a base de dados dedicada para faturas anuladas (BdsefaturaV4/{NIF}/anuladas_{NIF}.db)."""
    if not nif:
        return
    nif_clean = re.sub(r'[^0-9]', '', str(nif)).strip()[:9]
    db_path = obter_db_cliente_path(nif_clean, "anuladas")
    try:
        with db_connect(db_path, timeout=30) as conn:
            c = conn.cursor()
            c.execute("""
            CREATE TABLE IF NOT EXISTS efatura_anuladas (
                id TEXT PRIMARY KEY,
                id_fatura_unico TEXT UNIQUE,
                modulo TEXT NOT NULL,
                fatura TEXT,
                atcud TEXT,
                data_emissao TEXT,
                contraparte_nif TEXT,
                contraparte_nome TEXT,
                total_liquido REAL DEFAULT 0.0,
                total_iva REAL DEFAULT 0.0,
                total_doc REAL DEFAULT 0.0,
                data_anulacao TEXT,
                data_deteccao TEXT,
                created_at TEXT
            );
            """)
            c.execute("CREATE INDEX IF NOT EXISTS idx_anuladas_cp_nif ON efatura_anuladas(contraparte_nif);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_anuladas_dt ON efatura_anuladas(data_emissao);")
            conn.commit()
    except Exception as e:
        LOGGER.warning(f"Aviso ao inicializar anuladas_{nif_clean}.db: {e}")

def upsert_anuladas_direto(nif: str, rows: list, modulo: str = "compras"):
    """Insere ou atualiza faturas anuladas na base dedicada anuladas_{NIF}.db."""
    if not nif or not rows:
        return
    nif_clean = re.sub(r'[^0-9]', '', str(nif)).strip()[:9]
    init_anuladas_db(nif_clean)
    db_path = obter_db_cliente_path(nif_clean, "anuladas")
    agora_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        with db_connect(db_path, timeout=30) as conn:
            c = conn.cursor()
            for r in rows:
                if isinstance(r, dict):
                    doc_num = str(r.get("fatura") or r.get("numerodocumento") or "").strip()
                    atcud = str(r.get("atcud") or "").strip()
                    dt_emissao = str(r.get("data_emissao") or r.get("dataEmissaoDocumento") or "").strip()
                    cp_nif = str(r.get("contraparte_nif") or r.get("nifAdquirente") or r.get("nifEmitente") or "").strip()
                    cp_nome = str(r.get("contraparte_nome") or r.get("nomeAdquirente") or r.get("nomeEmitente") or "").strip()
                    t_doc = float(r.get("total_doc") or r.get("total") or 0.0)
                    t_liq = float(r.get("total_liquido_doc") or r.get("total_liquido") or 0.0)
                    t_iva = float(r.get("total_iva") or r.get("imposto") or 0.0)
                    dt_anul = str(r.get("data_anulacao") or agora_iso).strip()
                    uid = str(r.get("id_fatura_unico") or r.get("idDocumento") or f"A_{nif_clean}_{doc_num}").strip()
                else:
                    doc_num = getattr(r, "numerodocumento", "") or getattr(r, "fatura", "")
                    atcud = getattr(r, "atcud", "") or ""
                    dt_emissao = getattr(r, "dataEmissaoDocumento", "") or getattr(r, "data_emissao", "")
                    cp_nif = getattr(r, "nifAdquirente", "") if modulo == "vendas" else getattr(r, "nifEmitente", "")
                    cp_nome = getattr(r, "nomeAdquirente", "") if modulo == "vendas" else getattr(r, "nomeEmitente", "")
                    t_doc = float(getattr(r, "total", 0.0) or 0.0)
                    t_liq = float(getattr(r, "total_liquido", 0.0) or 0.0)
                    t_iva = float(getattr(r, "imposto", 0.0) or 0.0)
                    dt_anul = agora_iso
                    uid = str(getattr(r, "idDocumento", "") or f"A_{nif_clean}_{doc_num}").strip()

                reg_id = str(uuid.uuid4())
                c.execute("""
                INSERT INTO efatura_anuladas (
                    id, id_fatura_unico, modulo, fatura, atcud, data_emissao,
                    contraparte_nif, contraparte_nome, total_liquido, total_iva,
                    total_doc, data_anulacao, data_deteccao, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id_fatura_unico) DO UPDATE SET
                    contraparte_nome = excluded.contraparte_nome,
                    data_anulacao = excluded.data_anulacao,
                    data_deteccao = excluded.data_deteccao;
                """, (
                    reg_id, uid, modulo, doc_num, atcud, dt_emissao,
                    cp_nif, cp_nome, t_liq, t_iva, t_doc, dt_anul, agora_iso, agora_iso
                ))
            conn.commit()
    except Exception as e:
        LOGGER.warning(f"Aviso ao gravar anuladas em {db_path}: {e}")

def atualizar_nomes_xml_legado(nif: str, nomes_dict: dict, data_inicio: str = None, data_fim: str = None, pasta_raiz: str = None):
    """
    Atualiza atomicamente os ficheiros XML de Vendas em BdsefaturaV3/V com os nomes resolvidos.
    Usa ficheiro temporário (.tmp) + os.replace com retries defensivos para proteger contra leituras do Excel.
    """
    if not nif or not nomes_dict:
        return
    nif_clean = re.sub(r'[^0-9]', '', str(nif)).strip()[:9]
    import legado_bridge
    raiz = pasta_raiz or legado_bridge.obter_caminho_dados_gexcel()
    if not raiz or not os.path.exists(raiz):
        return

    pasta_vendas = os.path.join(raiz, "BdsefaturaV3", "V")
    if not os.path.exists(pasta_vendas):
        return

    # Procurar ficheiros XML desta entidade
    ficheiros_alvo = []
    try:
        for root, dirs, files in os.walk(pasta_vendas):
            if nif_clean in root:
                for f in files:
                    if f.endswith(f".{nif_clean}.efatV.xml"):
                        ficheiros_alvo.append(os.path.join(root, f))
    except Exception as e_w:
        LOGGER.debug(f"Aviso ao pesquisar ficheiros XML: {e_w}")

    if not ficheiros_alvo:
        return

    for xml_path in ficheiros_alvo:
        try:
            with open(xml_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

            modificado = False
            for cp_nif, nome in nomes_dict.items():
                if not cp_nif or not nome or nome == "[Sem Nome Registado]":
                    continue
                # Se o NIF estiver presente no XML com nome vazio ou Consumidor Final
                pattern = rf"(<Linha>[\s\S]*?<NIF_ComerConsu>{cp_nif}</NIF_ComerConsu>[\s\S]*?<Nome_ComerConsu>)(.*?)(</Nome_ComerConsu>)"
                def _sub_fn(m):
                    nonlocal modificado
                    curr = m.group(2).strip()
                    if not curr or curr.lower() in ("consumidor final", "consumidor final.", "[sem nome registado]"):
                        modificado = True
                        escaped = nome.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                        return f"{m.group(1)}{escaped}{m.group(3)}"
                    return m.group(0)

                content = re.sub(pattern, _sub_fn, content)

            if modificado:
                tmp_xml = xml_path + f".{uuid.uuid4().hex[:6]}.tmp"
                with open(tmp_xml, "w", encoding="utf-8", newline="\r\n") as f_out:
                    f_out.write(content)
                # Troca atómica com retry para sobreviver a bloqueios transitórios do Excel
                for tentativa in range(5):
                    try:
                        os.replace(tmp_xml, xml_path)
                        LOGGER.info(f"✅ [XML V3 ATUALIZADO] {os.path.basename(xml_path)} enriquecido com nomes resolvidos.")
                        break
                    except PermissionError:
                        time.sleep(0.3)
                    except Exception:
                        break
                if os.path.exists(tmp_xml):
                    try:
                        os.remove(tmp_xml)
                    except Exception:
                        pass
        except Exception as e_xml:
            LOGGER.warning(f"Aviso ao atualizar XML {xml_path}: {e_xml}")

def obter_nifs_vendas_sem_nome(nif_titular: str, limit: Optional[int] = None) -> dict:
    """Recupera amostras de faturas para NIFs sem nome na base de dados de vendas local."""
    if not nif_titular:
        return {}
    nif_clean = re.sub(r'[^0-9]', '', str(nif_titular)).strip()[:9]
    db_path = obter_db_cliente_path(nif_clean, "vendas")
    if not os.path.exists(db_path):
        return {}
    res = {}
    try:
        with sqlite3.connect(db_path, timeout=30) as conn:
            c = conn.cursor()
            lim_clause = f" LIMIT {int(limit)}" if limit else ""
            c.execute(f"""
                SELECT DISTINCT contraparte_nif, fatura, data_emissao
                FROM efatura_vendas_linhas
                WHERE contraparte_nif NOT IN ('999999999', '999999990', '')
                  AND (contraparte_nome IS NULL OR contraparte_nome = '' OR lower(contraparte_nome) IN ('consumidor final', 'consumidor final.'))
                {lim_clause}
            """)
            for row in c.fetchall():
                cp_nif = str(row[0]).strip()
                if cp_nif not in res:
                    res[cp_nif] = {
                        "nif": cp_nif,
                        "fatura": str(row[1] or "").strip(),
                        "data": str(row[2] or "").strip()[:10]
                    }
    except Exception as e:
        LOGGER.warning(f"Aviso ao consultar NIFs sem nome na BD de vendas de {nif_clean}: {e}")
    return res

def resolver_nif_vies(nif: str, country_code: str = "PT") -> Optional[str]:
    """
    Consulta o serviço REST oficial da Comissão Europeia (VIES) para obter o nome oficial da empresa.
    Retorna o nome formatado ou None se inválido/falha.
    """
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if len(nif_clean) != 9:
        return None

    url_rest = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number"
    headers = {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 GexcelEVO/4.2"}
    payload = {"countryCode": country_code, "vatNumber": nif_clean}

    for tentativa in range(3):
        try:
            r = requests.post(url_rest, json=payload, headers=headers, timeout=4)
            if r.status_code == 200:
                data = r.json()
                if data.get("valid") and data.get("name"):
                    nome_raw = str(data["name"]).strip()
                    nome_limpo = " ".join(nome_raw.split())
                    if nome_limpo and nome_limpo != "---":
                        try:
                            import efatura_api
                            return efatura_api.to_title_case(nome_limpo)
                        except Exception:
                            return nome_limpo.title()
                if "MS_MAX_CONCURRENT_REQ" in r.text:
                    time.sleep(0.5 * (tentativa + 1))
                    continue
            break
        except Exception:
            time.sleep(0.4)

    return None

def resolver_nif_nifpt(nif: str) -> Optional[str]:
    """
    Consulta o directório NIF.pt / Racius para obter a denominação social oficial.
    Retorna o nome formatado ou None se não encontrado.
    """
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if len(nif_clean) != 9:
        return None

    url = f"https://www.nif.pt/{nif_clean}/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
    try:
        r = requests.get(url, headers=headers, timeout=4)
        if r.status_code == 200:
            import html
            m = re.search(r"class=['\"]search-title['\"][^>]*>([^<]+)</span>", r.text)
            if not m:
                m = re.search(r"pertence à empresa ([^.]+)\.", r.text)
            if m:
                nome_raw = html.unescape(" ".join(m.group(1).strip().split()))
                if nome_raw and not nome_raw.isdigit():
                    try:
                        import efatura_api
                        return efatura_api.to_title_case(nome_raw)
                    except Exception:
                        return nome_raw.title()
    except Exception:
        pass
    return None

def resolver_nif_coletivo_cascata(nif: str) -> Optional[str]:
    """
    Resolve o nome de entidades coletivas (empresas 5xx, organismos 6xx, associações 9xx, etc.):
    1. Tenta NIF.pt / Racius (rápido, ~0.15s, cobertura 99% em Portugal)
    2. Fallback para VIES (Comissão Europeia)
    """
    nome = resolver_nif_nifpt(nif)
    if nome:
        return nome
    return resolver_nif_vies(nif)

def resolver_nifs_empresariais_lote(nifs: list, max_workers: int = 10, callback=None, timeout_global: Optional[float] = None) -> dict:
    """
    Consulta concorrente (10 threads simultâneas) em cascata com limite de tempo opcional.
    Grava em lote numa única transação na cache central e devolve o dicionário {nif: nome}.
    """
    if not nifs:
        return {}

    nifs_unicos = list(set(re.sub(r'[^0-9]', '', str(n)).strip()[:9] for n in nifs if n))
    if not nifs_unicos:
        return {}
    total = len(nifs_unicos)
    resultados = {}
    concluidos = 0

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=min(max_workers, total))
    try:
        future_to_nif = {executor.submit(resolver_nif_coletivo_cascata, n): n for n in nifs_unicos}
        try:
            for fut in concurrent.futures.as_completed(future_to_nif, timeout=timeout_global):
                n = future_to_nif[fut]
                concluidos += 1
                try:
                    nome = fut.result()
                    if nome:
                        resultados[n] = nome
                        LOGGER.info(f"✅ [EMPRESA RESOLVIDA] NIF {n} -> '{nome}'")
                except Exception as e:
                    LOGGER.debug(f"Falha na resolução coletiva do NIF {n}: {e}")

                if callback:
                    try:
                        callback(concluidos, total)
                    except Exception:
                        pass
        except concurrent.futures.TimeoutError:
            LOGGER.info(
                f"⏱️ [EMPRESAS TIMEOUT ORÇAMENTO] Orçamento de {timeout_global}s atingido "
                f"({len(resultados)}/{total} resolvidos). Restantes delegados ao segundo plano."
            )
    finally:
        try:
            executor.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            executor.shutdown(wait=False)

    if resultados:
        gravar_nomes_nifs_cache_lote(resultados, origem="empresas")

    return resultados

# Alias para compatibilidade
resolver_nifs_vies_lote = resolver_nifs_empresariais_lote

def _decrypt_legacy_pwd(pwd):
    return legado_bridge.descodificar_senha_legada(pwd)

def is_caminho_rede(path: str) -> bool:
    """Verifica se um caminho reside numa partilha de rede (UNC ou letra de drive remota)."""
    if not path:
        return False
    try:
        p = os.path.abspath(path)
        if p.startswith(("\\\\", "//")):
            return True
        import ctypes
        drive = os.path.splitdrive(p)[0]
        if drive:
            drive_root = drive + "\\" if not drive.endswith("\\") else drive
            # DRIVE_REMOTE = 4 no Windows
            return ctypes.windll.kernel32.GetDriveTypeW(drive_root) == 4
    except Exception:
        pass
    return False

def aplicar_pragmas_conexao(conn: sqlite3.Connection, db_path: str = "", timeout: int = 30):
    """
    Aplica PRAGMAs com compatibilidade inteligente:
    - Em discos locais: WAL + synchronous=NORMAL (máximo desempenho).
    - Em partilhas de rede (UNC / SMB): DELETE + synchronous=NORMAL (evita falhas do ficheiro -shm em SMB).
    - Fallback resiliente para DELETE caso WAL falhe.
    """
    try:
        conn.execute(f"PRAGMA busy_timeout = {int(timeout * 1000)};")
        if is_caminho_rede(db_path):
            conn.execute("PRAGMA journal_mode = DELETE;")
            conn.execute("PRAGMA synchronous = NORMAL;")
        else:
            try:
                conn.execute("PRAGMA journal_mode = WAL;")
                conn.execute("PRAGMA synchronous = NORMAL;")
            except Exception:
                conn.execute("PRAGMA journal_mode = DELETE;")
                conn.execute("PRAGMA synchronous = NORMAL;")
    except Exception as e:
        LOGGER.debug(f"Aviso ao configurar PRAGMAs para {db_path}: {e}")

class _ClosingSQLiteConnection(sqlite3.Connection):
    """Garante que 'with db_connect(...) as conn:' faz commit/rollback E fecha o descritor no Windows."""
    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            return super().__exit__(exc_type, exc_val, exc_tb)
        finally:
            try:
                self.close()
            except Exception:
                pass


def db_connect(path=None, timeout=30):
    """Cria uma conexão SQLite resiliente com timeout estendido e PRAGMAs otimizados para rede/local."""
    if not path:
        path = obter_db_controlo_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, timeout=timeout, factory=_ClosingSQLiteConnection)
    aplicar_pragmas_conexao(conn, path, timeout)
    return conn

_CLIENT_DBS_INITIALIZED = set()

def init_compras_db(nif: str = None):
    """Garante que a base SQLite de Compras do cliente está inicializada com índices e tabela efatura_linhas."""
    if not nif:
        init_controlo_db()
        return
    db_path = obter_db_cliente_path(nif, "compras")
    if db_path in _CLIENT_DBS_INITIALIZED and os.path.exists(db_path):
        return
    try:
        with db_connect(db_path, timeout=30) as conn:
            c = conn.cursor()
            c.execute("""
            CREATE TABLE IF NOT EXISTS `efatura_linhas` (
                `id` TEXT PRIMARY KEY,
                `id_cliente` TEXT DEFAULT '' NOT NULL,
                `hash_linha` TEXT DEFAULT '' NOT NULL,
                `id_fatura_unico` TEXT DEFAULT '' NOT NULL,
                `nif_cliente` TEXT DEFAULT '' NOT NULL,
                `fatura` TEXT DEFAULT '' NOT NULL,
                `atcud` TEXT DEFAULT '' NOT NULL,
                `data_emissao` TEXT DEFAULT '' NOT NULL,
                `tipo_documento` TEXT DEFAULT '' NOT NULL,
                `estado_documento` TEXT DEFAULT '' NOT NULL,
                `contraparte_nif` TEXT DEFAULT '' NOT NULL,
                `contraparte_nome` TEXT DEFAULT '' NOT NULL,
                `contraparte_pais` TEXT DEFAULT '' NOT NULL,
                `setor_atividade` TEXT DEFAULT '' NOT NULL,
                `tipo_imposto` TEXT DEFAULT '' NOT NULL,
                `codigo_taxa` TEXT DEFAULT '' NOT NULL,
                `taxa_percentagem` REAL DEFAULT 0 NOT NULL,
                `base_incidencia` REAL DEFAULT 0 NOT NULL,
                `valor_imposto` REAL DEFAULT 0 NOT NULL,
                `codigo_isencao` TEXT DEFAULT '' NOT NULL,
                `regiao_fiscal` TEXT DEFAULT '' NOT NULL,
                `total_liquido_doc` REAL DEFAULT 0 NOT NULL,
                `total_doc` REAL DEFAULT 0 NOT NULL,
                `created` TEXT DEFAULT '' NOT NULL,
                `updated` TEXT DEFAULT '' NOT NULL
            );
            """)
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_compras_hash ON efatura_linhas(hash_linha);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_compras_cliente_data ON efatura_linhas(nif_cliente, data_emissao);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_compras_id_cliente ON efatura_linhas(id_cliente);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_compras_contraparte ON efatura_linhas(contraparte_nif);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_compras_id_fatura ON efatura_linhas(id_fatura_unico);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_compras_fatura ON efatura_linhas(contraparte_nif, fatura);")
            conn.commit()
        _CLIENT_DBS_INITIALIZED.add(db_path)
    except Exception as e:
        LOGGER.warning(f"Aviso ao inicializar base de compras ({db_path}): {e}")

def init_vendas_db(nif: str = None):
    """Garante que a base SQLite de Vendas do cliente está inicializada com índices e tabela efatura_vendas_linhas."""
    if not nif:
        init_controlo_db()
        return
    db_path = obter_db_cliente_path(nif, "vendas")
    if db_path in _CLIENT_DBS_INITIALIZED and os.path.exists(db_path):
        return
    try:
        with db_connect(db_path, timeout=30) as conn:
            c = conn.cursor()
            c.execute("""
            CREATE TABLE IF NOT EXISTS `efatura_vendas_linhas` (
                `id` TEXT PRIMARY KEY,
                `id_cliente` TEXT DEFAULT '' NOT NULL,
                `hash_linha` TEXT DEFAULT '' NOT NULL,
                `id_fatura_unico` TEXT DEFAULT '' NOT NULL,
                `nif_cliente` TEXT DEFAULT '' NOT NULL,
                `fatura` TEXT DEFAULT '' NOT NULL,
                `atcud` TEXT DEFAULT '' NOT NULL,
                `data_emissao` TEXT DEFAULT '' NOT NULL,
                `tipo_documento` TEXT DEFAULT '' NOT NULL,
                `estado_documento` TEXT DEFAULT '' NOT NULL,
                `contraparte_nif` TEXT DEFAULT '' NOT NULL,
                `contraparte_nome` TEXT DEFAULT '' NOT NULL,
                `contraparte_pais` TEXT DEFAULT '' NOT NULL,
                `setor_atividade` TEXT DEFAULT '' NOT NULL,
                `tipo_imposto` TEXT DEFAULT '' NOT NULL,
                `codigo_taxa` TEXT DEFAULT '' NOT NULL,
                `taxa_percentagem` REAL DEFAULT 0 NOT NULL,
                `base_incidencia` REAL DEFAULT 0 NOT NULL,
                `valor_imposto` REAL DEFAULT 0 NOT NULL,
                `codigo_isencao` TEXT DEFAULT '' NOT NULL,
                `regiao_fiscal` TEXT DEFAULT '' NOT NULL,
                `total_liquido_doc` REAL DEFAULT 0 NOT NULL,
                `total_doc` REAL DEFAULT 0 NOT NULL,
                `created` TEXT DEFAULT '' NOT NULL,
                `updated` TEXT DEFAULT '' NOT NULL
            );
            """)
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_vendas_hash ON efatura_vendas_linhas(hash_linha);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_vendas_cliente_data ON efatura_vendas_linhas(nif_cliente, data_emissao);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_vendas_id_cliente ON efatura_vendas_linhas(id_cliente);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_vendas_contraparte ON efatura_vendas_linhas(contraparte_nif);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_vendas_id_fatura ON efatura_vendas_linhas(id_fatura_unico);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_vendas_fatura ON efatura_vendas_linhas(fatura);")
            conn.commit()
        _CLIENT_DBS_INITIALIZED.add(db_path)
    except Exception as e:
        LOGGER.warning(f"Aviso ao inicializar base de vendas ({db_path}): {e}")

_CONTROLO_DBS_INITIALIZED = set()
_CONTROLO_DBS_LOCK = threading.Lock()

def init_controlo_db():
    """Garante que a base controlo_geral.db e respetivas tabelas centrais de controlo existem."""
    db_path = obter_db_controlo_path()
    with _CONTROLO_DBS_LOCK:
        if db_path in _CONTROLO_DBS_INITIALIZED and os.path.exists(db_path):
            return
    try:
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        with db_connect(db_path, timeout=30) as conn:
            c = conn.cursor()
            c.execute("""
            CREATE TABLE IF NOT EXISTS `efatura_controlo_mensal` (
                `nif` TEXT NOT NULL,
                `ano` INTEGER NOT NULL,
                `mes` INTEGER NOT NULL,
                `tipo` TEXT NOT NULL,
                `total_esperado` INTEGER NOT NULL DEFAULT 0,
                `docs_gravados` INTEGER NOT NULL DEFAULT 0,
                `total_linhas` INTEGER NOT NULL DEFAULT 0,
                `soma_base` REAL NOT NULL DEFAULT 0.0,
                `soma_iva` REAL NOT NULL DEFAULT 0.0,
                `completo` INTEGER NOT NULL DEFAULT 0,
                `updated_at` TEXT DEFAULT '' NOT NULL,
                PRIMARY KEY (`nif`, `ano`, `mes`, `tipo`)
            );
            """)
            c.execute("CREATE INDEX IF NOT EXISTS idx_controlo_ano_tipo ON efatura_controlo_mensal (`ano`, `tipo`);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_controlo_nif ON efatura_controlo_mensal (`nif`);")

            c.execute("""
            CREATE TABLE IF NOT EXISTS `senhas_invalidas_at` (
                `nif` TEXT PRIMARY KEY,
                `senha` TEXT NOT NULL,
                `erro_detalhe` TEXT DEFAULT '',
                `updated_at` TEXT DEFAULT ''
            );
            """)

            c.execute("""
            CREATE TABLE IF NOT EXISTS `efatura_inconformidades` (
                `id` TEXT PRIMARY KEY,
                `id_fatura_unico` TEXT NOT NULL,
                `modulo` TEXT NOT NULL,
                `nif_cliente` TEXT NOT NULL,
                `fatura` TEXT NOT NULL,
                `data_emissao` TEXT NOT NULL,
                `valor_total` REAL NOT NULL,
                `data_deteccao` TEXT NOT NULL
            );
            """)
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS `idx_inconf_fatura` ON `efatura_inconformidades` (`id_fatura_unico`);")
            c.execute("CREATE INDEX IF NOT EXISTS `idx_inconf_cliente_data` ON `efatura_inconformidades` (`nif_cliente`, `data_deteccao`);")

            c.execute("""
            CREATE TABLE IF NOT EXISTS `entidades_base` (
                `id` TEXT PRIMARY KEY,
                `nif` TEXT NOT NULL,
                `nif_cc` TEXT DEFAULT '',
                `nomecli` TEXT NOT NULL
            );
            """)
            c.execute("""
            CREATE TABLE IF NOT EXISTS `entidades_senhas` (
                `id` TEXT PRIMARY KEY,
                `nomecli` TEXT NOT NULL,
                `password_efatura` TEXT DEFAULT '',
                `password_at` TEXT DEFAULT '',
                `utilizador_efatura` TEXT DEFAULT '',
                `utilizador_at` TEXT DEFAULT '',
                `senha_invalida_at` TEXT DEFAULT '',
                `erro_at_detalhe` TEXT DEFAULT ''
            );
            """)
            c.execute("""
            CREATE TABLE IF NOT EXISTS `nif_nomes_cache` (
                `nif` TEXT PRIMARY KEY,
                `nome` TEXT NOT NULL,
                `origem` TEXT DEFAULT '',
                `updated_at` TEXT DEFAULT ''
            );
            """)
            c.execute("CREATE INDEX IF NOT EXISTS `idx_nif_nomes_nif` ON `nif_nomes_cache` (`nif`);")
            conn.commit()
        with _CONTROLO_DBS_LOCK:
            _CONTROLO_DBS_INITIALIZED.add(db_path)
    except Exception as e:
        LOGGER.warning(f"Aviso ao inicializar base de controlo ({db_path}): {e}")

def init_senhas_invalidas_db():
    """Garante tabela leve de senhas inválidas em controlo_geral.db."""
    try:
        init_controlo_db()
    except Exception as e:
        LOGGER.debug(f"Aviso ao inicializar senhas_invalidas_db: {e}")

def init_inconformidades_db():
    """Garante que a tabela efatura_inconformidades existe no controlo_geral.db."""
    try:
        init_controlo_db()
    except Exception as e:
        LOGGER.debug(f"Aviso ao inicializar inconformidades_db: {e}")

def registar_inconformidade(
    id_fatura_unico: str,
    modulo: str,
    nif_cliente: str,
    fatura: str,
    data_emissao: str,
    valor_total: float,
    data_deteccao: str = "",
    conn=None
) -> bool:
    """Regista uma inconformidade por anulação tardia de fatura em efatura_inconformidades no controlo_geral.db."""
    if not id_fatura_unico:
        return False
    import string, random
    from datetime import datetime

    chars = string.ascii_lowercase + string.digits
    inconf_id = "".join(random.choice(chars) for _ in range(15))
    dt_deteccao = data_deteccao or datetime.now().strftime("%Y-%m-%d")
    dt_emissao = str(data_emissao or "")[:10]

    sql = """
    INSERT OR IGNORE INTO efatura_inconformidades (
        id, id_fatura_unico, modulo, nif_cliente, fatura, data_emissao, valor_total, data_deteccao
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """
    params = (
        inconf_id,
        str(id_fatura_unico),
        str(modulo).lower(),
        str(nif_cliente),
        str(fatura),
        dt_emissao,
        float(valor_total or 0.0),
        dt_deteccao
    )

    init_controlo_db()
    db_path = obter_db_controlo_path()
    if conn:
        conn.execute(sql, params)
        return True
    else:
        with sqlite3.connect(db_path, timeout=30) as c_db:
            c_db.execute(sql, params)
            c_db.commit()
        return True

def obter_dbs_gestor_entidades_evo12() -> List[str]:
    """
    Localiza as bases SQLite oficiais do Gestor de Entidades (EVO-12 / PocketBase / SafeDrive):
    - Windows SafeDrive Index Core: C:\\ProgramData\\GExcelAYD\\SafeDrive\\index_core\\pb_data\\data.db
    - Linux Hetzner EVO-12: /opt/gexcel/evo12/pb_data/data.db e /opt/gexcel/evo12/safedrive/index_core/pb_data/data.db
    """
    candidatos = []
    env_pb = os.environ.get("GEXCEL_EVO12_DB_PATH")
    if env_pb:
        candidatos.append(env_pb)
    if os.name == "nt":
        candidatos.extend([
            r"C:\Dados_evoGex\index_core\pb_data\data.db",
            r"C:\ProgramData\GExcelAYD\SafeDrive\index_core\pb_data\data.db",
            r"C:\DEV\Ecossistema_Gexcel\03_EVO_Ecossistema_Evo\EVO-12-Entidades e Cofre\pb_data\data.db",
        ])
    else:
        candidatos.extend([
            "/opt/gexcel/evo12/pb_data/data.db",
            "/opt/gexcel/evo12/safedrive/index_core/pb_data/data.db",
        ])
    return [c for c in candidatos if c and os.path.exists(c)]


def obter_db_workspace_evo12_ram(ws_id: Optional[str] = None) -> Optional[str]:
    """
    Localiza a base SQLite efemera em RAM do Gestor de Entidades (EVO-12) para este workspace_id.
    Utiliza exatamente o mesmo hash SHA-256[:24] do motor gexcel_bridge_service na Hetzner.
    """
    import tempfile
    wid = ws_id
    if not wid:
        try:
            import workspace_context
            wid = workspace_context.get_current_ws_id()
        except Exception:
            wid = ""
    clean_id = (wid or "").strip()
    if not clean_id or clean_id == "unlinked_empty":
        return None
    try:
        import workspace_context
        sbx_dir = workspace_context.resolve_sandbox_dir(clean_id)
        if sbx_dir is not None:
            sbx_db = sbx_dir / "data.db"
            if sbx_db.is_file() and sbx_db.stat().st_size > 0:
                return str(sbx_db)
            return None
    except Exception:
        pass
    digest = hashlib.sha256(clean_id.encode("utf-8")).hexdigest()[:24]
    candidatos = [
        f"/dev/shm/evo12_workspaces/ws_{digest}.db",
        os.path.join(tempfile.gettempdir(), "evo12_workspaces", f"ws_{digest}.db"),
    ]
    for p in candidatos:
        try:
            if p and os.path.exists(p) and os.path.getsize(p) > 0:
                return p
        except Exception:
            continue
    return None


def tem_entidades_workspace_evo12_ram(ws_id: Optional[str] = None) -> bool:
    """Verifica rapidamente se existem entidades ativas no workspace RAM partilhado com EVO-12."""
    db_ws = obter_db_workspace_evo12_ram(ws_id)
    if not db_ws:
        return False
    try:
        with sqlite3.connect(db_ws, timeout=3) as conn:
            conn.execute("PRAGMA busy_timeout=3000;")
            c = conn.cursor()
            c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='entidades_base'")
            if not c.fetchone():
                return False
            c.execute(
                "SELECT 1 FROM entidades_base WHERE nif != '' AND ativo NOT IN (0, '0', 'false', 'False') LIMIT 1"
            )
            return c.fetchone() is not None
    except Exception:
        return False


def _carregar_entidades_db_evo12(db_path: str, por_nif: Dict[str, Dict[str, Any]], origem: str = "evo12_gestor_entidades") -> None:
    """Lê entidades_base + entidades_senhas de uma base SQLite EVO-12 para o dicionário por NIF."""
    try:
        with sqlite3.connect(db_path, timeout=5) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA busy_timeout=5000;")
            c = conn.cursor()
            c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='entidades_base'")
            if not c.fetchone():
                return
            c.execute("""
                SELECT eb.id as pb_id,
                       eb.idcli as cod,
                       eb.nif as nif,
                       eb.nif_cc as nif_cc,
                       eb.nomecli as nomecli,
                       eb.ativo as ativo,
                       es.utilizador_efatura as utilizador_efatura,
                       es.password_efatura as password_efatura,
                       es.utilizador_at as utilizador_at,
                       es.password_at as password_at,
                       es.senha_invalida_at as senha_invalida_at,
                       es.erro_at_detalhe as erro_at_detalhe
                FROM entidades_base eb
                LEFT JOIN entidades_senhas es ON es.nomecli = eb.id
                ORDER BY eb.nomecli ASC
            """)
            for r in c.fetchall():
                nif_raw = str(r["nif"] or r["nif_cc"] or "").strip()
                nif_clean = re.sub(r"[^0-9]", "", nif_raw)[:9]
                if len(nif_clean) != 9:
                    continue
                ativo_val = r["ativo"]
                if ativo_val in (0, False, "0", "false", "False"):
                    continue

                p_efat = str(r["password_efatura"] or "").strip()
                u_efat = str(r["utilizador_efatura"] or "").strip()
                p_at = str(r["password_at"] or "").strip()
                u_at = str(r["utilizador_at"] or "").strip()
                if p_efat:
                    raw_pwd = p_efat
                    sub_raw_orig = u_efat or u_at or nif_clean
                else:
                    raw_pwd = p_at
                    sub_raw_orig = u_at or u_efat or nif_clean
                pwd_dec = legado_bridge.descodificar_senha_legada(raw_pwd) if raw_pwd else ""
                sub_raw = legado_bridge.normalizar_subutilizador_at(nif_clean, sub_raw_orig)
                cod_cli = str(r["cod"] or "").strip()
                nome_cli = str(r["nomecli"] or f"Entidade {nif_clean}").strip()

                existente = por_nif.get(nif_clean)
                if not existente or (pwd_dec and not existente.get("password")):
                    por_nif[nif_clean] = {
                        "id": nif_clean,
                        "pb_id": str(r["pb_id"] or nif_clean),
                        "cod": cod_cli,
                        "nif": nif_clean,
                        "nif_cc": str(r["nif_cc"] or nif_clean).strip(),
                        "nomecli": nome_cli,
                        "ativo": True,
                        "subutilizador": sub_raw or nif_clean,
                        "password": pwd_dec,
                        "senha_invalida_at": str(r["senha_invalida_at"] or "").strip(),
                        "erro_at_detalhe": str(r["erro_at_detalhe"] or "").strip(),
                        "origem": origem,
                    }
    except Exception as e_pb:
        LOGGER.debug(f"Aviso ao ler Gestor de Entidades EVO-12 ({db_path}): {e_pb}")


def carregar_entidades_gestor_evo12() -> List[Dict[str, Any]]:
    """
    Carrega de forma unificada todas as entidades e respetivas credenciais AT/e-Fatura:
    1. Fonte Primária: Gestor de Entidades da Plataforma (EVO-12 PocketBase / SafeDrive `entidades_base` + `entidades_senhas`).
    2. Fonte Complementar: `tCredenciais.xml` via `legado_bridge` (para enriquecer ou cobrir postos legados).
    3. Fallback Local: `controlo_geral.db` (`DB_PATH`).
    """
    if not (os.environ.get("GEXCEL_DADOS_DIR") or "").strip():
        is_cloud_zs = False
        try:
            import workspace_context
            is_cloud_zs = workspace_context.is_cloud_zero_storage()
            if is_cloud_zs:
                ws_id = workspace_context.get_current_ws_id()
                if ws_id == "unlinked_empty":
                    return []
                por_nif_ws: Dict[str, Dict[str, Any]] = {}
                db_ws = obter_db_workspace_evo12_ram(ws_id)
                if db_ws:
                    _carregar_entidades_db_evo12(db_ws, por_nif_ws, origem="evo12_workspace_ram")
                ents_ram = workspace_context.get_entidades_ram(ws_id)
                for e in ents_ram:
                    nif_clean = re.sub(r"[^0-9]", "", str(e.get("nif") or "")).strip()[:9]
                    if len(nif_clean) != 9:
                        continue
                    pwd_ram = str(e.get("password") or "").strip()
                    cod_ram = str(e.get("cod") or e.get("id_contab") or "").strip()
                    if nif_clean not in por_nif_ws:
                        por_nif_ws[nif_clean] = {
                            "id": nif_clean,
                            "pb_id": nif_clean,
                            "cod": cod_ram,
                            "nif": nif_clean,
                            "nif_cc": str(e.get("nif_cc") or nif_clean).strip(),
                            "nomecli": str(e.get("nomecli") or f"Entidade {nif_clean}").strip(),
                            "ativo": True,
                            "subutilizador": str(e.get("subutilizador") or nif_clean).strip(),
                            "password": pwd_ram,
                            "senha_invalida_at": str(e.get("senha_invalida_at") or "").strip(),
                            "erro_at_detalhe": str(e.get("erro_at_detalhe") or "").strip(),
                            "origem": "local_browser_session",
                        }
                    else:
                        if pwd_ram and not por_nif_ws[nif_clean].get("password"):
                            por_nif_ws[nif_clean]["password"] = pwd_ram
                            por_nif_ws[nif_clean]["subutilizador"] = str(e.get("subutilizador") or nif_clean).strip()
                        if cod_ram and not por_nif_ws[nif_clean].get("cod"):
                            por_nif_ws[nif_clean]["cod"] = cod_ram
                out_ws = list(por_nif_ws.values())
                out_ws.sort(key=lambda x: (x.get("nomecli") or "").upper())
                return out_ws
        except Exception as e_ws:
            LOGGER.debug(f"Aviso no isolamento workspace RAM em carregar_entidades_gestor_evo12: {e_ws}")
            if is_cloud_zs:
                return []

    por_nif: Dict[str, Dict[str, Any]] = {}

    # 1. Ler do Gestor de Entidades (EVO-12 SQLite data.db)
    for db_evo12 in obter_dbs_gestor_entidades_evo12():
        _carregar_entidades_db_evo12(db_evo12, por_nif, origem="evo12_gestor_entidades")

    # 2. Complementar com tCredenciais.xml (legado_bridge)
    try:
        entidades_legadas = legado_bridge.carregar_entidades_legadas()
        for e in entidades_legadas:
            nif_clean = re.sub(r"[^0-9]", "", str(e.get("nif") or "")).strip()[:9]
            if len(nif_clean) != 9:
                continue
            pwd_leg = str(e.get("password") or "").strip()
            sub_leg = str(e.get("subutilizador") or nif_clean).strip()
            cod_leg = str(e.get("cod") or e.get("id_contab") or "").strip()
            nome_leg = str(e.get("nomecli") or f"Entidade {nif_clean}").strip()

            if nif_clean not in por_nif:
                por_nif[nif_clean] = {
                    "id": nif_clean,
                    "pb_id": nif_clean,
                    "cod": cod_leg,
                    "nif": nif_clean,
                    "nif_cc": str(e.get("nif_cc") or nif_clean).strip(),
                    "nomecli": nome_leg,
                    "ativo": True,
                    "subutilizador": sub_leg,
                    "password": pwd_leg,
                    "senha_invalida_at": "",
                    "erro_at_detalhe": "",
                    "origem": "tcredenciais_xml",
                }
            else:
                if pwd_leg and not por_nif[nif_clean].get("password"):
                    por_nif[nif_clean]["password"] = pwd_leg
                    por_nif[nif_clean]["subutilizador"] = sub_leg
                if cod_leg and not por_nif[nif_clean].get("cod"):
                    por_nif[nif_clean]["cod"] = cod_leg
    except Exception as e_leg:
        LOGGER.debug(f"Aviso ao ler legado_bridge em carregar_entidades_gestor_evo12: {e_leg}")

    # 3. Fallback controlo_geral.db dinâmico se ainda vazio
    ctrl_db_fb = obter_db_controlo_path()
    if not por_nif and os.path.exists(ctrl_db_fb):
        try:
            with db_connect(ctrl_db_fb, timeout=5) as conn:
                c = conn.cursor()
                c.execute("""
                    SELECT eb.id, eb.nif, eb.nif_cc, eb.nomecli,
                           es.password_efatura, es.password_at,
                           es.utilizador_efatura, es.utilizador_at
                    FROM entidades_base eb
                    LEFT JOIN entidades_senhas es ON es.nomecli = eb.id
                    ORDER BY eb.nomecli ASC
                """)
                for r in c.fetchall():
                    nif_clean = re.sub(r"[^0-9]", "", str(r[1] or r[2] or "")).strip()[:9]
                    if len(nif_clean) != 9:
                        continue
                    p_efat_fb = str(r[4] or "").strip()
                    p_at_fb = str(r[5] or "").strip()
                    u_efat_fb = str(r[6] or "").strip()
                    u_at_fb = str(r[7] or "").strip()
                    if p_efat_fb:
                        pwd = legado_bridge.descodificar_senha_legada(p_efat_fb)
                        sub = legado_bridge.normalizar_subutilizador_at(nif_clean, u_efat_fb or u_at_fb or nif_clean)
                    else:
                        pwd = legado_bridge.descodificar_senha_legada(p_at_fb) if p_at_fb else ""
                        sub = legado_bridge.normalizar_subutilizador_at(nif_clean, u_at_fb or u_efat_fb or nif_clean)
                    por_nif[nif_clean] = {
                        "id": nif_clean,
                        "pb_id": str(r[0] or nif_clean),
                        "cod": "",
                        "nif": nif_clean,
                        "nif_cc": str(r[2] or nif_clean).strip(),
                        "nomecli": str(r[3] or f"Empresa {nif_clean}").strip(),
                        "ativo": True,
                        "subutilizador": sub,
                        "password": pwd,
                        "senha_invalida_at": "",
                        "erro_at_detalhe": "",
                        "origem": "controlo_geral",
                    }
        except Exception as e_ctrl:
            LOGGER.debug(f"Fallback SQLite controlo_geral: {e_ctrl}")

    lista = list(por_nif.values())
    lista.sort(key=lambda x: (x.get("nomecli") or "").upper())
    return lista


_CACHE_ENTIDADE_ID = {}
_CACHE_ENTIDADE_ID_LOCK = threading.Lock()


def get_entidade_id(nif):
    """Obtém o ID interno da entidade; se não existir, usa o próprio NIF."""
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if not nif_clean:
        return None
    ws_key = "local"
    try:
        import workspace_context
        if workspace_context.is_cloud_zero_storage():
            ws_key = workspace_context.get_current_ws_id()
    except Exception:
        pass
    cache_id_key = (ws_key, nif_clean)
    now_ts = time.time()
    with _CACHE_ENTIDADE_ID_LOCK:
        cached = _CACHE_ENTIDADE_ID.get(cache_id_key)
        if cached and (now_ts - cached[0]) < 120.0:
            return cached[1]
    res_id = nif_clean
    for ent in carregar_entidades_gestor_evo12():
        if ent["nif"] == nif_clean:
            res_id = ent.get("pb_id") or nif_clean
            break
    with _CACHE_ENTIDADE_ID_LOCK:
        _CACHE_ENTIDADE_ID[cache_id_key] = (now_ts, res_id)
    return res_id

def get_lista_entidades_ui():
    """
    Retorna a lista de entidades para a interface do utilizador, interligada diretamente
    com o Gestor de Entidades (EVO-12 PocketBase / SafeDrive) e tCredenciais.xml.
    """
    entidades = carregar_entidades_gestor_evo12()
    return [
        {
            "id": str(e["nif"]).strip(),
            "pb_id": str(e.get("pb_id") or e["nif"]).strip(),
            "cod": str(e.get("cod") or "").strip(),
            "nif": str(e["nif"]).strip(),
            "nif_cc": str(e.get("nif_cc") or e["nif"]).strip(),
            "nomecli": e["nomecli"],
            "ativo": bool(e.get("ativo", True)),
            "tem_credenciais_at": bool(e.get("password")),
        }
        for e in entidades
    ]

def get_credentials(nif):
    """
    Devolve (subutilizador, password).
    Prioridade 1: Gestor de Entidades (EVO-12 PocketBase / SafeDrive) + tCredenciais.xml.
    Prioridade 2: SQLite entidades_senhas local (fallback).
    """
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if not nif_clean:
        return None, None

    for ent in carregar_entidades_gestor_evo12():
        if ent["nif"] == nif_clean:
            pwd = ent.get("password")
            sub = ent.get("subutilizador") or nif_clean
            if pwd:
                return sub, pwd

    return None, None

def get_entidade_nome(nif: str) -> str:
    """Devolve a denominação social da entidade."""
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if not nif_clean:
        return ""

    for ent in carregar_entidades_gestor_evo12():
        if ent["nif"] == nif_clean and ent.get("nomecli"):
            return ent["nomecli"]

    return f"Empresa {nif_clean}"

def get_entidades_com_credenciais(nifs_filtro = None) -> list:
    """
    Obtém lista de entidades com credenciais para operações em lote.
    Lê diretamente do Gestor de Entidades (EVO-12) e tCredenciais.xml.
    """
    todas = carregar_entidades_gestor_evo12()
    resultado = []
    filtro_set = {re.sub(r'[^0-9]', '', str(n)).strip()[:9] for n in nifs_filtro if n} if nifs_filtro else None

    for ent in todas:
        nif_val = ent["nif"]
        if filtro_set and nif_val not in filtro_set:
            continue
        pwd = ent.get("password") or ""
        if not pwd:
            continue
        sub = ent.get("subutilizador") or nif_val
        is_inv, detalhe_inv = check_if_password_marked_invalid(nif_val, pwd)
        resultado.append({
            "nif": nif_val,
            "nome": ent["nomecli"],
            "cod": ent.get("cod") or "",
            "subutilizador": sub,
            "password": pwd,
            "senha_invalida": is_inv,
            "erro_detalhe": detalhe_inv if is_inv else ""
        })
    return resultado

_PADROES_FALSO_POSITIVO_AT = (
    "impossível carregar o site",
    "impossivel carregar o site",
    "carregar o site",
    "após 3 tentativas",
    "apos 3 tentativas",
    "falha comunicacao",
    "falha de comunicacao",
    "falha comunicação",
    "falha de comunicação",
    "servidor de autenticacao",
    "servidor de autenticação",
    "(500)",
    "502",
    "503",
    "504",
    "429",
    "internal server error",
    "service unavailable",
    "server unavailable",
    "servidor indisponivel",
    "servidor indisponível",
    "serviço indisponível",
    "servico indisponivel",
    "temporariamente indisponivel",
    "temporariamente indisponível",
    "manutenção",
    "manutencao",
    "timeout",
    "timed out",
    "tempo limite",
    "connection reset",
    "connection refused",
    "remote end closed",
    "socket",
    "eof occurred",
    "rate limit",
    "limite de pedidos",
    "demasiados pedidos",
    "too many requests",
    "permissao",
    "permissões",
    "sem autorizacao",
    "sem autorização",
    "sem perfil",
    "perfil insuficiente",
    "não autorizado",
    "nao autorizado",
    "2fa",
    "dois fatores",
    "segundo fator",
    "duplo fator",
    "sms",
    "otp",
    "código de validação",
    "codigo de validacao",
    "código não recebido",
    "codigo nao recebido",
    "temporariamente suspensa",
    "bloqueada temporariamente",
    "tentativas de login excedido",
    "tentativas excedido",
    "navegador compatível",
    "navegador compativel",
    "seletor",
    "análise inteligente",
    "analise inteligente",
    "chave da api não configurada",
    "chave da api nao configurada",
    "instalação de dependências",
    "instalacao de dependencias",
    "erro na autenticacao dos contribuintes",
    "erro na autenticação dos contribuintes",
)


def is_erro_falso_positivo_at(erro_detalhe) -> bool:
    """
    Identifica erros técnicos/rede/browser/2FA/permissões que NUNCA significam senha errada.
    Garante que falhas de carregamento do portal nunca bloqueiem credenciais válidas e permite
    limpar retroativamente bloqueios falsos já gravados na base local.
    """
    texto = str(erro_detalhe or "").strip().lower()
    if not texto:
        return False
    return any(p in texto for p in _PADROES_FALSO_POSITIVO_AT)


def _limpar_bloqueio_tabelas_auxiliares_conn(c, nif_clean: str):
    """Limpa registos residuais para o NIF também em senhas_bloqueadas e entidades_senhas."""
    try:
        c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='senhas_bloqueadas'"
        )
        if c.fetchone():
            c.execute(
                "DELETE FROM senhas_bloqueadas WHERE (nif=? OR nif LIKE ?) AND portal IN ('AT', 'EFATURA')",
                (nif_clean, f"{nif_clean}/%"),
            )
    except Exception:
        pass
    try:
        id_entidade = get_entidade_id(nif_clean)
        if id_entidade:
            c.execute(
                "UPDATE entidades_senhas SET senha_invalida_at='', erro_at_detalhe='' WHERE nomecli=?",
                (id_entidade,),
            )
    except Exception:
        pass


def _hash_senha_invalida(pwd: str) -> str:
    clean = str(pwd or "").strip()
    if not clean:
        return ""
    return "sha256:" + hashlib.sha256(clean.encode("utf-8")).hexdigest()


def _senha_guardada_corresponde(stored: str, current_pwd: str) -> bool:
    s = str(stored or "").strip()
    c = str(current_pwd or "").strip()
    if not s or not c:
        return False
    if s.startswith("sha256:"):
        return s == _hash_senha_invalida(c)
    return s == c


def check_if_password_marked_invalid(nif, current_pwd):
    """
    Verifica se a senha atual está memorizada como rejeitada pela AT na base central (Dados Gexcel Apps).
    Se a senha atual em tCredenciais.xml for diferente da que falhou, ou se o bloqueio anterior tiver
    sido causado por erro falso-positivo de rede/carregamento do portal, limpa automaticamente o bloqueio.
    """
    if not current_pwd:
        return False, ""
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    ctrl_db = obter_db_controlo_path()
    if not nif_clean or not os.path.exists(ctrl_db):
        return False, ""

    try:
        init_senhas_invalidas_db()
        with db_connect(ctrl_db, timeout=5) as conn:
            c = conn.cursor()
            c.execute("SELECT senha, erro_detalhe FROM senhas_invalidas_at WHERE nif=?", (nif_clean,))
            row = c.fetchone()
            if row and row[0]:
                detalhe_guardado = row[1] or ""
                if is_erro_falso_positivo_at(detalhe_guardado):
                    c.execute("DELETE FROM senhas_invalidas_at WHERE nif=?", (nif_clean,))
                    _limpar_bloqueio_tabelas_auxiliares_conn(c, nif_clean)
                    conn.commit()
                    LOGGER.info(
                        f"Bloqueio falso-positivo de rede/portal removido automaticamente para NIF {nif_clean}: {detalhe_guardado}"
                    )
                    return False, ""
                if _senha_guardada_corresponde(row[0], current_pwd):
                    return True, detalhe_guardado or "Autenticação Inválida"
                else:
                    # A senha foi alterada no ficheiro de credenciais: limpa automaticamente o registo antigo
                    c.execute("DELETE FROM senhas_invalidas_at WHERE nif=?", (nif_clean,))
                    _limpar_bloqueio_tabelas_auxiliares_conn(c, nif_clean)
                    conn.commit()
                    LOGGER.info(f"Nova senha detetada para NIF {nif_clean}. Bloqueio anterior limpo automaticamente.")
                    return False, ""
    except Exception:
        pass

    try:
        id_entidade = get_entidade_id(nif_clean)
        if id_entidade:
            with db_connect(ctrl_db, timeout=5) as conn:
                c = conn.cursor()
                c.execute("SELECT senha_invalida_at, erro_at_detalhe FROM entidades_senhas WHERE nomecli=?", (id_entidade,))
                row = c.fetchone()
                if row and row[0]:
                    detalhe_ent = row[1] or ""
                    if is_erro_falso_positivo_at(detalhe_ent):
                        c.execute(
                            "UPDATE entidades_senhas SET senha_invalida_at='', erro_at_detalhe='' WHERE nomecli=?",
                            (id_entidade,),
                        )
                        conn.commit()
                        return False, ""
                    if _senha_guardada_corresponde(row[0], current_pwd):
                        return True, detalhe_ent or "Autenticação Inválida"
    except Exception:
        pass

    return False, ""

def record_invalid_password(nif, invalid_pwd, error_detail):
    """Regista senha comprovadamente rejeitada pela AT na base central (Dados Gexcel Apps) para evitar novos bloqueios."""
    if not invalid_pwd:
        return
    if is_erro_falso_positivo_at(error_detail):
        LOGGER.info(
            f"Ignorado bloqueio de senha para NIF {nif}: falha transitória/rede detetada ({error_detail})."
        )
        return
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if not nif_clean:
        return
    ctrl_db = obter_db_controlo_path()
    try:
        init_senhas_invalidas_db()
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.000Z")
        with db_connect(ctrl_db, timeout=10) as conn:
            c = conn.cursor()
            c.execute("""
            INSERT INTO senhas_invalidas_at (nif, senha, erro_detalhe, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(nif) DO UPDATE SET
                senha=excluded.senha,
                erro_detalhe=excluded.erro_detalhe,
                updated_at=excluded.updated_at
            """, (nif_clean, _hash_senha_invalida(invalid_pwd), str(error_detail), now_str))
            conn.commit()
            LOGGER.warning(f"Senha do NIF {nif_clean} memorizada como INVÁLIDA na base central ({ctrl_db}).")
    except Exception as e:
        LOGGER.error(f"Erro ao registar senha inválida: {e}")

def clear_invalid_password_if_success(nif):
    """Limpa a marcação de senha inválida na base central após autenticação com sucesso ou reset manual."""
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    ctrl_db = obter_db_controlo_path()
    if not nif_clean or not os.path.exists(ctrl_db):
        return
    init_senhas_invalidas_db()
    try:
        with db_connect(ctrl_db, timeout=10) as conn:
            c = conn.cursor()
            c.execute("DELETE FROM senhas_invalidas_at WHERE nif=?", (nif_clean,))
            _limpar_bloqueio_tabelas_auxiliares_conn(c, nif_clean)
            conn.commit()
            LOGGER.info(f"Marcação de senha inválida para NIF {nif_clean} limpa com sucesso na base central.")
    except Exception as e:
        LOGGER.error(f"Erro ao limpar senha inválida: {e}")

def obter_mapa_senhas_invalidas() -> dict:
    """
    Devolve mapa {nif: erro_detalhe} de senhas comprovadamente rejeitadas na base central (Dados Gexcel Apps).
    Se a password em tCredenciais.xml já tiver sido alterada face à senha que falhou, ou se o erro guardado
    for um falso-positivo de rede/carregamento do portal, limpa automaticamente o bloqueio.
    """
    invalidas = {}
    ctrl_db = obter_db_controlo_path()
    if not os.path.exists(ctrl_db):
        return invalidas
    init_senhas_invalidas_db()

    mapa_senhas_atuais = {}
    try:
        for ent in carregar_entidades_gestor_evo12():
            n_val = str(ent.get("nif") or "").strip()[:9]
            p_val = str(ent.get("password") or "").strip()
            if n_val and p_val:
                mapa_senhas_atuais[n_val] = p_val
            s_inv_evo12 = str(ent.get("senha_invalida_at") or "").strip()
            det_evo12 = str(ent.get("erro_at_detalhe") or "Autenticação Rejeitada")
            if n_val and s_inv_evo12 and not is_erro_falso_positivo_at(det_evo12) and (not p_val or _senha_guardada_corresponde(s_inv_evo12, p_val)):
                invalidas[n_val] = det_evo12
    except Exception:
        pass

    try:
        nifs_para_limpar = []
        with db_connect(ctrl_db, timeout=5) as conn:
            c = conn.cursor()
            c.execute("SELECT nif, senha, erro_detalhe FROM senhas_invalidas_at")
            for r_nif, r_senha, r_erro in c.fetchall():
                if not r_nif:
                    continue
                nif_key = re.sub(r'[^0-9]', '', str(r_nif)).strip()[:9]
                if not nif_key:
                    continue
                if is_erro_falso_positivo_at(r_erro):
                    nifs_para_limpar.append((r_nif, nif_key))
                    continue
                senha_guardada = str(r_senha or "").strip()
                senha_atual_xml = mapa_senhas_atuais.get(nif_key, "")
                if senha_atual_xml and senha_guardada and not _senha_guardada_corresponde(senha_guardada, senha_atual_xml):
                    nifs_para_limpar.append((r_nif, nif_key))
                    continue
                invalidas[nif_key] = r_erro or "Autenticação Rejeitada"

            if nifs_para_limpar:
                for n_raw, n_clean in nifs_para_limpar:
                    c.execute("DELETE FROM senhas_invalidas_at WHERE nif=?", (n_raw,))
                    _limpar_bloqueio_tabelas_auxiliares_conn(c, n_clean)
                conn.commit()
                LOGGER.info(f"Auto-desbloqueio de senhas atualizadas ou falsos-positivos: {[x[1] for x in nifs_para_limpar]}")
    except Exception:
        pass
    return invalidas


def delete_faturas_periodo(nif, data_inicio, data_fim):
    """Apaga os registos de Compras de um cliente num intervalo de datas (Wipe & Fetch) na sua base própria."""
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if not nif_clean:
        return
    db_path = obter_db_cliente_path(nif_clean, "compras")
    if not os.path.exists(db_path):
        return
    try:
        init_compras_db(nif_clean)
        d_ini = str(data_inicio)[:10]
        d_fim = str(data_fim)[:10]
        with sqlite3.connect(db_path, timeout=30) as conn:
            c = conn.cursor()
            c.execute("""
            DELETE FROM efatura_linhas 
            WHERE (substr(data_emissao, 1, 10) >= ? AND substr(data_emissao, 1, 10) <= ?)
               OR (data_emissao >= ? AND data_emissao <= ?)
            """, (d_ini, d_fim, f"{d_ini} 00:00:00.000Z", f"{d_fim} 23:59:59.999Z"))
            conn.commit()
            LOGGER.info(f"Wipe Compras SQLite efetuado: {c.rowcount} linhas apagadas para o NIF {nif_clean} em {db_path}.")
    except Exception as e:
        LOGGER.error(f"Erro ao apagar registos antigos no SQLite ({db_path}): {e}")

def _desduplicar_linhas_fatura_vertical(rows_cli: list, is_vendas: bool = False) -> list:
    """
    Desduplica linhas verticais pertencentes à mesma fatura caso tenham sido multiplicadas
    por reimportações sucessivas (2x, 3x, etc.) ou quando a mesma linha fiscal aparece repetida
    com a soma de (base + iva) a exceder o Total Documento.
    """
    if not rows_cli:
        return []
    grupos = {}
    ordem_chaves = []
    for r in rows_cli:
        cp_nif = str(r.get("Contraparte NIF") or "").strip()
        fat = str(r.get("Fatura") or "").strip()
        dt = str(r.get("Data") or "")[:10]
        chave = (fat, dt) if is_vendas else (cp_nif, fat, dt)
        if chave not in grupos:
            grupos[chave] = []
            ordem_chaves.append(chave)
        grupos[chave].append(r)

    resultado = []
    for chave in ordem_chaves:
        linhas = grupos[chave]
        if len(linhas) <= 1:
            resultado.extend(linhas)
            continue
        tot_doc = abs(float(linhas[0].get("Total Documento") or 0.0))
        soma_linhas = sum(float(x.get("Base Incidência") or 0.0) + float(x.get("Valor Imposto") or 0.0) for x in linhas)
        if tot_doc > 0.01 and abs(abs(soma_linhas) - tot_doc) > 0.05:
            # Desduplicar por assinatura fiscal exata
            unicas = []
            vistas = set()
            for x in linhas:
                ass = (
                    str(x.get("Tipo Imposto") or "IVA").strip(),
                    str(x.get("Código Taxa") or "").strip(),
                    round(float(x.get("Taxa (%)") or 0.0), 2),
                    round(float(x.get("Base Incidência") or 0.0), 2),
                    round(float(x.get("Valor Imposto") or 0.0), 2),
                    str(x.get("Código Isenção") or "").strip(),
                )
                if ass not in vistas:
                    vistas.add(ass)
                    unicas.append(x)
            soma_unicas = sum(float(x.get("Base Incidência") or 0.0) + float(x.get("Valor Imposto") or 0.0) for x in unicas)
            if abs(abs(soma_unicas) - tot_doc) <= abs(abs(soma_linhas) - tot_doc):
                linhas = unicas
        resultado.extend(linhas)
    return resultado

def upsert_faturas_direto(vertical_rows):
    """Executa o UPSERT real em lote direto na base particionada do cliente compras_{nif}.db."""
    if not vertical_rows:
        return 0

    import string, random
    from datetime import datetime, timezone

    def gen_id():
        chars = string.ascii_lowercase + string.digits
        return "".join(random.choice(chars) for _ in range(15))

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.000Z")
    cache_clientes = {}

    por_nif = {}
    for row in vertical_rows:
        nif_cli = str(row.get("NIF Cliente") or "").strip()
        nif_clean = re.sub(r'[^0-9]', '', nif_cli).strip()
        if not nif_clean: continue
        por_nif.setdefault(nif_clean, []).append(row)

    # 1. Registo e Auditoria Forense Obrigatória no Cofre Permanente de Estados (Ledger Vault)
    # Garante que 100% das faturas importadas pela API são auditadas e anulações tardias detetadas
    try:
        from cofre_ledger import CofreEstadosLedger
        cofre = CofreEstadosLedger()
        for nif_alvo, rows_alvo in por_nif.items():
            novas_inconf = cofre.registar_e_confrontar(rows_alvo, nif_titular=str(nif_alvo))
            if novas_inconf:
                LOGGER.warning(
                    f"🚨 [COFRE AUDITORIA] {len(novas_inconf)} fatura(s) com anulação tardia detetada(s) em Compras (NIF {nif_alvo})!"
                )
    except Exception as e_cofre:
        LOGGER.error(f"Erro ao registar faturas no CofreEstadosLedger (Compras): {e_cofre}")

    total_gravado = 0
    for nif_clean, rows_cli in por_nif.items():
        rows_cli = _desduplicar_linhas_fatura_vertical(rows_cli, is_vendas=False)
        init_compras_db(nif_clean)
        db_path = obter_db_cliente_path(nif_clean, "compras")

        id_cliente = cache_clientes.get(nif_clean)
        if not id_cliente:
            id_cliente = get_entidade_id(nif_clean)
            cache_clientes[nif_clean] = id_cliente

        batch_data = []
        seen_hashes = {}
        faturas_a_substituir_id = set()
        faturas_a_substituir_chave = set()
        for row in rows_cli:
            nif_emissor = str(row.get("Contraparte NIF") or nif_clean).strip() or "000000000"
            data_str = str(row.get("Data", "")).replace("-", "") or "00000000"
            fatura_no = str(row.get("Fatura", "")).strip().replace(" ", "_")
            atcud = str(row.get("ATCUD", "")).strip()
            fatura_raw = str(row.get("Fatura", "")).strip()
            total_doc_val = float(row.get("Total Documento") or 0.0)

            id_fatura = gerar_chave_documento(
                nif=nif_emissor,
                fatura=fatura_raw,
                total_doc=total_doc_val,
                atcud=atcud,
                prefixo="C"
            )
            row["id_fatura_unico"] = id_fatura
            if id_fatura:
                faturas_a_substituir_id.add((id_fatura, fatura_raw))
            dt_curta = str(row.get("Data") or "")[:10]
            if nif_emissor and fatura_raw and dt_curta:
                faturas_a_substituir_chave.add((nif_emissor, fatura_raw, dt_curta))

            taxa_raw = row.get("Taxa (%)")
            try:
                tf = float(taxa_raw or 0.0)
                taxa_perc = str(int(tf)) if tf.is_integer() else str(tf)
            except Exception:
                taxa_perc = str(taxa_raw or "0")
            tipo_imp = str(row.get("Tipo Imposto") or "IVA").strip()
            cod_taxa = str(row.get("Código Taxa") or "").strip()
            cod_ise = str(row.get("Código Isenção") or "").strip()
            sufixo_fiscal = f"{taxa_perc}"
            if tipo_imp != "IVA" or cod_taxa or cod_ise:
                sufixo_fiscal = f"{tipo_imp}_{cod_taxa}_{taxa_perc}_{cod_ise}".strip("_")
            base_hash = f"{nif_emissor}_{data_str}_{fatura_no}_{sufixo_fiscal}" if fatura_no else f"{id_fatura}_{sufixo_fiscal}"
            occ = seen_hashes.get(base_hash, 0) + 1
            seen_hashes[base_hash] = occ
            hash_linha = base_hash if occ == 1 else f"{base_hash}_{occ}"
            data_emissao = f"{row.get('Data')} 12:00:00.000Z" if row.get("Data") else ""

            batch_data.append((
                gen_id(),
                id_cliente,
                hash_linha,
                id_fatura,
                nif_clean,
                str(row.get("Fatura", "")),
                atcud,
                data_emissao,
                str(row.get("Tipo Documento", "")),
                str(row.get("Estado Documento", "")),
                str(row.get("Contraparte NIF", "")),
                str(row.get("Contraparte", "")),
                str(row.get("Contraparte País", "")),
                str(row.get("Setor", "")),
                str(row.get("Tipo Imposto", "")),
                str(row.get("Código Taxa", "")),
                float(row.get("Taxa (%)") or 0.0),
                float(row.get("Base Incidência") or 0.0),
                float(row.get("Valor Imposto") or 0.0),
                str(row.get("Código Isenção") or ""),
                str(row.get("Região Fiscal") or ""),
                float(row.get("Total Líquido Documento") or 0.0),
                float(row.get("Total Documento") or 0.0),
                now_str,
                now_str
            ))

        if not batch_data:
            continue

        try:
            with db_connect(db_path, timeout=30) as conn:
                c = conn.cursor()

                # Deteção forense de anulações tardias em Compras
                anuladas_vistas = set()
                for r_data in rows_cli:
                    est_doc = str(r_data.get("Estado Documento", "")).strip().upper()
                    if est_doc in ("A", "ANULADO"):
                        cli_nif = nif_clean
                        cp_nif = str(r_data.get("Contraparte NIF") or "").strip()
                        fat_no = str(r_data.get("Fatura") or "").strip()
                        chave_doc = (cli_nif, cp_nif, fat_no)
                        if chave_doc in anuladas_vistas or not (cli_nif and fat_no):
                            continue
                        anuladas_vistas.add(chave_doc)

                        c.execute("""
                            SELECT id_fatura_unico, data_emissao, total_doc, estado_documento
                            FROM efatura_linhas
                            WHERE contraparte_nif = ? AND fatura = ?
                            LIMIT 1
                        """, (cp_nif, fat_no))
                        reg_antigo = c.fetchone()
                        if reg_antigo:
                            id_fat_orig, dt_orig, tot_orig, est_orig = reg_antigo
                            if str(est_orig or "").strip().upper() not in ("A", "ANULADO"):
                                val_total = float(tot_orig or r_data.get("Total Documento") or 0.0)
                                dt_emissao = str(r_data.get("Data") or dt_orig or "")[:10]
                                registar_inconformidade(
                                    id_fatura_unico=id_fat_orig,
                                    modulo="compras",
                                    nif_cliente=cli_nif,
                                    fatura=fat_no,
                                    data_emissao=dt_emissao,
                                    valor_total=val_total
                                )
                                LOGGER.warning(
                                    f"[FORENSE] Inconformidade detetada (anulação tardia COMPRAS): "
                                    f"Fatura '{fat_no}' (NIF: {cli_nif}, Fornecedor: {cp_nif}, Valor: {val_total}€, ID: {id_fat_orig})"
                                )

                # Limpar linhas anteriores das faturas incluídas neste lote para impedir duplicação 2x/3x por variação de hash_linha
                # Usa (id_fatura_unico, fatura) para nunca apagar duas faturas distintas que partilhem o mesmo ATCUD
                if faturas_a_substituir_id:
                    c.executemany(
                        "DELETE FROM efatura_linhas WHERE id_fatura_unico = ? AND (fatura = ? OR COALESCE(fatura, '') = '')",
                        list(faturas_a_substituir_id)
                    )
                if faturas_a_substituir_chave:
                    c.executemany(
                        "DELETE FROM efatura_linhas WHERE contraparte_nif = ? AND fatura = ? AND substr(data_emissao, 1, 10) = ?",
                        list(faturas_a_substituir_chave)
                    )

                c.executemany("""
                INSERT INTO efatura_linhas (
                    id, id_cliente, hash_linha, id_fatura_unico, nif_cliente, fatura, atcud,
                    data_emissao, tipo_documento, estado_documento, contraparte_nif,
                    contraparte_nome, contraparte_pais, setor_atividade, tipo_imposto,
                    codigo_taxa, taxa_percentagem, base_incidencia, valor_imposto,
                    codigo_isencao, regiao_fiscal, total_liquido_doc, total_doc, created, updated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(hash_linha) DO UPDATE SET
                    id_fatura_unico=excluded.id_fatura_unico,
                    fatura=excluded.fatura,
                    atcud=excluded.atcud,
                    data_emissao=excluded.data_emissao,
                    tipo_documento=excluded.tipo_documento,
                    estado_documento=excluded.estado_documento,
                    contraparte_nif=excluded.contraparte_nif,
                    contraparte_nome=excluded.contraparte_nome,
                    base_incidencia=excluded.base_incidencia,
                    valor_imposto=excluded.valor_imposto,
                    total_liquido_doc=excluded.total_liquido_doc,
                    total_doc=excluded.total_doc,
                    updated=excluded.updated;
                """, batch_data)
                conn.commit()
            total_gravado += len(batch_data)
            LOGGER.info(f"Upsert Compras SQLite efetuado com sucesso: {len(batch_data)} linhas gravadas em {db_path}.")
        except Exception as e:
            LOGGER.error(f"Erro no batch upsert Compras SQLite ({db_path}): {e}")

    return total_gravado

def upsert_faturas_async(vertical_rows):
    """Inicia a gravação no SQLite numa thread separada preservando o contexto de workspace."""
    if not vertical_rows:
        return
    target_fn = upsert_faturas_direto
    try:
        import workspace_context
        target_fn = workspace_context.wrap_thread_target(upsert_faturas_direto)
    except Exception:
        pass
    threading.Thread(target=target_fn, args=(vertical_rows,), daemon=True).start()

def delete_vendas_periodo(nif, data_inicio, data_fim):
    """Apaga os registos de Vendas de um cliente num determinado intervalo de datas (Wipe & Fetch)."""
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if not nif_clean:
        return
    db_path = obter_db_cliente_path(nif_clean, "vendas")
    if not os.path.exists(db_path):
        return
    try:
        init_vendas_db(nif_clean)
        d_ini = str(data_inicio)[:10]
        d_fim = str(data_fim)[:10]
        with sqlite3.connect(db_path, timeout=30) as conn:
            c = conn.cursor()
            c.execute("""
            DELETE FROM efatura_vendas_linhas 
            WHERE (substr(data_emissao, 1, 10) >= ? AND substr(data_emissao, 1, 10) <= ?)
               OR (data_emissao >= ? AND data_emissao <= ?)
            """, (d_ini, d_fim, f"{d_ini} 00:00:00.000Z", f"{d_fim} 23:59:59.999Z"))
            conn.commit()
            LOGGER.info(f"Wipe Vendas efetuado: {c.rowcount} linhas apagadas para o NIF {nif_clean} em {db_path}.")
    except Exception as e:
        LOGGER.error(f"Erro ao apagar registos de Vendas no SQLite ({db_path}): {e}")

def upsert_vendas_direto(vertical_rows):
    """Executa o UPSERT real em lote de Vendas direto na base dedicada vendas_{nif}.db."""
    if not vertical_rows:
        return 0

    import string, random
    from datetime import datetime, timezone

    def gen_id():
        chars = string.ascii_lowercase + string.digits
        return "".join(random.choice(chars) for _ in range(15))

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.000Z")
    cache_clientes = {}
    cache_nomes = {}

    por_nif = {}
    for row in vertical_rows:
        nif_cli = str(row.get("NIF Cliente") or "").strip()
        nif_clean = re.sub(r'[^0-9]', '', nif_cli).strip()
        if not nif_clean: continue
        por_nif.setdefault(nif_clean, []).append(row)

    # 1. Registo e Auditoria Forense Obrigatória no Cofre Permanente de Estados (Ledger Vault)
    # Garante que 100% das faturas importadas pela API são auditadas e anulações tardias detetadas
    try:
        from cofre_ledger import CofreEstadosLedger
        cofre = CofreEstadosLedger()
        for nif_alvo, rows_alvo in por_nif.items():
            novas_inconf = cofre.registar_e_confrontar(rows_alvo, nif_titular=str(nif_alvo))
            if novas_inconf:
                LOGGER.warning(
                    f"🚨 [COFRE AUDITORIA] {len(novas_inconf)} fatura(s) com anulação tardia detetada(s) em Vendas para NIF {nif_alvo}!"
                )
    except Exception as e_cofre:
        LOGGER.error(f"Erro ao registar faturas no CofreEstadosLedger (Vendas): {e_cofre}")

    total_gravado = 0
    for nif_clean, rows_cli in por_nif.items():
        rows_cli = _desduplicar_linhas_fatura_vertical(rows_cli, is_vendas=True)
        init_vendas_db(nif_clean)
        db_path = obter_db_cliente_path(nif_clean, "vendas")

        id_cliente = cache_clientes.get(nif_clean)
        if not id_cliente:
            id_cliente = get_entidade_id(nif_clean)
            cache_clientes[nif_clean] = id_cliente

        if not cache_nomes:
            cache_nomes = carregar_mapa_nomes_nifs_locais(nif_titular=nif_clean)

        batch_data = []
        seen_hashes = {}
        faturas_a_substituir_id = set()
        faturas_a_substituir_chave = set()
        for row in rows_cli:
            nif_emissor = str(nif_clean).strip() or "000000000"
            atcud = str(row.get("ATCUD", "")).strip()
            fatura_raw = str(row.get("Fatura", "")).strip()
            total_doc_val = float(row.get("Total Documento") or 0.0)

            id_fatura = gerar_chave_documento(
                nif=nif_emissor,
                fatura=fatura_raw,
                total_doc=total_doc_val,
                atcud=atcud,
                prefixo="V"
            )
            row["id_fatura_unico"] = id_fatura
            if id_fatura:
                faturas_a_substituir_id.add((id_fatura, fatura_raw))
            dt_curta = str(row.get("Data") or "")[:10]
            if fatura_raw and dt_curta:
                faturas_a_substituir_chave.add((fatura_raw, dt_curta))

            data_str = str(row.get("Data", "")).replace("-", "") or "00000000"
            fatura_no = str(row.get("Fatura", "")).strip().replace(" ", "_")
            taxa_raw = row.get("Taxa (%)")
            try:
                tf = float(taxa_raw or 0.0)
                taxa_perc = str(int(tf)) if tf.is_integer() else str(tf)
            except Exception:
                taxa_perc = str(taxa_raw or "0")
            tipo_imp = str(row.get("Tipo Imposto") or "IVA").strip()
            cod_taxa = str(row.get("Código Taxa") or "").strip()
            cod_ise = str(row.get("Código Isenção") or "").strip()
            sufixo_fiscal = f"{taxa_perc}"
            if tipo_imp != "IVA" or cod_taxa or cod_ise:
                sufixo_fiscal = f"{tipo_imp}_{cod_taxa}_{taxa_perc}_{cod_ise}".strip("_")
            base_hash = f"V_{nif_emissor}_{data_str}_{fatura_no}_{sufixo_fiscal}" if fatura_no else f"{id_fatura}_{sufixo_fiscal}"
            occ = seen_hashes.get(base_hash, 0) + 1
            seen_hashes[base_hash] = occ
            hash_linha = base_hash if occ == 1 else f"{base_hash}_{occ}"
            data_emissao = f"{row.get('Data')} 12:00:00.000Z" if row.get("Data") else ""

            contraparte_nif = str(row.get("Contraparte NIF", "")).strip()
            contraparte_nome = str(row.get("Contraparte", "")).strip()
            if not contraparte_nome and contraparte_nif:
                cp_clean = re.sub(r'[^0-9]', '', contraparte_nif).strip()
                contraparte_nome = cache_nomes.get(cp_clean, "")
            if contraparte_nif:
                if contraparte_nif in ("999999999", "999999990", "99999999"):
                    contraparte_nome = "Consumidor final"
                elif not contraparte_nome or contraparte_nome.lower() in ("consumidor final", "consumidor final."):
                    contraparte_nome = "[Sem Nome Registado]"

            batch_data.append((
                gen_id(),
                id_cliente,
                hash_linha,
                id_fatura,
                nif_clean,
                str(row.get("Fatura", "")),
                atcud,
                data_emissao,
                str(row.get("Tipo Documento", "")),
                str(row.get("Estado Documento", "")),
                contraparte_nif,
                contraparte_nome,
                str(row.get("Contraparte País", "")),
                str(row.get("Setor", "")),
                str(row.get("Tipo Imposto", "")),
                str(row.get("Código Taxa", "")),
                float(row.get("Taxa (%)") or 0.0),
                float(row.get("Base Incidência") or 0.0),
                float(row.get("Valor Imposto") or 0.0),
                str(row.get("Código Isenção") or ""),
                str(row.get("Região Fiscal") or ""),
                float(row.get("Total Líquido Documento") or 0.0),
                float(row.get("Total Documento") or 0.0),
                now_str,
                now_str
            ))

        if not batch_data:
            continue

        try:
            with db_connect(db_path, timeout=30) as conn:
                c = conn.cursor()

                # Deteção forense de anulações tardias em Vendas
                anuladas_vistas = set()
                for r_data in rows_cli:
                    est_doc = str(r_data.get("Estado Documento", "")).strip().upper()
                    if est_doc in ("A", "ANULADO"):
                        cli_nif = nif_clean
                        fat_no = str(r_data.get("Fatura") or "").strip()
                        chave_doc = (cli_nif, fat_no)
                        if chave_doc in anuladas_vistas or not (cli_nif and fat_no):
                            continue
                        anuladas_vistas.add(chave_doc)

                        c.execute("""
                            SELECT id_fatura_unico, data_emissao, total_doc, estado_documento
                            FROM efatura_vendas_linhas
                            WHERE fatura = ?
                            LIMIT 1
                        """, (fat_no,))
                        reg_antigo = c.fetchone()
                        if reg_antigo:
                            id_fat_orig, dt_orig, tot_orig, est_orig = reg_antigo
                            if str(est_orig or "").strip().upper() not in ("A", "ANULADO"):
                                val_total = float(tot_orig or r_data.get("Total Documento") or 0.0)
                                dt_emissao = str(r_data.get("Data") or dt_orig or "")[:10]
                                registar_inconformidade(
                                    id_fatura_unico=id_fat_orig,
                                    modulo="vendas",
                                    nif_cliente=cli_nif,
                                    fatura=fat_no,
                                    data_emissao=dt_emissao,
                                    valor_total=val_total
                                )
                                LOGGER.warning(
                                    f"[FORENSE] Inconformidade detetada (anulação tardia VENDAS): "
                                    f"Fatura '{fat_no}' (NIF Emissor: {cli_nif}, Valor: {val_total}€, ID: {id_fat_orig})"
                                )

                # Limpar linhas anteriores das faturas incluídas neste lote para impedir duplicação 2x/3x por variação de hash_linha
                # Usa (id_fatura_unico, fatura) para nunca apagar duas faturas distintas que partilhem o mesmo ATCUD
                if faturas_a_substituir_id:
                    c.executemany(
                        "DELETE FROM efatura_vendas_linhas WHERE id_fatura_unico = ? AND (fatura = ? OR COALESCE(fatura, '') = '')",
                        list(faturas_a_substituir_id)
                    )
                if faturas_a_substituir_chave:
                    c.executemany(
                        "DELETE FROM efatura_vendas_linhas WHERE fatura = ? AND substr(data_emissao, 1, 10) = ?",
                        list(faturas_a_substituir_chave)
                    )

                c.executemany("""
                INSERT INTO efatura_vendas_linhas (
                    id, id_cliente, hash_linha, id_fatura_unico, nif_cliente, fatura, atcud,
                    data_emissao, tipo_documento, estado_documento, contraparte_nif,
                    contraparte_nome, contraparte_pais, setor_atividade, tipo_imposto,
                    codigo_taxa, taxa_percentagem, base_incidencia, valor_imposto,
                    codigo_isencao, regiao_fiscal, total_liquido_doc, total_doc, created, updated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(hash_linha) DO UPDATE SET
                    id_fatura_unico=excluded.id_fatura_unico,
                    fatura=excluded.fatura,
                    atcud=excluded.atcud,
                    data_emissao=excluded.data_emissao,
                    tipo_documento=excluded.tipo_documento,
                    estado_documento=excluded.estado_documento,
                    contraparte_nif=excluded.contraparte_nif,
                    contraparte_nome=excluded.contraparte_nome,
                    base_incidencia=excluded.base_incidencia,
                    valor_imposto=excluded.valor_imposto,
                    total_liquido_doc=excluded.total_liquido_doc,
                    total_doc=excluded.total_doc,
                    updated=excluded.updated;
                """, batch_data)
                conn.commit()
            total_gravado += len(batch_data)
            LOGGER.info(f"Upsert Vendas efetuado com sucesso: {len(batch_data)} linhas gravadas em {db_path}.")
        except Exception as e:
            LOGGER.error(f"Erro no batch upsert de Vendas SQLite ({db_path}): {e}")

    return total_gravado

def limpar_toda_a_base_dados(
    limpar_senhas_invalidas: bool = True, 
    tipo: str = "tudo", 
    nif: str = None,
    ano: Optional[int] = None,
    mes: Optional[int] = None
):
    """
    Limpa registos importados (compras, vendas ou tudo).
    Suporta granularidade:
    - Base toda (nif=None, ano=None, mes=None)
    - Entidade completa (nif="...", ano=None, mes=None)
    - Entidade num ano específico (nif="...", ano=2026, mes=None)
    - Entidade num mês específico (nif="...", ano=2026, mes=3)
    """
    linhas_compras = 0
    linhas_vendas = 0
    senhas_resetadas = 0

    if nif:
        nif_clean = re.sub(r'[^0-9]', '', str(nif)).strip()[:9]
        nifs_alvo = [nif_clean] if nif_clean else []
    else:
        v4_dir = obter_pasta_v4()
        nifs_alvo = [d for d in os.listdir(v4_dir) if os.path.isdir(os.path.join(v4_dir, d)) and d.isdigit()]

    tipos_limpar = ["compras", "vendas"] if tipo in ("tudo", "ambos") else [tipo.lower()]

    for n_clean in nifs_alvo:
        if "compras" in tipos_limpar:
            db_c = obter_db_cliente_path(n_clean, "compras")
            if os.path.exists(db_c):
                try:
                    with sqlite3.connect(db_c, timeout=30) as conn:
                        c = conn.cursor()
                        if ano and mes:
                            filtro = f"{int(ano):04d}-{int(mes):02d}"
                            c.execute("DELETE FROM efatura_linhas WHERE substr(data_emissao, 1, 7) = ?", (filtro,))
                        elif ano:
                            filtro = f"{int(ano):04d}"
                            c.execute("DELETE FROM efatura_linhas WHERE substr(data_emissao, 1, 4) = ?", (filtro,))
                        else:
                            c.execute("DELETE FROM efatura_linhas")
                        linhas_compras += c.rowcount
                        conn.commit()
                        if not ano and not mes:
                            c.execute("VACUUM")
                except Exception as e:
                    LOGGER.error(f"Erro ao limpar compras de {n_clean} (ano={ano}, mes={mes}): {e}")

        if "vendas" in tipos_limpar:
            db_v = obter_db_cliente_path(n_clean, "vendas")
            if os.path.exists(db_v):
                try:
                    with sqlite3.connect(db_v, timeout=30) as conn:
                        c = conn.cursor()
                        if ano and mes:
                            filtro = f"{int(ano):04d}-{int(mes):02d}"
                            c.execute("DELETE FROM efatura_vendas_linhas WHERE substr(data_emissao, 1, 7) = ?", (filtro,))
                        elif ano:
                            filtro = f"{int(ano):04d}"
                            c.execute("DELETE FROM efatura_vendas_linhas WHERE substr(data_emissao, 1, 4) = ?", (filtro,))
                        else:
                            c.execute("DELETE FROM efatura_vendas_linhas")
                        linhas_vendas += c.rowcount
                        conn.commit()
                        if not ano and not mes:
                            c.execute("VACUUM")
                except Exception as e:
                    LOGGER.error(f"Erro ao limpar vendas de {n_clean} (ano={ano}, mes={mes}): {e}")

    # Limpar controlo mensal e senhas inválidas em controlo_geral.db
    ctrl_db = obter_db_controlo_path()
    try:
        with sqlite3.connect(ctrl_db, timeout=30) as conn:
            c = conn.cursor()
            for t in tipos_limpar:
                if nif:
                    n_clean = re.sub(r'[^0-9]', '', str(nif)).strip()[:9]
                    if ano and mes:
                        c.execute("DELETE FROM efatura_controlo_mensal WHERE nif = ? AND ano = ? AND mes = ? AND tipo = ?", (n_clean, int(ano), int(mes), t))
                    elif ano:
                        c.execute("DELETE FROM efatura_controlo_mensal WHERE nif = ? AND ano = ? AND tipo = ?", (n_clean, int(ano), t))
                    else:
                        c.execute("DELETE FROM efatura_controlo_mensal WHERE nif = ? AND tipo = ?", (n_clean, t))
                else:
                    if ano and mes:
                        c.execute("DELETE FROM efatura_controlo_mensal WHERE ano = ? AND mes = ? AND tipo = ?", (int(ano), int(mes), t))
                    elif ano:
                        c.execute("DELETE FROM efatura_controlo_mensal WHERE ano = ? AND tipo = ?", (int(ano), t))
                    else:
                        c.execute("DELETE FROM efatura_controlo_mensal WHERE tipo = ?", (t,))

            if limpar_senhas_invalidas and not nif:
                c.execute("DELETE FROM senhas_invalidas_at")
                c.execute("UPDATE entidades_senhas SET senha_invalida_at = '', erro_at_detalhe = ''")
                senhas_resetadas = c.rowcount
            conn.commit()
            if not ano and not mes and not nif:
                c.execute("VACUUM")
    except Exception as e:
        LOGGER.error(f"Erro ao limpar controlo_geral.db: {e}")

    # 4. Limpar ficheiros de staging persistente (JSONL) para evitar mensagens falsas de "já existem"
    try:
        staging_dir = os.path.join(obter_pasta_v4(), "staging")
        if os.path.exists(staging_dir):
            prefixos = []
            for n_clean in nifs_alvo:
                if ano and mes:
                    prefixos.append(f"staging_{n_clean}_{int(ano)}_{int(mes)}_")
                    prefixos.append(f"staging_{n_clean}_{int(ano)}_{int(mes):02d}_")
                elif ano:
                    prefixos.append(f"staging_{n_clean}_{int(ano)}_")
                else:
                    prefixos.append(f"staging_{n_clean}_")

            for fname in os.listdir(staging_dir):
                if fname.endswith(".jsonl"):
                    deve_apagar = False
                    if not nif and not ano:
                        deve_apagar = True
                    else:
                        for pfx in prefixos:
                            if fname.startswith(pfx):
                                deve_apagar = True
                                break
                    if deve_apagar:
                        try:
                            os.remove(os.path.join(staging_dir, fname))
                        except Exception as fe:
                            LOGGER.debug(f"Erro ao remover staging {fname}: {fe}")
    except Exception as se:
        LOGGER.error(f"Erro ao limpar diretório de staging: {se}")

    return linhas_compras + linhas_vendas, senhas_resetadas

def contar_docs_na_bd(nif: str, ano: int, mes: int, tipo: str) -> int:
    """
    Conta o número real de faturas distintas existentes na base de dados do cliente
    para um determinado (nif, ano, mes, tipo).
    """
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if not nif_clean:
        return 0
    ano_str = str(ano)
    mes_str = f"{int(mes):02d}"
    is_vendas = str(tipo).strip().lower() == "vendas"

    db_path = obter_db_cliente_path(nif_clean, "vendas" if is_vendas else "compras")
    tabela = "efatura_vendas_linhas" if is_vendas else "efatura_linhas"

    if not os.path.exists(db_path):
        return 0

    try:
        with sqlite3.connect(db_path, timeout=10) as conn:
            c = conn.cursor()
            c.execute(f"""
            SELECT count(DISTINCT {_EXPR_DOC_DISTINTO_SQL})
            FROM {tabela}
            WHERE strftime('%Y', data_emissao) = ?
              AND strftime('%m', data_emissao) = ?
            """, (ano_str, mes_str))
            row = c.fetchone()
            return int(row[0] if row else 0)
    except Exception as e:
        LOGGER.error(f"Erro ao contar docs na BD ({tipo}, {mes}/{ano}, {nif_clean}): {e}")
        return 0

def contar_docs_intervalo_na_bd(nif: str, data_inicio: str, data_fim: str, tipo: str) -> int:
    """Conta faturas distintas na BD do cliente num intervalo exato de datas YYYY-MM-DD."""
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if not nif_clean:
        return 0
    is_vendas = str(tipo).strip().lower() == "vendas"
    db_path = obter_db_cliente_path(nif_clean, "vendas" if is_vendas else "compras")
    tabela = "efatura_vendas_linhas" if is_vendas else "efatura_linhas"
    if not os.path.exists(db_path):
        return 0
    d_ini = str(data_inicio)[:10]
    d_fim = str(data_fim)[:10]
    try:
        with sqlite3.connect(db_path, timeout=10) as conn:
            c = conn.cursor()
            c.execute(f"""
            SELECT count(DISTINCT {_EXPR_DOC_DISTINTO_SQL})
            FROM {tabela}
            WHERE substr(data_emissao, 1, 10) >= ? AND substr(data_emissao, 1, 10) <= ?
            """, (d_ini, d_fim))
            row = c.fetchone()
            return int(row[0] if row else 0)
    except Exception as e:
        LOGGER.error(f"Erro ao contar docs no intervalo ({d_ini}..{d_fim}, {nif_clean}): {e}")
        return 0

def obter_status_mes(nif: str, ano: int, mes: int, tipo: str) -> dict:
    """Retorna o registo de controlo mensal para um mês específico em controlo_geral.db."""
    init_controlo_db()
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    tipo_str = "vendas" if str(tipo).strip().lower() == "vendas" else "compras"
    ctrl_db = obter_db_controlo_path()
    try:
        with sqlite3.connect(ctrl_db, timeout=10) as conn:
            c = conn.cursor()
            c.execute(
                "SELECT total_esperado, docs_gravados, completo FROM efatura_controlo_mensal WHERE nif = ? AND ano = ? AND mes = ? AND tipo = ?",
                (nif_clean, int(ano), int(mes), tipo_str)
            )
            r = c.fetchone()
            if r:
                return {
                    "total_esperado": int(r[0] or 0),
                    "docs_gravados": int(r[1] or 0),
                    "completo": int(r[2] or 0),
                    "existe": True
                }
    except Exception as e:
        LOGGER.warning(f"Erro ao obter status do mês {mes}/{ano} ({nif_clean}): {e}")
    return {"total_esperado": 0, "docs_gravados": 0, "completo": 0, "existe": False}

def obter_chaves_faturas_existentes(nif: str, data_inicio: str, data_fim: str, tipo: str) -> set:
    """
    Retorna o conjunto de chaves únicas (contraparte_nif, fatura) de documentos já gravados na BD
    para o intervalo de datas especificado. Permite saltar o descarregamento de detalhes já existentes.
    """
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if not nif_clean:
        return set()
    is_vendas = str(tipo).strip().lower() == "vendas"
    db_path = obter_db_cliente_path(nif_clean, "vendas" if is_vendas else "compras")
    tabela = "efatura_vendas_linhas" if is_vendas else "efatura_linhas"
    if not os.path.exists(db_path):
        return set()
    d_ini = str(data_inicio)[:10]
    d_fim = str(data_fim)[:10]
    try:
        with sqlite3.connect(db_path, timeout=15) as conn:
            c = conn.cursor()
            c.execute(f"""
            SELECT DISTINCT contraparte_nif, fatura
            FROM {tabela}
            WHERE substr(data_emissao, 1, 10) >= ? AND substr(data_emissao, 1, 10) <= ?
            """, (d_ini, d_fim))
            return set((str(r[0] or "").strip(), str(r[1] or "").strip()) for r in c.fetchall())
    except Exception as e:
        LOGGER.warning(f"Erro ao obter chaves faturas existentes ({d_ini}..{d_fim}): {e}")
        return set()


def registar_scout_mensal(nif, tipo, scout_itens):
    """
    Regista os totais de documentos apurados pelo batedor rápido da AT para cada mês em controlo_geral.db.
    """
    if not scout_itens:
        return
    init_controlo_db()
    from datetime import datetime, timezone
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.000Z")
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    ctrl_db = obter_db_controlo_path()
    try:
        with sqlite3.connect(ctrl_db, timeout=30) as conn:
            c = conn.cursor()
            for item in scout_itens:
                ano = int(item["ano"])
                mes = int(item["mes"])
                total_esp = int(item["total_esperado"] or 0)
                docs_bd = contar_docs_na_bd(nif_clean, ano, mes, tipo)
                completo = 1 if (total_esp == 0 or (total_esp > 0 and docs_bd >= total_esp)) else 0
                c.execute("""
                INSERT INTO efatura_controlo_mensal (nif, ano, mes, tipo, total_esperado, docs_gravados, completo, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(nif, ano, mes, tipo) DO UPDATE SET
                    total_esperado = excluded.total_esperado,
                    docs_gravados = excluded.docs_gravados,
                    completo = CASE 
                        WHEN excluded.total_esperado = 0 THEN 1 
                        WHEN excluded.docs_gravados >= excluded.total_esperado AND excluded.total_esperado > 0 THEN 1
                        ELSE efatura_controlo_mensal.completo 
                    END,
                    updated_at = excluded.updated_at;
                """, (nif_clean, ano, mes, tipo.lower(), total_esp, docs_bd, completo, now_str))
            conn.commit()
        LOGGER.info(f"Scout mensal registado para NIF {nif_clean} ({len(scout_itens)} meses).")
    except Exception as e:
        LOGGER.error(f"Erro ao registar scout mensal no controlo_geral.db: {e}")

def limpar_status_mes(nif: str, ano: int, mes: int, tipo: str):
    """
    Remove por completo o registo de controlo mensal em controlo_geral.db para o mês indicado,
    garantindo que em modo -r (reimportar_tudo) não persiste qualquer cache de total_esperado ou completo.
    """
    init_controlo_db()
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if not nif_clean:
        return
    tipo_str = "vendas" if str(tipo).strip().lower() == "vendas" else "compras"
    ctrl_db = obter_db_controlo_path()
    try:
        with sqlite3.connect(ctrl_db, timeout=30) as conn:
            c = conn.cursor()
            c.execute(
                "DELETE FROM efatura_controlo_mensal WHERE nif = ? AND ano = ? AND mes = ? AND tipo = ?",
                (nif_clean, int(ano), int(mes), tipo_str)
            )
            conn.commit()
        LOGGER.info(f"Controlo mensal apagado (limpar_status_mes): NIF={nif_clean}, {mes}/{ano}, tipo={tipo_str}")
    except Exception as e:
        LOGGER.error(f"Erro ao limpar status do mes {mes}/{ano} ({nif_clean}): {e}")

def atualizar_status_mes(nif, ano, mes, tipo, total_esperado=None, docs_gravados=None, completo=None):
    """
    Atualiza o controlo mensal de um mes especifico em controlo_geral.db,
    apurando docs reais, linhas, soma de base e soma de IVA a partir da base do cliente.
    """
    init_controlo_db()
    from datetime import datetime, timezone
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.000Z")
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]

    is_vendas = str(tipo).strip().lower() == "vendas"
    tipo_str = "vendas" if is_vendas else "compras"
    db_cli = obter_db_cliente_path(nif_clean, tipo_str)
    tabela = "efatura_vendas_linhas" if is_vendas else "efatura_linhas"

    docs_reais = 0
    tot_linhas = 0
    s_base = 0.0
    s_iva = 0.0
    db_encontrada = False

    if os.path.exists(db_cli):
        try:
            with sqlite3.connect(db_cli, timeout=10) as conn:
                c = conn.cursor()
                c.execute(f"""
                SELECT count(DISTINCT {_EXPR_DOC_DISTINTO_SQL}), count(*), round(sum(base_incidencia), 2), round(sum(valor_imposto), 2)
                FROM {tabela}
                WHERE strftime('%Y', data_emissao) = ? AND strftime('%m', data_emissao) = ?
                """, (str(ano), f"{int(mes):02d}"))
                row = c.fetchone()
                if row:
                    docs_reais = int(row[0] or 0)
                    tot_linhas = int(row[1] or 0)
                    s_base = float(row[2] or 0.0)
                    s_iva = float(row[3] or 0.0)
                    db_encontrada = True
        except Exception as e:
            LOGGER.warning(f"Erro ao apurar totais do cliente {nif_clean} ({mes}/{ano}): {e}")

    # A contagem fisica na base SQLite do cliente e soberana para este mes.
    # So usamos o parametro docs_gravados se a base ainda nao existir no disco.
    if not db_encontrada and docs_gravados is not None:
        docs_reais = int(docs_gravados)

    # Consultar estado atual no controlo_geral para nao sobrescrever total_esperado com valores parciais/invalidos
    ctrl_db = obter_db_controlo_path()
    total_esp_atual = 0
    comp_atual = 0
    try:
        with sqlite3.connect(ctrl_db, timeout=10) as conn:
            c = conn.cursor()
            c.execute("SELECT total_esperado, completo FROM efatura_controlo_mensal WHERE nif = ? AND ano = ? AND mes = ? AND tipo = ?", (nif_clean, int(ano), int(mes), tipo_str))
            r = c.fetchone()
            if r:
                total_esp_atual = int(r[0] or 0)
                comp_atual = int(r[1] or 0)
    except Exception:
        pass

    # Total esperado para este mes especifico
    if total_esperado == 0 and docs_gravados == 0 and completo is False:
        total_esp_final = 0
    elif total_esperado is not None and int(total_esperado) > 0:
        total_esp_final = int(total_esperado)
    elif total_esp_atual > 0:
        total_esp_final = total_esp_atual
    else:
        total_esp_final = docs_reais if completo else 0

    if total_esp_final > 0 and docs_reais < total_esp_final:
        is_comp = 0
    elif total_esp_final > 0 and docs_reais >= total_esp_final:
        is_comp = 1 if (completo is not False) else 0
    elif completo is not None:
        is_comp = 1 if completo else 0
    elif total_esp_final == 0 and docs_reais == 0:
        is_comp = 1
    else:
        is_comp = comp_atual

    # Invariante #10: Nunca marcar um mês como completo se existir qualquer fatura com divergência contabilística
    if is_comp == 1 and docs_reais > 0:
        d_ini_m = f"{int(ano):04d}-{int(mes):02d}-01"
        d_fim_m = f"{int(ano):04d}-{int(mes):02d}-31"
        if periodo_tem_inconsistencia_faturas(nif_clean, d_ini_m, d_fim_m, tipo_str):
            is_comp = 0

    try:
        with sqlite3.connect(ctrl_db, timeout=30) as conn:
            c = conn.cursor()
            c.execute("""
            INSERT INTO efatura_controlo_mensal (nif, ano, mes, tipo, total_esperado, docs_gravados, total_linhas, soma_base, soma_iva, completo, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(nif, ano, mes, tipo) DO UPDATE SET
                total_esperado = excluded.total_esperado,
                docs_gravados = excluded.docs_gravados,
                total_linhas = excluded.total_linhas,
                soma_base = excluded.soma_base,
                soma_iva = excluded.soma_iva,
                completo = excluded.completo,
                updated_at = excluded.updated_at;
            """, (nif_clean, int(ano), int(mes), tipo_str, total_esp_final, docs_reais, tot_linhas, s_base, s_iva, is_comp, now_str))
            conn.commit()
        LOGGER.info(f"Controlo mensal atualizado: NIF={nif_clean}, {mes}/{ano}, docs={docs_reais}/{total_esp_final}, completo={is_comp}")
    except Exception as e:
        LOGGER.error(f"Erro ao atualizar status do mes {mes}/{ano} ({nif_clean}): {e}")

def sanear_duplicados_bd_cliente(nif: str = None, tipo: str = "ambos") -> dict:
    """
    Saneia linhas duplicadas (2x/3x/etc.) nas bases SQLite de clientes (compras_{nif}.db e vendas_{nif}.db)
    causadas por coexistência de formatos antigos/novos de hash_linha (_23.0 vs _IVA_NOR_23.0 vs _2)
    e recalcula id_fatura_unico para ATCUDs sem dígitos numéricos.
    """
    v4_dir = obter_pasta_v4()
    if not os.path.exists(v4_dir):
        return {"sucesso": False, "faturas_corrigidas": 0, "linhas_removidas": 0}
    tipos = ["compras", "vendas"] if str(tipo).lower() in ("ambos", "todos", "all") else [str(tipo).lower()]
    nifs_pastas = [d for d in os.listdir(v4_dir) if os.path.isdir(os.path.join(v4_dir, d)) and d.isdigit()]
    if nif:
        nif_clean = re.sub(r'[^0-9]', '', str(nif)).strip()[:9]
        nifs_pastas = [d for d in nifs_pastas if d == nif_clean]

    faturas_corrigidas = 0
    linhas_removidas = 0
    ids_recalculados = 0

    for n_cli in nifs_pastas:
        for t_cli in tipos:
            is_vendas = (t_cli == "vendas")
            db_cli = obter_db_cliente_path(n_cli, t_cli)
            if not os.path.exists(db_cli):
                continue
            tabela = "efatura_vendas_linhas" if is_vendas else "efatura_linhas"
            try:
                with sqlite3.connect(db_cli, timeout=30) as conn:
                    c = conn.cursor()
                    c.execute(f"""
                        SELECT rowid, id_fatura_unico, contraparte_nif, fatura, atcud, substr(data_emissao, 1, 10),
                               tipo_imposto, codigo_taxa, taxa_percentagem, base_incidencia, valor_imposto,
                               codigo_isencao, total_doc, hash_linha
                        FROM {tabela}
                        ORDER BY rowid ASC
                    """)
                    todas = c.fetchall()
                    if not todas:
                        continue

                    grupos = {}
                    updates_id = []
                    for row in todas:
                        rid, id_fat, cp_nif, fat, atcud, dt10, t_imp, c_tax, taxa, base, iva, c_ise, tot_doc, h_linha = row
                        nif_emissor = n_cli if is_vendas else str(cp_nif or n_cli).strip()
                        novo_id = gerar_chave_documento(
                            nif=nif_emissor,
                            fatura=str(fat or "").strip(),
                            total_doc=float(tot_doc or 0.0),
                            atcud=str(atcud or "").strip(),
                            prefixo="V" if is_vendas else "C"
                        )
                        if novo_id and novo_id != id_fat:
                            updates_id.append((novo_id, rid))
                            id_fat = novo_id
                        chave_doc = (str(fat or "").strip(), str(dt10 or "")) if is_vendas else (str(cp_nif or "").strip(), str(fat or "").strip(), str(dt10 or ""))
                        grupos.setdefault(chave_doc, []).append((rid, id_fat, cp_nif, fat, atcud, dt10, t_imp, c_tax, taxa, base, iva, c_ise, tot_doc, h_linha))

                    rowids_apagar = []
                    for chave_doc, linhas in grupos.items():
                        if len(linhas) <= 1:
                            continue
                        tot_doc = abs(float(linhas[0][12] or 0.0))
                        soma_linhas = sum(float(x[9] or 0.0) + float(x[10] or 0.0) for x in linhas)
                        if tot_doc > 0.01 and abs(abs(soma_linhas) - tot_doc) > 0.05:
                            vistas = {}
                            for x in linhas:
                                ass = (
                                    str(x[6] or "IVA").strip(),
                                    str(x[7] or "").strip(),
                                    round(float(x[8] or 0.0), 2),
                                    round(float(x[9] or 0.0), 2),
                                    round(float(x[10] or 0.0), 2),
                                    str(x[11] or "").strip(),
                                )
                                vistas.setdefault(ass, []).append(x)
                            unicas = [lista[-1] for lista in vistas.values()]
                            soma_unicas = sum(float(x[9] or 0.0) + float(x[10] or 0.0) for x in unicas)
                            if len(unicas) < len(linhas) and abs(abs(soma_unicas) - tot_doc) <= abs(abs(soma_linhas) - tot_doc):
                                manter_rids = {x[0] for x in unicas}
                                apagar = [x[0] for x in linhas if x[0] not in manter_rids]
                                if apagar:
                                    rowids_apagar.extend(apagar)
                                    faturas_corrigidas += 1

                    if updates_id:
                        c.executemany(f"UPDATE {tabela} SET id_fatura_unico = ? WHERE rowid = ?", updates_id)
                        ids_recalculados += len(updates_id)
                    if rowids_apagar:
                        c.executemany(f"DELETE FROM {tabela} WHERE rowid = ?", [(r,) for r in rowids_apagar])
                        linhas_removidas += len(rowids_apagar)
                    if updates_id or rowids_apagar:
                        conn.commit()
            except Exception as e:
                LOGGER.warning(f"Erro ao sanear duplicados em {db_cli}: {e}")

    return {
        "sucesso": True,
        "faturas_corrigidas": faturas_corrigidas,
        "linhas_removidas": linhas_removidas,
        "ids_recalculados": ids_recalculados
    }


def periodo_tem_inconsistencia_faturas(nif: str, data_inicio, data_fim, tipo: str = "compras") -> bool:
    """
    Verifica se existem faturas no período [data_inicio, data_fim] na BD SQLite do cliente
    cujo somatório das linhas (base_incidencia + valor_imposto) diverge de total_doc
    (ex: por linhas D/C antigas sem DebitCreditIndicator ou multiplicações 2x/3x residuais).
    """
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if not nif_clean:
        return False
    is_vendas = str(tipo).lower().startswith("v")
    t_cli = "vendas" if is_vendas else "compras"
    db_cli = obter_db_cliente_path(nif_clean, t_cli)
    if not os.path.exists(db_cli):
        return False
    tabela = "efatura_vendas_linhas" if is_vendas else "efatura_linhas"
    d_ini_s = str(data_inicio)[:10]
    d_fim_s = str(data_fim)[:10]
    try:
        sanear_duplicados_bd_cliente(nif_clean, t_cli)
        with sqlite3.connect(db_cli, timeout=15) as conn:
            c = conn.cursor()
            c.execute(f"""
                SELECT id_fatura_unico, estado_documento, MAX(ABS(total_doc)) as tot_d,
                       SUM(base_incidencia + valor_imposto) as soma_l
                FROM {tabela}
                WHERE substr(data_emissao, 1, 10) >= ? AND substr(data_emissao, 1, 10) <= ?
                GROUP BY id_fatura_unico, fatura
            """, (d_ini_s, d_fim_s))
            for id_fat, est_doc, tot_d, soma_l in c.fetchall():
                if str(est_doc or "").strip().upper() in ("A", "ANULADA", "ANULADO"):
                    continue
                td = abs(float(tot_d or 0.0))
                sl = abs(float(soma_l or 0.0))
                if td > 0.05 and sl > td + 0.50:
                    LOGGER.warning(
                        f"Inconsistência detetada na cache SQLite para NIF {nif_clean} ({d_ini_s}..{d_fim_s}): "
                        f"doc={id_fat} total_doc={td:.2f} vs soma_linhas={sl:.2f}. A forçar reimportação limpa."
                    )
                    return True
    except Exception as e:
        LOGGER.warning(f"Erro ao verificar consistência do período ({nif_clean}): {e}")
    return False

def recalibrar_controlo_mensal_de_bases_reais(ano: int = None, tipo: str = "ambos", nif_filtro: str = None) -> dict:
    """
    Recalibra efatura_controlo_mensal em controlo_geral.db a partir dos dados reais e soberanos
    existentes nas bases individuais de cada cliente (compras_{nif}.db e vendas_{nif}.db).
    Corrige quaisquer contagens inflacionadas ou duplicadas por sincronizacoes multi-mes.
    """
    init_controlo_db()
    v4_dir = obter_pasta_v4()
    if not os.path.exists(v4_dir):
        return {"sucesso": False, "mensagem": "Pasta BdsefaturaV4 nao encontrada"}

    tipos = ["compras", "vendas"] if tipo.lower() in ("ambos", "todos", "all") else [tipo.lower()]
    nifs_pastas = [d for d in os.listdir(v4_dir) if os.path.isdir(os.path.join(v4_dir, d)) and d.isdigit()]
    if nif_filtro:
        nif_clean = re.sub(r'[^0-9]', '', str(nif_filtro)).strip()[:9]
        nifs_pastas = [d for d in nifs_pastas if d == nif_clean]

    recalibrados = 0
    meses_corrigidos = 0

    for n_cli in nifs_pastas:
        for t_cli in tipos:
            db_cli = obter_db_cliente_path(n_cli, t_cli)
            if not os.path.exists(db_cli):
                continue
            is_vendas = (t_cli == "vendas")
            tabela = "efatura_vendas_linhas" if is_vendas else "efatura_linhas"
            try:
                with sqlite3.connect(db_cli, timeout=10) as conn_cli:
                    c_cli = conn_cli.cursor()
                    c_cli.execute("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", (tabela,))
                    if not c_cli.fetchone():
                        continue

                    # Auto-reparação: atualizar id_fatura_unico para registos com ATCUD sem hífen
                    c_cli.execute(f"""
                        SELECT id, contraparte_nif, nif_cliente, fatura, total_doc, atcud, id_fatura_unico
                        FROM {tabela}
                        WHERE atcud IS NOT NULL AND atcud != '' AND atcud NOT LIKE '%-%'
                    """)
                    updates_id = []
                    for r_id, cp_nif, cli_nif, fat_str, tot_d, atc_str, old_id in c_cli.fetchall():
                        emissor = cli_nif if is_vendas else (cp_nif or cli_nif)
                        new_id = gerar_chave_documento(nif=emissor, fatura=fat_str, total_doc=tot_d or 0.0, atcud=atc_str, prefixo="V" if is_vendas else "C")
                        if new_id and new_id != old_id:
                            updates_id.append((new_id, r_id))
                    if updates_id:
                        c_cli.executemany(f"UPDATE {tabela} SET id_fatura_unico = ? WHERE id = ?", updates_id)
                        conn_cli.commit()

                    query = f"""
                    SELECT cast(strftime('%Y', data_emissao) as integer) as a,
                           cast(strftime('%m', data_emissao) as integer) as m,
                           count(DISTINCT {_EXPR_DOC_DISTINTO_SQL}) as docs,
                           count(*) as linhas,
                           round(sum(base_incidencia), 2) as base,
                           round(sum(valor_imposto), 2) as iva
                    FROM {tabela}
                    WHERE data_emissao IS NOT NULL
                    """
                    params = []
                    if ano:
                        query += " AND cast(strftime('%Y', data_emissao) as integer) = ?"
                        params.append(int(ano))
                    query += " GROUP BY a, m ORDER BY a, m"

                    c_cli.execute(query, tuple(params))
                    linhas_meses = c_cli.fetchall()

                meses_com_dados = set()
                for a_m, m_m, d_m, l_m, b_m, iv_m in linhas_meses:
                    if not a_m or not m_m:
                        continue
                    meses_com_dados.add((a_m, m_m))
                    atualizar_status_mes(n_cli, a_m, m_m, t_cli, total_esperado=None, docs_gravados=d_m, completo=True)
                    meses_corrigidos += 1

                # Limpar/zerar meses em controlo_geral.db que tinham registos fantasma (sem faturas na base real)
                ctrl_db = obter_db_controlo_path()
                with sqlite3.connect(ctrl_db, timeout=20) as conn_ctrl:
                    c_ctrl = conn_ctrl.cursor()
                    q_ctrl = "SELECT ano, mes, docs_gravados FROM efatura_controlo_mensal WHERE nif = ? AND tipo = ?"
                    p_ctrl = [n_cli, t_cli]
                    if ano:
                        q_ctrl += " AND ano = ?"
                        p_ctrl.append(int(ano))
                    c_ctrl.execute(q_ctrl, tuple(p_ctrl))
                    for a_db, m_db, docs_db in c_ctrl.fetchall():
                        if (a_db, m_db) not in meses_com_dados and docs_db > 0:
                            c_ctrl.execute("""
                            UPDATE efatura_controlo_mensal
                            SET docs_gravados = 0, total_linhas = 0, soma_base = 0.0, soma_iva = 0.0, total_esperado = 0, completo = 1
                            WHERE nif = ? AND ano = ? AND mes = ? AND tipo = ?
                            """, (n_cli, a_db, m_db, t_cli))
                    conn_ctrl.commit()

                recalibrados += 1
            except Exception as err:
                LOGGER.warning(f"Erro ao recalibrar {n_cli} ({t_cli}): {err}")

    return {
        "sucesso": True,
        "empresas_processadas": recalibrados,
        "meses_recalibrados": meses_corrigidos
    }

def obter_controlo_ano(ano, tipo):
    """
    Retorna o mapa de controlo mensal para o ano e tipo lido diretamente de controlo_geral.db:
    { nif: { mes: { 'total_esperado': int, 'docs_gravados': int, 'total_linhas': int, 'soma_base': float, 'soma_iva': float, 'completo': int } } }
    """
    init_controlo_db()
    mapa = {}
    ctrl_db = obter_db_controlo_path()
    try:
        with sqlite3.connect(ctrl_db, timeout=30) as conn:
            c = conn.cursor()
            c.execute("""
            SELECT nif, mes, total_esperado, docs_gravados, total_linhas, soma_base, soma_iva, completo
            FROM efatura_controlo_mensal
            WHERE ano = ? AND tipo = ?
            """, (int(ano), str(tipo).strip().lower()))
            for r_nif, r_mes, r_total_esp, r_gravados, r_linhas, r_base, r_iva, r_comp in c.fetchall():
                if not r_nif:
                    continue
                r_nif_clean = re.sub(r'[^0-9]', '', str(r_nif)).strip()[:9]
                if not r_nif_clean:
                    continue
                if r_nif_clean not in mapa:
                    mapa[r_nif_clean] = {}
                mapa[r_nif_clean][int(r_mes)] = {
                    "total_esperado": int(r_total_esp or 0),
                    "docs_gravados": int(r_gravados or 0),
                    "total_linhas": int(r_linhas or 0),
                    "soma_base": float(r_base or 0.0),
                    "soma_iva": float(r_iva or 0.0),
                    "completo": int(r_comp or 0)
                }
    except Exception as e:
        LOGGER.error(f"Erro ao obter controlo do ano {ano} ({tipo}): {e}")
    return mapa

def aplicar_retencao_anos(nif: str = None, tipo: str = "ambos", anos_retencao: int = 3, ano_referencia: int = None) -> dict:
    """
    Aplica a política de retenção por janela deslizante (Rolling Window).
    Elimina faturas de anos anteriores ao limite (ex: se ano=2026 e anos_retencao=3, apaga < 2024).
    Executa VACUUM local para devolver o espaço ao disco.
    Se nif for None ou 'TODOS', aplica a todos os clientes em BdsefaturaV4.
    """
    from datetime import date
    ano_ref = ano_referencia or date.today().year
    ano_corte = ano_ref - anos_retencao + 1

    if not nif or str(nif).strip().upper() == "TODOS":
        v4_dir = obter_pasta_v4()
        nifs_alvo = [d for d in os.listdir(v4_dir) if os.path.isdir(os.path.join(v4_dir, d)) and d.isdigit()]
        res_geral = {
            "status": "sucesso",
            "modo": "global",
            "total_empresas": len(nifs_alvo),
            "ano_referencia": ano_ref,
            "anos_retencao": anos_retencao,
            "ano_corte": ano_corte,
            "detalhes": {}
        }
        for n_cli in nifs_alvo:
            res_geral["detalhes"][n_cli] = aplicar_retencao_anos(n_cli, tipo, anos_retencao, ano_ref)
        return res_geral

    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()
    if not nif_clean:
        return {"status": "erro", "mensagem": "NIF não fornecido"}

    from datetime import date
    ano_ref = ano_referencia or date.today().year
    ano_corte = ano_ref - anos_retencao + 1

    tipos = ["compras", "vendas"] if tipo == "ambos" else [tipo.lower()]
    resultado = {
        "nif": nif_clean,
        "ano_referencia": ano_ref,
        "anos_retencao": anos_retencao,
        "ano_corte": ano_corte,
        "linhas_apagadas": {}
    }

    for t in tipos:
        db_path = obter_db_cliente_path(nif_clean, t)
        tabela = "efatura_vendas_linhas" if t == "vendas" else "efatura_linhas"
        if not os.path.exists(db_path):
            resultado["linhas_apagadas"][t] = 0
            continue

        try:
            with sqlite3.connect(db_path, timeout=30) as conn:
                c = conn.cursor()
                c.execute(f"DELETE FROM {tabela} WHERE cast(substr(data_emissao, 1, 4) as integer) < ?", (ano_corte,))
                apagadas = c.rowcount
                conn.commit()
                if apagadas > 0:
                    c.execute("VACUUM")
                resultado["linhas_apagadas"][t] = apagadas
                LOGGER.info(f"Retenção aplicada para {nif_clean} ({t}): {apagadas} linhas apagadas (< {ano_corte}).")
        except Exception as e:
            LOGGER.error(f"Erro ao aplicar retenção para {nif_clean} ({t}): {e}")
            resultado["linhas_apagadas"][t] = f"erro: {e}"

    # Limpar também o controlo mensal para anos anteriores a ano_corte
    ctrl_db = obter_db_controlo_path()
    try:
        with sqlite3.connect(ctrl_db, timeout=30) as conn:
            c = conn.cursor()
            c.execute("DELETE FROM efatura_controlo_mensal WHERE nif = ? AND ano < ?", (nif_clean, ano_corte))
            conn.commit()
    except Exception as e:
        LOGGER.warning(f"Erro ao limpar efatura_controlo_mensal na retenção: {e}")

    return resultado

def consultar_faturas_linhas_todas(
    tipo: str = "compras",
    data_inicio: str = "",
    data_fim: str = "",
    pesquisa: str = "",
    taxa = None,
    limite: int = 250,
    offset: int = 0,
    ordenar_por: str = "data_emissao",
    ordem: str = "desc"
) -> dict:
    """
    Consulta agregada de faturas e linhas em todas as bases de clientes em BdsefaturaV4.
    """
    import glob
    v4 = obter_pasta_v4()
    if not os.path.exists(v4):
        return {
            "total_linhas": 0,
            "total_documentos": 0,
            "soma_base": 0.0,
            "soma_iva": 0.0,
            "soma_total": 0.0,
            "linhas": []
        }

    colunas_ordenacao_validas = {
        "data_emissao": "data_emissao",
        "fatura": "fatura",
        "tipo_documento": "tipo_documento",
        "estado_documento": "estado_documento",
        "empresa_nossa": "nif_cliente",
        "nif_cliente": "nif_cliente",
        "contraparte_nif": "contraparte_nif",
        "contraparte_nome": "contraparte_nome",
        "contraparte_pais": "contraparte_pais",
        "setor_atividade": "setor_atividade",
        "tipo_imposto": "tipo_imposto",
        "codigo_taxa": "codigo_taxa",
        "taxa_percentagem": "taxa_percentagem",
        "base_incidencia": "base_incidencia",
        "valor_imposto": "valor_imposto",
        "total_linha": "(base_incidencia + valor_imposto)",
        "total_liquido_doc": "total_liquido_doc",
        "total_doc": "total_doc",
        "codigo_isencao": "codigo_isencao",
        "regiao_fiscal": "regiao_fiscal",
        "atcud": "atcud",
        "id_fatura_unico": "id_fatura_unico",
        "hash_linha": "hash_linha",
    }
    dir_sql = "ASC" if str(ordem).strip().lower() == "asc" else "DESC"
    col_sql = colunas_ordenacao_validas.get(str(ordenar_por).strip().lower(), "data_emissao")

    is_vendas = str(tipo).strip().lower() == "vendas"
    tabela = "efatura_vendas_linhas" if is_vendas else "efatura_linhas"
    padrao = os.path.join(v4, "*", f"vendas_*.db" if is_vendas else f"compras_*.db")
    dbs = glob.glob(padrao)

    where_clauses = ["1=1"]
    params = []
    if data_inicio:
        where_clauses.append("data_emissao >= ?")
        params.append(f"{data_inicio} 00:00:00")
    if data_fim:
        where_clauses.append("data_emissao <= ?")
        params.append(f"{data_fim} 23:59:59.999Z")
    if taxa is not None and str(taxa).strip() != "":
        try:
            val_taxa = float(taxa)
            where_clauses.append("taxa_percentagem = ?")
            params.append(val_taxa)
        except ValueError:
            pass
    if pesquisa and str(pesquisa).strip():
        termo = f"%{str(pesquisa).strip()}%"
        where_clauses.append("(fatura LIKE ? OR contraparte_nome LIKE ? OR contraparte_nif LIKE ? OR atcud LIKE ?)")
        params.extend([termo, termo, termo, termo])

    where_sql = " AND ".join(where_clauses)
    tot_linhas = 0
    tot_docs = 0
    soma_base = 0.0
    soma_iva = 0.0
    todas_linhas = []
    max_coletar = int(limite) + int(offset)

    for db_path in dbs:
        try:
            with sqlite3.connect(db_path, timeout=5) as conn:
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                count_sql = f"""
                SELECT 
                    COUNT(*) as total_linhas,
                    COUNT(DISTINCT id_fatura_unico) as total_documentos,
                    COALESCE(SUM(base_incidencia), 0) as soma_base,
                    COALESCE(SUM(valor_imposto), 0) as soma_iva
                FROM {tabela}
                WHERE {where_sql}
                """
                c.execute(count_sql, params)
                res = c.fetchone()
                if res and res["total_linhas"] > 0:
                    tot_linhas += int(res["total_linhas"] or 0)
                    tot_docs += int(res["total_documentos"] or 0)
                    soma_base += float(res["soma_base"] or 0)
                    soma_iva += float(res["soma_iva"] or 0)

                    query_linhas = f"""
                    SELECT 
                        id, id_cliente, hash_linha, id_fatura_unico, fatura, atcud,
                        SUBSTR(data_emissao, 1, 10) as data_emissao, tipo_documento,
                        estado_documento, nif_cliente, contraparte_nif, contraparte_nome,
                        contraparte_pais, setor_atividade, tipo_imposto, codigo_taxa,
                        taxa_percentagem, base_incidencia, valor_imposto,
                        (base_incidencia + valor_imposto) as total_linha,
                        codigo_isencao, regiao_fiscal, total_liquido_doc, total_doc
                    FROM {tabela}
                    WHERE {where_sql}
                    ORDER BY {col_sql} {dir_sql}, fatura DESC
                    LIMIT ?
                    """
                    c.execute(query_linhas, params + [max_coletar])
                    for r in c.fetchall():
                        todas_linhas.append({
                            "id": r["id"],
                            "id_cliente": r["id_cliente"] or "",
                            "hash_linha": r["hash_linha"] or "",
                            "id_fatura_unico": r["id_fatura_unico"] or "",
                            "fatura": r["fatura"] or "",
                            "atcud": r["atcud"] or "",
                            "data_emissao": r["data_emissao"] or "",
                            "tipo_documento": r["tipo_documento"] or "",
                            "estado_documento": r["estado_documento"] or "",
                            "nif_cliente": r["nif_cliente"] or "",
                            "contraparte_nif": r["contraparte_nif"] or "",
                            "contraparte_nome": r["contraparte_nome"] or "",
                            "contraparte_pais": r["contraparte_pais"] or "",
                            "setor_atividade": r["setor_atividade"] or "",
                            "tipo_imposto": r["tipo_imposto"] or "",
                            "codigo_taxa": r["codigo_taxa"] or "",
                            "taxa_percentagem": float(r["taxa_percentagem"] or 0),
                            "base_incidencia": round(float(r["base_incidencia"] or 0), 2),
                            "valor_imposto": round(float(r["valor_imposto"] or 0), 2),
                            "total_linha": round(float(r["total_linha"] or 0), 2),
                            "codigo_isencao": r["codigo_isencao"] or "",
                            "regiao_fiscal": r["regiao_fiscal"] or "",
                            "total_liquido_doc": round(float(r["total_liquido_doc"] or 0), 2),
                            "total_doc": round(float(r["total_doc"] or 0), 2),
                        })
        except Exception as e:
            LOGGER.warning(f"Aviso ao consultar DB cliente {db_path}: {e}")

    todas_linhas.sort(key=lambda r: (r.get("data_emissao") or "", r.get("fatura") or ""), reverse=True)
    linhas_pag = todas_linhas[offset:offset+limite]

    return {
        "total_linhas": tot_linhas,
        "total_documentos": tot_docs,
        "soma_base": round(soma_base, 2),
        "soma_iva": round(soma_iva, 2),
        "soma_total": round(soma_base + soma_iva, 2),
        "linhas": linhas_pag
    }

def consultar_faturas_linhas(
    tipo: str = "compras",
    nif: str = "",
    data_inicio: str = "",
    data_fim: str = "",
    pesquisa: str = "",
    taxa = None,
    limite: int = 250,
    offset: int = 0,
    ordenar_por: str = "data_emissao",
    ordem: str = "desc"
):
    """
    Consulta faturas e linhas individuais de compras ou vendas a partir da base SQLite da entidade em BdsefaturaV4.
    """
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()
    is_vendas = str(tipo).strip().lower() == "vendas"
    tipo_str = "vendas" if is_vendas else "compras"
    tabela = "efatura_vendas_linhas" if is_vendas else "efatura_linhas"

    if not nif_clean:
        return consultar_faturas_linhas_todas(
            tipo=tipo,
            data_inicio=data_inicio,
            data_fim=data_fim,
            pesquisa=pesquisa,
            taxa=taxa,
            limite=limite,
            offset=offset,
            ordenar_por=ordenar_por,
            ordem=ordem
        )

    colunas_ordenacao_validas = {
        "data_emissao": "data_emissao",
        "fatura": "fatura",
        "tipo_documento": "tipo_documento",
        "estado_documento": "estado_documento",
        "empresa_nossa": "nif_cliente",
        "nif_cliente": "nif_cliente",
        "contraparte_nif": "contraparte_nif",
        "contraparte_nome": "contraparte_nome",
        "contraparte_pais": "contraparte_pais",
        "setor_atividade": "setor_atividade",
        "tipo_imposto": "tipo_imposto",
        "codigo_taxa": "codigo_taxa",
        "taxa_percentagem": "taxa_percentagem",
        "base_incidencia": "base_incidencia",
        "valor_imposto": "valor_imposto",
        "total_linha": "(base_incidencia + valor_imposto)",
        "total_liquido_doc": "total_liquido_doc",
        "total_doc": "total_doc",
        "codigo_isencao": "codigo_isencao",
        "regiao_fiscal": "regiao_fiscal",
        "atcud": "atcud",
        "id_fatura_unico": "id_fatura_unico",
        "hash_linha": "hash_linha",
    }
    dir_sql = "ASC" if str(ordem).strip().lower() == "asc" else "DESC"
    col_sql = colunas_ordenacao_validas.get(str(ordenar_por).strip().lower(), "data_emissao")

    db_path = obter_db_cliente_path(nif_clean, tipo_str)
    if not os.path.exists(db_path):
        return {
            "total_linhas": 0,
            "total_documentos": 0,
            "soma_base": 0.0,
            "soma_iva": 0.0,
            "soma_total": 0.0,
            "linhas": []
        }

    where_clauses = ["1=1"]
    params = []

    # 1. Filtro de Empresa (NIF do cliente)
    where_clauses.append("(nif_cliente = ? OR nif_cliente = '')")
    params.append(nif_clean)

    # 2. Filtro de Período Temporal
    if data_inicio:
        where_clauses.append("data_emissao >= ?")
        params.append(f"{data_inicio} 00:00:00")
    if data_fim:
        where_clauses.append("data_emissao <= ?")
        params.append(f"{data_fim} 23:59:59.999Z")

    # 3. Filtro de Taxa IVA
    if taxa is not None and str(taxa).strip() != "":
        try:
            val_taxa = float(taxa)
            where_clauses.append("taxa_percentagem = ?")
            params.append(val_taxa)
        except ValueError:
            pass

    # 4. Filtro de Pesquisa Textual (Fatura, Contraparte, NIF, ATCUD)
    if pesquisa and str(pesquisa).strip():
        termo = f"%{str(pesquisa).strip()}%"
        where_clauses.append("(fatura LIKE ? OR contraparte_nome LIKE ? OR contraparte_nif LIKE ? OR atcud LIKE ?)")
        params.extend([termo, termo, termo, termo])

    where_sql = " AND ".join(where_clauses)

    try:
        with db_connect(db_path, timeout=30) as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()

            # Totais Agregados
            count_sql = f"""
            SELECT 
                COUNT(*) as total_linhas,
                COUNT(DISTINCT id_fatura_unico) as total_documentos,
                COALESCE(SUM(base_incidencia), 0) as soma_base,
                COALESCE(SUM(valor_imposto), 0) as soma_iva
            FROM {tabela}
            WHERE {where_sql}
            """
            c.execute(count_sql, params)
            res_totais = c.fetchone()
            tot_linhas = int(res_totais["total_linhas"] or 0) if res_totais else 0
            tot_docs = int(res_totais["total_documentos"] or 0) if res_totais else 0
            soma_base = round(float(res_totais["soma_base"] or 0), 2) if res_totais else 0.0
            soma_iva = round(float(res_totais["soma_iva"] or 0), 2) if res_totais else 0.0
            soma_total = round(soma_base + soma_iva, 2)

            # Linhas Paginadas
            query_linhas = f"""
            SELECT 
                id,
                id_cliente,
                hash_linha,
                id_fatura_unico,
                fatura,
                atcud,
                SUBSTR(data_emissao, 1, 10) as data_emissao,
                tipo_documento,
                estado_documento,
                nif_cliente,
                contraparte_nif,
                contraparte_nome,
                contraparte_pais,
                setor_atividade,
                tipo_imposto,
                codigo_taxa,
                taxa_percentagem,
                base_incidencia,
                valor_imposto,
                (base_incidencia + valor_imposto) as total_linha,
                codigo_isencao,
                regiao_fiscal,
                total_liquido_doc,
                total_doc
            FROM {tabela}
            WHERE {where_sql}
            ORDER BY {col_sql} {dir_sql}, fatura DESC, id ASC
            LIMIT ? OFFSET ?
            """
            params_linhas = list(params)
            params_linhas.extend([int(limite), int(offset)])
            c.execute(query_linhas, params_linhas)
            linhas_raw = c.fetchall()

            linhas = []
            for r in linhas_raw:
                linhas.append({
                    "id": r["id"],
                    "id_cliente": r["id_cliente"] or "",
                    "hash_linha": r["hash_linha"] or "",
                    "id_fatura_unico": r["id_fatura_unico"] or "",
                    "fatura": r["fatura"] or "",
                    "atcud": r["atcud"] or "",
                    "data_emissao": r["data_emissao"] or "",
                    "tipo_documento": r["tipo_documento"] or "",
                    "estado_documento": r["estado_documento"] or "",
                    "nif_cliente": r["nif_cliente"] or "",
                    "contraparte_nif": r["contraparte_nif"] or "",
                    "contraparte_nome": r["contraparte_nome"] or "",
                    "contraparte_pais": r["contraparte_pais"] or "",
                    "setor_atividade": r["setor_atividade"] or "",
                    "tipo_imposto": r["tipo_imposto"] or "",
                    "codigo_taxa": r["codigo_taxa"] or "",
                    "taxa_percentagem": float(r["taxa_percentagem"] or 0),
                    "base_incidencia": round(float(r["base_incidencia"] or 0), 2),
                    "valor_imposto": round(float(r["valor_imposto"] or 0), 2),
                    "total_linha": round(float(r["total_linha"] or 0), 2),
                    "codigo_isencao": r["codigo_isencao"] or "",
                    "regiao_fiscal": r["regiao_fiscal"] or "",
                    "total_liquido_doc": round(float(r["total_liquido_doc"] or 0), 2),
                    "total_doc": round(float(r["total_doc"] or 0), 2),
                })

            return {
                "total_linhas": tot_linhas,
                "total_documentos": tot_docs,
                "soma_base": soma_base,
                "soma_iva": soma_iva,
                "soma_total": soma_total,
                "linhas": linhas
            }
    except Exception as e:
        LOGGER.error(f"Erro ao consultar faturas linhas: {e}")
        return {
            "total_linhas": 0,
            "total_documentos": 0,
            "soma_base": 0.0,
            "soma_iva": 0.0,
            "soma_total": 0.0,
            "linhas": [],
            "erro": str(e)
        }

def consultar_inconformidades(
    nif: str = "",
    modulo: str = "",
    data_inicio: str = "",
    data_fim: str = "",
    limite: int = 100,
    offset: int = 0
) -> dict:
    """Consulta registos de auditoria forense de inconformidades / anulações tardias no data.db."""
    init_inconformidades_db()
    ctrl_db = obter_db_controlo_path()
    if not os.path.exists(ctrl_db):
        return {"total": 0, "inconformidades": []}

    where_clauses = ["1=1"]
    params = []

    if nif and str(nif).strip():
        where_clauses.append("nif_cliente = ?")
        params.append(str(nif).strip())

    if modulo and str(modulo).strip().lower() in ("compras", "vendas"):
        where_clauses.append("modulo = ?")
        params.append(str(modulo).strip().lower())

    if data_inicio:
        where_clauses.append("data_deteccao >= ?")
        params.append(data_inicio[:10])

    if data_fim:
        where_clauses.append("data_deteccao <= ?")
        params.append(data_fim[:10])

    where_sql = " AND ".join(where_clauses)

    try:
        with sqlite3.connect(ctrl_db, timeout=30) as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute(f"SELECT COUNT(*) as total FROM efatura_inconformidades WHERE {where_sql}", params)
            total = c.fetchone()["total"]

            query = f"""
                SELECT id, id_fatura_unico, modulo, nif_cliente, fatura, data_emissao, valor_total, data_deteccao
                FROM efatura_inconformidades
                WHERE {where_sql}
                ORDER BY data_deteccao DESC, id_fatura_unico ASC
                LIMIT ? OFFSET ?
            """
            c.execute(query, params + [int(limite), int(offset)])
            rows = [dict(r) for r in c.fetchall()]

        # Enriquecer com registos do Cofre Permanente (.vault)
        try:
            vault_inconfs = CofreEstadosLedger().obter_inconformidades(nif_cliente=nif)
            chaves_existentes = {r.get("id_fatura_unico") for r in rows}
            for vi in vault_inconfs:
                k = vi.get("id_fatura_unico")
                if k and k not in chaves_existentes:
                    rows.append({
                        "id": f"vault_{k}",
                        "id_fatura_unico": k,
                        "modulo": "vendas" if str(k).startswith("V") else "compras",
                        "nif_cliente": vi.get("nif_cliente", nif),
                        "fatura": k,
                        "data_emissao": vi.get("data_registo_inicial", ""),
                        "valor_total": 0.0,
                        "data_deteccao": vi.get("data_anulacao_detetada", "")
                    })
                    total += 1
        except Exception as ve:
            LOGGER.debug(f"Aviso ao consultar cofre ledger em consultar_inconformidades: {ve}")

        return {
            "total": total,
            "limite": limite,
            "offset": offset,
            "inconformidades": rows
        }
    except Exception as e:
        LOGGER.error(f"Erro ao consultar efatura_inconformidades: {e}")
        return {
            "total": 0,
            "limite": limite,
            "offset": offset,
            "inconformidades": [],
            "erro": str(e)
        }


def consultar_anuladas(
    nif: str = "",
    modulo: str = "",
    data_inicio: str = "",
    data_fim: str = "",
    filtro_origem: str = "todos",
    pesquisa: str = "",
    ordenar_por: str = "data_emissao",
    ordem: str = "desc",
    limite: int = 250,
    offset: int = 0
) -> dict:
    """
    Consulta unificada de todos os documentos anulados da(s) entidade(s):
    1. Base dedicada BdsefaturaV4/{NIF}/anuladas_{NIF}.db (tabela efatura_anuladas)
    2. Bases compras_{NIF}.db e vendas_{NIF}.db com estado_documento IN ('A', 'ANULADO', 'ANULADA')
    3. Cruzamento com efatura_inconformidades (controlo_geral.db) e CofreEstadosLedger (.vault)
       para distinguir Anulações Tardias Forenses (N -> A) de Anulados na Origem (A).
    """
    init_inconformidades_db()
    nif_clean = re.sub(r"[^0-9]", "", str(nif or "")).strip()[:9]
    mod_clean = str(modulo or "").strip().lower()
    if mod_clean not in ("compras", "vendas"):
        mod_clean = ""

    d_ini = str(data_inicio or "")[:10]
    d_fim = str(data_fim or "")[:10]
    termo = str(pesquisa or "").strip().lower()
    origem_clean = str(filtro_origem or "todos").strip().lower()

    mapa_nomes_entidades = {
        str(e.get("nif") or "").strip(): str(e.get("nomecli") or "").strip()
        for e in get_lista_entidades_ui()
    }

    # 1. Obter conjunto de chaves que são inconformidades forenses (N -> A)
    inconf_por_id = {}
    inconf_por_fatura = {}
    ctrl_db_anul = obter_db_controlo_path()
    try:
        if os.path.exists(ctrl_db_anul):
            with sqlite3.connect(ctrl_db_anul, timeout=15) as conn:
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                c.execute("SELECT * FROM efatura_inconformidades")
                for r in c.fetchall():
                    d_r = dict(r)
                    k_id = str(d_r.get("id_fatura_unico") or "").strip()
                    k_fat = (str(d_r.get("nif_cliente") or "").strip(), str(d_r.get("modulo") or "").strip().lower(), str(d_r.get("fatura") or "").strip())
                    if k_id:
                        inconf_por_id[k_id] = d_r
                    if k_fat[0] and k_fat[2]:
                        inconf_por_fatura[k_fat] = d_r
    except Exception as e_inc:
        LOGGER.debug(f"Aviso ao ler efatura_inconformidades em consultar_anuladas: {e_inc}")

    try:
        vault_list = CofreEstadosLedger().obter_inconformidades(nif_cliente=nif_clean or None)
        for vi in vault_list:
            k_id = str(vi.get("id_fatura_unico") or "").strip()
            if k_id and k_id not in inconf_por_id:
                inconf_por_id[k_id] = {
                    "id": f"vault_{k_id}",
                    "id_fatura_unico": k_id,
                    "modulo": "vendas" if k_id.startswith("V") else "compras",
                    "nif_cliente": str(vi.get("nif_cliente") or nif_clean or ""),
                    "fatura": k_id,
                    "data_emissao": str(vi.get("data_registo_inicial") or "")[:10],
                    "valor_total": 0.0,
                    "data_deteccao": str(vi.get("data_anulacao_detetada") or "")[:10],
                }
    except Exception:
        pass

    # 2. Determinar NIFs alvo em BdsefaturaV4
    v4_dir = obter_pasta_v4()
    if nif_clean:
        nifs_alvo = [nif_clean]
    elif os.path.exists(v4_dir):
        nifs_alvo = sorted([
            d for d in os.listdir(v4_dir)
            if os.path.isdir(os.path.join(v4_dir, d)) and d.isdigit() and len(d) == 9
        ])
    else:
        nifs_alvo = []

    registos_unificados = {}

    for n_cli in nifs_alvo:
        nome_cli = mapa_nomes_entidades.get(n_cli) or get_entidade_nome(n_cli)

        # 2.1 Ler base dedicada anuladas_{NIF}.db
        db_anul = obter_db_cliente_path(n_cli, "anuladas")
        if os.path.exists(db_anul):
            try:
                with sqlite3.connect(db_anul, timeout=10) as conn_a:
                    conn_a.row_factory = sqlite3.Row
                    c_a = conn_a.cursor()
                    c_a.execute("SELECT * FROM efatura_anuladas")
                    for r in c_a.fetchall():
                        mod_r = str(r["modulo"] or "compras").strip().lower()
                        if mod_clean and mod_r != mod_clean:
                            continue
                        dt_em = str(r["data_emissao"] or "")[:10]
                        dt_det = str(r["data_deteccao"] or r["data_anulacao"] or "")[:10]
                        uid = str(r["id_fatura_unico"] or "").strip()
                        fat_no = str(r["fatura"] or "").strip()
                        chave_dedup = f"{n_cli}|{mod_r}|{fat_no or uid}"

                        inc_match = inconf_por_id.get(uid) or inconf_por_fatura.get((n_cli, mod_r, fat_no))
                        is_inconf = inc_match is not None

                        registos_unificados[chave_dedup] = {
                            "id": str(r["id"] or uid),
                            "id_fatura_unico": uid,
                            "modulo": mod_r,
                            "nif_cliente": n_cli,
                            "nome_cliente": nome_cli,
                            "fatura": fat_no or uid,
                            "atcud": str(r["atcud"] or ""),
                            "tipo_documento": "FT",
                            "data_emissao": dt_em,
                            "contraparte_nif": str(r["contraparte_nif"] or ""),
                            "contraparte_nome": str(r["contraparte_nome"] or ""),
                            "total_liquido": round(float(r["total_liquido"] or 0.0), 2),
                            "total_iva": round(float(r["total_iva"] or 0.0), 2),
                            "total_doc": round(float(r["total_doc"] or 0.0), 2),
                            "data_deteccao": str(inc_match.get("data_deteccao") if inc_match else dt_det)[:10],
                            "is_inconformidade": is_inconf,
                            "tipo_alerta": "inconformidade_forense" if is_inconf else "anulado_origem",
                        }
            except Exception as e_a:
                LOGGER.debug(f"Aviso ao ler {db_anul}: {e_a}")

        # 2.2 Ler faturas com estado_documento='A' em compras_{NIF}.db e vendas_{NIF}.db
        modulos_scan = [mod_clean] if mod_clean else ["compras", "vendas"]
        for m_scan in modulos_scan:
            db_m = obter_db_cliente_path(n_cli, m_scan)
            if not os.path.exists(db_m):
                continue
            tab_m = "efatura_vendas_linhas" if m_scan == "vendas" else "efatura_linhas"
            try:
                with sqlite3.connect(db_m, timeout=10) as conn_m:
                    conn_m.row_factory = sqlite3.Row
                    c_m = conn_m.cursor()
                    c_m.execute(f"""
                        SELECT id_fatura_unico, fatura, atcud, tipo_documento,
                               SUBSTR(data_emissao, 1, 10) as dt_emissao,
                               contraparte_nif, contraparte_nome,
                               SUM(base_incidencia) as soma_base,
                               SUM(valor_imposto) as soma_iva,
                               MAX(total_doc) as max_total_doc,
                               MAX(updated) as dt_updated
                        FROM {tab_m}
                        WHERE UPPER(TRIM(estado_documento)) IN ('A', 'ANULADO', 'ANULADA')
                        GROUP BY id_fatura_unico, fatura
                    """)
                    for r in c_m.fetchall():
                        uid = str(r["id_fatura_unico"] or "").strip()
                        fat_no = str(r["fatura"] or "").strip()
                        chave_dedup = f"{n_cli}|{m_scan}|{fat_no or uid}"
                        inc_match = inconf_por_id.get(uid) or inconf_por_fatura.get((n_cli, m_scan, fat_no))
                        is_inconf = inc_match is not None

                        t_liq = round(float(r["soma_base"] or 0.0), 2)
                        t_iva = round(float(r["soma_iva"] or 0.0), 2)
                        t_doc = round(float(r["max_total_doc"] or (t_liq + t_iva)), 2)

                        if chave_dedup not in registos_unificados:
                            registos_unificados[chave_dedup] = {
                                "id": f"db_{uid}_{fat_no}",
                                "id_fatura_unico": uid,
                                "modulo": m_scan,
                                "nif_cliente": n_cli,
                                "nome_cliente": nome_cli,
                                "fatura": fat_no or uid,
                                "atcud": str(r["atcud"] or ""),
                                "tipo_documento": str(r["tipo_documento"] or "FT"),
                                "data_emissao": str(r["dt_emissao"] or "")[:10],
                                "contraparte_nif": str(r["contraparte_nif"] or ""),
                                "contraparte_nome": str(r["contraparte_nome"] or ""),
                                "total_liquido": t_liq,
                                "total_iva": t_iva,
                                "total_doc": t_doc,
                                "data_deteccao": str(inc_match.get("data_deteccao") if inc_match else (r["dt_updated"] or ""))[:10],
                                "is_inconformidade": is_inconf,
                                "tipo_alerta": "inconformidade_forense" if is_inconf else "anulado_origem",
                            }
                        else:
                            ex = registos_unificados[chave_dedup]
                            if not ex.get("atcud") and r["atcud"]:
                                ex["atcud"] = str(r["atcud"])
                            if not ex.get("contraparte_nome") and r["contraparte_nome"]:
                                ex["contraparte_nome"] = str(r["contraparte_nome"])
                            if is_inconf:
                                ex["is_inconformidade"] = True
                                ex["tipo_alerta"] = "inconformidade_forense"
            except Exception as e_m:
                LOGGER.debug(f"Aviso ao ler anuladas em {db_m}: {e_m}")

    # 3. Garantir que qualquer inconformidade registada em controlo_geral.db / vault também consta na lista
    for k_id, inc in inconf_por_id.items():
        n_cli = re.sub(r"[^0-9]", "", str(inc.get("nif_cliente") or "")).strip()[:9]
        if nif_clean and n_cli != nif_clean:
            continue
        mod_r = str(inc.get("modulo") or "compras").strip().lower()
        if mod_clean and mod_r != mod_clean:
            continue
        fat_no = str(inc.get("fatura") or k_id).strip()
        chave_dedup = f"{n_cli}|{mod_r}|{fat_no}"
        if chave_dedup not in registos_unificados:
            nome_cli = mapa_nomes_entidades.get(n_cli) or get_entidade_nome(n_cli)
            val_tot = round(float(inc.get("valor_total") or 0.0), 2)
            registos_unificados[chave_dedup] = {
                "id": str(inc.get("id") or f"inc_{k_id}"),
                "id_fatura_unico": k_id,
                "modulo": mod_r,
                "nif_cliente": n_cli,
                "nome_cliente": nome_cli,
                "fatura": fat_no,
                "atcud": "",
                "tipo_documento": "FT",
                "data_emissao": str(inc.get("data_emissao") or "")[:10],
                "contraparte_nif": "",
                "contraparte_nome": "",
                "total_liquido": val_tot,
                "total_iva": 0.0,
                "total_doc": val_tot,
                "data_deteccao": str(inc.get("data_deteccao") or "")[:10],
                "is_inconformidade": True,
                "tipo_alerta": "inconformidade_forense",
            }

    # 4. Aplicar filtros de data, pesquisa e origem
    lista_filtrada_base = []
    for item in registos_unificados.values():
        dt_ref = item.get("data_emissao") or item.get("data_deteccao") or ""
        if d_ini and dt_ref and dt_ref < d_ini:
            continue
        if d_fim and dt_ref and dt_ref > d_fim:
            continue
        if termo:
            busca_str = " ".join([
                str(item.get("fatura") or ""),
                str(item.get("id_fatura_unico") or ""),
                str(item.get("atcud") or ""),
                str(item.get("nif_cliente") or ""),
                str(item.get("nome_cliente") or ""),
                str(item.get("contraparte_nif") or ""),
                str(item.get("contraparte_nome") or ""),
            ]).lower()
            if termo not in busca_str:
                continue
        lista_filtrada_base.append(item)

    total_global = len(lista_filtrada_base)
    total_inconf = sum(1 for x in lista_filtrada_base if x.get("is_inconformidade"))
    total_origem = total_global - total_inconf

    if origem_clean in ("inconformidades", "forense", "n_a"):
        lista_final = [x for x in lista_filtrada_base if x.get("is_inconformidade")]
    elif origem_clean in ("origem", "anulado_origem", "a"):
        lista_final = [x for x in lista_filtrada_base if not x.get("is_inconformidade")]
    else:
        lista_final = lista_filtrada_base

    soma_liquido = round(sum(float(x.get("total_liquido") or 0.0) for x in lista_final), 2)
    soma_iva = round(sum(float(x.get("total_iva") or 0.0) for x in lista_final), 2)
    soma_total = round(sum(float(x.get("total_doc") or 0.0) for x in lista_final), 2)

    reverse_sort = str(ordem or "desc").strip().lower() != "asc"
    col_sort = str(ordenar_por or "data_emissao").strip()

    def _sort_key_anul(x):
        v = x.get(col_sort)
        if col_sort in ("total_liquido", "total_iva", "total_doc"):
            try:
                return float(v or 0.0)
            except Exception:
                return 0.0
        return str(v or "").lower()

    lista_final.sort(key=_sort_key_anul, reverse=reverse_sort)
    paginados = lista_final[int(offset): int(offset) + int(limite)]

    return {
        "total": len(lista_final),
        "total_anuladas_global": total_global,
        "total_inconformidades": total_inconf,
        "total_anuladas_origem": total_origem,
        "soma_liquido": soma_liquido,
        "soma_iva": soma_iva,
        "soma_total": soma_total,
        "limite": int(limite),
        "offset": int(offset),
        "anuladas": paginados,
    }






