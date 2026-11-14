"""
Serviço de Orquestração, Persistência SQLite (BdsefaturaV4), Sincronização XML Legado (BdsRV),
Matriz Anual, Consulta e Extração de Recibos Verdes e Rendas
EVO-05 API e-Fatura (:8015) <-> SCR-03_Scrap_RecibosVerdes
"""

import os
import re
import sys
import time
import sqlite3
import logging
import threading
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple

import pb_client

LOGGER = logging.getLogger("gexcel.efatura.rv")

# Injetar caminhos dos motores SCR-01 e SCR-03
_BASE_EVO_DIR = Path(__file__).resolve().parent.parent
_SCR01_DIR = _BASE_EVO_DIR / "03.9_SCR_EVO_Scrapers_Gov" / "SCR-01_Logins_Gov"
_SCR03_DIR = _BASE_EVO_DIR / "03.9_SCR_EVO_Scrapers_Gov" / "SCR-03_Scrap_RecibosVerdes"

for _p in (_SCR03_DIR, _SCR01_DIR):
    if _p.exists() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

try:
    from models import DocumentoRV, LoteRecibosVerdes, serial_excel_para_iso
    from xml_engine import carregar_lote_xml, salvar_lote_xml
    from storage_manager import obter_caminho_xml, garantir_diretorio
    from pdf_downloader import (
        obter_pasta_base_pdfs_default,
        sincronizar_estado_pdfs_disco,
        resolver_caminho_pdf_documento,
    )
    from scraper_rv import extrair_recibos_verdes
    SCRAPER_RV_DISPONIVEL = True
except Exception as _e_rv:
    LOGGER.warning(f"Aviso ao carregar SCR-03_Scrap_RecibosVerdes: {_e_rv}")
    SCRAPER_RV_DISPONIVEL = False

_RV_DB_LOCK = threading.Lock()
_BROWSER_SEMAPHORE = threading.Semaphore(4)


def obter_pasta_bdsrv() -> Path:
    """Resolve a pasta oficial BdsRV (XML legado do Gexcel Apps) dentro da raiz de dados."""
    raiz = Path(pb_client.obter_pasta_dados_raiz())
    pasta = raiz / "BdsRV"
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta


def obter_db_rv_cliente_path(nif: str) -> str:
    """Retorna o caminho da base SQLite moderna particionada para Recibos Verdes e Rendas: BdsefaturaV4/{NIF}/recibos_verdes_{NIF}.db."""
    nif_clean = re.sub(r"[^0-9]", "", str(nif or "")).strip()[:9]
    pasta_v4 = Path(pb_client.obter_pasta_v4())
    pasta_nif = pasta_v4 / nif_clean
    pasta_nif.mkdir(parents=True, exist_ok=True)
    return str(pasta_nif / f"recibos_verdes_{nif_clean}.db")


def _init_config_rv_db():
    """Garante tabelas de configuração e log de sincronização XML->SQLite no controlo_geral.db."""
    pb_client.init_controlo_db()
    ctrl_db = pb_client.obter_db_controlo_path()
    try:
        with pb_client.db_connect(ctrl_db, timeout=10) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS config_recibos_verdes (
                    chave TEXT PRIMARY KEY,
                    valor TEXT NOT NULL,
                    updated_at TEXT DEFAULT ''
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS rv_xml_sync_log (
                    caminho_xml TEXT PRIMARY KEY,
                    nif TEXT NOT NULL,
                    ano INTEGER NOT NULL,
                    tipo_code TEXT NOT NULL,
                    mtime REAL NOT NULL,
                    docs_sincronizados INTEGER DEFAULT 0,
                    updated_at TEXT DEFAULT ''
                );
            """)
            conn.commit()
    except Exception as e:
        LOGGER.debug(f"Aviso ao inicializar tabelas de Recibos Verdes no controlo_geral.db: {e}")


def _init_cliente_rv_db(nif: str) -> str:
    """Inicializa a tabela moderna `recibos_verdes_documentos` na base SQLite particionada do cliente."""
    db_path = obter_db_rv_cliente_path(nif)
    with pb_client.db_connect(db_path, timeout=15) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS recibos_verdes_documentos (
                nif_cliente TEXT NOT NULL,
                tipo_fluxo TEXT NOT NULL,
                id_documento TEXT NOT NULL,
                n_documento TEXT DEFAULT '',
                atcud TEXT DEFAULT '0',
                tipo_doc TEXT DEFAULT 'Fatura-Recibo',
                categoria TEXT DEFAULT 'recibo_verde',
                situacao TEXT DEFAULT 'Emitido',
                nif_emit TEXT DEFAULT '',
                nome_emit TEXT DEFAULT '',
                nif_adquirente TEXT DEFAULT '',
                nome_adquirente TEXT DEFAULT '',
                contraparte_nif TEXT DEFAULT '',
                contraparte_nome TEXT DEFAULT '',
                dta_emissao TEXT DEFAULT '',
                ano_emissao INTEGER DEFAULT 0,
                mes_emissao INTEGER DEFAULT 0,
                dta_prestacao TEXT DEFAULT '',
                ano_prestacao INTEGER DEFAULT 0,
                mes_prestacao INTEGER DEFAULT 0,
                dta_recebimento TEXT DEFAULT '',
                ano_recebimento INTEGER DEFAULT 0,
                mes_recebimento INTEGER DEFAULT 0,
                ano_efetivo INTEGER DEFAULT 0,
                mes_efetivo INTEGER DEFAULT 0,
                valor_base REAL DEFAULT 0.0,
                valor_iva REAL DEFAULT 0.0,
                imposto_selo REAL DEFAULT 0.0,
                valor_irs REAL DEFAULT 0.0,
                importancia_recebida REAL DEFAULT 0.0,
                descricao TEXT DEFAULT '',
                ativid_exercida TEXT DEFAULT '',
                domicilio_fisc_estab_e TEXT DEFAULT '',
                domic_adquire TEXT DEFAULT '',
                desc_taxa_iva TEXT DEFAULT '',
                desc_irs TEXT DEFAULT '',
                desc_imp_selo TEXT DEFAULT '',
                import_rec_a_tit_de TEXT DEFAULT '',
                contrib_trabalhador_indep REAL DEFAULT 0.0,
                dta_atualiza TEXT DEFAULT '',
                baixado TEXT DEFAULT '',
                caminho_pdf TEXT DEFAULT '',
                ano_xml_origem INTEGER DEFAULT 0,
                updated_at TEXT DEFAULT '',
                PRIMARY KEY (nif_cliente, tipo_fluxo, id_documento)
            );
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_rv_ano_mes
            ON recibos_verdes_documentos(nif_cliente, tipo_fluxo, ano_efetivo, mes_efetivo);
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_rv_categoria
            ON recibos_verdes_documentos(tipo_fluxo, categoria, ano_efetivo);
        """)
        conn.commit()
    return db_path


def obter_pasta_pdfs_configurada() -> str:
    """Obtém a pasta base configurada para download de PDFs de Recibos Verdes e Rendas."""
    _init_config_rv_db()
    ctrl_db = pb_client.obter_db_controlo_path()
    default_dir = str(Path(pb_client.obter_pasta_dados_raiz()) / "BdsRV_PDFs")
    try:
        with pb_client.db_connect(ctrl_db, timeout=5) as conn:
            c = conn.cursor()
            c.execute("SELECT valor FROM config_recibos_verdes WHERE chave = 'pasta_pdfs'")
            row = c.fetchone()
            if row and row[0] and str(row[0]).strip():
                return str(row[0]).strip()
    except Exception:
        pass
    return default_dir


def guardar_pasta_pdfs_configurada(caminho: str) -> str:
    """Guarda a pasta base para download de PDFs de Recibos Verdes e Rendas."""
    _init_config_rv_db()
    ctrl_db = pb_client.obter_db_controlo_path()
    caminho_limpo = str(caminho or "").strip()
    if not caminho_limpo:
        caminho_limpo = str(Path(pb_client.obter_pasta_dados_raiz()) / "BdsRV_PDFs")
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with pb_client.db_connect(ctrl_db, timeout=10) as conn:
            conn.execute("""
                INSERT INTO config_recibos_verdes (chave, valor, updated_at)
                VALUES ('pasta_pdfs', ?, ?)
                ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at
            """, (caminho_limpo, now_str))
            conn.commit()
    except Exception as e:
        LOGGER.warning(f"Erro ao guardar pasta_pdfs em config_recibos_verdes: {e}")
    return caminho_limpo


def obter_alimentar_xml_legado() -> bool:
    """
    Indica se o sistema deve continuar a alimentar em paralelo os ficheiros XML legados
    do Gexcel Apps (BdsefaturaV3 e BdsRV) além da gravação moderna em SQLite (BdsefaturaV4).
    Por defeito: True (alimenta SQLite + XML Gexcel Apps).
    """
    _init_config_rv_db()
    ctrl_db = pb_client.obter_db_controlo_path()
    try:
        with pb_client.db_connect(ctrl_db, timeout=5) as conn:
            c = conn.cursor()
            c.execute("SELECT valor FROM config_recibos_verdes WHERE chave = 'alimentar_xml_legado'")
            row = c.fetchone()
            if row and row[0] is not None:
                return str(row[0]).strip().lower() not in ("0", "false", "nao", "não", "off")
    except Exception:
        pass
    return True


def guardar_alimentar_xml_legado(ativo: bool) -> bool:
    """Guarda a preferência global de alimentar os ficheiros XML legados do Gexcel Apps (BdsefaturaV3 e BdsRV)."""
    _init_config_rv_db()
    ctrl_db = pb_client.obter_db_controlo_path()
    val_str = "1" if ativo else "0"
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with pb_client.db_connect(ctrl_db, timeout=10) as conn:
            conn.execute("""
                INSERT INTO config_recibos_verdes (chave, valor, updated_at)
                VALUES ('alimentar_xml_legado', ?, ?)
                ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at
            """, (val_str, now_str))
            conn.commit()
    except Exception as e:
        LOGGER.warning(f"Erro ao guardar alimentar_xml_legado: {e}")
    return bool(ativo)


def invalidar_cache_xml(caminho_xml: Optional[Path] = None):
    """Força re-verificação de sincronização XML->SQLite."""
    _init_config_rv_db()
    ctrl_db = pb_client.obter_db_controlo_path()
    try:
        with pb_client.db_connect(ctrl_db, timeout=5) as conn:
            if caminho_xml:
                conn.execute("DELETE FROM rv_xml_sync_log WHERE caminho_xml = ?", (str(caminho_xml),))
            else:
                conn.execute("DELETE FROM rv_xml_sync_log")
            conn.commit()
    except Exception:
        pass


def _determinar_ano_mes_efetivo(doc: Any, ano_fallback: int = 0) -> Tuple[int, int]:
    """
    Determina o ano e mês efetivos de emissão/recebimento de um DocumentoRV:
    1. Se ano_emissao > 1900, usa (ano_emissao, mes_emissao).
    2. Senão, se ano_recebimento > 1900, usa (ano_recebimento, mes_recebimento).
    3. Senão, se ano_prestacao > 1900, usa (ano_prestacao, mes_prestacao).
    4. Fallback para ano_fallback.
    """
    ano_em = int(getattr(doc, "ano_emissao", 0) or 0)
    mes_em = int(getattr(doc, "mes_emissao", 0) or 0)
    if ano_em > 1900 and 1 <= mes_em <= 12:
        return ano_em, mes_em

    ano_rc = int(getattr(doc, "ano_recebimento", 0) or 0)
    mes_rc = int(getattr(doc, "mes_recebimento", 0) or 0)
    if ano_rc > 1900 and 1 <= mes_rc <= 12:
        return ano_rc, mes_rc

    ano_pr = int(getattr(doc, "ano_prestacao", 0) or 0)
    mes_pr = int(getattr(doc, "mes_prestacao", 0) or 0)
    if ano_pr > 1900 and 1 <= mes_pr <= 12:
        return ano_pr, mes_pr

    return ano_fallback, mes_em if 1 <= mes_em <= 12 else 1


def guardar_lote_rv_sqlite(
    lote: Any,
    nif_cliente: str,
    ano_xml_origem: int,
    tipo_code: str,
    pasta_pdfs: Optional[Path] = None
) -> int:
    """
    Persiste todos os documentos de um LoteRecibosVerdes na base SQLite moderna particionada:
    `BdsefaturaV4/{NIF}/recibos_verdes_{NIF}.db`.
    """
    nif_clean = re.sub(r"[^0-9]", "", str(nif_cliente or "")).strip()[:9]
    if not nif_clean or not lote:
        return 0

    is_vendas = str(tipo_code or "C").strip().upper() == "V"
    tipo_fluxo = "vendas" if is_vendas else "compras"
    pasta_pdfs_final = pasta_pdfs or Path(obter_pasta_pdfs_configurada())

    sincronizar_estado_pdfs_disco(lote, pasta_base_pdfs=pasta_pdfs_final)
    db_path = _init_cliente_rv_db(nif_clean)
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    rows_to_upsert = []
    for doc in lote.documentos:
        ano_ef, mes_ef = _determinar_ano_mes_efetivo(doc, ano_fallback=0)
        d_api = doc.to_api_dict()
        dta_em_iso = d_api.get("dta_emissao") or (
            f"{ano_ef:04d}-{mes_ef:02d}-01" if (ano_ef > 1900 and 1 <= mes_ef <= 12) else ""
        )
        dta_pr_iso = d_api.get("dta_prestacao") or ""
        dta_rc_iso = d_api.get("dta_recebimento") or ""
        dta_at_iso = d_api.get("dta_atualiza") or ""

        cp_nif = str(doc.nif_adquirente if is_vendas else doc.nif_emit).strip()
        cp_nome = str(doc.nome_adquirente if is_vendas else doc.nome_emit).strip()
        cat = "renda" if doc.tipo_doc == "RECIBO-RENDA" else "recibo_verde"

        rows_to_upsert.append((
            nif_clean,
            tipo_fluxo,
            str(doc.id_documento or "").strip(),
            str(doc.n_documento or "").strip(),
            str(doc.atcud or "0").strip(),
            str(doc.tipo_doc or "Fatura-Recibo").strip(),
            cat,
            str(doc.situacao or "Emitido").strip(),
            str(doc.nif_emit or "").strip(),
            str(doc.nome_emit or "").strip(),
            str(doc.nif_adquirente or "").strip(),
            str(doc.nome_adquirente or "").strip(),
            cp_nif,
            cp_nome,
            dta_em_iso,
            int(doc.ano_emissao or 0),
            int(doc.mes_emissao or 0),
            dta_pr_iso,
            int(doc.ano_prestacao or 0),
            int(doc.mes_prestacao or 0),
            dta_rc_iso,
            int(doc.ano_recebimento or 0),
            int(doc.mes_recebimento or 0),
            int(ano_ef),
            int(mes_ef),
            float(doc.valor_base or 0.0),
            float(doc.valor_iva or 0.0),
            float(doc.imposto_selo or 0.0),
            float(doc.valor_irs or 0.0),
            float(doc.importancia_recebida or 0.0),
            str(doc.descricao or ""),
            str(doc.ativid_exercida or ""),
            str(doc.domicilio_fisc_estab_e or ""),
            str(doc.domic_adquire or ""),
            str(doc.desc_taxa_iva or ""),
            str(doc.desc_irs or ""),
            str(doc.desc_imp_selo or ""),
            str(doc.import_rec_a_tit_de or ""),
            float(doc.contrib_trabalhador_indep or 0.0),
            dta_at_iso,
            str(doc.baixado or ""),
            str(doc.caminho_pdf or ""),
            int(ano_xml_origem or 0),
            now_str,
        ))

    with _RV_DB_LOCK:
        with pb_client.db_connect(db_path, timeout=20) as conn:
            conn.executemany("""
                INSERT INTO recibos_verdes_documentos (
                    nif_cliente, tipo_fluxo, id_documento, n_documento, atcud,
                    tipo_doc, categoria, situacao, nif_emit, nome_emit,
                    nif_adquirente, nome_adquirente, contraparte_nif, contraparte_nome,
                    dta_emissao, ano_emissao, mes_emissao, dta_prestacao, ano_prestacao, mes_prestacao,
                    dta_recebimento, ano_recebimento, mes_recebimento, ano_efetivo, mes_efetivo,
                    valor_base, valor_iva, imposto_selo, valor_irs, importancia_recebida,
                    descricao, ativid_exercida, domicilio_fisc_estab_e, domic_adquire,
                    desc_taxa_iva, desc_irs, desc_imp_selo, import_rec_a_tit_de,
                    contrib_trabalhador_indep, dta_atualiza, baixado, caminho_pdf,
                    ano_xml_origem, updated_at
                ) VALUES (
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?
                )
                ON CONFLICT(nif_cliente, tipo_fluxo, id_documento) DO UPDATE SET
                    n_documento = excluded.n_documento,
                    atcud = excluded.atcud,
                    tipo_doc = excluded.tipo_doc,
                    categoria = excluded.categoria,
                    situacao = excluded.situacao,
                    nif_emit = excluded.nif_emit,
                    nome_emit = excluded.nome_emit,
                    nif_adquirente = excluded.nif_adquirente,
                    nome_adquirente = excluded.nome_adquirente,
                    contraparte_nif = excluded.contraparte_nif,
                    contraparte_nome = excluded.contraparte_nome,
                    dta_emissao = excluded.dta_emissao,
                    ano_emissao = excluded.ano_emissao,
                    mes_emissao = excluded.mes_emissao,
                    dta_prestacao = excluded.dta_prestacao,
                    ano_prestacao = excluded.ano_prestacao,
                    mes_prestacao = excluded.mes_prestacao,
                    dta_recebimento = excluded.dta_recebimento,
                    ano_recebimento = excluded.ano_recebimento,
                    mes_recebimento = excluded.mes_recebimento,
                    ano_efetivo = excluded.ano_efetivo,
                    mes_efetivo = excluded.mes_efetivo,
                    valor_base = excluded.valor_base,
                    valor_iva = excluded.valor_iva,
                    imposto_selo = excluded.imposto_selo,
                    valor_irs = excluded.valor_irs,
                    importancia_recebida = excluded.importancia_recebida,
                    descricao = CASE WHEN excluded.descricao != '' THEN excluded.descricao ELSE recibos_verdes_documentos.descricao END,
                    ativid_exercida = CASE WHEN excluded.ativid_exercida != '' THEN excluded.ativid_exercida ELSE recibos_verdes_documentos.ativid_exercida END,
                    domicilio_fisc_estab_e = CASE WHEN excluded.domicilio_fisc_estab_e != '' THEN excluded.domicilio_fisc_estab_e ELSE recibos_verdes_documentos.domicilio_fisc_estab_e END,
                    domic_adquire = CASE WHEN excluded.domic_adquire != '' THEN excluded.domic_adquire ELSE recibos_verdes_documentos.domic_adquire END,
                    desc_taxa_iva = CASE WHEN excluded.desc_taxa_iva != '' THEN excluded.desc_taxa_iva ELSE recibos_verdes_documentos.desc_taxa_iva END,
                    desc_irs = CASE WHEN excluded.desc_irs != '' THEN excluded.desc_irs ELSE recibos_verdes_documentos.desc_irs END,
                    desc_imp_selo = CASE WHEN excluded.desc_imp_selo != '' THEN excluded.desc_imp_selo ELSE recibos_verdes_documentos.desc_imp_selo END,
                    import_rec_a_tit_de = CASE WHEN excluded.import_rec_a_tit_de != '' THEN excluded.import_rec_a_tit_de ELSE recibos_verdes_documentos.import_rec_a_tit_de END,
                    contrib_trabalhador_indep = excluded.contrib_trabalhador_indep,
                    dta_atualiza = excluded.dta_atualiza,
                    baixado = CASE WHEN excluded.baixado = 'sim' THEN 'sim' ELSE recibos_verdes_documentos.baixado END,
                    caminho_pdf = CASE WHEN excluded.caminho_pdf != '' THEN excluded.caminho_pdf ELSE recibos_verdes_documentos.caminho_pdf END,
                    ano_xml_origem = excluded.ano_xml_origem,
                    updated_at = excluded.updated_at
            """, rows_to_upsert)
            conn.commit()

    return len(rows_to_upsert)


def carregar_cache_rv_de_sqlite(nif: str, ano: int, tipo_code: str) -> Dict[str, Any]:
    """Carrega os DocumentoRV já existentes na base SQLite `recibos_verdes_{NIF}.db` para alimentar a cache incremental."""
    nif_clean = re.sub(r"[^0-9]", "", str(nif or "")).strip()[:9]
    db_path = obter_db_rv_cliente_path(nif_clean)
    if not os.path.exists(db_path) or not SCRAPER_RV_DISPONIVEL:
        return {}

    tipo_fluxo = "vendas" if str(tipo_code).upper() == "V" else "compras"
    cache_map: Dict[str, Any] = {}
    try:
        with pb_client.db_connect(db_path, timeout=5) as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("""
                SELECT * FROM recibos_verdes_documentos
                WHERE nif_cliente = ? AND tipo_fluxo = ? AND (ano_efetivo = ? OR ano_xml_origem = ? OR categoria = 'renda')
            """, (nif_clean, tipo_fluxo, int(ano), int(ano)))
            for r in c.fetchall():
                doc = DocumentoRV(
                    id_documento=r["id_documento"],
                    nif_emit=r["nif_emit"] or "",
                    nome_emit=r["nome_emit"] or "",
                    nif_adquirente=r["nif_adquirente"] or "",
                    nome_adquirente=r["nome_adquirente"] or "",
                    pais_adquirente="",
                    tipo_doc=r["tipo_doc"] or "Fatura-Recibo",
                    situacao=r["situacao"] or "Emitido",
                    n_documento=r["n_documento"] or "",
                    atcud=r["atcud"] or "0",
                    dta_emissao=r["dta_emissao"] or "",
                    ano_emissao=int(r["ano_emissao"] or 0),
                    mes_emissao=int(r["mes_emissao"] or 0),
                    dta_prestacao=r["dta_prestacao"] or "",
                    ano_prestacao=int(r["ano_prestacao"] or 0),
                    mes_prestacao=int(r["mes_prestacao"] or 0),
                    dta_recebimento=r["dta_recebimento"] or "",
                    ano_recebimento=int(r["ano_recebimento"] or 0),
                    mes_recebimento=int(r["mes_recebimento"] or 0),
                    valor_base=float(r["valor_base"] or 0.0),
                    valor_iva=float(r["valor_iva"] or 0.0),
                    imposto_selo=float(r["imposto_selo"] or 0.0),
                    valor_irs=float(r["valor_irs"] or 0.0),
                    contrib_trabalhador_indep=float(r["contrib_trabalhador_indep"] or 0.0),
                    importancia_recebida=float(r["importancia_recebida"] or 0.0),
                    domicilio_fisc_estab_e=r["domicilio_fisc_estab_e"] or "",
                    ativid_exercida=r["ativid_exercida"] or "",
                    descricao=r["descricao"] or "",
                    desc_taxa_iva=r["desc_taxa_iva"] or "",
                    desc_imp_selo=r["desc_imp_selo"] or "",
                    desc_irs=r["desc_irs"] or "",
                    import_rec_a_tit_de=r["import_rec_a_tit_de"] or "",
                    domic_adquire=r["domic_adquire"] or "",
                    dta_atualiza=r["dta_atualiza"] or "",
                    baixado=r["baixado"] or "",
                    caminho_pdf=r["caminho_pdf"] or "",
                )
                cache_map[doc.id_documento] = doc
    except Exception as e:
        LOGGER.debug(f"Aviso ao carregar cache RV de SQLite ({nif_clean}): {e}")
    return cache_map


def sincronizar_xmls_bdsrv_para_sqlite(ano: int, tipo_code: str, nif_filtro: str = "") -> int:
    """
    Sincroniza automaticamente os ficheiros XML existentes em `BdsRV/<C|V>/<Ano>/<NIF>/`
    para as bases SQLite modernas `BdsefaturaV4/{NIF}/recibos_verdes_{NIF}.db` sempre que
    um XML for novo ou tiver sido modificado no disco.
    """
    if not SCRAPER_RV_DISPONIVEL:
        return 0

    _init_config_rv_db()
    pasta_bdsrv = obter_pasta_bdsrv()
    pasta_pdfs = Path(obter_pasta_pdfs_configurada())
    pasta_ano = pasta_bdsrv / tipo_code.upper() / str(ano)
    if not pasta_ano.exists():
        return 0

    ctrl_db = pb_client.obter_db_controlo_path()
    mtimes_registados: Dict[str, float] = {}
    try:
        with pb_client.db_connect(ctrl_db, timeout=5) as conn:
            c = conn.cursor()
            c.execute("SELECT caminho_xml, mtime FROM rv_xml_sync_log WHERE ano = ? AND tipo_code = ?", (int(ano), tipo_code.upper()))
            for row in c.fetchall():
                mtimes_registados[str(row[0])] = float(row[1] or 0.0)
    except Exception:
        pass

    nif_clean_f = re.sub(r"[^0-9]", "", str(nif_filtro or "")).strip()[:9]
    pastas_nif = [pasta_ano / nif_clean_f] if nif_clean_f else [d for d in pasta_ano.iterdir() if d.is_dir()]

    sincronizados = 0
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for item in pastas_nif:
        if not item.exists() or not item.is_dir():
            continue
        nif_clean = re.sub(r"[^0-9]", "", item.name).strip()[:9]
        if len(nif_clean) != 9:
            continue
        caminho_xml = item / f"{ano}.{nif_clean}.RVerd{tipo_code.upper()}.xml"
        if not caminho_xml.exists():
            continue

        chave_xml = str(caminho_xml)
        try:
            mtime_atual = round(caminho_xml.stat().st_mtime, 3)
        except Exception:
            continue

        db_cli = obter_db_rv_cliente_path(nif_clean)
        if chave_xml in mtimes_registados and abs(mtimes_registados[chave_xml] - mtime_atual) < 0.01 and os.path.exists(db_cli):
            continue

        try:
            lote = carregar_lote_xml(caminho_xml, nif_clean, int(ano), tipo_code.upper())
            gravados = guardar_lote_rv_sqlite(lote, nif_clean, int(ano), tipo_code.upper(), pasta_pdfs=pasta_pdfs)
            with pb_client.db_connect(ctrl_db, timeout=10) as conn:
                conn.execute("""
                    INSERT INTO rv_xml_sync_log (caminho_xml, nif, ano, tipo_code, mtime, docs_sincronizados, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(caminho_xml) DO UPDATE SET
                        mtime = excluded.mtime,
                        docs_sincronizados = excluded.docs_sincronizados,
                        updated_at = excluded.updated_at
                """, (chave_xml, nif_clean, int(ano), tipo_code.upper(), mtime_atual, gravados, now_str))
                conn.commit()
            sincronizados += 1
        except Exception as e:
            LOGGER.warning(f"Erro ao sincronizar XML BdsRV {caminho_xml} para SQLite: {e}")

    return sincronizados


def _listar_nifs_com_db_rv() -> List[str]:
    """Lista todos os NIFs que possuem base SQLite `recibos_verdes_{NIF}.db` em BdsefaturaV4."""
    pasta_v4 = Path(pb_client.obter_pasta_v4())
    if not pasta_v4.exists():
        return []
    nifs = []
    for d in pasta_v4.iterdir():
        if d.is_dir() and d.name.isdigit() and len(d.name) == 9:
            db_f = d / f"recibos_verdes_{d.name}.db"
            if db_f.exists():
                nifs.append(d.name)
    return sorted(nifs)


def obter_matriz_anual_rv(ano: int, tipo: str = "compras", pasta_pdfs_override: Optional[str] = None) -> Dict[str, Any]:
    """
    Retorna a matriz agregada de Recibos Verdes e Recibos de Renda por empresa e por mês (1..12).
    Lê diretamente das bases SQLite modernas (`BdsefaturaV4/{NIF}/recibos_verdes_{NIF}.db`)
    após sincronizar automaticamente quaisquer ficheiros XML em `BdsRV`.
    """
    is_vendas = str(tipo or "compras").strip().lower() in ("vendas", "v", "emitente", "prestador")
    tipo_code = "V" if is_vendas else "C"
    tipo_str = "vendas" if is_vendas else "compras"

    pasta_bdsrv = obter_pasta_bdsrv()
    pasta_pdfs = Path(pasta_pdfs_override or obter_pasta_pdfs_configurada())

    # 1. Garantir que quaisquer XMLs em BdsRV deste ano estão sincronizados na base SQLite
    sincronizar_xmls_bdsrv_para_sqlite(int(ano), tipo_code)

    # 2. Consultar todas as bases SQLite `recibos_verdes_{NIF}.db` em BdsefaturaV4
    empresas: Dict[str, Any] = {}
    nifs_com_db = _listar_nifs_com_db_rv()

    for nif_clean in nifs_com_db:
        db_path = obter_db_rv_cliente_path(nif_clean)
        if not os.path.exists(db_path):
            continue

        meses_dict: Dict[int, Dict[str, Any]] = {}
        total_docs_ano = 0
        total_rv_ano = 0
        total_rendas_ano = 0
        total_rendas_historico = 0
        total_baixados_ano = 0
        total_anulados_ano = 0
        total_base_ano = 0.0
        total_iva_ano = 0.0
        total_irs_ano = 0.0
        total_selo_ano = 0.0
        total_liquido_ano = 0.0
        meses_incompletos = set()
        ultima_atualizacao = ""

        try:
            with pb_client.db_connect(db_path, timeout=5) as conn:
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                c.execute("""
                    SELECT COUNT(*) FROM recibos_verdes_documentos
                    WHERE nif_cliente = ? AND tipo_fluxo = ? AND categoria = 'renda'
                """, (nif_clean, tipo_str))
                row_rr = c.fetchone()
                total_rendas_historico = int(row_rr[0] or 0) if row_rr else 0

                c.execute("""
                    SELECT * FROM recibos_verdes_documentos
                    WHERE nif_cliente = ? AND tipo_fluxo = ? AND ano_efetivo = ?
                """, (nif_clean, tipo_str, int(ano)))
                rows = c.fetchall()

                for r in rows:
                    mes_ef = int(r["mes_efetivo"] or 0)
                    if not (1 <= mes_ef <= 12):
                        continue

                    is_renda = (r["categoria"] == "renda" or r["tipo_doc"] == "RECIBO-RENDA")
                    is_anulado = ("anulado" in str(r["situacao"] or "").lower())
                    if r["dta_atualiza"]:
                        ultima_atualizacao = r["dta_atualiza"]

                    if mes_ef not in meses_dict:
                        meses_dict[mes_ef] = {
                            "docs": 0,
                            "rv": 0,
                            "rendas": 0,
                            "baixados": 0,
                            "anulados": 0,
                            "base": 0.0,
                            "iva": 0.0,
                            "irs": 0.0,
                            "selo": 0.0,
                            "liquido": 0.0,
                            "incompleto": False,
                        }

                    m_entry = meses_dict[mes_ef]
                    m_entry["docs"] += 1
                    total_docs_ano += 1

                    if is_renda:
                        m_entry["rendas"] += 1
                        total_rendas_ano += 1
                    else:
                        m_entry["rv"] += 1
                        total_rv_ano += 1

                    # Verificar se o PDF existe ou se já estava marcado como baixado
                    baixado_flag = str(r["baixado"] or "").strip().lower() == "sim"
                    if not baixado_flag and r["caminho_pdf"] and os.path.exists(r["caminho_pdf"]):
                        baixado_flag = True

                    if baixado_flag:
                        m_entry["baixados"] += 1
                        total_baixados_ano += 1

                    if is_anulado:
                        m_entry["anulados"] += 1
                        total_anulados_ano += 1
                    else:
                        vb = float(r["valor_base"] or 0.0)
                        vi = float(r["valor_iva"] or 0.0)
                        virs = float(r["valor_irs"] or 0.0)
                        vselo = float(r["imposto_selo"] or 0.0)
                        vliq = float(r["importancia_recebida"] or 0.0)

                        m_entry["base"] = round(m_entry["base"] + vb, 2)
                        m_entry["iva"] = round(m_entry["iva"] + vi, 2)
                        m_entry["irs"] = round(m_entry["irs"] + virs, 2)
                        m_entry["selo"] = round(m_entry["selo"] + vselo, 2)
                        m_entry["liquido"] = round(m_entry["liquido"] + vliq, 2)

                        total_base_ano = round(total_base_ano + vb, 2)
                        total_iva_ano = round(total_iva_ano + vi, 2)
                        total_irs_ano = round(total_irs_ano + virs, 2)
                        total_selo_ano = round(total_selo_ano + vselo, 2)
                        total_liquido_ano = round(total_liquido_ano + vliq, 2)

                        if not r["descricao"] and not is_renda:
                            m_entry["incompleto"] = True
                            meses_incompletos.add(mes_ef)
        except Exception as e:
            LOGGER.warning(f"Erro ao ler matriz RV SQLite de {nif_clean}: {e}")
            continue

        caminho_xml = pasta_bdsrv / tipo_code / str(ano) / nif_clean / f"{ano}.{nif_clean}.RVerd{tipo_code}.xml"
        if total_docs_ano > 0 or total_rendas_historico > 0 or caminho_xml.exists():
            empresas[nif_clean] = {
                "meses": meses_dict,
                "total_docs_ano": total_docs_ano,
                "total_rv_ano": total_rv_ano,
                "total_rendas_ano": total_rendas_ano,
                "total_rendas_historico": total_rendas_historico,
                "total_baixados_ano": total_baixados_ano,
                "total_anulados_ano": total_anulados_ano,
                "total_base_ano": total_base_ano,
                "total_iva_ano": total_iva_ano,
                "total_irs_ano": total_irs_ano,
                "total_selo_ano": total_selo_ano,
                "total_liquido_ano": total_liquido_ano,
                "tem_incompletos": len(meses_incompletos) > 0,
                "meses_incompletos": sorted(list(meses_incompletos)),
                "caminho_xml": str(caminho_xml) if caminho_xml.exists() else db_path,
                "caminho_sqlite": db_path,
                "tem_xml_legado": caminho_xml.exists(),
                "ultima_atualizacao": ultima_atualizacao,
            }

    invalidas = pb_client.obter_mapa_senhas_invalidas()

    return {
        "status": "ok",
        "ano": int(ano),
        "tipo": tipo_str,
        "pasta_bdsrv": str(pasta_bdsrv),
        "pasta_v4": str(pb_client.obter_pasta_v4()),
        "pasta_pdfs": str(pasta_pdfs),
        "alimentar_xml_legado": obter_alimentar_xml_legado(),
        "assinatura": "API Importador e-Fatura Gexcel",
        "empresas": empresas,
        "senhas_invalidas": invalidas,
    }


def consultar_documentos_rv(
    tipo: str = "compras",
    nif: str = "",
    ano: int = 2026,
    mes: Optional[int] = None,
    categoria: str = "todos",
    tipo_doc: str = "",
    situacao: str = "",
    apenas_ano_emissao: bool = True,
    pesquisa: str = "",
    limite: int = 250,
    offset: int = 0,
    ordenar_por: str = "dta_emissao",
    ordem: str = "desc"
) -> Dict[str, Any]:
    """
    Consulta detalhada de Recibos Verdes (Fatura-Recibo / Fatura / Recibo) e Recibos de Renda (RECIBO-RENDA)
    a partir das bases SQLite particionadas (`BdsefaturaV4/{NIF}/recibos_verdes_{NIF}.db`).
    """
    is_vendas = str(tipo or "compras").strip().lower() in ("vendas", "v", "emitente", "prestador")
    tipo_code = "V" if is_vendas else "C"
    tipo_str = "vendas" if is_vendas else "compras"
    pasta_pdfs = Path(obter_pasta_pdfs_configurada())

    nif_filtro = re.sub(r"[^0-9]", "", str(nif or "")).strip()[:9]
    sincronizar_xmls_bdsrv_para_sqlite(int(ano), tipo_code, nif_filtro=nif_filtro)

    mapa_nomes_entidades = {
        str(e.get("nif") or "").strip(): str(e.get("nomecli") or "").strip()
        for e in pb_client.get_lista_entidades_ui()
    }

    nifs_alvo = [nif_filtro] if nif_filtro else _listar_nifs_com_db_rv()

    termo = str(pesquisa or "").strip().lower()
    cat_clean = str(categoria or "todos").strip().lower()
    tdoc_clean = str(tipo_doc or "").strip().lower()
    sit_clean = str(situacao or "").strip().lower()

    todos_registos: List[Dict[str, Any]] = []
    total_rv = 0
    total_rendas = 0
    total_anulados = 0
    total_pdfs_baixados = 0
    soma_base = 0.0
    soma_iva = 0.0
    soma_irs = 0.0
    soma_selo = 0.0
    soma_liquido = 0.0

    for n_cli in nifs_alvo:
        db_path = obter_db_rv_cliente_path(n_cli)
        if not os.path.exists(db_path):
            continue
        nome_cli = mapa_nomes_entidades.get(n_cli) or pb_client.get_entidade_nome(n_cli)

        try:
            with pb_client.db_connect(db_path, timeout=5) as conn:
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                if apenas_ano_emissao:
                    c.execute("""
                        SELECT * FROM recibos_verdes_documentos
                        WHERE nif_cliente = ? AND tipo_fluxo = ? AND ano_efetivo = ?
                    """, (n_cli, tipo_str, int(ano)))
                else:
                    c.execute("""
                        SELECT * FROM recibos_verdes_documentos
                        WHERE nif_cliente = ? AND tipo_fluxo = ? AND (ano_efetivo = ? OR ano_xml_origem = ?)
                    """, (n_cli, tipo_str, int(ano), int(ano)))
                rows = c.fetchall()
        except Exception as e:
            LOGGER.warning(f"Erro ao consultar SQLite RV de {n_cli}: {e}")
            continue

        for r in rows:
            ano_ef = int(r["ano_efetivo"] or 0)
            mes_ef = int(r["mes_efetivo"] or 0)
            if mes is not None and int(mes) > 0 and mes_ef != int(mes):
                continue

            is_renda = (r["categoria"] == "renda" or r["tipo_doc"] == "RECIBO-RENDA")
            if cat_clean in ("rv", "recibo_verde", "recibos_verdes") and is_renda:
                continue
            if cat_clean in ("renda", "rendas", "rr", "recibo_renda") and not is_renda:
                continue
            if tdoc_clean and str(r["tipo_doc"] or "").lower() != tdoc_clean:
                continue
            if sit_clean and sit_clean not in str(r["situacao"] or "").lower():
                continue

            d_api = dict(r)
            d_api["nome_cliente"] = nome_cli
            if not d_api.get("dta_emissao") and ano_ef > 1900 and 1 <= mes_ef <= 12:
                d_api["dta_emissao"] = f"{ano_ef:04d}-{mes_ef:02d}-01"

            if termo:
                campos_busca = " ".join([
                    str(d_api.get("id_documento") or ""),
                    str(d_api.get("n_documento") or ""),
                    str(d_api.get("atcud") or ""),
                    str(d_api.get("tipo_doc") or ""),
                    str(d_api.get("contraparte_nif") or ""),
                    str(d_api.get("contraparte_nome") or ""),
                    str(d_api.get("nif_cliente") or ""),
                    str(d_api.get("nome_cliente") or ""),
                    str(d_api.get("descricao") or ""),
                    str(d_api.get("ativid_exercida") or ""),
                ]).lower()
                if termo not in campos_busca:
                    continue

            is_anulado = ("anulado" in str(d_api.get("situacao") or "").lower())
            if is_renda:
                total_rendas += 1
            else:
                total_rv += 1
            if is_anulado:
                total_anulados += 1
            if str(d_api.get("baixado") or "").lower() == "sim":
                total_pdfs_baixados += 1

            if not is_anulado:
                soma_base += float(d_api.get("valor_base") or 0.0)
                soma_iva += float(d_api.get("valor_iva") or 0.0)
                soma_irs += float(d_api.get("valor_irs") or 0.0)
                soma_selo += float(d_api.get("imposto_selo") or 0.0)
                soma_liquido += float(d_api.get("importancia_recebida") or 0.0)

            todos_registos.append(d_api)

    # Ordenação
    reverse_sort = str(ordem or "desc").strip().lower() != "asc"
    col_sort = str(ordenar_por or "dta_emissao").strip()

    def _sort_key(item: Dict[str, Any]):
        val = item.get(col_sort)
        if col_sort in ("valor_base", "valor_iva", "valor_irs", "imposto_selo", "importancia_recebida", "ano_emissao", "mes_emissao"):
            try:
                return float(val or 0.0)
            except Exception:
                return 0.0
        return str(val or "").lower()

    todos_registos.sort(key=_sort_key, reverse=reverse_sort)
    paginados = todos_registos[int(offset): int(offset) + int(limite)]

    return {
        "status": "ok",
        "assinatura": "API Importador e-Fatura Gexcel",
        "tipo": tipo_str,
        "ano": int(ano),
        "mes": mes,
        "pasta_pdfs": str(pasta_pdfs),
        "alimentar_xml_legado": obter_alimentar_xml_legado(),
        "total_documentos": len(todos_registos),
        "total_rv": total_rv,
        "total_rendas": total_rendas,
        "total_anulados": total_anulados,
        "total_pdfs_baixados": total_pdfs_baixados,
        "soma_base": round(soma_base, 2),
        "soma_iva": round(soma_iva, 2),
        "soma_irs": round(soma_irs, 2),
        "soma_selo": round(soma_selo, 2),
        "soma_liquido": round(soma_liquido, 2),
        "linhas": paginados,
    }


def limpar_dados_rv(nif: Optional[str] = None, ano: Optional[int] = None, tipo: str = "ambos") -> int:
    """Elimina registos SQLite (`recibos_verdes_{NIF}.db`) e ficheiros XML `BdsRV` da entidade/ano solicitados."""
    pasta_bdsrv = obter_pasta_bdsrv()
    tipos_cod = ["C", "V"] if str(tipo or "ambos").lower() in ("ambos", "tudo", "all") else (
        ["V"] if str(tipo).lower() in ("vendas", "v") else ["C"]
    )
    nif_clean = re.sub(r"[^0-9]", "", str(nif or "")).strip()[:9] if nif else ""
    apagados = 0

    # 1. Limpar ficheiros XML BdsRV
    for tc in tipos_cod:
        p_tc = pasta_bdsrv / tc
        if not p_tc.exists():
            continue
        anos_dirs = [p_tc / str(ano)] if ano else [d for d in p_tc.iterdir() if d.is_dir()]
        for a_dir in anos_dirs:
            if not a_dir.exists():
                continue
            nifs_dirs = [a_dir / nif_clean] if nif_clean else [d for d in a_dir.iterdir() if d.is_dir()]
            for n_dir in nifs_dirs:
                if not n_dir.exists():
                    continue
                for xml_file in n_dir.glob("*.xml"):
                    try:
                        xml_file.unlink()
                        invalidar_cache_xml(xml_file)
                        apagados += 1
                    except Exception as e:
                        LOGGER.warning(f"Erro ao eliminar {xml_file}: {e}")

    # 2. Limpar registos na base SQLite particionada `recibos_verdes_{NIF}.db`
    nifs_sqlite = [nif_clean] if nif_clean else _listar_nifs_com_db_rv()
    tipos_fluxo = ["compras", "vendas"] if len(tipos_cod) == 2 else (["vendas"] if tipos_cod[0] == "V" else ["compras"])
    for n_sql in nifs_sqlite:
        db_path = obter_db_rv_cliente_path(n_sql)
        if not os.path.exists(db_path):
            continue
        try:
            with pb_client.db_connect(db_path, timeout=10) as conn:
                for tf in tipos_fluxo:
                    if ano:
                        cur = conn.execute(
                            "DELETE FROM recibos_verdes_documentos WHERE nif_cliente = ? AND tipo_fluxo = ? AND (ano_efetivo = ? OR ano_xml_origem = ?)",
                            (n_sql, tf, int(ano), int(ano))
                        )
                    else:
                        cur = conn.execute(
                            "DELETE FROM recibos_verdes_documentos WHERE nif_cliente = ? AND tipo_fluxo = ?",
                            (n_sql, tf)
                        )
                    apagados += max(0, cur.rowcount or 0)
                conn.commit()
        except Exception as e:
            LOGGER.warning(f"Erro ao limpar SQLite RV de {n_sql}: {e}")

    return apagados


def executar_job_recibos_verdes(
    job_id: str,
    jobs_dict: Dict[str, Any],
    concurrency_manager: Any,
    nif: str,
    ano: int,
    tipo: str = "compras",
    incluir_rv: bool = True,
    incluir_rendas: bool = True,
    baixar_pdfs: bool = False,
    pasta_pdfs: Optional[str] = None,
    id_contab: str = "",
    reimportar_tudo: bool = False,
    gerar_xml_legado: Optional[bool] = None,
    apenas_ano_corrente_rendas: bool = False,
    headless: bool = True,
):
    """
    Worker assíncrono para extração de Recibos Verdes e Rendas:
    - Grava SEMPRE na base SQLite moderna (`BdsefaturaV4/{NIF}/recibos_verdes_{NIF}.db`);
    - Se `gerar_xml_legado=True` (padrão), alimenta em simultâneo o XML legado do Gexcel Apps (`BdsRV`);
    - Opcionalmente descarrega os PDFs oficiais de Recibos Verdes e Recibos de Renda.
    """
    nif_clean = re.sub(r"[^0-9]", "", str(nif or "")).strip()[:9]
    is_vendas = str(tipo or "compras").strip().lower() in ("vendas", "v", "emitente", "prestador")
    tipo_code = "V" if is_vendas else "C"

    usar_xml_legado = obter_alimentar_xml_legado() if gerar_xml_legado is None else bool(gerar_xml_legado)

    def _is_cancelled() -> bool:
        j = jobs_dict.get(job_id)
        return bool(not j or j.get("cancelar") or j.get("cancelado") or j.get("status") == "cancelado")

    concurrency_manager.acquire(volume=10, cancel_fn=_is_cancelled)
    _BROWSER_SEMAPHORE.acquire()
    try:
        if _is_cancelled():
            return

        if not SCRAPER_RV_DISPONIVEL:
            raise RuntimeError("O motor SCR-03_Scrap_RecibosVerdes não está disponível.")

        sub, pwd = pb_client.get_credentials(nif_clean)
        if not pwd:
            raise ValueError(f"Sem senha da AT configurada para o NIF {nif_clean}.")

        is_inv, det_inv = pb_client.check_if_password_marked_invalid(nif_clean, pwd)
        if is_inv:
            raise ValueError(f"Senha recusada anteriormente pela AT ({det_inv}). Atualize a senha antes de extrair.")

        login_user = str(sub).strip() if sub and str(sub).strip() else nif_clean
        pasta_bdsrv = obter_pasta_bdsrv()
        pasta_pdfs_final = Path(pasta_pdfs.strip()) if (pasta_pdfs and str(pasta_pdfs).strip()) else Path(obter_pasta_pdfs_configurada())
        if pasta_pdfs and str(pasta_pdfs).strip():
            guardar_pasta_pdfs_configurada(str(pasta_pdfs_final))

        if job_id in jobs_dict:
            jobs_dict[job_id]["status"] = "em_progresso"
            jobs_dict[job_id]["mensagem"] = f"A autenticar no Portal da AT ({login_user})..."
            jobs_dict[job_id]["percentagem"] = 10

        def _on_progress(msg: str, atual: int = 0, total: int = 0):
            if job_id in jobs_dict:
                jobs_dict[job_id]["mensagem"] = msg
                if total > 0:
                    jobs_dict[job_id]["docs_atuais"] = atual
                    jobs_dict[job_id]["total_esperado"] = total
                    jobs_dict[job_id]["percentagem"] = min(95, max(15, int((atual / max(1, total)) * 85) + 10))

        cache_sqlite = {} if reimportar_tudo else carregar_cache_rv_de_sqlite(nif_clean, int(ano), tipo_code)

        lote = extrair_recibos_verdes(
            nif=login_user,
            password=pwd,
            ano=int(ano),
            tipo=tipo_code,
            obter_detalhes=True,
            incluir_rv=bool(incluir_rv),
            incluir_rendas=bool(incluir_rendas),
            apenas_ano_corrente_rendas=bool(apenas_ano_corrente_rendas),
            baixar_pdfs=bool(baixar_pdfs),
            pasta_pdfs=pasta_pdfs_final,
            id_contab=id_contab or "",
            reimportar_tudo=bool(reimportar_tudo),
            gerar_xml_legado=bool(usar_xml_legado),
            cache_externa=cache_sqlite,
            max_workers=6,
            canal="auto",
            headless=bool(headless),
            base_dir_bdsrv=pasta_bdsrv,
            progress_callback=_on_progress,
        )

        # 1. Persistir SEMPRE na base SQLite moderna particionada (BdsefaturaV4/{NIF}/recibos_verdes_{NIF}.db)
        lote.nif_titular = nif_clean
        guardar_lote_rv_sqlite(lote, nif_clean, int(ano), tipo_code, pasta_pdfs=pasta_pdfs_final)

        # 2. Se gerar_xml_legado estiver ativo, garantir que o XML fica gravado sob o NIF da empresa em BdsRV
        caminho_xml_empresa = obter_caminho_xml(nif_clean, int(ano), tipo_code, base_dir=pasta_bdsrv)
        if usar_xml_legado:
            if login_user != nif_clean or not caminho_xml_empresa.exists():
                garantir_diretorio(caminho_xml_empresa)
                salvar_lote_xml(lote, caminho_xml_empresa)
            invalidar_cache_xml(caminho_xml_empresa)

        pb_client.clear_invalid_password_if_success(nif_clean)

        docs_ano = sum(
            1 for d in lote.documentos
            if _determinar_ano_mes_efetivo(d, 0)[0] == int(ano)
        )
        rv_ano = sum(
            1 for d in lote.documentos
            if d.tipo_doc != "RECIBO-RENDA" and _determinar_ano_mes_efetivo(d, 0)[0] == int(ano)
        )
        rr_ano = sum(
            1 for d in lote.documentos
            if d.tipo_doc == "RECIBO-RENDA" and _determinar_ano_mes_efetivo(d, 0)[0] == int(ano)
        )
        pdfs_ok = sum(
            1 for d in lote.documentos
            if str(d.baixado or "").lower() == "sim" and _determinar_ano_mes_efetivo(d, 0)[0] == int(ano)
        )

        if job_id in jobs_dict:
            jobs_dict[job_id]["status"] = "concluido"
            jobs_dict[job_id]["docs_atuais"] = docs_ano
            jobs_dict[job_id]["total_esperado"] = docs_ano
            jobs_dict[job_id]["total_documentos"] = docs_ano
            jobs_dict[job_id]["percentagem"] = 100
            extra_pdf = f" | {pdfs_ok} PDF(s)" if baixar_pdfs else ""
            extra_destino = " [SQLite + XML BdsRV]" if usar_xml_legado else " [SQLite BdsefaturaV4]"
            jobs_dict[job_id]["mensagem"] = f"Concluído: {rv_ano} RV + {rr_ano} Rendas ({docs_ano} docs em {ano}){extra_pdf}{extra_destino}."

    except Exception as e:
        err_msg = str(e)
        LOGGER.error(f"Erro na extração de Recibos Verdes/Rendas ({nif_clean}, {ano}): {err_msg}")
        if not pb_client.is_erro_falso_positivo_at(err_msg) and any(
            k in err_msg.lower()
            for k in (
                "utilizador ou senha",
                "utilizador ou a senha",
                "credenciais inv",
                "credenciais rejeitadas pelo portal",
                "senha inv",
                "password inv",
                "autenticacao invalida",
                "autenticação inválida",
                "erro na autentica",
            )
        ):
            try:
                _, pwd_curr = pb_client.get_credentials(nif_clean)
                if pwd_curr:
                    pb_client.record_invalid_password(nif_clean, pwd_curr, err_msg[:200])
            except Exception:
                pass
        if job_id in jobs_dict:
            jobs_dict[job_id]["status"] = "erro"
            jobs_dict[job_id]["erro"] = err_msg
            jobs_dict[job_id]["mensagem"] = f"Erro: {err_msg}"
    finally:
        try:
            _BROWSER_SEMAPHORE.release()
        except Exception:
            pass
        concurrency_manager.release()
