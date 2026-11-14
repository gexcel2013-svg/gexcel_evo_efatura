# -*- coding: utf-8 -*-
"""
Módulo Cofre Permanente de Estados (Ledger Forense de Faturas).
Ecossistema Gexcel EVO — Localizado fora de pb_data em:
%LOCALAPPDATA%\\GexcelApps\\.vault\\efatura_estados_ledger.db

Garante que 100% das faturas importadas pela API (em memória, SQLite ou XML)
registam o seu estado de forma imutável e detetam anulações tardias (inconformidades).
"""
import logging
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any, Union, Tuple

LOGGER = logging.getLogger("gexcel.efatura.vault")
_COFRE_SCHEMA_LOCK = threading.Lock()
_COFRE_SCHEMA_READY = set()


def resolver_pasta_vault() -> Path:
    """
    Localiza ou cria a pasta oficial do Cofre permanente do Ecossistema Gexcel:
    %LOCALAPPDATA%\\GexcelApps\\.vault
    """
    localapp = os.environ.get("LOCALAPPDATA")
    vault = (Path(localapp) if localapp else Path.home() / "AppData" / "Local") / "GexcelApps" / ".vault"
    try:
        vault.mkdir(parents=True, exist_ok=True)
        return vault.resolve()
    except Exception as e:
        LOGGER.warning(f"Aviso ao resolver pasta vault padrão: {e}. Usando fallback local.")
        fallback = Path(__file__).parent.resolve() / ".vault"
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback.resolve()


def obter_caminho_ledger(db_path: Optional[Union[str, Path]] = None) -> Path:
    """Retorna o caminho seguro para efatura_estados_ledger.db."""
    if db_path:
        return Path(db_path).resolve()
    return resolver_pasta_vault() / "efatura_estados_ledger.db"


class CofreEstadosLedger:
    """
    Cofre permanente e imutável de estados de faturas (Ledger Forense).
    Localizado fora das bases operacionais e fora das pastas de projeto:
    %LOCALAPPDATA%\\GexcelApps\\.vault\\efatura_estados_ledger.db

    Guarda o estado de cada fatura no momento exato em que a máquina a lê pela 1.ª vez
    e deteta alterações à posteriori (ex: REGISTADA -> ANULADA).
    """

    def __init__(self, db_path: Optional[Union[str, Path]] = None):
        self.db_path = obter_caminho_ledger(db_path)
        self._inicializar()

    def _inicializar(self):
        """Garante a estrutura SQLite ultra-compacta (~40 bytes por fatura)."""
        db_key = str(self.db_path)
        if db_key in _COFRE_SCHEMA_READY and self.db_path.exists():
            return
        with _COFRE_SCHEMA_LOCK:
            if db_key in _COFRE_SCHEMA_READY and self.db_path.exists():
                return
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                with sqlite3.connect(self.db_path, timeout=30) as conn:
                    conn.execute("PRAGMA journal_mode = WAL;")
                    conn.execute("PRAGMA synchronous = NORMAL;")
                    c = conn.cursor()

                    # 1. Registo cumulativo de 100% das faturas lidas pela aplicação
                    c.execute("""
                    CREATE TABLE IF NOT EXISTS `efatura_ledger_estados` (
                        `id_fatura_unico` TEXT PRIMARY KEY,
                        `nif_cliente` TEXT NOT NULL,
                        `estado` TEXT NOT NULL,          -- 'N' (Normal/Registada) ou 'A' (Anulada)
                        `data_extracao` TEXT NOT NULL    -- YYYY-MM-DD HH:MM:SS
                    );
                    """)
                    c.execute("CREATE INDEX IF NOT EXISTS `idx_ledger_nif` ON `efatura_ledger_estados` (`nif_cliente`);")

                    # 2. Livro de Inconformidades (apenas faturas que mudaram de Normal para Anulada)
                    c.execute("""
                    CREATE TABLE IF NOT EXISTS `efatura_inconformidades` (
                        `id_fatura_unico` TEXT PRIMARY KEY,
                        `nif_cliente` TEXT NOT NULL,
                        `data_registo_inicial` TEXT NOT NULL,
                        `data_anulacao_detetada` TEXT NOT NULL
                    );
                    """)
                    c.execute("CREATE INDEX IF NOT EXISTS `idx_inconf_nif` ON `efatura_inconformidades` (`nif_cliente`);")
                    conn.commit()
                _COFRE_SCHEMA_READY.add(db_key)
            except Exception as e:
                LOGGER.error(f"Erro ao inicializar efatura_estados_ledger.db em {self.db_path}: {e}")

    def registar_e_confrontar(
        self,
        documentos_ou_linhas: List[Any],
        nif_titular: str
    ) -> List[Dict[str, Any]]:
        """
        Regista no cofre todas as faturas lidas e deteta instantaneamente se alguma
        fatura que antes estava 'N' agora passou a 'A'.
        Retorna a lista de novas inconformidades detetadas.
        """
        if not documentos_ou_linhas:
            return []

        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        novas_inconformidades: List[Dict[str, Any]] = []
        mapa_docs: Dict[str, Tuple[str, str]] = {}

        # Normalizar items para pares (id_fatura_unico, nif_cliente, estado)
        for item in documentos_ou_linhas:
            if isinstance(item, dict):
                chave = (
                    item.get("id_fatura_unico")
                    or item.get("IdDocumento")
                    or item.get("ID Fatura Único (Core BD)")
                    or ""
                )
                if not chave and (item.get("Fatura") or item.get("fatura") or item.get("Nº Documento") or item.get("numero_documento")):
                    import pb_client
                    fat_no = str(item.get("Fatura") or item.get("fatura") or item.get("Nº Documento") or item.get("numero_documento") or "").strip()
                    tot_v = float(item.get("Total Documento") or item.get("total_doc") or item.get("Valor Total (€)") or item.get("valor_total") or 0.0)
                    atcud = str(item.get("ATCUD") or item.get("atcud") or "").strip()
                    nif_cli_cand = str(item.get("nif_cliente") or item.get("NIF Cliente") or item.get("NIF EntidadeEfatura") or nif_titular or "").strip()
                    cp_nif = str(item.get("Contraparte NIF") or item.get("contraparte_nif") or item.get("NIF Emitente") or item.get("nif_emitente") or "").strip()
                    is_vendas = ("venda" in str(item.get("tipo_fluxo", "")).lower()) or (not cp_nif or cp_nif == nif_cli_cand)
                    prefixo = "V" if is_vendas else "C"
                    emissor = nif_cli_cand if is_vendas else (cp_nif or nif_cli_cand)
                    chave = pb_client.gerar_chave_documento(
                        nif=emissor,
                        fatura=fat_no,
                        total_doc=tot_v,
                        atcud=atcud,
                        prefixo=prefixo
                    )

                if not chave or chave == "TotalDocs:":
                    continue

                nif_cli = (
                    item.get("nif_cliente")
                    or item.get("NIF Cliente")
                    or item.get("NIF EntidadeEfatura")
                    or nif_titular
                    or ""
                )
                sit = str(
                    item.get("estado_documento")
                    or item.get("Estado Documento")
                    or item.get("situacao_documento")
                    or item.get("Situação Documento")
                    or item.get("Situação")
                    or "REGISTADA"
                ).strip().upper()
                est = "A" if ("ANULAD" in sit or sit == "A") else "N"

            elif hasattr(item, "id_fatura_unico"):
                chave = getattr(item, "id_fatura_unico", "") or ""
                if not chave:
                    continue
                nif_cli = (
                    getattr(item, "nif_cliente", None)
                    or getattr(item, "nif_adquirente", None)
                    or getattr(item, "nif_emitente", None)
                    or nif_titular
                    or ""
                )
                sit = str(
                    getattr(item, "situacao_documento", None)
                    or getattr(item, "estado_documento", None)
                    or "REGISTADA"
                ).strip().upper()
                est = "A" if ("ANULAD" in sit or sit == "A") else "N"

            elif hasattr(item, "InvoiceNo"):
                # Objeto de Fatura original AT Zeep
                import pb_client
                inv_no = getattr(item, "InvoiceNo", "") or ""
                doc_status = getattr(item, "DocumentStatus", "") or ""
                atcud = getattr(item, "ATCUD", "") or ""
                gross_tot = float(getattr(item, "GrossTotal", 0.0) or 0.0)
                nif_cli = str(nif_titular or "").strip()
                tax_reg = getattr(item, "TaxRegistrationNumber", None)
                cust_tax = getattr(item, "CustomerTaxID", None)
                nif_emissor = str(tax_reg or cust_tax or nif_cli).strip()

                chave = pb_client.gerar_chave_documento(
                    nif=nif_emissor,
                    fatura=inv_no,
                    total_doc=gross_tot,
                    atcud=atcud,
                    prefixo="C" if tax_reg else "V"
                )
                est = "A" if str(doc_status).upper() in ("A", "ANULADO") else "N"

            else:
                continue

            if chave and chave not in mapa_docs:
                mapa_docs[chave] = (str(nif_cli).strip(), est)

        if not mapa_docs:
            return []

        try:
            with sqlite3.connect(self.db_path, timeout=30) as conn:
                c = conn.cursor()
                chaves_lista = list(mapa_docs.keys())
                existentes: Dict[str, Tuple[str, str]] = {}
                for idx in range(0, len(chaves_lista), 400):
                    lote_ids = chaves_lista[idx:idx + 400]
                    placeholders = ",".join("?" for _ in lote_ids)
                    c.execute(
                        f"SELECT id_fatura_unico, estado, data_extracao FROM efatura_ledger_estados WHERE id_fatura_unico IN ({placeholders})",
                        lote_ids,
                    )
                    for r_id, r_est, r_dt in c.fetchall():
                        existentes[r_id] = (r_est, r_dt)

                novos_inserir = []
                atualizar_a = []
                inconf_inserir = []

                for chave, (nif_cli, est_novo) in mapa_docs.items():
                    row = existentes.get(chave)
                    if not row:
                        # 1. Primeira vez que a máquina vê esta fatura: regista estado inicial
                        novos_inserir.append((chave, nif_cli, est_novo, now_str))
                    else:
                        estado_antigo, data_antiga = row[0], row[1]
                        # 2. Ponto Crítico: se estava 'N' (Normal/Registada) e agora vem 'A' (Anulada)
                        if estado_antigo == "N" and est_novo == "A":
                            atualizar_a.append((chave,))
                            inconf_inserir.append((chave, nif_cli, data_antiga, now_str))
                            inconf_item = {
                                "id_fatura_unico": chave,
                                "nif_cliente": nif_cli,
                                "data_registo_inicial": data_antiga,
                                "data_anulacao_detetada": now_str
                            }
                            novas_inconformidades.append(inconf_item)
                            LOGGER.warning(
                                f"🚨 [COFRE AUDITORIA] Inconformidade! Fatura {chave} (Cliente {nif_cli}) "
                                f"registada em {data_antiga} foi ANULADA à posteriori em {now_str}!"
                            )

                if novos_inserir:
                    c.executemany("""
                        INSERT OR IGNORE INTO efatura_ledger_estados (id_fatura_unico, nif_cliente, estado, data_extracao)
                        VALUES (?, ?, ?, ?)
                    """, novos_inserir)
                if atualizar_a:
                    c.executemany(
                        "UPDATE efatura_ledger_estados SET estado = 'A' WHERE id_fatura_unico = ?",
                        atualizar_a,
                    )
                if inconf_inserir:
                    c.executemany("""
                        INSERT OR IGNORE INTO efatura_inconformidades (
                            id_fatura_unico, nif_cliente, data_registo_inicial, data_anulacao_detetada
                        ) VALUES (?, ?, ?, ?)
                    """, inconf_inserir)

                conn.commit()
        except Exception as e:
            LOGGER.error(f"Erro ao registar/confrontar faturas no Cofre Ledger: {e}")

        return novas_inconformidades

    registar_lote_faturas = registar_e_confrontar

    def obter_inconformidades(self, nif_cliente: Optional[str] = None) -> List[Dict[str, Any]]:
        """Devolve todas as inconformidades registadas no Cofre permanente."""
        try:
            with sqlite3.connect(self.db_path, timeout=10) as conn:
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                if nif_cliente:
                    c.execute("""
                        SELECT * FROM efatura_inconformidades 
                        WHERE nif_cliente = ? 
                        ORDER BY data_anulacao_detetada DESC
                    """, (str(nif_cliente).strip(),))
                else:
                    c.execute("SELECT * FROM efatura_inconformidades ORDER BY data_anulacao_detetada DESC")
                return [dict(r) for r in c.fetchall()]
        except Exception as e:
            LOGGER.error(f"Erro ao obter inconformidades do Cofre Ledger: {e}")
            return []

    def total_faturas_registadas(self, nif_cliente: Optional[str] = None) -> int:
        """Devolve o total de faturas catalogadas no Cofre Ledger."""
        try:
            with sqlite3.connect(self.db_path, timeout=10) as conn:
                c = conn.cursor()
                if nif_cliente:
                    c.execute("SELECT COUNT(*) FROM efatura_ledger_estados WHERE nif_cliente = ?", (str(nif_cliente).strip(),))
                else:
                    c.execute("SELECT COUNT(*) FROM efatura_ledger_estados")
                return c.fetchone()[0]
        except Exception as e:
            LOGGER.error(f"Erro ao contar faturas no Cofre Ledger: {e}")
            return 0

    def expurgar_antigas(self, anos_retencao: int = 5, data_limite: Optional[str] = None) -> Tuple[int, int]:
        """
        Purga registos com mais de X anos (padrão 5 anos) ou anteriores a data_limite.
        Garante que o cofre nunca se expande indefinidamente.
        Retorna (ledger_removidos, inconformidades_removidas).
        """
        if not data_limite:
            ano_corte = datetime.now().year - anos_retencao
            data_limite = f"{ano_corte}-01-01"

        try:
            with sqlite3.connect(self.db_path, timeout=10) as conn:
                c = conn.cursor()
                c.execute("DELETE FROM efatura_ledger_estados WHERE data_extracao < ?", (data_limite,))
                rem_ledger = c.rowcount
                c.execute("DELETE FROM efatura_inconformidades WHERE data_anulacao_detetada < ?", (data_limite,))
                rem_inconf = c.rowcount
                conn.commit()
                LOGGER.info(
                    f"🧹 [COFRE PURGA] Removidos registos anteriores a {data_limite}: "
                    f"{rem_ledger} estados, {rem_inconf} inconformidades."
                )
                return rem_ledger, rem_inconf
        except Exception as e:
            LOGGER.error(f"Erro ao expurgar registos antigos do Cofre Ledger: {e}")
            return 0, 0
