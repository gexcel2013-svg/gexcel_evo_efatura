# -*- coding: utf-8 -*-
"""
pendentes_service.py - Motor de Classificação de Documentos Pendentes e-Fatura (Gexcel EVO).

Responsabilidades:
1. Catálogo oficial atualizado da AT (16 setores C01..C15 + C99 e 3 âmbitos 0/1/2).
2. Filtragem de entidades singulares (NIFs iniciados por 1, 2, 3 ou 45).
3. Persistência SQLite resiliente em WAL (`BdsefaturaV4/pendentes_efatura.db`).
4. Recolha em bloco de documentos pendentes e histórico (ano atual e anterior) na AT.
5. Motor de pré-classificação determinístico (Modo Tudo Fora -> Histórico Ano Atual ->
   Histórico Ano Anterior -> Palavras-Chave -> Regra de Setores Pessoais), com sinalização `%`
   de fornecedores com histórico dividido.
6. Classificação em bloco por fornecedor/cliente, validação explícita por cliente e registo
   imutável de Termo de Responsabilidade (SHA-256) antes de qualquer submissão na AT.
7. Submissão em lote (`resolverListaPendenciasAdquirente.action`) com verificação empírica e
   fallback individual (`detalheDocumentoAdquirente.action`).
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import sqlite3
import sys
import threading
import time
import unicodedata
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

import pb_client

LOGGER = logging.getLogger("gexcel.efatura.pendentes")

# =============================================================================
# 1. CATÁLOGOS OFICIAIS AT (16 SETORES + 3 ÂMBITOS + DOCS NÃO ADMITIDOS)
# =============================================================================

SETORES_EFATURA: List[Dict[str, Any]] = [
    # Grupo 1: Atividade / Mistos (podem ser dentro ou fora da atividade)
    {
        "codigo": "C99",
        "nome_curto": "Outros",
        "descricao_at": "Outros / Despesas Gerais Familiares",
        "grupo": "atividade_misto",
        "auto_fora": False,
    },
    {
        "codigo": "C03",
        "nome_curto": "Restauração / Aloj.",
        "descricao_at": "Alojamento, restauração e similares",
        "grupo": "atividade_misto",
        "auto_fora": False,
    },
    {
        "codigo": "C01",
        "nome_curto": "Reparação Auto",
        "descricao_at": "Manutenção e reparação de veículos automóveis",
        "grupo": "atividade_misto",
        "auto_fora": False,
    },
    {
        "codigo": "C02",
        "nome_curto": "Reparação Motos",
        "descricao_at": "Manutenção e reparação de motociclos, de suas peças e acessórios",
        "grupo": "atividade_misto",
        "auto_fora": False,
    },
    {
        "codigo": "C07",
        "nome_curto": "Imóveis",
        "descricao_at": "Imóveis",
        "grupo": "atividade_misto",
        "auto_fora": False,
    },
    {
        "codigo": "C04",
        "nome_curto": "Cabeleireiros",
        "descricao_at": "Atividades de salões de cabeleireiro e institutos de beleza",
        "grupo": "atividade_misto",
        "auto_fora": False,
    },
    # Grupo 2: Setores Pessoais (Fora da Atividade por defeito -> âmbito '1')
    {
        "codigo": "C05",
        "nome_curto": "Saúde",
        "descricao_at": "Saúde",
        "grupo": "pessoal",
        "auto_fora": True,
    },
    {
        "codigo": "C06",
        "nome_curto": "Educação",
        "descricao_at": "Educação",
        "grupo": "pessoal",
        "auto_fora": True,
    },
    {
        "codigo": "C08",
        "nome_curto": "Lares",
        "descricao_at": "Lares",
        "grupo": "pessoal",
        "auto_fora": True,
    },
    {
        "codigo": "C11",
        "nome_curto": "Ginásios",
        "descricao_at": "Ginásios",
        "grupo": "pessoal",
        "auto_fora": True,
    },
    {
        "codigo": "C10",
        "nome_curto": "Passes / Transportes",
        "descricao_at": "Aquisição de passes mensais ou de bilhetes para utilização de transportes públicos coletivos",
        "grupo": "pessoal",
        "auto_fora": True,
    },
    {
        "codigo": "C09",
        "nome_curto": "Veterinários",
        "descricao_at": "Atividades veterinárias",
        "grupo": "pessoal",
        "auto_fora": True,
    },
    {
        "codigo": "C12",
        "nome_curto": "Jornais e Revistas",
        "descricao_at": "Jornais e Revistas",
        "grupo": "pessoal",
        "auto_fora": True,
    },
    {
        "codigo": "C13",
        "nome_curto": "Livros",
        "descricao_at": "Comércio a retalho de livros",
        "grupo": "pessoal",
        "auto_fora": True,
    },
    {
        "codigo": "C14",
        "nome_curto": "Artes / Espetáculos",
        "descricao_at": "Atividades artísticas e literárias",
        "grupo": "pessoal",
        "auto_fora": True,
    },
    {
        "codigo": "C15",
        "nome_curto": "Museus",
        "descricao_at": "Atividades dos museus e monumentos históricos",
        "grupo": "pessoal",
        "auto_fora": True,
    },
]

SETORES_MAP: Dict[str, Dict[str, Any]] = {s["codigo"]: s for s in SETORES_EFATURA}
CODIGOS_SETOR_VALIDOS = set(SETORES_MAP.keys())
SETORES_AUTO_FORA = {s["codigo"] for s in SETORES_EFATURA if s["auto_fora"]}

AMBITOS_ATIVIDADE: List[Dict[str, str]] = [
    {
        "codigo": "0",
        "nome_curto": "Sim Total",
        "descricao_at": "Sim, despesa totalmente afeta à atividade",
    },
    {
        "codigo": "2",
        "nome_curto": "Sim Parcial",
        "descricao_at": "Sim, despesa parcialmente afeta à atividade",
    },
    {
        "codigo": "1",
        "nome_curto": "Não (Fora)",
        "descricao_at": "Não",
    },
]

AMBITOS_MAP: Dict[str, Dict[str, str]] = {a["codigo"]: a for a in AMBITOS_ATIVIDADE}
CODIGOS_AMBITO_VALIDOS = set(AMBITOS_MAP.keys())

DOCS_NAO_ADMITIDOS = {
    "documento de conferencia",
    "consultas de mesa",
    "credito de consignacao",
    "fatura de consignacao",
    "folhas de obra",
    "nota de encomenda",
    "orcamentos",
    "pro-forma",
    "proforma",
}

PALAVRAS_CHAVE_INICIAIS: List[Tuple[str, str, str]] = [
    # Saúde (C05 -> Fora)
    ("FARMACIA", "C05", "1"),
    ("CLINICA", "C05", "1"),
    ("HOSPITAL", "C05", "1"),
    ("DENTARIA", "C05", "1"),
    ("MEDICINA", "C05", "1"),
    ("OPTICA", "C05", "1"),
    ("OTICA", "C05", "1"),
    ("LABORATORIO", "C05", "1"),
    # Educação (C06 -> Fora)
    ("ESCOLA", "C06", "1"),
    ("COLEGIO", "C06", "1"),
    ("UNIVERSIDADE", "C06", "1"),
    ("INSTITUTO POLITECNICO", "C06", "1"),
    ("CRECHE", "C06", "1"),
    ("JARDIM DE INFANCIA", "C06", "1"),
    # Lares (C08 -> Fora)
    ("SANTA CASA", "C08", "1"),
    ("MISERICORDIA", "C08", "1"),
    ("CENTRO SOCIAL", "C08", "1"),
    ("RESIDENCIA SENIOR", "C08", "1"),
    # Veterinários (C09 -> Fora)
    ("VETERINAR", "C09", "1"),
    ("CLINICA ANIMAL", "C09", "1"),
    ("HOSPITAL ANIMAL", "C09", "1"),
    # Passes / Transportes Públicos (C10 -> Fora)
    ("METROPOLITANO", "C10", "1"),
    ("CARRIS", "C10", "1"),
    ("COMBOIOS DE PORTUGAL", "C10", "1"),
    ("STCP", "C10", "1"),
    ("TRANSTEJO", "C10", "1"),
    ("FERTAGUS", "C10", "1"),
    ("ANDANTE", "C10", "1"),
    ("NAVEGANTE", "C10", "1"),
    # Ginásios (C11 -> Fora)
    ("GINASIO", "C11", "1"),
    ("FITNESS", "C11", "1"),
    ("SOLINCA", "C11", "1"),
    ("HOLMES PLACE", "C11", "1"),
    ("ELEMENT GYM", "C11", "1"),
    ("VIVA GYM", "C11", "1"),
    ("CROSSFIT", "C11", "1"),
    # Jornais e Revistas (C12 -> Fora)
    ("JORNAL", "C12", "1"),
    ("REVISTA", "C12", "1"),
    ("PUBLICO COMUNICACAO", "C12", "1"),
    ("IMPRESA PUBLISHING", "C12", "1"),
    # Livros (C13 -> Fora)
    ("LIVRARIA", "C13", "1"),
    ("BERTRAND", "C13", "1"),
    ("PORTO EDITORA", "C13", "1"),
    ("ALMEDINA", "C13", "1"),
    ("WOOK", "C13", "1"),
    # Atividades artísticas e literárias (C14 -> Fora)
    ("TEATRO", "C14", "1"),
    ("FILARMONICA", "C14", "1"),
    ("CINEMA", "C14", "1"),
    ("BILHETEIRA", "C14", "1"),
    ("AUDITORIO", "C14", "1"),
    # Museus e monumentos históricos (C15 -> Fora)
    ("MUSEU", "C15", "1"),
    ("MONUMENTO", "C15", "1"),
    ("PALACIO NACIONAL", "C15", "1"),
    # Reparação Auto (C01)
    ("OFICINA", "C01", ""),
    ("PNEUS", "C01", ""),
    ("NORAUTO", "C01", ""),
    ("FEU VERT", "C01", ""),
    ("MIDAS", "C01", ""),
    ("CARGLASS", "C01", ""),
    ("BOSCH CAR", "C01", ""),
    # Reparação Motos (C02)
    ("MOTOCICLOS", "C02", ""),
    ("MOTOS ", "C02", ""),
    # Restauração / Alojamento (C03)
    ("RESTAURANTE", "C03", ""),
    ("PASTELARIA", "C03", ""),
    ("CHURRASCARIA", "C03", ""),
    ("PIZZARIA", "C03", ""),
    ("HOTEL ", "C03", ""),
    ("CAFETERIA", "C03", ""),
    ("PADARIA", "C03", ""),
    # Cabeleireiros (C04)
    ("CABELEIREIR", "C04", ""),
    ("BARBEARIA", "C04", ""),
    ("INSTITUTO DE BELEZA", "C04", ""),
    # Outros (C99)
    ("CONTINENTE", "C99", ""),
    ("MODELO CONTINENTE", "C99", ""),
    ("PINGO DOCE", "C99", ""),
    ("LIDL", "C99", ""),
    ("MERCADONA", "C99", ""),
    ("AUCHAN", "C99", ""),
    ("INTERMARCHE", "C99", ""),
    ("ALDI", "C99", ""),
    ("EDP ", "C99", ""),
    ("SU ELETRICIDADE", "C99", ""),
    ("ENDESA", "C99", ""),
    ("IBERDROLA", "C99", ""),
    ("GALP", "C99", ""),
    ("REPSOL", "C99", ""),
    ("CEPSA", "C99", ""),
    ("VODAFONE", "C99", ""),
    ("MEO ", "C99", ""),
    ("NOS COMUNICACOES", "C99", ""),
    ("DIGI ", "C99", ""),
    ("VIA VERDE", "C99", ""),
    ("CTT ", "C99", ""),
    ("WORTEN", "C99", ""),
    ("LEROY MERLIN", "C99", ""),
    ("IKEA", "C99", ""),
]

_DB_LOCK = threading.RLock()
_INIT_PATHS_DONE: set[str] = set()


# =============================================================================
# 2. UTILITÁRIOS DE NORMALIZAÇÃO E CONEXÃO SQLITE RESILIENTE
# =============================================================================

def _normalizar_texto(val: Any) -> str:
    txt = str(val or "").strip()
    if not txt:
        return ""
    sem_acentos = unicodedata.normalize("NFKD", txt).encode("ASCII", "ignore").decode("utf-8")
    return re.sub(r"\s+", " ", sem_acentos).upper().strip()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def limpar_nif(nif: Any) -> str:
    digits = re.sub(r"[^0-9]", "", str(nif or "")).strip()
    return digits[:9]


def is_nif_singular(nif: Any) -> bool:
    """Identifica contribuintes singulares (NIFs iniciados por 1, 2, 3 ou 45)."""
    nif_clean = limpar_nif(nif)
    if len(nif_clean) != 9:
        return False
    return nif_clean[0] in ("1", "2", "3") or nif_clean.startswith("45")


def normalizar_codigo_setor(val: Any) -> str:
    s = str(val or "").strip()
    if not s:
        return ""
    up = s.upper()
    if up in CODIGOS_SETOR_VALIDOS:
        return up
    if ":" in up:
        cand = up.split(":")[-1].strip()
        if cand in CODIGOS_SETOR_VALIDOS:
            return cand
    norm = _normalizar_texto(s)
    if norm in ("DGF", "DESPESAS GERAIS FAMILIARES", "OUTROS", "OUTRO"):
        return "C99"
    for info in SETORES_EFATURA:
        if norm == _normalizar_texto(info["descricao_at"]) or norm == _normalizar_texto(info["nome_curto"]):
            return info["codigo"]
    if "SAUDE" in norm:
        return "C05"
    if "EDUCAC" in norm:
        return "C06"
    if "IMOVE" in norm:
        return "C07"
    if "LARES" in norm:
        return "C08"
    if "AUTOMOV" in norm or "REPAUTO" in norm:
        return "C01"
    if "MOTOCICL" in norm or "REPMOTO" in norm:
        return "C02"
    if "RESTAURAC" in norm or "ALOJAMENT" in norm:
        return "C03"
    if "CABELEIR" in norm:
        return "C04"
    if "VETERIN" in norm:
        return "C09"
    if "PASSE" in norm or "TRANSPORTES PUBLIC" in norm:
        return "C10"
    if "GINASI" in norm:
        return "C11"
    if "JORNA" in norm or "REVISTA" in norm:
        return "C12"
    if "LIVRO" in norm:
        return "C13"
    if "ARTISTIC" in norm or "LITERARI" in norm:
        return "C14"
    if "MUSEU" in norm or "MONUMENT" in norm:
        return "C15"
    return ""


def normalizar_codigo_ambito(val: Any) -> str:
    s = str(val or "").strip()
    if not s:
        return ""
    if s in CODIGOS_AMBITO_VALIDOS:
        return s
    if ":" in s:
        cand = s.split(":")[-1].strip()
        if cand in CODIGOS_AMBITO_VALIDOS:
            return cand
    norm = _normalizar_texto(s)
    if norm in ("NAO", "FORA", "1"):
        return "1"
    if "PARCIAL" in norm or norm == "2":
        return "2"
    if "TOTAL" in norm or norm in ("SIM", "DENTRO", "0"):
        return "0"
    return ""


def is_doc_nao_admitido(tipo_doc_desc: Any) -> bool:
    norm = _normalizar_texto(tipo_doc_desc).lower()
    if not norm:
        return False
    return norm in DOCS_NAO_ADMITIDOS


def obter_pendentes_db_path(override_path: Optional[str] = None) -> str:
    if override_path:
        p = Path(override_path)
    else:
        env_path = (os.environ.get("GEXCEL_PENDENTES_DB_PATH") or "").strip()
        if env_path:
            p = Path(env_path)
        else:
            pasta_v4 = Path(pb_client.obter_pasta_v4())
            p = pasta_v4 / "pendentes_efatura.db"
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p.resolve())


def _conectar_db(db_path: Optional[str] = None, timeout: float = 20.0) -> sqlite3.Connection:
    resolved = obter_pendentes_db_path(db_path)
    conn = sqlite3.connect(resolved, timeout=timeout, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        pb_client.aplicar_pragmas_conexao(conn, resolved, timeout=int(timeout))
    except Exception:
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            conn.execute(f"PRAGMA busy_timeout={int(timeout * 1000)};")
        except Exception:
            pass
    return conn


def _executar_com_retry(fn: Callable[[], Any], tentativas: int = 4) -> Any:
    atraso = 0.15
    for idx in range(tentativas):
        try:
            return fn()
        except sqlite3.OperationalError as e:
            msg = str(e).lower()
            if idx < tentativas - 1 and ("locked" in msg or "busy" in msg):
                time.sleep(atraso)
                atraso *= 2
                continue
            raise


def init_pendentes_db(db_path: Optional[str] = None) -> str:
    resolved = obter_pendentes_db_path(db_path)
    if resolved in _INIT_PATHS_DONE and os.path.exists(resolved):
        return resolved

    def _init():
        with _DB_LOCK:
            with _conectar_db(resolved) as conn:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS pendentes_meta (
                        chave TEXT PRIMARY KEY,
                        valor TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS pendentes_documentos (
                        nif_cliente TEXT NOT NULL,
                        id_documento TEXT NOT NULL,
                        id_fatura_unico TEXT DEFAULT '',
                        nome_cliente TEXT DEFAULT '',
                        ano INTEGER NOT NULL,
                        mes INTEGER NOT NULL,
                        data_emissao TEXT DEFAULT '',
                        nif_emitente TEXT DEFAULT '',
                        nome_emitente TEXT DEFAULT '',
                        tipo_doc TEXT DEFAULT '',
                        tipo_doc_desc TEXT DEFAULT '',
                        numero_documento TEXT DEFAULT '',
                        atcud TEXT DEFAULT '',
                        valor_total REAL DEFAULT 0.0,
                        valor_base REAL DEFAULT 0.0,
                        valor_iva REAL DEFAULT 0.0,
                        setor_at_original TEXT DEFAULT '',
                        ambito_at_original TEXT DEFAULT '',
                        estado_at TEXT DEFAULT 'P',
                        setor_codigo TEXT DEFAULT '',
                        ambito_codigo TEXT DEFAULT '',
                        origem_sugestao TEXT DEFAULT '',
                        historico_dividido_setor INTEGER DEFAULT 0,
                        historico_dividido_ambito INTEGER DEFAULT 0,
                        detalhe_historico TEXT DEFAULT '',
                        validado INTEGER DEFAULT 0,
                        validado_por TEXT DEFAULT '',
                        validado_em TEXT DEFAULT '',
                        estado_submissao TEXT DEFAULT 'pendente',
                        erro_submissao TEXT DEFAULT '',
                        submetido_em TEXT DEFAULT '',
                        updated_at TEXT DEFAULT '',
                        PRIMARY KEY (nif_cliente, id_documento)
                    );

                    CREATE INDEX IF NOT EXISTS idx_pend_docs_ano_nif
                    ON pendentes_documentos(ano, nif_cliente, nif_emitente, data_emissao);

                    CREATE INDEX IF NOT EXISTS idx_pend_docs_estado
                    ON pendentes_documentos(ano, estado_submissao, validado);

                    CREATE TABLE IF NOT EXISTS pendentes_entidades_config (
                        nif_cliente TEXT PRIMARY KEY,
                        modo_tudo_fora INTEGER DEFAULT 0,
                        ultima_recolha TEXT DEFAULT '',
                        updated_at TEXT DEFAULT ''
                    );

                    CREATE TABLE IF NOT EXISTS pendentes_historico_fornecedor (
                        nif_cliente TEXT NOT NULL,
                        ano INTEGER NOT NULL,
                        nif_emitente TEXT NOT NULL,
                        setor_codigo TEXT NOT NULL,
                        ambito_codigo TEXT NOT NULL,
                        qtd INTEGER DEFAULT 0,
                        PRIMARY KEY (nif_cliente, ano, nif_emitente, setor_codigo, ambito_codigo)
                    );

                    CREATE INDEX IF NOT EXISTS idx_pend_hist_lookup
                    ON pendentes_historico_fornecedor(nif_cliente, ano, nif_emitente);

                    CREATE TABLE IF NOT EXISTS pendentes_palavras_chave (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        palavra TEXT NOT NULL UNIQUE,
                        setor_codigo TEXT NOT NULL,
                        ambito_codigo TEXT DEFAULT '',
                        ativo INTEGER DEFAULT 1
                    );

                    CREATE TABLE IF NOT EXISTS pendentes_termos_responsabilidade (
                        id TEXT PRIMARY KEY,
                        timestamp_iso TEXT NOT NULL,
                        utilizador TEXT NOT NULL,
                        email_utilizador TEXT DEFAULT '',
                        ip_origem TEXT DEFAULT '',
                        texto_termo TEXT NOT NULL,
                        nifs_json TEXT NOT NULL,
                        total_documentos INTEGER NOT NULL,
                        resumo_sha256 TEXT NOT NULL
                    );
                """)

                seed_row = conn.execute(
                    "SELECT valor FROM pendentes_meta WHERE chave = 'seed_palavras_chave_v1'"
                ).fetchone()
                if not seed_row:
                    count_kw = conn.execute("SELECT COUNT(*) FROM pendentes_palavras_chave").fetchone()[0]
                    if count_kw == 0:
                        conn.executemany(
                            "INSERT OR IGNORE INTO pendentes_palavras_chave (palavra, setor_codigo, ambito_codigo, ativo) VALUES (?, ?, ?, 1)",
                            PALAVRAS_CHAVE_INICIAIS,
                        )
                    conn.execute(
                        "INSERT OR REPLACE INTO pendentes_meta (chave, valor) VALUES ('seed_palavras_chave_v1', ?)",
                        (_now_iso(),),
                    )
                conn.commit()
            _INIT_PATHS_DONE.add(resolved)
        return resolved

    return _executar_com_retry(_init)


# =============================================================================
# 3. MOTOR DE PRÉ-CLASSIFICAÇÃO DETERMINÍSTICO (PURO & TESTÁVEL)
# =============================================================================

def _analisar_distribuicao(contagens: Dict[str, int], mapa_nomes: Dict[str, str], ano_label: int) -> Tuple[str, int, str]:
    """
    Analisa distribuição de frequências {codigo: qtd}.
    Devolve (codigo_sugerido, flag_dividido, texto_detalhe).
    """
    limpos = {str(k).strip(): int(v) for k, v in (contagens or {}).items() if str(k).strip() and int(v) > 0}
    total = sum(limpos.values())
    if total <= 0:
        return "", 0, ""

    ordenados = sorted(limpos.items(), key=lambda kv: (-kv[1], kv[0]))
    top_cod, top_qtd = ordenados[0]
    dividido = 1 if len(ordenados) > 1 else 0
    sugerido = top_cod if (top_qtd / total) >= 0.5 else ""

    if dividido or sugerido:
        partes = [f"{mapa_nomes.get(cod, cod)} ({qtd})" for cod, qtd in ordenados[:4]]
        detalhe = f"{ano_label}: " + " · ".join(partes)
    else:
        detalhe = ""
    return sugerido, dividido, detalhe


def calcular_preclassificacao_documento(
    doc: Dict[str, Any],
    modo_tudo_fora: bool = False,
    hist_ano_atual: Optional[Dict[str, Dict[str, Any]]] = None,
    hist_ano_ant: Optional[Dict[str, Dict[str, Any]]] = None,
    palavras_chave: Optional[List[Dict[str, Any]]] = None,
    ano_atual: Optional[int] = None,
    ano_anterior: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Calcula a pré-classificação sugerida de um documento pendente.
    Garante sempre `validado = 0` para obrigar revisão humana antes de submeter.
    """
    setor_at = normalizar_codigo_setor(doc.get("setor_at_original") or doc.get("actividade_emitente") or "")
    ambito_at = normalizar_codigo_ambito(doc.get("ambito_at_original") or doc.get("actividade_prof") or "")
    nif_em = limpar_nif(doc.get("nif_emitente") or "")
    nome_em_norm = _normalizar_texto(doc.get("nome_emitente") or "")

    ano_ref = int(ano_atual or doc.get("ano") or datetime.now().year)
    ano_prev = int(ano_anterior or (ano_ref - 1))

    if modo_tudo_fora:
        setor_final = setor_at if setor_at in CODIGOS_SETOR_VALIDOS else "C99"
        return {
            "setor_codigo": setor_final,
            "ambito_codigo": "1",
            "origem_sugestao": "tudo_fora",
            "historico_dividido_setor": 0,
            "historico_dividido_ambito": 0,
            "detalhe_historico": "Modo Tudo Fora ativo",
            "validado": 0,
        }

    nomes_setor_curto = {s["codigo"]: s["nome_curto"] for s in SETORES_EFATURA}
    nomes_ambito_curto = {a["codigo"]: a["nome_curto"] for a in AMBITOS_ATIVIDADE}

    h_atual = (hist_ano_atual or {}).get(nif_em) or {}
    h_ant = (hist_ano_ant or {}).get(nif_em) or {}

    kw_match: Optional[Dict[str, Any]] = None
    if palavras_chave and nome_em_norm:
        for kw in palavras_chave:
            if not kw.get("ativo", 1):
                continue
            termo = _normalizar_texto(kw.get("palavra") or "")
            if termo and termo in nome_em_norm:
                kw_match = kw
                break

    # 1. Resolução do Setor
    setor_codigo = ""
    origem_setor = ""
    div_setor = 0
    detalhes: List[str] = []

    if setor_at in CODIGOS_SETOR_VALIDOS:
        setor_codigo = setor_at
        origem_setor = "at_origem"
    else:
        s_atual, div_a, det_a = _analisar_distribuicao(h_atual.get("setores") or {}, nomes_setor_curto, ano_ref)
        if s_atual or div_a:
            setor_codigo = s_atual
            div_setor = div_a
            if s_atual:
                origem_setor = "historico_ano_atual"
            if det_a:
                detalhes.append(f"Setor {det_a}")
        if not setor_codigo:
            s_ant, div_p, det_p = _analisar_distribuicao(h_ant.get("setores") or {}, nomes_setor_curto, ano_prev)
            if s_ant or div_p:
                setor_codigo = s_ant
                div_setor = max(div_setor, div_p)
                if s_ant:
                    origem_setor = "historico_ano_anterior"
                if det_p:
                    detalhes.append(f"Setor {det_p}")
        if not setor_codigo and kw_match:
            kw_s = normalizar_codigo_setor(kw_match.get("setor_codigo") or "")
            if kw_s:
                setor_codigo = kw_s
                origem_setor = "palavra_chave"

    # 2. Resolução do Âmbito (0=Sim Total, 2=Sim Parcial, 1=Não)
    ambito_codigo = ""
    origem_ambito = ""
    div_ambito = 0

    if ambito_at in CODIGOS_AMBITO_VALIDOS:
        ambito_codigo = ambito_at
        origem_ambito = "at_origem"
    elif setor_codigo in SETORES_AUTO_FORA:
        ambito_codigo = "1"
        origem_ambito = "regra_setor_pessoal"
    else:
        amb_atual, div_aa, det_aa = _analisar_distribuicao(h_atual.get("ambitos") or {}, nomes_ambito_curto, ano_ref)
        if amb_atual or div_aa:
            ambito_codigo = amb_atual
            div_ambito = div_aa
            if amb_atual:
                origem_ambito = "historico_ano_atual"
            if det_aa:
                detalhes.append(f"Âmbito {det_aa}")
        if not ambito_codigo:
            amb_ant, div_ap, det_ap = _analisar_distribuicao(h_ant.get("ambitos") or {}, nomes_ambito_curto, ano_prev)
            if amb_ant or div_ap:
                ambito_codigo = amb_ant
                div_ambito = max(div_ambito, div_ap)
                if amb_ant:
                    origem_ambito = "historico_ano_anterior"
                if det_ap:
                    detalhes.append(f"Âmbito {det_ap}")
        if not ambito_codigo and kw_match:
            kw_a = normalizar_codigo_ambito(kw_match.get("ambito_codigo") or "")
            if kw_a:
                ambito_codigo = kw_a
                origem_ambito = "palavra_chave"

    # Origem principal exibida no UI (prioridade para o critério inteligente que resolveu a pendência)
    origem_final = ""
    for cand in (origem_ambito, origem_setor):
        if cand in ("historico_ano_atual", "historico_ano_anterior", "palavra_chave"):
            origem_final = cand
            break
    if not origem_final:
        origem_final = origem_ambito or origem_setor or ""
    if origem_final == "regra_setor_pessoal" and origem_setor in ("historico_ano_atual", "historico_ano_anterior", "palavra_chave"):
        origem_final = origem_setor

    return {
        "setor_codigo": setor_codigo,
        "ambito_codigo": ambito_codigo,
        "origem_sugestao": origem_final,
        "historico_dividido_setor": int(div_setor),
        "historico_dividido_ambito": int(div_ambito),
        "detalhe_historico": " | ".join(detalhes),
        "validado": 0,
    }


# =============================================================================
# 4. CATÁLOGO, PALAVRAS-CHAVE, ENTIDADES E CONFIGURAÇÃO
# =============================================================================

def listar_palavras_chave(apenas_ativas: bool = False, db_path: Optional[str] = None) -> List[Dict[str, Any]]:
    init_pendentes_db(db_path)
    with _conectar_db(db_path) as conn:
        sql = "SELECT id, palavra, setor_codigo, ambito_codigo, ativo FROM pendentes_palavras_chave"
        if apenas_ativas:
            sql += " WHERE ativo = 1"
        sql += " ORDER BY setor_codigo ASC, palavra ASC"
        rows = conn.execute(sql).fetchall()
    return [dict(r) for r in rows]


def guardar_palavra_chave(palavra: str, setor_codigo: str, ambito_codigo: str = "", db_path: Optional[str] = None) -> Dict[str, Any]:
    init_pendentes_db(db_path)
    p_norm = _normalizar_texto(palavra)
    if not p_norm:
        raise ValueError("Palavra-chave inválida.")
    s_cod = normalizar_codigo_setor(setor_codigo)
    if s_cod not in CODIGOS_SETOR_VALIDOS:
        raise ValueError("Código de setor inválido.")
    a_cod = normalizar_codigo_ambito(ambito_codigo) if ambito_codigo else ("1" if s_cod in SETORES_AUTO_FORA else "")

    def _op():
        with _DB_LOCK:
            with _conectar_db(db_path) as conn:
                conn.execute(
                    """
                    INSERT INTO pendentes_palavras_chave (palavra, setor_codigo, ambito_codigo, ativo)
                    VALUES (?, ?, ?, 1)
                    ON CONFLICT(palavra) DO UPDATE SET
                        setor_codigo = excluded.setor_codigo,
                        ambito_codigo = excluded.ambito_codigo,
                        ativo = 1
                    """,
                    (p_norm, s_cod, a_cod),
                )
                row = conn.execute(
                    "SELECT id, palavra, setor_codigo, ambito_codigo, ativo FROM pendentes_palavras_chave WHERE palavra = ?",
                    (p_norm,),
                ).fetchone()
                conn.commit()
                return dict(row)

    return _executar_com_retry(_op)


def eliminar_palavra_chave(kw_id: int, db_path: Optional[str] = None) -> bool:
    init_pendentes_db(db_path)

    def _op():
        with _DB_LOCK:
            with _conectar_db(db_path) as conn:
                cur = conn.execute("DELETE FROM pendentes_palavras_chave WHERE id = ?", (int(kw_id),))
                conn.commit()
                return cur.rowcount > 0

    return _executar_com_retry(_op)


def obter_catalogo(db_path: Optional[str] = None) -> Dict[str, Any]:
    return {
        "setores": SETORES_EFATURA,
        "ambitos": AMBITOS_ATIVIDADE,
        "palavras_chave": listar_palavras_chave(apenas_ativas=False, db_path=db_path),
    }


def listar_entidades_pendentes(ano: int, db_path: Optional[str] = None) -> List[Dict[str, Any]]:
    """Lista apenas entidades singulares (NIF 1xx, 2xx, 3xx, 45x) enriquecidas com estado de pendentes."""
    init_pendentes_db(db_path)
    todas = pb_client.get_lista_entidades_ui()
    singulares = [e for e in todas if is_nif_singular(e.get("nif") or "")]

    with _conectar_db(db_path) as conn:
        cfg_rows = conn.execute(
            "SELECT nif_cliente, modo_tudo_fora, ultima_recolha FROM pendentes_entidades_config"
        ).fetchall()
        cfg_map = {r["nif_cliente"]: dict(r) for r in cfg_rows}

        stats_rows = conn.execute(
            """
            SELECT
                nif_cliente,
                SUM(CASE WHEN estado_submissao != 'submetido' THEN 1 ELSE 0 END) AS total_pendentes,
                SUM(CASE WHEN estado_submissao != 'submetido' AND (COALESCE(setor_codigo, '') = '' OR COALESCE(ambito_codigo, '') = '') THEN 1 ELSE 0 END) AS total_por_preencher,
                SUM(CASE WHEN estado_submissao != 'submetido' AND (historico_dividido_setor = 1 OR historico_dividido_ambito = 1) THEN 1 ELSE 0 END) AS total_duvidosos,
                SUM(CASE WHEN estado_submissao != 'submetido' AND validado = 1 THEN 1 ELSE 0 END) AS total_validados,
                SUM(CASE WHEN estado_submissao = 'submetido' THEN 1 ELSE 0 END) AS total_submetidos
            FROM pendentes_documentos
            WHERE ano = ?
            GROUP BY nif_cliente
            """,
            (int(ano),),
        ).fetchall()
        stats_map = {r["nif_cliente"]: dict(r) for r in stats_rows}

    resultado: List[Dict[str, Any]] = []
    for ent in singulares:
        nif = limpar_nif(ent.get("nif") or "")
        cfg = cfg_map.get(nif, {})
        st = stats_map.get(nif, {})
        resultado.append({
            "id": ent.get("id") or nif,
            "cod": ent.get("cod") or "",
            "nif": nif,
            "nomecli": ent.get("nomecli") or f"Contribuinte {nif}",
            "tem_credenciais_at": bool(ent.get("tem_credenciais_at")),
            "modo_tudo_fora": bool(cfg.get("modo_tudo_fora", 0)),
            "ultima_recolha": cfg.get("ultima_recolha") or "",
            "total_pendentes": int(st.get("total_pendentes") or 0),
            "total_por_preencher": int(st.get("total_por_preencher") or 0),
            "total_duvidosos": int(st.get("total_duvidosos") or 0),
            "total_validados": int(st.get("total_validados") or 0),
            "total_submetidos": int(st.get("total_submetidos") or 0),
        })
    return resultado


def definir_modo_tudo_fora(
    nifs: List[str],
    ativo: bool,
    ano: int,
    aplicar_existentes: bool = True,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    init_pendentes_db(db_path)
    nifs_limpos = [limpar_nif(n) for n in (nifs or []) if is_nif_singular(n)]
    if not nifs_limpos:
        return {"atualizadas": 0, "documentos_atualizados": 0}

    now_iso = _now_iso()
    flag = 1 if ativo else 0

    def _op():
        docs_afetados = 0
        with _DB_LOCK:
            with _conectar_db(db_path) as conn:
                for nif in nifs_limpos:
                    conn.execute(
                        """
                        INSERT INTO pendentes_entidades_config (nif_cliente, modo_tudo_fora, ultima_recolha, updated_at)
                        VALUES (?, ?, '', ?)
                        ON CONFLICT(nif_cliente) DO UPDATE SET
                            modo_tudo_fora = excluded.modo_tudo_fora,
                            updated_at = excluded.updated_at
                        """,
                        (nif, flag, now_iso),
                    )
                    if ativo and aplicar_existentes:
                        cur = conn.execute(
                            """
                            UPDATE pendentes_documentos
                            SET
                                setor_codigo = CASE WHEN COALESCE(setor_at_original, '') != '' THEN setor_at_original ELSE COALESCE(NULLIF(setor_codigo, ''), 'C99') END,
                                ambito_codigo = '1',
                                origem_sugestao = 'tudo_fora',
                                historico_dividido_setor = 0,
                                historico_dividido_ambito = 0,
                                detalhe_historico = 'Modo Tudo Fora ativo',
                                validado = 0,
                                updated_at = ?
                            WHERE nif_cliente = ? AND ano = ? AND estado_submissao != 'submetido'
                            """,
                            (now_iso, nif, int(ano)),
                        )
                        docs_afetados += cur.rowcount
                conn.commit()
        return {"atualizadas": len(nifs_limpos), "documentos_atualizados": docs_afetados}

    return _executar_com_retry(_op)


# =============================================================================
# 5. PERSISTÊNCIA DO HISTÓRICO E SINCRONIZAÇÃO DE PENDENTES
# =============================================================================

def _gravar_historico_fornecedor(
    nif_cliente: str,
    ano: int,
    documentos: Iterable[Any],
    db_path: Optional[str] = None,
) -> int:
    """Agrega documentos já classificados por (nif_emitente, setor, ambito) na tabela de cache histórico."""
    init_pendentes_db(db_path)
    contagens: Counter[Tuple[str, str, str]] = Counter()
    for doc in documentos:
        if isinstance(doc, dict):
            sit = str(doc.get("situacao_documento") or "").upper()
            est_b = str(doc.get("estado_beneficio") or "").upper()
            nif_em = limpar_nif(doc.get("nif_emitente") or "")
            setor_cod = normalizar_codigo_setor(doc.get("actividade_emitente") or doc.get("setor_at_original") or "")
            amb_cod = normalizar_codigo_ambito(doc.get("actividade_prof") or doc.get("ambito_at_original") or "")
        else:
            sit = str(getattr(doc, "situacao_documento", "") or "").upper()
            est_b = str(getattr(doc, "estado_beneficio", "") or "").upper()
            nif_em = limpar_nif(getattr(doc, "nif_emitente", "") or "")
            setor_cod = normalizar_codigo_setor(getattr(doc, "actividade_emitente", "") or "")
            amb_cod = normalizar_codigo_ambito(getattr(doc, "actividade_prof", "") or "")

        if sit == "ANULADA" or est_b in ("A", "C", "O", "P"):
            continue
        if not nif_em:
            continue
        if not setor_cod and not amb_cod:
            continue
        contagens[(nif_em, setor_cod, amb_cod)] += 1

    def _op():
        with _DB_LOCK:
            with _conectar_db(db_path) as conn:
                conn.execute(
                    "DELETE FROM pendentes_historico_fornecedor WHERE nif_cliente = ? AND ano = ?",
                    (nif_cliente, int(ano)),
                )
                if contagens:
                    conn.executemany(
                        """
                        INSERT INTO pendentes_historico_fornecedor
                        (nif_cliente, ano, nif_emitente, setor_codigo, ambito_codigo, qtd)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        [(nif_cliente, int(ano), k[0], k[1], k[2], int(qtd)) for k, qtd in contagens.items()],
                    )
                conn.commit()
        return len(contagens)

    return _executar_com_retry(_op)


def _carregar_mapa_historico(nif_cliente: str, ano: int, db_path: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
    init_pendentes_db(db_path)
    mapa: Dict[str, Dict[str, Any]] = {}
    with _conectar_db(db_path) as conn:
        rows = conn.execute(
            """
            SELECT nif_emitente, setor_codigo, ambito_codigo, qtd
            FROM pendentes_historico_fornecedor
            WHERE nif_cliente = ? AND ano = ?
            """,
            (nif_cliente, int(ano)),
        ).fetchall()
    for r in rows:
        em = r["nif_emitente"]
        entry = mapa.setdefault(em, {"setores": defaultdict(int), "ambitos": defaultdict(int), "ano": int(ano)})
        if r["setor_codigo"]:
            entry["setores"][r["setor_codigo"]] += int(r["qtd"] or 0)
        if r["ambito_codigo"]:
            entry["ambitos"][r["ambito_codigo"]] += int(r["qtd"] or 0)
    return mapa


def _is_documento_pendente(doc: Any) -> bool:
    if isinstance(doc, dict):
        sit = str(doc.get("situacao_documento") or "").upper()
        est_b = str(doc.get("estado_beneficio") or "").upper()
        tipo_desc = doc.get("tipo_documento_desc") or ""
        setor = normalizar_codigo_setor(doc.get("actividade_emitente") or "")
        amb = normalizar_codigo_ambito(doc.get("actividade_prof") or "")
    else:
        sit = str(getattr(doc, "situacao_documento", "") or "").upper()
        est_b = str(getattr(doc, "estado_beneficio", "") or "").upper()
        tipo_desc = getattr(doc, "tipo_documento_desc", "") or ""
        setor = normalizar_codigo_setor(getattr(doc, "actividade_emitente", "") or "")
        amb = normalizar_codigo_ambito(getattr(doc, "actividade_prof", "") or "")

    if sit == "ANULADA" or est_b in ("A", "C", "O"):
        return False
    if is_doc_nao_admitido(tipo_desc):
        return False
    if est_b == "P":
        return True
    if est_b not in ("R", "B", "E", "N") and (not setor or not amb):
        return True
    return False


def guardar_documentos_pendentes_entidade(
    nif_cliente: str,
    nome_cliente: str,
    ano: int,
    documentos_todos_ano: List[Any],
    db_path: Optional[str] = None,
) -> Dict[str, int]:
    """
    Atualiza histórico do ano corrente, calcula pré-classificação de cada documento pendente,
    preserva edições/validações manuais já existentes e remove pendentes resolvidos fora da app.
    """
    init_pendentes_db(db_path)
    nif_clean = limpar_nif(nif_cliente)
    now_iso = _now_iso()

    # 1. Atualizar histórico do próprio ano com documentos já classificados
    _gravar_historico_fornecedor(nif_clean, ano, documentos_todos_ano, db_path=db_path)

    # 2. Carregar config, históricos e palavras-chave
    with _conectar_db(db_path) as conn:
        cfg_row = conn.execute(
            "SELECT modo_tudo_fora FROM pendentes_entidades_config WHERE nif_cliente = ?",
            (nif_clean,),
        ).fetchone()
        modo_tudo_fora = bool(cfg_row["modo_tudo_fora"]) if cfg_row else False

        existentes_rows = conn.execute(
            """
            SELECT id_documento, setor_codigo, ambito_codigo, origem_sugestao, validado, validado_por, validado_em, estado_submissao
            FROM pendentes_documentos
            WHERE nif_cliente = ? AND ano = ?
            """,
            (nif_clean, int(ano)),
        ).fetchall()
        existentes = {r["id_documento"]: dict(r) for r in existentes_rows}

    hist_atual = _carregar_mapa_historico(nif_clean, ano, db_path=db_path)
    hist_ant = _carregar_mapa_historico(nif_clean, ano - 1, db_path=db_path)
    palavras_chave = listar_palavras_chave(apenas_ativas=True, db_path=db_path)

    pendentes = [d for d in documentos_todos_ano if _is_documento_pendente(d)]
    ids_pendentes_at: set[str] = set()
    registos_upsert: List[Tuple[Any, ...]] = []
    preclassificados = 0

    for doc in pendentes:
        if isinstance(doc, dict):
            id_doc = str(doc.get("id_documento") or "").strip()
            id_fat = str(doc.get("id_fatura_unico") or "")
            dt_em = str(doc.get("data_emissao") or "")[:10]
            nif_em = limpar_nif(doc.get("nif_emitente") or "")
            nome_em = str(doc.get("nome_emitente") or "").strip()
            t_doc = str(doc.get("tipo_documento") or "").strip()
            t_desc = str(doc.get("tipo_documento_desc") or "").strip()
            num_doc = str(doc.get("numero_documento") or "").strip()
            atcud = str(doc.get("atcud") or "").strip()
            v_tot = float(doc.get("valor_total") or 0.0)
            v_base = float(doc.get("base_tributavel") or 0.0)
            v_iva = float(doc.get("valor_iva") or 0.0)
            setor_orig = normalizar_codigo_setor(doc.get("actividade_emitente") or "")
            amb_orig = normalizar_codigo_ambito(doc.get("actividade_prof") or "")
            est_at = str(doc.get("estado_beneficio") or "P").strip()
        else:
            id_doc = str(getattr(doc, "id_documento", "") or "").strip()
            id_fat = str(getattr(doc, "id_fatura_unico", "") or "")
            dt_em = str(getattr(doc, "data_emissao", "") or "")[:10]
            nif_em = limpar_nif(getattr(doc, "nif_emitente", "") or "")
            nome_em = str(getattr(doc, "nome_emitente", "") or "").strip()
            t_doc = str(getattr(doc, "tipo_documento", "") or "").strip()
            t_desc = str(getattr(doc, "tipo_documento_desc", "") or "").strip()
            num_doc = str(getattr(doc, "numero_documento", "") or "").strip()
            atcud = str(getattr(doc, "atcud", "") or "").strip()
            v_tot = float(getattr(doc, "valor_total", 0.0) or 0.0)
            v_base = float(getattr(doc, "base_tributavel", 0.0) or 0.0)
            v_iva = float(getattr(doc, "valor_iva", 0.0) or 0.0)
            setor_orig = normalizar_codigo_setor(getattr(doc, "actividade_emitente", "") or "")
            amb_orig = normalizar_codigo_ambito(getattr(doc, "actividade_prof", "") or "")
            est_at = str(getattr(doc, "estado_beneficio", "P") or "P").strip()

        if not id_doc:
            continue
        ids_pendentes_at.add(id_doc)
        try:
            mes_num = int(dt_em[5:7]) if len(dt_em) >= 7 else 1
        except Exception:
            mes_num = 1

        prev = existentes.get(id_doc)
        preservar_manual = bool(prev and (prev["validado"] == 1 or prev["origem_sugestao"] == "manual"))

        sug = calcular_preclassificacao_documento(
            {
                "setor_at_original": setor_orig,
                "ambito_at_original": amb_orig,
                "nif_emitente": nif_em,
                "nome_emitente": nome_em,
                "ano": ano,
            },
            modo_tudo_fora=modo_tudo_fora,
            hist_ano_atual=hist_atual,
            hist_ano_ant=hist_ant,
            palavras_chave=palavras_chave,
            ano_atual=ano,
            ano_anterior=ano - 1,
        )

        if preservar_manual and prev:
            setor_cod = prev["setor_codigo"] or sug["setor_codigo"]
            amb_cod = prev["ambito_codigo"] or sug["ambito_codigo"]
            origem = prev["origem_sugestao"] or sug["origem_sugestao"]
            val_flag = int(prev["validado"] or 0)
            val_por = prev["validado_por"] or ""
            val_em = prev["validado_em"] or ""
            div_s = 0 if prev["origem_sugestao"] == "manual" else sug["historico_dividido_setor"]
            div_a = 0 if prev["origem_sugestao"] == "manual" else sug["historico_dividido_ambito"]
        else:
            setor_cod = sug["setor_codigo"]
            amb_cod = sug["ambito_codigo"]
            origem = sug["origem_sugestao"]
            val_flag = 0
            val_por = ""
            val_em = ""
            div_s = sug["historico_dividido_setor"]
            div_a = sug["historico_dividido_ambito"]

        if setor_cod and amb_cod:
            preclassificados += 1

        registos_upsert.append((
            nif_clean, id_doc, id_fat, nome_cliente, int(ano), mes_num, dt_em,
            nif_em, nome_em, t_doc, t_desc, num_doc, atcud,
            round(v_tot, 2), round(v_base, 2), round(v_iva, 2),
            setor_orig, amb_orig, est_at,
            setor_cod, amb_cod, origem,
            div_s, div_a, sug["detalhe_historico"],
            val_flag, val_por, val_em,
            "pendente", "", "", now_iso,
        ))

    def _persist():
        with _DB_LOCK:
            with _conectar_db(db_path) as conn:
                # Limpar registos locais ainda marcados como 'pendente' que já foram resolvidos na AT
                for ex_id, ex_info in existentes.items():
                    if ex_info["estado_submissao"] != "submetido" and ex_id not in ids_pendentes_at:
                        conn.execute(
                            "DELETE FROM pendentes_documentos WHERE nif_cliente = ? AND id_documento = ? AND ano = ?",
                            (nif_clean, ex_id, int(ano)),
                        )

                if registos_upsert:
                    conn.executemany(
                        """
                        INSERT INTO pendentes_documentos (
                            nif_cliente, id_documento, id_fatura_unico, nome_cliente, ano, mes, data_emissao,
                            nif_emitente, nome_emitente, tipo_doc, tipo_doc_desc, numero_documento, atcud,
                            valor_total, valor_base, valor_iva,
                            setor_at_original, ambito_at_original, estado_at,
                            setor_codigo, ambito_codigo, origem_sugestao,
                            historico_dividido_setor, historico_dividido_ambito, detalhe_historico,
                            validado, validado_por, validado_em,
                            estado_submissao, erro_submissao, submetido_em, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(nif_cliente, id_documento) DO UPDATE SET
                            id_fatura_unico = excluded.id_fatura_unico,
                            nome_cliente = excluded.nome_cliente,
                            ano = excluded.ano,
                            mes = excluded.mes,
                            data_emissao = excluded.data_emissao,
                            nif_emitente = excluded.nif_emitente,
                            nome_emitente = excluded.nome_emitente,
                            tipo_doc = excluded.tipo_doc,
                            tipo_doc_desc = excluded.tipo_doc_desc,
                            numero_documento = excluded.numero_documento,
                            atcud = excluded.atcud,
                            valor_total = excluded.valor_total,
                            valor_base = excluded.valor_base,
                            valor_iva = excluded.valor_iva,
                            setor_at_original = excluded.setor_at_original,
                            ambito_at_original = excluded.ambito_at_original,
                            estado_at = excluded.estado_at,
                            setor_codigo = excluded.setor_codigo,
                            ambito_codigo = excluded.ambito_codigo,
                            origem_sugestao = excluded.origem_sugestao,
                            historico_dividido_setor = excluded.historico_dividido_setor,
                            historico_dividido_ambito = excluded.historico_dividido_ambito,
                            detalhe_historico = excluded.detalhe_historico,
                            validado = excluded.validado,
                            validado_por = excluded.validado_por,
                            validado_em = excluded.validado_em,
                            estado_submissao = 'pendente',
                            erro_submissao = '',
                            updated_at = excluded.updated_at
                        """,
                        registos_upsert,
                    )

                conn.execute(
                    """
                    INSERT INTO pendentes_entidades_config (nif_cliente, modo_tudo_fora, ultima_recolha, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(nif_cliente) DO UPDATE SET
                        ultima_recolha = excluded.ultima_recolha,
                        updated_at = excluded.updated_at
                    """,
                    (nif_clean, 1 if modo_tudo_fora else 0, now_iso, now_iso),
                )
                conn.commit()
        return {"total_pendentes": len(registos_upsert), "preclassificados": preclassificados}

    return _executar_com_retry(_persist)


# =============================================================================
# 6. CONSULTA UNIFICADA MULTI-CLIENTE, CLASSIFICAÇÃO E VALIDAÇÃO
# =============================================================================

_ORDEM_COLUNAS_SQL = {
    "grupo_cliente_fornecedor": "nome_cliente {dir}, nif_cliente {dir}, nome_emitente {dir}, data_emissao {dir}, id_documento {dir}",
    "nif_cliente": "nif_cliente {dir}, nome_emitente ASC, data_emissao DESC",
    "nome_cliente": "nome_cliente {dir}, nome_emitente ASC, data_emissao DESC",
    "data_emissao": "data_emissao {dir}, nome_cliente ASC, id_documento {dir}",
    "nif_emitente": "nif_emitente {dir}, data_emissao DESC",
    "nome_emitente": "nome_emitente {dir}, data_emissao DESC",
    "numero_documento": "numero_documento {dir}, data_emissao DESC",
    "valor_total": "valor_total {dir}, data_emissao DESC",
    "setor_codigo": "setor_codigo {dir}, nome_emitente ASC",
    "ambito_codigo": "ambito_codigo {dir}, nome_emitente ASC",
    "validado": "validado {dir}, nome_cliente ASC, nome_emitente ASC",
    "estado_submissao": "estado_submissao {dir}, nome_cliente ASC, data_emissao DESC",
}


def consultar_pendentes(
    ano: int,
    nifs: Optional[List[str]] = None,
    filtro_rapido: str = "todos",
    pesquisa: str = "",
    ordenar_por: str = "grupo_cliente_fornecedor",
    ordem: str = "asc",
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    init_pendentes_db(db_path)
    nifs_limpos = [limpar_nif(n) for n in (nifs or []) if limpar_nif(n)]

    where_base = ["ano = ?"]
    params_base: List[Any] = [int(ano)]

    if nifs_limpos:
        placeholders = ",".join("?" for _ in nifs_limpos)
        where_base.append(f"nif_cliente IN ({placeholders})")
        params_base.extend(nifs_limpos)

    if pesquisa and pesquisa.strip():
        q = f"%{pesquisa.strip().lower()}%"
        where_base.append(
            "(LOWER(nif_cliente) LIKE ? OR LOWER(nome_cliente) LIKE ? OR LOWER(nif_emitente) LIKE ? OR LOWER(nome_emitente) LIKE ? OR LOWER(numero_documento) LIKE ?)"
        )
        params_base.extend([q, q, q, q, q])

    where_base_sql = " AND ".join(where_base)

    filtro_map = {
        "todos": "1=1",
        "vazios": "(estado_submissao != 'submetido' AND (COALESCE(setor_codigo, '') = '' OR COALESCE(ambito_codigo, '') = ''))",
        "duvidosos": "(estado_submissao != 'submetido' AND (historico_dividido_setor = 1 OR historico_dividido_ambito = 1))",
        "por_validar": "(estado_submissao != 'submetido' AND COALESCE(setor_codigo, '') != '' AND COALESCE(ambito_codigo, '') != '' AND validado = 0)",
        "validados": "(estado_submissao != 'submetido' AND validado = 1)",
        "submetidos": "(estado_submissao = 'submetido')",
        "erros": "(estado_submissao = 'erro')",
    }
    filtro_sql = filtro_map.get((filtro_rapido or "todos").strip().lower(), "1=1")

    dir_sql = "DESC" if str(ordem or "").strip().lower() == "desc" else "ASC"
    order_tpl = _ORDEM_COLUNAS_SQL.get(ordenar_por, _ORDEM_COLUNAS_SQL["grupo_cliente_fornecedor"])
    order_sql = order_tpl.format(dir=dir_sql)

    with _conectar_db(db_path) as conn:
        all_rows = conn.execute(
            f"""
            SELECT * FROM pendentes_documentos
            WHERE {where_base_sql}
            ORDER BY {order_sql}
            """,
            params_base,
        ).fetchall()

        rows_filtradas = conn.execute(
            f"""
            SELECT * FROM pendentes_documentos
            WHERE {where_base_sql} AND {filtro_sql}
            ORDER BY {order_sql}
            """,
            params_base,
        ).fetchall()

        cfg_rows = conn.execute("SELECT nif_cliente, modo_tudo_fora FROM pendentes_entidades_config").fetchall()
        cfg_map = {r["nif_cliente"]: bool(r["modo_tudo_fora"]) for r in cfg_rows}

    kpis = {
        "total_pendentes": 0,
        "por_preencher": 0,
        "duvidosos": 0,
        "por_validar": 0,
        "validados_por_submeter": 0,
        "submetidos": 0,
        "erros": 0,
        "valor_total_pendente": 0.0,
    }
    resumos_cli_map: Dict[str, Dict[str, Any]] = {}
    contagem_forn_cli: Counter[Tuple[str, str]] = Counter()

    for r in all_rows:
        st_sub = r["estado_submissao"] or "pendente"
        nif_cli = r["nif_cliente"]
        nif_em = r["nif_emitente"] or ""
        preenchido = bool((r["setor_codigo"] or "").strip() and (r["ambito_codigo"] or "").strip())
        div = bool(r["historico_dividido_setor"] or r["historico_dividido_ambito"])
        val = bool(r["validado"])

        cli = resumos_cli_map.setdefault(
            nif_cli,
            {
                "nif_cliente": nif_cli,
                "nome_cliente": r["nome_cliente"] or f"Contribuinte {nif_cli}",
                "modo_tudo_fora": cfg_map.get(nif_cli, False),
                "total": 0,
                "preenchidos": 0,
                "por_preencher": 0,
                "duvidosos": 0,
                "validados": 0,
                "submetidos": 0,
                "valor_total": 0.0,
            },
        )

        if st_sub == "submetido":
            kpis["submetidos"] += 1
            cli["submetidos"] += 1
        else:
            contagem_forn_cli[(nif_cli, nif_em)] += 1
            kpis["total_pendentes"] += 1
            kpis["valor_total_pendente"] += float(r["valor_total"] or 0.0)
            cli["total"] += 1
            cli["valor_total"] += float(r["valor_total"] or 0.0)
            if preenchido:
                cli["preenchidos"] += 1
                if val:
                    kpis["validados_por_submeter"] += 1
                    cli["validados"] += 1
                else:
                    kpis["por_validar"] += 1
            else:
                kpis["por_preencher"] += 1
                cli["por_preencher"] += 1
            if div:
                kpis["duvidosos"] += 1
                cli["duvidosos"] += 1
            if st_sub == "erro":
                kpis["erros"] += 1

    kpis["valor_total_pendente"] = round(kpis["valor_total_pendente"], 2)
    resumos_clientes = sorted(resumos_cli_map.values(), key=lambda c: (c["nome_cliente"] or "").lower())
    for c in resumos_clientes:
        c["valor_total"] = round(c["valor_total"], 2)

    docs_out: List[Dict[str, Any]] = []
    for r in rows_filtradas:
        d = dict(r)
        d["chave_linha"] = f"{d['nif_cliente']}:{d['id_documento']}"
        d["qtd_fornecedor_cliente"] = contagem_forn_cli.get((d["nif_cliente"], d["nif_emitente"] or ""), 1)
        d["validado"] = bool(d["validado"])
        d["historico_dividido_setor"] = bool(d["historico_dividido_setor"])
        d["historico_dividido_ambito"] = bool(d["historico_dividido_ambito"])
        docs_out.append(d)

    return {
        "documentos": docs_out,
        "resumos_clientes": resumos_clientes,
        "kpis": kpis,
    }


def classificar_documentos(
    escopo: str,
    ano: int,
    nif_cliente: str = "",
    id_documento: str = "",
    chaves_selecionadas: Optional[List[str]] = None,
    nif_emitente: str = "",
    setor_codigo: Optional[str] = None,
    ambito_codigo: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Aplica classificação de setor e/ou âmbito segundo o escopo:
    - 'documento': uma linha específica (nif_cliente + id_documento)
    - 'selecionados': lista de chaves '{nif_cliente}:{id_documento}'
    - 'fornecedor_cliente': todas as faturas não submetidas do mesmo fornecedor naquele cliente
    - 'tudo_fora_cliente': todas as faturas não submetidas daquele cliente (Outros/setor original + Não)
    """
    init_pendentes_db(db_path)
    escopo_norm = (escopo or "documento").strip().lower()
    if escopo_norm not in ("documento", "selecionados", "fornecedor_cliente", "tudo_fora_cliente"):
        raise ValueError(f"Escopo inválido: {escopo}")

    setor_norm: Optional[str] = None
    if setor_codigo is not None and str(setor_codigo).strip() != "":
        setor_norm = normalizar_codigo_setor(setor_codigo)
        if setor_norm not in CODIGOS_SETOR_VALIDOS:
            raise ValueError(f"Setor inválido: {setor_codigo}")

    ambito_norm: Optional[str] = None
    if ambito_codigo is not None and str(ambito_codigo).strip() != "":
        ambito_norm = normalizar_codigo_ambito(ambito_codigo)
        if ambito_norm not in CODIGOS_AMBITO_VALIDOS:
            raise ValueError(f"Âmbito inválido: {ambito_codigo}")

    # Regra oficial dos setores pessoais: definir âmbito '1' (Não/Fora) automaticamente se âmbito não foi explicitamente forçado
    if setor_norm in SETORES_AUTO_FORA and ambito_norm is None:
        ambito_norm = "1"

    now_iso = _now_iso()
    nif_cli_clean = limpar_nif(nif_cliente)
    nif_em_clean = limpar_nif(nif_emitente)

    def _op():
        atualizados = 0
        with _DB_LOCK:
            with _conectar_db(db_path) as conn:
                if escopo_norm == "tudo_fora_cliente":
                    if not nif_cli_clean:
                        raise ValueError("NIF do cliente obrigatório para 'tudo_fora_cliente'.")
                    cur = conn.execute(
                        """
                        UPDATE pendentes_documentos
                        SET
                            setor_codigo = CASE WHEN COALESCE(setor_at_original, '') != '' THEN setor_at_original ELSE COALESCE(NULLIF(setor_codigo, ''), 'C99') END,
                            ambito_codigo = '1',
                            origem_sugestao = 'tudo_fora',
                            historico_dividido_setor = 0,
                            historico_dividido_ambito = 0,
                            validado = 0,
                            erro_submissao = '',
                            estado_submissao = 'pendente',
                            updated_at = ?
                        WHERE nif_cliente = ? AND ano = ? AND estado_submissao != 'submetido'
                        """,
                        (now_iso, nif_cli_clean, int(ano)),
                    )
                    atualizados = cur.rowcount
                    conn.commit()
                    return {"atualizados": atualizados}

                sets: List[str] = ["origem_sugestao = 'manual'", "erro_submissao = ''", "estado_submissao = 'pendente'", "updated_at = ?"]
                set_params: List[Any] = [now_iso]
                if setor_norm is not None:
                    sets.append("setor_codigo = ?")
                    sets.append("historico_dividido_setor = 0")
                    set_params.append(setor_norm)
                if ambito_norm is not None:
                    sets.append("ambito_codigo = ?")
                    sets.append("historico_dividido_ambito = 0")
                    set_params.append(ambito_norm)

                if len(sets) == 4:
                    return {"atualizados": 0}

                set_sql = ", ".join(sets)

                if escopo_norm == "documento":
                    if not nif_cli_clean or not str(id_documento).strip():
                        raise ValueError("Identificação do documento obrigatória.")
                    cur = conn.execute(
                        f"UPDATE pendentes_documentos SET {set_sql} WHERE nif_cliente = ? AND id_documento = ? AND ano = ? AND estado_submissao != 'submetido'",
                        set_params + [nif_cli_clean, str(id_documento).strip(), int(ano)],
                    )
                    atualizados = cur.rowcount
                elif escopo_norm == "fornecedor_cliente":
                    if not nif_cli_clean or not nif_em_clean:
                        raise ValueError("NIF do cliente e NIF do fornecedor são obrigatórios.")
                    cur = conn.execute(
                        f"UPDATE pendentes_documentos SET {set_sql} WHERE nif_cliente = ? AND nif_emitente = ? AND ano = ? AND estado_submissao != 'submetido'",
                        set_params + [nif_cli_clean, nif_em_clean, int(ano)],
                    )
                    atualizados = cur.rowcount
                elif escopo_norm == "selecionados":
                    pares: List[Tuple[str, str]] = []
                    for ch in (chaves_selecionadas or []):
                        if ":" in str(ch):
                            c_nif, c_doc = str(ch).split(":", 1)
                            c_nif_c = limpar_nif(c_nif)
                            c_doc_c = c_doc.strip()
                            if c_nif_c and c_doc_c:
                                pares.append((c_nif_c, c_doc_c))
                    for c_nif_c, c_doc_c in pares:
                        cur = conn.execute(
                            f"UPDATE pendentes_documentos SET {set_sql} WHERE nif_cliente = ? AND id_documento = ? AND ano = ? AND estado_submissao != 'submetido'",
                            set_params + [c_nif_c, c_doc_c, int(ano)],
                        )
                        atualizados += cur.rowcount

                conn.commit()
        return {"atualizados": atualizados}

    return _executar_com_retry(_op)


def validar_documentos(
    escopo: str,
    acao: str,
    ano: int,
    nif_cliente: str = "",
    id_documento: str = "",
    chaves_selecionadas: Optional[List[str]] = None,
    nif_emitente: str = "",
    utilizador: str = "",
    db_path: Optional[str] = None,
) -> Dict[str, int]:
    """
    Aprova ou remove aprovação ('validar' / 'desvalidar') de documentos completos.
    Proibido escopo global multi-cliente de validação cega; máximo é 'cliente_preenchidos'.
    """
    init_pendentes_db(db_path)
    escopo_norm = (escopo or "documento").strip().lower()
    if escopo_norm not in ("documento", "selecionados", "fornecedor_cliente", "cliente_preenchidos"):
        raise ValueError(f"Escopo de validação não permitido: {escopo}")

    validar_flag = 1 if (acao or "validar").strip().lower() == "validar" else 0
    now_iso = _now_iso() if validar_flag == 1 else ""
    user_str = str(utilizador or "").strip() if validar_flag == 1 else ""
    nif_cli_clean = limpar_nif(nif_cliente)
    nif_em_clean = limpar_nif(nif_emitente)

    def _op():
        atualizados = 0
        ignorados = 0
        with _DB_LOCK:
            with _conectar_db(db_path) as conn:
                alvos: List[Tuple[str, str]] = []
                if escopo_norm == "documento":
                    if nif_cli_clean and str(id_documento).strip():
                        alvos.append((nif_cli_clean, str(id_documento).strip()))
                elif escopo_norm == "selecionados":
                    for ch in (chaves_selecionadas or []):
                        if ":" in str(ch):
                            c_nif, c_doc = str(ch).split(":", 1)
                            if limpar_nif(c_nif) and c_doc.strip():
                                alvos.append((limpar_nif(c_nif), c_doc.strip()))
                elif escopo_norm == "fornecedor_cliente":
                    if not nif_cli_clean or not nif_em_clean:
                        raise ValueError("NIF do cliente e do fornecedor são obrigatórios.")
                    rows = conn.execute(
                        "SELECT nif_cliente, id_documento FROM pendentes_documentos WHERE nif_cliente = ? AND nif_emitente = ? AND ano = ? AND estado_submissao != 'submetido'",
                        (nif_cli_clean, nif_em_clean, int(ano)),
                    ).fetchall()
                    alvos = [(r["nif_cliente"], r["id_documento"]) for r in rows]
                elif escopo_norm == "cliente_preenchidos":
                    if not nif_cli_clean:
                        raise ValueError("NIF do cliente é obrigatório para validar os preenchidos do cliente.")
                    rows = conn.execute(
                        "SELECT nif_cliente, id_documento FROM pendentes_documentos WHERE nif_cliente = ? AND ano = ? AND estado_submissao != 'submetido'",
                        (nif_cli_clean, int(ano)),
                    ).fetchall()
                    alvos = [(r["nif_cliente"], r["id_documento"]) for r in rows]

                for c_nif, c_doc in alvos:
                    row = conn.execute(
                        "SELECT setor_codigo, ambito_codigo, estado_submissao FROM pendentes_documentos WHERE nif_cliente = ? AND id_documento = ? AND ano = ?",
                        (c_nif, c_doc, int(ano)),
                    ).fetchone()
                    if not row or row["estado_submissao"] == "submetido":
                        continue
                    if validar_flag == 1 and (not (row["setor_codigo"] or "").strip() or not (row["ambito_codigo"] or "").strip()):
                        ignorados += 1
                        continue
                    cur = conn.execute(
                        """
                        UPDATE pendentes_documentos
                        SET validado = ?, validado_por = ?, validado_em = ?, updated_at = ?
                        WHERE nif_cliente = ? AND id_documento = ? AND ano = ? AND estado_submissao != 'submetido'
                        """,
                        (validar_flag, user_str, now_iso, _now_iso(), c_nif, c_doc, int(ano)),
                    )
                    atualizados += cur.rowcount

                conn.commit()
        return {"atualizados": atualizados, "ignorados_incompletos": ignorados}

    return _executar_com_retry(_op)


# =============================================================================
# 7. AUDITORIA DO TERMO DE RESPONSABILIDADE LEGAL
# =============================================================================

def obter_documentos_prontos_submissao(
    ano: int,
    nifs: Optional[List[str]] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    init_pendentes_db(db_path)
    nifs_limpos = [limpar_nif(n) for n in (nifs or []) if limpar_nif(n)]
    sql = """
        SELECT * FROM pendentes_documentos
        WHERE ano = ? AND validado = 1 AND estado_submissao != 'submetido'
          AND COALESCE(setor_codigo, '') != '' AND COALESCE(ambito_codigo, '') != ''
    """
    params: List[Any] = [int(ano)]
    if nifs_limpos:
        placeholders = ",".join("?" for _ in nifs_limpos)
        sql += f" AND nif_cliente IN ({placeholders})"
        params.extend(nifs_limpos)
    sql += " ORDER BY nif_cliente ASC, nif_emitente ASC, data_emissao ASC, id_documento ASC"

    with _conectar_db(db_path) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def registar_termo_responsabilidade(
    ano: int,
    termo_aceite: bool,
    texto_termo: str,
    utilizador: str,
    email_utilizador: str = "",
    ip_origem: str = "",
    nifs: Optional[List[str]] = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Exige aceitação explícita (`termo_aceite=True`), gera assinatura SHA-256 dos documentos
    validados e grava registo auditável imutável em `pendentes_termos_responsabilidade`.
    """
    if not termo_aceite:
        raise ValueError("A aceitação explícita do Termo de Responsabilidade é obrigatória antes de submeter na AT.")
    if not str(texto_termo or "").strip():
        raise ValueError("Texto do Termo de Responsabilidade em falta.")
    if not str(utilizador or "").strip():
        raise ValueError("Identificação do utilizador é obrigatória no Termo de Responsabilidade.")

    init_pendentes_db(db_path)
    docs_prontos = obter_documentos_prontos_submissao(ano=ano, nifs=nifs, db_path=db_path)
    if not docs_prontos:
        raise ValueError("Não existem documentos validados e completos prontos a submeter.")

    nifs_envolvidos = sorted({d["nif_cliente"] for d in docs_prontos})
    assinatura_payload = "|".join(
        f"{d['nif_cliente']}:{d['id_documento']}:{d['setor_codigo']}:{d['ambito_codigo']}"
        for d in docs_prontos
    )
    resumo_sha256 = hashlib.sha256(assinatura_payload.encode("utf-8")).hexdigest()
    termo_id = f"termo_{uuid.uuid4().hex[:16]}"
    ts_iso = _now_iso()

    def _op():
        with _DB_LOCK:
            with _conectar_db(db_path) as conn:
                conn.execute(
                    """
                    INSERT INTO pendentes_termos_responsabilidade (
                        id, timestamp_iso, utilizador, email_utilizador, ip_origem,
                        texto_termo, nifs_json, total_documentos, resumo_sha256
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        termo_id,
                        ts_iso,
                        str(utilizador).strip(),
                        str(email_utilizador or "").strip(),
                        str(ip_origem or "").strip(),
                        str(texto_termo).strip(),
                        json.dumps(nifs_envolvidos, ensure_ascii=False),
                        len(docs_prontos),
                        resumo_sha256,
                    ),
                )
                conn.commit()
        return {
            "termo_id": termo_id,
            "timestamp_iso": ts_iso,
            "utilizador": str(utilizador).strip(),
            "nifs": nifs_envolvidos,
            "total_documentos": len(docs_prontos),
            "resumo_sha256": resumo_sha256,
        }

    return _executar_com_retry(_op)


def listar_termos_responsabilidade(limite: int = 100, db_path: Optional[str] = None) -> List[Dict[str, Any]]:
    init_pendentes_db(db_path)
    with _conectar_db(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, timestamp_iso, utilizador, email_utilizador, ip_origem,
                   texto_termo, nifs_json, total_documentos, resumo_sha256
            FROM pendentes_termos_responsabilidade
            ORDER BY timestamp_iso DESC
            LIMIT ?
            """,
            (max(1, min(int(limite), 500)),),
        ).fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        item = dict(r)
        try:
            item["nifs"] = json.loads(item.get("nifs_json") or "[]")
        except Exception:
            item["nifs"] = []
        out.append(item)
    return out


# =============================================================================
# 8. JOBS EM SEGUNDO PLANO: RECOLHA EM BLOCO E SUBMISSÃO NA AT
# =============================================================================

def _obter_credenciais_entidade(nif_clean: str) -> Tuple[str, str]:
    sub, pwd = pb_client.get_credentials(nif_clean)
    if pwd:
        return (str(sub or nif_clean).strip(), str(pwd))
    try:
        import legado_bridge
        for ent in legado_bridge.carregar_entidades_legadas():
            if limpar_nif(ent.get("nif")) == nif_clean and ent.get("password"):
                return (str(ent.get("subutilizador") or nif_clean).strip(), str(ent["password"]))
    except Exception:
        pass
    return nif_clean, ""


def _historico_anterior_existe(nif_clean: str, ano_ant: int, db_path: Optional[str] = None) -> bool:
    init_pendentes_db(db_path)
    with _conectar_db(db_path) as conn:
        cnt = conn.execute(
            "SELECT COUNT(*) FROM pendentes_historico_fornecedor WHERE nif_cliente = ? AND ano = ?",
            (nif_clean, int(ano_ant)),
        ).fetchone()[0]
    return int(cnt or 0) > 0


def executar_job_recolha_pendentes(
    job_id: str,
    jobs_dict: Dict[str, Any],
    nifs: List[str],
    ano: int,
    forcar_historico_anterior: bool = False,
    iniciar_sessao_fn: Optional[Callable[..., Any]] = None,
    efatura_compras_cls: Optional[Any] = None,
    verificar_bloqueio_fn: Optional[Callable[[str, str, str], Tuple[bool, str]]] = None,
    registar_rejeitada_fn: Optional[Callable[[str, str, str, str], Any]] = None,
    limpar_bloqueio_fn: Optional[Callable[[str, str], Any]] = None,
    browser_semaphore: Optional[threading.Semaphore] = None,
    db_path: Optional[str] = None,
):
    """
    Extrai pendentes e histórico (ano corrente + ano anterior) para um conjunto de entidades singulares.
    """
    init_pendentes_db(db_path)
    job = jobs_dict[job_id]
    nifs_alvo = [limpar_nif(n) for n in (nifs or []) if is_nif_singular(n)]
    total_ents = len(nifs_alvo)

    if total_ents == 0:
        job["status"] = "erro"
        job["erro"] = "Nenhuma entidade singular válida selecionada."
        job["mensagem"] = job["erro"]
        return

    if iniciar_sessao_fn is None or efatura_compras_cls is None:
        try:
            from efatura_scraper import EFaturaCompras as _efc, iniciar_sessao_efatura as _ise
            iniciar_sessao_fn = iniciar_sessao_fn or _ise
            efatura_compras_cls = efatura_compras_cls or _efc
        except Exception as e_imp:
            job["status"] = "erro"
            job["erro"] = f"Motor de navegação AT indisponível: {e_imp}"
            job["mensagem"] = job["erro"]
            return

    if verificar_bloqueio_fn is None:
        try:
            from logins_Gov import (
                limpar_bloqueio_sucesso as _lbs,
                registar_senha_rejeitada as _rsr,
                verificar_bloqueio_senha as _vbs,
            )
            verificar_bloqueio_fn = _vbs
            registar_rejeitada_fn = _rsr
            limpar_bloqueio_fn = _lbs
        except Exception:
            verificar_bloqueio_fn = lambda *_a, **_kw: (False, "")
            registar_rejeitada_fn = lambda *_a, **_kw: None
            limpar_bloqueio_fn = lambda *_a, **_kw: None

    total_pend_global = 0
    total_pre_global = 0
    avisos: List[str] = []

    try:
        for idx, nif_clean in enumerate(nifs_alvo, start=1):
            if job.get("cancelar"):
                job["status"] = "interrompido"
                job["mensagem"] = f"Recolha interrompida ({idx - 1}/{total_ents} clientes)."
                return

            nome_cli = pb_client.get_entidade_nome(nif_clean)
            pct_base = int(((idx - 1) / total_ents) * 100)
            job["nif"] = nif_clean
            job["nome_empresa"] = nome_cli
            job["percentagem"] = max(5, pct_base)
            job["mensagem"] = f"[{idx}/{total_ents}] A iniciar sessão para {nome_cli} ({nif_clean})..."

            login_user, pwd = _obter_credenciais_entidade(nif_clean)
            if not pwd:
                avisos.append(f"{nif_clean} ({nome_cli}): sem senha configurada.")
                continue

            bloq, det_bloq = verificar_bloqueio_fn(nif_clean, "EFATURA", pwd)
            if bloq:
                avisos.append(f"{nif_clean}: senha bloqueada na AT ({det_bloq}).")
                continue

            sessao = None
            sem_acquired = False
            try:
                if browser_semaphore is not None:
                    browser_semaphore.acquire()
                    sem_acquired = True

                sessao = iniciar_sessao_fn(nif=login_user, password=pwd, headless=True, canal="auto")
                if limpar_bloqueio_fn:
                    try:
                        limpar_bloqueio_fn(nif_clean, "EFATURA")
                    except Exception:
                        pass

                extrator = efatura_compras_cls(sessao, visual=False)

                # 1. Histórico do ano anterior (apenas se ainda não existir em cache local ou se forçado)
                if forcar_historico_anterior or not _historico_anterior_existe(nif_clean, ano - 1, db_path=db_path):
                    job["mensagem"] = f"[{idx}/{total_ents}] {nome_cli}: a recolher histórico de {ano - 1}..."
                    docs_ant = extrator.consultar_intervalo(f"{ano - 1}-01-01", f"{ano - 1}-12-31")
                    _gravar_historico_fornecedor(nif_clean, ano - 1, docs_ant, db_path=db_path)

                if job.get("cancelar"):
                    job["status"] = "interrompido"
                    job["mensagem"] = f"Recolha interrompida durante {nome_cli}."
                    return

                # 2. Documentos do ano selecionado (pendentes + classificados de ano)
                job["mensagem"] = f"[{idx}/{total_ents}] {nome_cli}: a recolher compras e pendentes de {ano}..."
                docs_ano = extrator.consultar_intervalo(f"{ano}-01-01", f"{ano}-12-31")
                res_ent = guardar_documentos_pendentes_entidade(
                    nif_cliente=nif_clean,
                    nome_cliente=nome_cli,
                    ano=ano,
                    documentos_todos_ano=docs_ano,
                    db_path=db_path,
                )
                total_pend_global += res_ent["total_pendentes"]
                total_pre_global += res_ent["preclassificados"]
                job["docs_atuais"] = total_pend_global
                job["percentagem"] = min(99, int((idx / total_ents) * 100))

            except Exception as exc_ent:
                err_txt = str(exc_ent)
                LOGGER.warning(f"[PENDENTES RECOLHA] Erro em {nif_clean}: {err_txt}")
                avisos.append(f"{nif_clean} ({nome_cli}): {err_txt}")
                low = err_txt.lower()
                if any(t in low for t in ("credenciais inválidas", "credenciais invalidas", "palavra-passe incorreta", "dados de acesso")):
                    if registar_rejeitada_fn:
                        try:
                            registar_rejeitada_fn(nif_clean, "EFATURA", pwd, err_txt)
                        except Exception:
                            pass
            finally:
                if sessao is not None:
                    try:
                        sessao.close()
                    except Exception:
                        pass
                if sem_acquired and browser_semaphore is not None:
                    browser_semaphore.release()

        msg_fim = f"Recolha concluída ({total_ents} cliente(s)): {total_pend_global} pendente(s), {total_pre_global} pré-classificado(s)."
        if avisos:
            msg_fim += f" Avisos: {' | '.join(avisos[:3])}"
        job["percentagem"] = 100
        job["docs_atuais"] = total_pend_global
        job["total_esperado"] = total_pend_global
        job["total_documentos"] = total_pend_global
        job["status"] = "concluido"
        job["mensagem"] = msg_fim
        job["avisos"] = avisos

    except Exception as exc_fatal:
        LOGGER.exception(f"Erro fatal na recolha de pendentes: {exc_fatal}")
        job["status"] = "erro"
        job["erro"] = str(exc_fatal)
        job["mensagem"] = str(exc_fatal)


def _atualizar_setor_compras_v4(nif_cliente: str, atualizacoes: List[Tuple[str, str]]):
    """Propaga setor confirmado para `compras_{NIF}.db` se existir localmente."""
    if not atualizacoes:
        return
    try:
        db_compras = pb_client.obter_db_cliente_path(nif_cliente, tipo="compras")
        if not db_compras or not os.path.exists(db_compras):
            return
        with pb_client.db_connect(db_compras, timeout=10) as conn:
            for id_fatura_unico, setor_cod in atualizacoes:
                if not id_fatura_unico or not setor_cod:
                    continue
                setor_desc = SETORES_MAP.get(setor_cod, {}).get("descricao_at") or setor_cod
                conn.execute(
                    "UPDATE efatura_linhas SET setor_atividade = ?, updated = ? WHERE id_fatura_unico = ?",
                    (setor_desc, _now_iso(), id_fatura_unico),
                )
            conn.commit()
    except Exception as e:
        LOGGER.debug(f"Aviso ao sincronizar setor em compras_{nif_cliente}.db: {e}")


def executar_job_submissao_pendentes(
    job_id: str,
    jobs_dict: Dict[str, Any],
    ano: int,
    termo_id: str,
    nifs: Optional[List[str]] = None,
    modo_simulacao: bool = False,
    iniciar_sessao_fn: Optional[Callable[..., Any]] = None,
    browser_semaphore: Optional[threading.Semaphore] = None,
    db_path: Optional[str] = None,
):
    """
    Submete documentos validados na AT com Travão Fiscal estrito:
    - Exige `termo_id` registado em `pendentes_termos_responsabilidade`.
    - Agrupa por cliente, usa envio em lote (`resolverListaPendenciasAdquirente.action`)
      em blocos de 50 documentos, verifica via JSON quais saíram de 'P' e faz
      fallback individual (`detalheDocumentoAdquirente.action`) para os restantes.
    """
    init_pendentes_db(db_path)
    job = jobs_dict[job_id]

    # Travão Fiscal obrigatório
    with _conectar_db(db_path) as conn:
        termo_row = conn.execute(
            "SELECT id, utilizador, timestamp_iso FROM pendentes_termos_responsabilidade WHERE id = ?",
            (str(termo_id or "").strip(),),
        ).fetchone()
    if not termo_row:
        job["status"] = "erro"
        job["erro"] = "Submissão bloqueada pelo Travão Fiscal: Termo de Responsabilidade não registado."
        job["mensagem"] = job["erro"]
        return

    docs = obter_documentos_prontos_submissao(ano=ano, nifs=nifs, db_path=db_path)
    if not docs:
        job["status"] = "concluido"
        job["percentagem"] = 100
        job["mensagem"] = "Sem documentos validados pendentes de submissão."
        return

    por_cliente: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for d in docs:
        por_cliente[d["nif_cliente"]].append(d)

    if modo_simulacao:
        job["status"] = "concluido"
        job["percentagem"] = 100
        job["docs_atuais"] = len(docs)
        job["total_esperado"] = len(docs)
        job["total_documentos"] = len(docs)
        job["mensagem"] = f"Simulação validada ({len(docs)} documento(s) em {len(por_cliente)} cliente(s); nada enviado à AT)."
        return

    if iniciar_sessao_fn is None:
        try:
            from efatura_scraper import iniciar_sessao_efatura as _ise
            iniciar_sessao_fn = _ise
        except Exception as e_imp:
            job["status"] = "erro"
            job["erro"] = f"Motor de navegação AT indisponível: {e_imp}"
            job["mensagem"] = job["erro"]
            return

    total_docs = len(docs)
    submetidos_ok = 0
    erros_docs = 0
    processados = 0

    for idx_cli, (nif_clean, docs_cli) in enumerate(por_cliente.items(), start=1):
        if job.get("cancelar"):
            job["status"] = "interrompido"
            job["mensagem"] = f"Submissão interrompida ({submetidos_ok}/{total_docs} submetidos)."
            return

        nome_cli = docs_cli[0].get("nome_cliente") or pb_client.get_entidade_nome(nif_clean)
        job["nif"] = nif_clean
        job["nome_empresa"] = nome_cli
        job["mensagem"] = f"[{idx_cli}/{len(por_cliente)}] A autenticar {nome_cli} ({len(docs_cli)} doc(s))..."

        login_user, pwd = _obter_credenciais_entidade(nif_clean)
        if not pwd:
            for d in docs_cli:
                _marcar_erro_submissao(nif_clean, d["id_documento"], "Senha AT não configurada.", db_path=db_path)
                erros_docs += 1
                processados += 1
            continue

        sessao = None
        sem_acquired = False
        try:
            if browser_semaphore is not None:
                browser_semaphore.acquire()
                sem_acquired = True

            sessao = iniciar_sessao_fn(nif=login_user, password=pwd, headless=True, canal="auto")
            page = sessao.page

            # 1. Via rápida em lote via resolverListaPendenciasAdquirenteForm.action
            for start_i in range(0, len(docs_cli), 50):
                if job.get("cancelar"):
                    break
                lote = docs_cli[start_i:start_i + 50]
                page.goto(
                    "https://faturas.portaldasfinancas.gov.pt/resolverListaPendenciasAdquirenteForm.action",
                    wait_until="domcontentloaded",
                    timeout=30000,
                )
                page.wait_for_timeout(800)

                tem_amb_prof = page.evaluate("() => document.querySelectorAll('.selecaoActividadeProf').length > 0")
                payload_at = []
                for d in lote:
                    item_at = {
                        "idDocumento": int(d["id_documento"]) if str(d["id_documento"]).isdigit() else d["id_documento"],
                        "ambitoAquisicaoPend": d["setor_codigo"],
                        "ambitoActividadeProfPend": d["ambito_codigo"] if tem_amb_prof else None,
                    }
                    payload_at.append(item_at)

                enviado = page.evaluate("""(payloadJson) => {
                    const form = document.querySelector('#resolverListaPendencias');
                    if (!form) return false;
                    const inp = form.querySelector('input[name="listaPendencias"]');
                    if (!inp) return false;
                    inp.value = payloadJson;
                    form.submit();
                    return true;
                }""", json.dumps(payload_at))

                if enviado:
                    page.wait_for_load_state("domcontentloaded", timeout=30000)
                    page.wait_for_timeout(1200)

            # 2. Verificar quais continuam pendentes na AT
            datas_cli = [d["data_emissao"][:10] for d in docs_cli if d.get("data_emissao")]
            d_ini = min(datas_cli) if datas_cli else f"{ano}-01-01"
            d_fim = max(datas_cli) if datas_cli else f"{ano}-12-31"
            ainda_pendentes_ids = _consultar_ids_ainda_pendentes(page, d_ini, d_fim)

            confirmados_cli: List[Tuple[str, str]] = []
            restantes_cli: List[Dict[str, Any]] = []

            if ainda_pendentes_ids is None:
                # Se a verificação JSON falhou, força validação via detalhe individual para não assumir sucesso cego
                restantes_cli = list(docs_cli)
            else:
                for d in docs_cli:
                    if str(d["id_documento"]) not in ainda_pendentes_ids:
                        _marcar_submetido(nif_clean, d["id_documento"], db_path=db_path)
                        confirmados_cli.append((d.get("id_fatura_unico") or "", d["setor_codigo"]))
                        submetidos_ok += 1
                        processados += 1
                    else:
                        restantes_cli.append(d)

            # 3. Fallback individual para documentos que permaneceram pendentes
            for d in restantes_cli:
                if job.get("cancelar"):
                    break
                ok_ind, err_ind = _submeter_detalhe_individual(page, d)
                if ok_ind:
                    _marcar_submetido(nif_clean, d["id_documento"], db_path=db_path)
                    confirmados_cli.append((d.get("id_fatura_unico") or "", d["setor_codigo"]))
                    submetidos_ok += 1
                else:
                    _marcar_erro_submissao(nif_clean, d["id_documento"], err_ind or "A AT manteve o documento pendente.", db_path=db_path)
                    erros_docs += 1
                processados += 1
                job["docs_atuais"] = submetidos_ok
                job["percentagem"] = min(99, int((processados / max(1, total_docs)) * 100))

            if confirmados_cli:
                _atualizar_setor_compras_v4(nif_clean, confirmados_cli)

            job["docs_atuais"] = submetidos_ok
            job["percentagem"] = min(99, int((processados / max(1, total_docs)) * 100))

        except Exception as exc_cli:
            err_txt = str(exc_cli)
            LOGGER.error(f"[PENDENTES SUBMISSAO] Erro no cliente {nif_clean}: {err_txt}")
            for d in docs_cli:
                _marcar_erro_submissao(nif_clean, d["id_documento"], err_txt, db_path=db_path)
                erros_docs += 1
                processados += 1
        finally:
            if sessao is not None:
                try:
                    sessao.close()
                except Exception:
                    pass
            if sem_acquired and browser_semaphore is not None:
                browser_semaphore.release()

    job["percentagem"] = 100
    job["docs_atuais"] = submetidos_ok
    job["total_esperado"] = total_docs
    job["total_documentos"] = submetidos_ok
    job["status"] = "concluido"
    job["mensagem"] = f"Submissão concluída: {submetidos_ok} documento(s) gravado(s) na AT" + (f", {erros_docs} com aviso/erro." if erros_docs else ".")


def _consultar_ids_ainda_pendentes(page: Any, data_inicio: str, data_fim: str) -> Optional[set[str]]:
    try:
        res = page.evaluate("""async ({dIni, dFim}) => {
            const u = `/json/obterDocumentosAdquirente.action?dataInicioFilter=${encodeURIComponent(dIni)}&dataFimFilter=${encodeURIComponent(dFim)}&estadoDocumentoFilter=P&ambitoAquisicaoFilter=+&tipoAmbitoAtividadeFilter=`;
            const r = await fetch(u, {headers: {'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}});
            if (!r.ok) return {erro: true};
            const buf = await r.arrayBuffer();
            const txt = new TextDecoder('iso-8859-15').decode(buf);
            const j = JSON.parse(txt);
            return {ids: (j.linhas || []).map(l => String(l.idDocumento))};
        }""", {"dIni": data_inicio, "dFim": data_fim})
        if isinstance(res, dict) and isinstance(res.get("ids"), list):
            return set(res["ids"])
    except Exception:
        pass
    return None


def _submeter_detalhe_individual(page: Any, doc: Dict[str, Any]) -> Tuple[bool, str]:
    id_doc = doc["id_documento"]
    dt_doc = (doc.get("data_emissao") or "")[:10]
    url = f"https://faturas.portaldasfinancas.gov.pt/detalheDocumentoAdquirente.action?idDocumento={id_doc}&dataEmissaoDocumento={dt_doc}"
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(700)
        sub_res = page.evaluate("""({setor, ambito}) => {
            const formPend = document.querySelector('form#resolverPendencia');
            if (formPend && document.querySelector('#resolverPendenciaBtn')) {
                const selSetor = document.querySelector('select#ambitoAquisicaoPend');
                const selAmb = document.querySelector('select#ambitoActividadeProfPend');
                const hidSetor = formPend.querySelector('input[name="ambitoAquisicaoPend"]');
                const hidAmb = formPend.querySelector('input[name="ambitoActividadeProfPend"]');
                if (selSetor) selSetor.value = setor;
                if (hidSetor) hidSetor.value = setor;
                if (selAmb) selAmb.value = ambito;
                if (hidAmb) hidAmb.value = ambito;
                formPend.submit();
                return 'submitted_pend';
            }
            const formAlt = document.querySelector('form#alterarDocumentoAdquirente');
            if (formAlt) {
                const hidSetor = formAlt.querySelector('input[name="ambitoAquisicao"]');
                const hidAmb = formAlt.querySelector('input[name="ambitoActividadeProf"]');
                if (hidSetor) hidSetor.value = setor;
                if (hidAmb) hidAmb.value = ambito;
                formAlt.submit();
                return 'submitted_alt';
            }
            return 'no_form';
        }""", {"setor": doc["setor_codigo"], "ambito": doc["ambito_codigo"]})

        if sub_res == "no_form":
            return False, "Formulário de classificação não disponível no detalhe da AT."

        page.wait_for_load_state("domcontentloaded", timeout=30000)
        page.wait_for_timeout(900)
        texto = page.evaluate("() => document.body ? document.body.innerText : ''") or ""
        if "Informação guardada com sucesso" in texto or "guardada com sucesso" in texto.lower():
            return True, ""
        for padrao in ("CAE/CIRS", "erro", "inválid", "não é possível", "por favor corrija"):
            for linha in texto.splitlines():
                if padrao.lower() in linha.lower() and len(linha.strip()) > 6:
                    return False, linha.strip()[:220]
        return False, "A AT não confirmou a gravação do documento."
    except Exception as e:
        return False, str(e)[:220]


def _marcar_submetido(nif_cliente: str, id_documento: str, db_path: Optional[str] = None):
    now_iso = _now_iso()

    def _op():
        with _DB_LOCK:
            with _conectar_db(db_path) as conn:
                conn.execute(
                    """
                    UPDATE pendentes_documentos
                    SET estado_submissao = 'submetido', erro_submissao = '', submetido_em = ?, updated_at = ?
                    WHERE nif_cliente = ? AND id_documento = ?
                    """,
                    (now_iso, now_iso, nif_cliente, str(id_documento)),
                )
                conn.commit()

    _executar_com_retry(_op)


def _marcar_erro_submissao(nif_cliente: str, id_documento: str, erro: str, db_path: Optional[str] = None):
    now_iso = _now_iso()

    def _op():
        with _DB_LOCK:
            with _conectar_db(db_path) as conn:
                conn.execute(
                    """
                    UPDATE pendentes_documentos
                    SET estado_submissao = 'erro', erro_submissao = ?, updated_at = ?
                    WHERE nif_cliente = ? AND id_documento = ?
                    """,
                    (str(erro or "")[:300], now_iso, nif_cliente, str(id_documento)),
                )
                conn.commit()

    _executar_com_retry(_op)


# =============================================================================
# 8. ENSAIO VISUAL NO BROWSER AT (EXCLUSIVO PROGRAMADOR - NUNCA SUBMETE NA AT)
# =============================================================================

_JS_PREPARAR_PAGINA_ENSAIO = """() => {
    try {
        if (!document.getElementById('gexcel-ensaio-banner')) {
            const bar = document.createElement('div');
            bar.id = 'gexcel-ensaio-banner';
            bar.style.cssText = 'position:sticky;top:0;z-index:999999;background:#07121c;color:#f8fafc;border-bottom:3px solid #0284c7;padding:10px 18px;font-family:monospace;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between;box-shadow:0 4px 14px rgba(0,0,0,0.35);';
            bar.innerHTML = '<span>MODO ENSAIO VISUAL (PROGRAMADOR) · PREENCHIMENTO EM DIRETO NA AT</span><span style="background:#0284c7;color:#ffffff;padding:3px 10px;border-radius:4px;font-size:11px;">SUBMISSAO BLOQUEADA · ZERO ALTERACOES FISCAIS</span>';
            document.body.insertBefore(bar, document.body.firstChild);
        }
        const btnGuardar = document.querySelector('#guardarResolverListaPendenciasBtn');
        if (btnGuardar) {
            btnGuardar.disabled = true;
            btnGuardar.style.opacity = '0.45';
            btnGuardar.style.pointerEvents = 'none';
            if ('value' in btnGuardar && btnGuardar.tagName === 'INPUT') {
                btnGuardar.value = 'Guardar (Bloqueado em Modo Ensaio)';
            } else {
                btnGuardar.textContent = 'Guardar (Bloqueado em Modo Ensaio)';
            }
        }
        const form = document.querySelector('#resolverListaPendencias');
        if (form && !form.dataset.gexcelEnsaioLocked) {
            form.dataset.gexcelEnsaioLocked = '1';
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }, true);
        }
    } catch (e) {}
}"""

_JS_PREENCHER_LINHA_AT = """async ({idDoc, setorCod, ambitoCod, ambitoLabel}) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const row = document.getElementById('documento_' + idDoc);
    if (!row) {
        return { encontrou: false, motivo: 'Linha nao visivel na pagina atual' };
    }
    row.scrollIntoView({ behavior: 'instant', block: 'center' });
    row.style.outline = '3px solid #0284c7';
    row.style.backgroundColor = '#f0f9ff';

    const fecharModalSeAberto = async () => {
        for (let i = 0; i < 4; i++) {
            const modal = document.getElementById('modalPendencias');
            if (modal) {
                const btnUm = modal.querySelector('#oneBtn');
                const disp = window.getComputedStyle(modal).display;
                const visivel = modal.classList.contains('in') || modal.classList.contains('show') || disp === 'block';
                if (btnUm && visivel) {
                    btnUm.click();
                    await sleep(90);
                    document.querySelectorAll('.modal-backdrop').forEach((bd) => bd.remove());
                    document.body.classList.remove('modal-open');
                    return;
                }
            }
            await sleep(55);
        }
        document.querySelectorAll('.modal-backdrop').forEach((bd) => bd.remove());
        document.body.classList.remove('modal-open');
    };

    let setorClicado = false;
    const setorBtns = Array.from(row.querySelectorAll('.selecaoSector button'));
    for (const b of setorBtns) {
        const val = (b.getAttribute('value') || '').trim().toUpperCase();
        if (val === String(setorCod || '').trim().toUpperCase()) {
            b.click();
            setorClicado = true;
            break;
        }
    }
    await sleep(70);
    await fecharModalSeAberto();

    let ambitoClicado = false;
    const temAmbito = row.querySelectorAll('.selecaoActividadeProf button').length > 0;
    if (temAmbito) {
        const ambBtns = Array.from(row.querySelectorAll('.selecaoActividadeProf button'));
        for (const b of ambBtns) {
            const val = (b.getAttribute('value') || '').trim();
            if (val === String(ambitoCod || '').trim()) {
                b.click();
                ambitoClicado = true;
                break;
            }
        }
        await sleep(70);
        await fecharModalSeAberto();
    } else {
        ambitoClicado = true;
    }

    const setorAtivo = Array.from(row.querySelectorAll('.selecaoSector button')).some(
        (b) => (b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true') &&
               (b.getAttribute('value') || '').trim().toUpperCase() === String(setorCod || '').trim().toUpperCase()
    );
    const ambitoAtivo = !temAmbito || Array.from(row.querySelectorAll('.selecaoActividadeProf button')).some(
        (b) => (b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true') &&
               (b.getAttribute('value') || '').trim() === String(ambitoCod || '').trim()
    );

    let selTag = row.querySelector('.gexcel-ensaio-tag');
    if (!selTag) {
        selTag = document.createElement('div');
        selTag.className = 'gexcel-ensaio-tag';
        selTag.style.cssText = 'margin-top:4px;padding:2px 6px;border-radius:4px;background:#0c1520;color:#38bdf8;font-family:monospace;font-size:11px;font-weight:700;display:inline-block;border:1px solid #0284c7;';
        const alvoCel = row.querySelector('td') || row;
        alvoCel.appendChild(selTag);
    }
    selTag.textContent = 'Ensaio Preenchido: ' + setorCod + (temAmbito ? ' · ' + ambitoLabel : '');

    return {
        encontrou: true,
        setor_clicado: setorClicado,
        ambito_clicado: ambitoClicado,
        setor_ativo: setorAtivo,
        ambito_ativo: ambitoAtivo,
        tem_ambito: temAmbito
    };
}"""


def _capturar_frame_ensaio(page: Any, job: Dict[str, Any], passo_txt: str, full_page: bool = False) -> str:
    try:
        job["ensaio_url"] = str(getattr(page, "url", "") or job.get("ensaio_url") or "")
        job["ensaio_passo_atual"] = passo_txt
        raw = page.screenshot(type="jpeg", quality=78, full_page=full_page)
        if isinstance(raw, (bytes, bytearray)) and raw:
            b64 = base64.b64encode(bytes(raw)).decode("ascii")
            job["ensaio_frame_b64"] = b64
            return b64
    except Exception as exc:
        LOGGER.debug(f"[ENSAIO VISUAL] Falha ao capturar screenshot: {exc}")
    return ""


def _manter_sessoes_abertas_dev(sessoes: List[Any], tempo_max_seg: int = 600):
    """Mantem janelas nativas abertas no ambiente de trabalho ate o programador as fechar."""
    inicio = time.time()
    try:
        while time.time() - inicio < tempo_max_seg:
            ativas = []
            for s in sessoes:
                try:
                    br = getattr(s, "browser", None)
                    ctx = getattr(getattr(s, "page", None), "context", None)
                    if br is not None and br.is_connected() and (ctx is None or len(ctx.pages) > 0):
                        ativas.append(s)
                except Exception:
                    pass
            if not ativas:
                break
            time.sleep(1.0)
    finally:
        for s in sessoes:
            try:
                s.close()
            except Exception:
                pass


def executar_job_ensaio_visivel_pendentes(
    job_id: str,
    jobs_dict: Dict[str, Any],
    ano: int,
    nifs: Optional[List[str]] = None,
    iniciar_sessao_fn: Optional[Callable[..., Any]] = None,
    browser_semaphore: Optional[threading.Semaphore] = None,
    db_path: Optional[str] = None,
):
    """
    Executa simulacao visual em direto no Portal das Financas para o programador:
    - Abre a sessao AT e navega ate `resolverListaPendenciasAdquirenteForm.action`.
    - Bloqueia por completo todas as rotas de submissao/gravacao na AT (Travão Fiscal absoluto).
    - Seleciona visualmente o setor e ambito de cada documento validado e transmite frames em direto.
    - NUNCA altera o estado dos documentos nem regista termo legal definitivo na base de dados.
    """
    init_pendentes_db(db_path)
    job = jobs_dict[job_id]
    is_win = sys.platform == "win32"

    job["modo_ensaio_visivel"] = True
    job.setdefault("docs_atuais", 0)
    job.setdefault("total_esperado", 0)
    job["ensaio_url"] = "https://faturas.portaldasfinancas.gov.pt/resolverListaPendenciasAdquirenteForm.action"
    job["ensaio_passo_atual"] = "A preparar sessao de ensaio visual no Portal das Financas..."
    job["ensaio_frame_b64"] = ""
    job["ensaio_paginas_b64"] = []
    job["ensaio_itens"] = []
    job["janela_nativa_aberta"] = is_win

    docs = obter_documentos_prontos_submissao(ano=ano, nifs=nifs, db_path=db_path)
    if not docs:
        job["status"] = "concluido"
        job["percentagem"] = 100
        job["ensaio_passo_atual"] = "Sem documentos validados prontos para simular na AT."
        job["mensagem"] = "Sem documentos validados para ensaio visual."
        return

    if iniciar_sessao_fn is None:
        try:
            from efatura_scraper import iniciar_sessao_efatura as _ise
            iniciar_sessao_fn = _ise
        except Exception as e_imp:
            job["status"] = "erro"
            job["erro"] = f"Motor de navegacao AT indisponivel: {e_imp}"
            job["ensaio_passo_atual"] = job["erro"]
            job["mensagem"] = job["erro"]
            return

    por_cliente: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for d in docs:
        por_cliente[d["nif_cliente"]].append(d)

    total_docs = len(docs)
    preenchidos_ok = 0
    processados = 0
    sessoes_nativas: List[Any] = []
    avisos: List[str] = []

    for idx_cli, (nif_clean, docs_cli) in enumerate(por_cliente.items(), start=1):
        if job.get("cancelar"):
            job["status"] = "interrompido"
            job["ensaio_passo_atual"] = f"Ensaio visual interrompido ({preenchidos_ok}/{total_docs} preenchidos)."
            job["mensagem"] = job["ensaio_passo_atual"]
            break

        nome_cli = docs_cli[0].get("nome_cliente") or pb_client.get_entidade_nome(nif_clean)
        job["nif"] = nif_clean
        job["nome_empresa"] = nome_cli
        job["ensaio_passo_atual"] = f"[{idx_cli}/{len(por_cliente)}] A autenticar {nome_cli} no e-Fatura..."
        job["mensagem"] = job["ensaio_passo_atual"]

        login_user, pwd = _obter_credenciais_entidade(nif_clean)
        if not pwd:
            for d in docs_cli:
                job["ensaio_itens"].append({
                    "nif_cliente": nif_clean,
                    "nome_cliente": nome_cli,
                    "id_documento": d["id_documento"],
                    "numero_documento": d.get("numero_documento") or d["id_documento"],
                    "nome_emitente": d.get("nome_emitente") or d.get("nif_emitente") or "",
                    "valor_total": float(d.get("valor_total") or 0.0),
                    "setor_codigo": d["setor_codigo"],
                    "ambito_codigo": d["ambito_codigo"],
                    "preenchido_ecra": False,
                    "detalhe": "Senha AT nao configurada.",
                })
                processados += 1
            avisos.append(f"{nif_clean}: sem senha configurada")
            continue

        sessao = None
        sem_acquired = False
        manter_sessao_aberta = False
        try:
            if browser_semaphore is not None:
                browser_semaphore.acquire()
                sem_acquired = True

            sessao = iniciar_sessao_fn(nif=login_user, password=pwd, headless=(not is_win), canal="auto")
            page = sessao.page

            try:
                page.set_viewport_size({"width": 1440, "height": 900})
            except Exception:
                pass

            if is_win:
                try:
                    page.bring_to_front()
                    from abrir_browser_sessao import focar_janela_navegador
                    focar_janela_navegador()
                except Exception:
                    pass

            # Bloqueio estrito de rede contra qualquer submissao fiscal na AT durante o ensaio
            def _bloquear_submissao_route(route):
                try:
                    url_low = str(getattr(route.request, "url", "") or "").lower()
                    if "resolverlistapendenciasadquirenteform.action" in url_low:
                        route.continue_()
                        return
                    if any(
                        pat in url_low
                        for pat in (
                            "resolverlistapendenciasadquirente.action",
                            "resolverpendenciaadquirente.action",
                            "resolverpendencia.action",
                            "alterardocumentoadquirente.action",
                        )
                    ):
                        LOGGER.warning(f"[ENSAIO VISUAL] Bloqueio de submissao acionado em: {url_low}")
                        route.abort()
                        return
                    route.continue_()
                except Exception:
                    try:
                        route.continue_()
                    except Exception:
                        pass

            try:
                page.route("**/*.action*", _bloquear_submissao_route)
            except Exception:
                pass

            url_pend = "https://faturas.portaldasfinancas.gov.pt/resolverListaPendenciasAdquirenteForm.action"
            page.goto(url_pend, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(900)
            try:
                page.evaluate(_JS_PREPARAR_PAGINA_ENSAIO)
            except Exception:
                pass

            try:
                if page.locator("select[name='listaPendencias_length']").count() > 0:
                    page.select_option("select[name='listaPendencias_length']", "50")
                    page.wait_for_timeout(500)
            except Exception:
                pass

            _capturar_frame_ensaio(
                page,
                job,
                f"[{idx_cli}/{len(por_cliente)}] {nome_cli}: grelha de pendentes aberta na AT...",
                full_page=False,
            )

            docs_pendentes_mapa = {str(d["id_documento"]): d for d in docs_cli}
            preenchidos_cli: set[str] = set()

            for num_pag in range(1, 11):
                if job.get("cancelar") or len(preenchidos_cli) >= len(docs_cli):
                    break

                try:
                    ids_visiveis = page.evaluate("""() => {
                        return Array.from(document.querySelectorAll('#listaPendencias tbody tr[id^="documento_"]'))
                            .map(tr => tr.id.replace('documento_', ''));
                    }""") or []
                except Exception:
                    ids_visiveis = []

                ids_alvo_pag = [id_v for id_v in ids_visiveis if id_v in docs_pendentes_mapa and id_v not in preenchidos_cli]
                preenchidos_pagina = 0

                for id_doc in ids_alvo_pag:
                    if job.get("cancelar"):
                        break
                    d = docs_pendentes_mapa[id_doc]
                    amb_cod = d.get("ambito_codigo") or "1"
                    amb_label = AMBITOS_MAP.get(amb_cod, {}).get("nome_curto") or amb_cod
                    res_fill = page.evaluate(
                        _JS_PREENCHER_LINHA_AT,
                        {
                            "idDoc": id_doc,
                            "setorCod": d["setor_codigo"],
                            "ambitoCod": amb_cod,
                            "ambitoLabel": amb_label,
                        },
                    )
                    # Fechar eventual popup "Aplicar a todos deste fornecedor?" mantendo apenas a linha/ensaio
                    try:
                        one_btn = page.locator("#modalPendencias #oneBtn")
                        if one_btn.is_visible(timeout=180):
                            one_btn.click(timeout=1000)
                            page.wait_for_timeout(160)
                    except Exception:
                        pass

                    ok_ecra = bool(isinstance(res_fill, dict) and res_fill.get("encontrou") and res_fill.get("setor_clicado"))
                    preenchidos_cli.add(id_doc)
                    if ok_ecra:
                        preenchidos_ok += 1
                        preenchidos_pagina += 1
                    processados += 1

                    job["ensaio_itens"].append({
                        "nif_cliente": nif_clean,
                        "nome_cliente": nome_cli,
                        "id_documento": id_doc,
                        "numero_documento": d.get("numero_documento") or id_doc,
                        "nome_emitente": d.get("nome_emitente") or d.get("nif_emitente") or "",
                        "valor_total": float(d.get("valor_total") or 0.0),
                        "setor_codigo": d["setor_codigo"],
                        "ambito_codigo": amb_cod,
                        "preenchido_ecra": ok_ecra,
                        "detalhe": "Selecionado visualmente na AT (sem submeter)" if ok_ecra else "Linha localizada mas botao nao respondeu",
                    })
                    job["docs_atuais"] = preenchidos_ok
                    job["percentagem"] = min(98, int((processados / max(1, total_docs)) * 100))

                    _capturar_frame_ensaio(
                        page,
                        job,
                        f"A preencher na AT: {d.get('nome_emitente') or d['nif_emitente']} ({d.get('numero_documento') or id_doc}) -> {d['setor_codigo']} / {amb_label}",
                        full_page=False,
                    )

                if preenchidos_pagina > 0 or num_pag == 1:
                    try:
                        page.evaluate("() => window.scrollTo(0, 0)")
                    except Exception:
                        pass
                    snap_b64 = _capturar_frame_ensaio(
                        page,
                        job,
                        f"{nome_cli} · Pagina {num_pag} preenchida visualmente na AT (sem submeter)",
                        full_page=True,
                    )
                    if snap_b64:
                        job["ensaio_paginas_b64"].append({
                            "nif_cliente": nif_clean,
                            "cliente": nome_cli,
                            "pagina": num_pag,
                            "preenchidos": preenchidos_pagina,
                            "img_b64": snap_b64,
                        })

                if len(preenchidos_cli) >= len(docs_cli):
                    break

                # Avancar para a pagina seguinte da grelha AT se existir
                try:
                    tem_proxima = page.evaluate("""() => {
                        const nxt = document.querySelector('#listaPendencias_next');
                        if (!nxt || nxt.classList.contains('disabled')) return false;
                        const a = nxt.querySelector('a') || nxt;
                        a.click();
                        return true;
                    }""")
                    if not tem_proxima:
                        break
                    page.wait_for_timeout(500)
                except Exception:
                    break

            for d in docs_cli:
                id_str = str(d["id_documento"])
                if id_str not in preenchidos_cli:
                    processados += 1
                    job["ensaio_itens"].append({
                        "nif_cliente": nif_clean,
                        "nome_cliente": nome_cli,
                        "id_documento": id_str,
                        "numero_documento": d.get("numero_documento") or id_str,
                        "nome_emitente": d.get("nome_emitente") or d.get("nif_emitente") or "",
                        "valor_total": float(d.get("valor_total") or 0.0),
                        "setor_codigo": d["setor_codigo"],
                        "ambito_codigo": d.get("ambito_codigo") or "1",
                        "preenchido_ecra": False,
                        "detalhe": "Documento nao encontrado na grelha de pendentes atual da AT.",
                    })

            if is_win:
                manter_sessao_aberta = True
                sessoes_nativas.append(sessao)

        except Exception as exc_cli:
            err_txt = str(exc_cli)
            LOGGER.error(f"[ENSAIO VISUAL] Erro em {nif_clean}: {err_txt}")
            avisos.append(f"{nif_clean}: {err_txt}")
            for d in docs_cli:
                if not any(it["id_documento"] == str(d["id_documento"]) and it["nif_cliente"] == nif_clean for it in job["ensaio_itens"]):
                    processados += 1
                    job["ensaio_itens"].append({
                        "nif_cliente": nif_clean,
                        "nome_cliente": nome_cli,
                        "id_documento": str(d["id_documento"]),
                        "numero_documento": d.get("numero_documento") or str(d["id_documento"]),
                        "nome_emitente": d.get("nome_emitente") or d.get("nif_emitente") or "",
                        "valor_total": float(d.get("valor_total") or 0.0),
                        "setor_codigo": d["setor_codigo"],
                        "ambito_codigo": d.get("ambito_codigo") or "1",
                        "preenchido_ecra": False,
                        "detalhe": err_txt[:220],
                    })
        finally:
            if sessao is not None and not manter_sessao_aberta:
                try:
                    sessao.close()
                except Exception:
                    pass
            if sem_acquired and browser_semaphore is not None:
                browser_semaphore.release()

    if job.get("cancelar"):
        return

    msg_fim = (
        f"Ensaio visual concluido: {preenchidos_ok}/{total_docs} documento(s) preenchido(s) no ecra da AT (submissao bloqueada)."
    )
    if avisos:
        msg_fim += f" Avisos: {' | '.join(avisos[:2])}"

    job["percentagem"] = 100
    job["docs_atuais"] = preenchidos_ok
    job["total_esperado"] = total_docs
    job["total_documentos"] = preenchidos_ok
    job["ensaio_passo_atual"] = msg_fim
    job["mensagem"] = msg_fim
    job["status"] = "concluido"

    if sessoes_nativas:
        threading.Thread(
            target=_manter_sessoes_abertas_dev,
            args=(sessoes_nativas,),
            daemon=True,
        ).start()
