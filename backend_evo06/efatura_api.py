from zeep.exceptions import Fault
import os
import re
import sys
from calendar import monthrange
from datetime import date, datetime, timedelta
import time
from lxml import etree
from zeep import Client, Plugin, Settings
from zeep.transports import Transport
from requests import Session
import crypto_utils
import secure_vault
import logging
import json
import threading
import concurrent.futures
from dotenv import load_dotenv
import legado_bridge

# Load environment variables
load_dotenv()

LOGGER = logging.getLogger("efatura_api")

BASE_DIR = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
FATSHARE_NAMESPACE = "http://factemi.at.min_financas.pt/fatshareInvoices"
FATSHARE_BINDING = f"{{{FATSHARE_NAMESPACE}}}fatshareInvoicesPortSoap11"
PRODUCTION_ENDPOINT = (
    "https://servicos.portaldasfinancas.gov.pt:425/"
    "fatshare/ws/fatshareFaturas"
)
TEST_ENDPOINT = (
    "https://servicos.portaldasfinancas.gov.pt:725/"
    "fatshare/ws/fatshareFaturas"
)
SUCCESS_CODE = 200
EMPTY_RESULT_CODE = 486


class ATAPIError(RuntimeError):
    """Erro funcional devolvido pelo webservice da AT."""

    def __init__(self, code, description):
        self.code = code
        self.description = description
        super().__init__(f"AT {code}: {description}")

class LimiteVolumeExcedidoError(RuntimeError):
    """Lançada quando a entidade ultrapassa o limite seguro de documentos para processamento nesta versão."""
    pass

class ATWSSecurityPlugin(Plugin):
    def __init__(self, nif_subuser, password, cert_path):
        self.nif_subuser = nif_subuser
        self.password = password
        self.cert_path = cert_path

    def egress(self, envelope, http_headers, operation, binding_options):
        # Generate the cryptographic values
        crypto_data = crypto_utils.generate_ws_security_header_data(
            self.cert_path, self.nif_subuser, self.password
        )

        # Namespaces defined by AT
        S = "http://schemas.xmlsoap.org/soap/envelope/"
        wss = "http://schemas.xmlsoap.org/ws/2002/12/secext"
        at_ns = "http://at.pt/wsp/auth"

        # Create Header element if not exists
        header = envelope.find(f"{{{S}}}Header")
        if header is None:
            header = etree.Element(f"{{{S}}}Header")
            envelope.insert(0, header)
        
        # Define namespaces map for the new elements
        nsmap = {'wss': wss, 'at': at_ns, 'S': S}
        
        # Create Security element
        security = etree.Element(f"{{{wss}}}Security", nsmap=nsmap)
        security.set(f"{{{S}}}Actor", "http://at.pt/actor/SPA")
        security.set(f"{{{at_ns}}}Version", "2")
        header.append(security)

        # UsernameToken
        username_token = etree.SubElement(security, f"{{{wss}}}UsernameToken")
        
        # Username
        username_el = etree.SubElement(username_token, f"{{{wss}}}Username")
        username_el.text = crypto_data["Username"]
        
        # Password
        password_el = etree.SubElement(username_token, f"{{{wss}}}Password")
        password_el.set("Digest", crypto_data["Digest"])
        password_el.text = crypto_data["Password"]
        
        # Nonce
        nonce_el = etree.SubElement(username_token, f"{{{wss}}}Nonce")
        nonce_el.text = crypto_data["Nonce"]
        
        # Created
        created_el = etree.SubElement(username_token, f"{{{wss}}}Created")
        created_el.text = crypto_data["Created"]

        return envelope, http_headers

def get_at_client(nif_subuser, password, pem_path=None, endpoint=None):
    # A Chave Pública da AT para encriptar a mensagem
    cert_path = os.path.join(BASE_DIR, "certs/ChaveCifraPublicaAT2027/Chave Cifra Publica AT 2027.cer")
    
    # Se pem_path não foi fornecido, verifica se existe localmente ou no cofre
    if not pem_path or not os.path.exists(pem_path):
        dev_pem = os.path.join(BASE_DIR, "certs/200685341_producao_full.pem").replace('\\', '/')
        if os.path.exists(dev_pem):
            pem_path = dev_pem
        else:
            raise FileNotFoundError(f"Certificado de Produtor de Software em falta ou não inicializado pelo cofre.")
    
    # URL local para o WSDL
    from pathlib import Path
    wsdl_path = Path(BASE_DIR) / "docs" / "fatshareInvoices.wsdl.txt"
    wsdl_url = wsdl_path.resolve().as_uri()

    # Plugin de WS-Security customizado
    security_plugin = ATWSSecurityPlugin(nif_subuser, password, cert_path)

    session = Session()
    session.cert = pem_path
    session.verify = True

    transport = Transport(session=session, operation_timeout=60)
    client_settings = Settings(strict=False, xml_huge_tree=True)
    client = Client(
        wsdl=wsdl_url,
        transport=transport,
        plugins=[security_plugin],
        settings=client_settings
    )

    service_endpoint = endpoint or os.getenv("AT_EFATURA_ENDPOINT", PRODUCTION_ENDPOINT)
    
    service = client.create_service(
        FATSHARE_BINDING,
        service_endpoint
    )

    return service


def _normalise_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value)
    raise TypeError("A data deve ser date, datetime ou texto ISO YYYY-MM-DD.")


def iter_month_periods(start_date, end_date):
    """Divide um intervalo em períodos que nunca atravessam um mês civil."""
    start_date = _normalise_date(start_date)
    end_date = _normalise_date(end_date)

    if start_date > end_date:
        raise ValueError("A data inicial não pode ser posterior à data final.")

    current = start_date
    while current <= end_date:
        last_day = monthrange(current.year, current.month)[1]
        period_end = min(date(current.year, current.month, last_day), end_date)
        yield current, period_end
        current = date.fromordinal(period_end.toordinal() + 1)


def dividir_periodo_em_blocos(start_date, end_date, dias_bloco=5):
    """
    Subdivide um intervalo civil em blocos compactos de N dias (padrão 5 dias).
    Permite aos clientes de grande densidade (postos de combustível, retalho) consultar e
    descarregar centenas de milhares de documentos sem provocar timeouts no backend da AT.
    """
    blocos = []
    atual = _normalise_date(start_date)
    fim_global = _normalise_date(end_date)
    while atual <= fim_global:
        fim_bloco = min(atual + timedelta(days=dias_bloco - 1), fim_global)
        blocos.append((atual, fim_bloco))
        atual = fim_bloco + timedelta(days=1)
    return blocos


def aferir_alta_densidade(service, nif, p_start, p_end, as_buyer):
    """
    Sondagem relâmpago de densidade fiscal (amostragem cirúrgica de 1 dia na AT, ~250ms).
    Se detetar >= 300 documentos num único dia, classifica a entidade como Alta Densidade.
    """
    p_start = _normalise_date(p_start)
    p_end = _normalise_date(p_end)

    if (p_end - p_start).days < 5:
        return False

    # 1. Testar o primeiro dia do período
    try:
        resp = _request_page(service, nif, p_start, p_start, as_buyer, page=1, page_size=1)
        code, _ = _get_status(resp)
        if code == SUCCESS_CODE:
            pag = getattr(getattr(resp, "InvoicesList", None), "PaginationTotal", None)
            total_dia = int(getattr(pag, "totalDocs", 0) or 0)
            if total_dia >= 300:
                return True
            elif total_dia > 0:
                return False
    except Exception:
        pass

    # 2. Se o dia 1 deu 0 e o período tem pelo menos 3 dias (ex: feriado/domingo fechado), testa um dia útil
    dias_totais = (p_end - p_start).days
    if dias_totais >= 3:
        dia_teste = p_start + timedelta(days=min(3, dias_totais // 2))
        try:
            resp = _request_page(service, nif, dia_teste, dia_teste, as_buyer, page=1, page_size=1)
            code, _ = _get_status(resp)
            if code == SUCCESS_CODE:
                pag = getattr(getattr(resp, "InvoicesList", None), "PaginationTotal", None)
                total_dia = int(getattr(pag, "totalDocs", 0) or 0)
                if total_dia >= 300:
                    return True
        except Exception:
            pass

    return False


def _get_status(response):
    status = getattr(response, "estadoExecucao", None)
    return (
        getattr(status, "EstadoOperacao", None),
        getattr(status, "Desc", "Resposta sem descrição."),
    )


def _is_transient_at_fault(fault_exc) -> bool:
    msg = str(getattr(fault_exc, "message", None) or fault_exc or "").lower()
    return any(term in msg for term in [
        "falha comunicacao", "falha de comunicacao", "(500)", "500", "timeout",
        "indisponivel", "indisponível", "servico", "serviço", "internal server error"
    ])


def _request_page(service, nif, start_date, end_date, as_buyer, page, page_size):
    request_data = {
        "StartDate": start_date,
        "EndDate": end_date,
        "Pagination": {"nPage": page, "nDocsPage": page_size},
    }
    if as_buyer:
        request_data["CustomerTaxID"] = int(nif)
    else:
        request_data["TaxRegistrationNumber"] = int(nif)
    
    # Se for consulta pesada de período longo (> 5 dias com page_size > 1), faz apenas 1 retry rápido
    # para permitir que _fetch_adaptive_tracker subdivida imediatamente o intervalo em blocos menores.
    dias_span = (_normalise_date(end_date) - _normalise_date(start_date)).days
    max_retries = 1 if (dias_span > 5 and page_size > 1) else 3
    for attempt in range(max_retries + 1):
        try:
            return service.Invoices(**request_data)
        except Fault as f:
            msg = str(f.message or f or "")
            if _is_transient_at_fault(f) and attempt < max_retries:
                wait_s = 1.5 * (attempt + 1)
                LOGGER.warning(f"AT Fault temporário na pág {page} ({msg}). A tentar novamente em {wait_s}s (tentativa {attempt+1}/{max_retries})...")
                time.sleep(wait_s)
                continue
            raise
        except Exception as e:
            err_str = str(e).lower()
            if any(term in err_str for term in ["timeout", "connection", "reset", "closed", "remote end", "502", "503", "504"]) and attempt < max_retries:
                wait_s = 2.0 * (attempt + 1)
                LOGGER.warning(f"Falha de rede/timeout na pág {page} ({e}). A tentar novamente em {wait_s}s (tentativa {attempt+1}/{max_retries})...")
                time.sleep(wait_s)
                continue
            raise


def _notify_progress(cb, msg, docs=None, total=None, mes=None, ano=None):
    """Notifica progresso com suporte a metadados numéricos de documentos."""
    if not cb:
        return
    try:
        cb(msg, docs_atuais=docs, total_docs=total, mes=mes, ano=ano)
    except TypeError:
        try:
            cb(msg, docs_atuais=docs, total_docs=total)
        except TypeError:
            try:
                cb(msg)
            except Exception:
                pass

class GlobalProgressTracker:
    """Rastreador de progresso contínuo e estritamente monótono para o lote total de documentos."""
    def __init__(self, callback, cancel_check=None, initial_docs=0, as_buyer=True):
        self.callback = callback
        self.cancel_check = cancel_check
        self.grand_total = 0
        self.docs_downloaded = initial_docs
        self.as_buyer = as_buyer
        self.current_month = None
        self.current_year = None
        self._lock = threading.Lock()

    def set_current_period(self, year, month):
        with self._lock:
            self.current_year = year
            self.current_month = month

    def set_grand_total(self, total):
        with self._lock:
            self.grand_total = max(self.grand_total, total)
            if self.callback:
                tipo_str = "compras" if self.as_buyer else "vendas"
                period_tag = f" - Mês {self.current_month:02d}/{self.current_year}" if self.current_month and self.current_year else ""
                if self.docs_downloaded > 0:
                    msg = f"A retomar faturas de {tipo_str}{period_tag} ({self.docs_downloaded:,} de {self.grand_total:,} já na BD)...".replace(",", ".")
                else:
                    msg = f"A recolher faturas de {tipo_str}{period_tag} (0 de {self.grand_total:,})...".replace(",", ".")
                _notify_progress(self.callback, msg, docs=self.docs_downloaded, total=self.grand_total, mes=self.current_month, ano=self.current_year)

    def add_page(self, count):
        with self._lock:
            self.docs_downloaded += count
            if self.callback:
                total_ref = max(self.grand_total, self.docs_downloaded)
                tipo_str = "compras" if self.as_buyer else "vendas"
                period_tag = f" - Mês {self.current_month:02d}/{self.current_year}" if self.current_month and self.current_year else ""
                msg = f"A recolher faturas de {tipo_str}{period_tag} ({self.docs_downloaded:,} de {total_ref:,})...".replace(",", ".")
                _notify_progress(self.callback, msg, docs=self.docs_downloaded, total=total_ref, mes=self.current_month, ano=self.current_year)

    def add_delta(self, delta):
        if delta <= 0:
            return
        with self._lock:
            self.docs_downloaded += delta
            if self.grand_total > 0:
                self.docs_downloaded = min(self.grand_total, self.docs_downloaded)
            if self.callback:
                total_ref = max(self.grand_total, self.docs_downloaded)
                tipo_str = "compras" if self.as_buyer else "vendas"
                period_tag = f" - Mês {self.current_month:02d}/{self.current_year}" if self.current_month and self.current_year else ""
                msg = f"A recolher faturas de {tipo_str}{period_tag} ({self.docs_downloaded:,} de {total_ref:,})...".replace(",", ".")
                _notify_progress(self.callback, msg, docs=self.docs_downloaded, total=total_ref, mes=self.current_month, ano=self.current_year)

    def notify_interrupted(self):
        with self._lock:
            if self.callback:
                total_ref = max(self.grand_total, self.docs_downloaded)
                tipo_str = "compras" if self.as_buyer else "vendas"
                period_tag = f" - Mês {self.current_month:02d}/{self.current_year}" if self.current_month and self.current_year else ""
                msg = f"Interrompido{period_tag} ({self.docs_downloaded:,} de {total_ref:,} faturas de {tipo_str} salvas)".replace(",", ".")
                _notify_progress(self.callback, msg, docs=self.docs_downloaded, total=total_ref, mes=self.current_month, ano=self.current_year)

def _fetch_adaptive_tracker(
    service, nif, start, end, as_buyer, tracker,
    known_total=None, max_docs_per_chunk=3500, cancel_check=None,
    start_page=1, on_page_fetched=None, max_page=None, fetched_counter=None
):
    if cancel_check and cancel_check():
        return []

    # 1. Batedor se o total deste período ainda não é conhecido (known_total < 0 indica sub-bloco direto sem scout extra)
    total_docs = known_total
    if total_docs is None:
        try:
            response = _request_page(service, nif, start, end, as_buyer, page=1, page_size=1)
            code, description = _get_status(response)
            if code == EMPTY_RESULT_CODE:
                return []
            if code != SUCCESS_CODE:
                raise ATAPIError(code, description)
            invoice_list = getattr(response, "InvoicesList", None)
            pagination = getattr(invoice_list, "PaginationTotal", None)
            total_docs = int(getattr(pagination, "totalDocs", 0) or 0)
        except ATAPIError:
            raise
        except Fault as f:
            if _is_transient_at_fault(f) and start != end and start_page == 1:
                mid = start + timedelta(days=(end - start).days // 2)
                invs1 = _fetch_adaptive_tracker(service, nif, start, mid, as_buyer, tracker, None, max_docs_per_chunk, cancel_check, start_page=1, on_page_fetched=on_page_fetched, fetched_counter=fetched_counter)
                if cancel_check and cancel_check():
                    return invs1
                invs2 = _fetch_adaptive_tracker(service, nif, mid + timedelta(days=1), end, as_buyer, tracker, None, max_docs_per_chunk, cancel_check, start_page=1, on_page_fetched=on_page_fetched, fetched_counter=fetched_counter)
                return invs1 + invs2
            raise
        except Exception:
            if start != end and start_page == 1:
                mid = start + timedelta(days=(end - start).days // 2)
                invs1 = _fetch_adaptive_tracker(service, nif, start, mid, as_buyer, tracker, None, max_docs_per_chunk, cancel_check, start_page=1, on_page_fetched=on_page_fetched, fetched_counter=fetched_counter)
                if cancel_check and cancel_check():
                    return invs1
                invs2 = _fetch_adaptive_tracker(service, nif, mid + timedelta(days=1), end, as_buyer, tracker, None, max_docs_per_chunk, cancel_check, start_page=1, on_page_fetched=on_page_fetched, fetched_counter=fetched_counter)
                return invs1 + invs2
            return []

    if cancel_check and cancel_check():
        return []

    if total_docs == 0:
        return []

    # 2. Se o bloco for superior ao limite seguro da AT e começar na página 1, subdivide
    # Nota: se start_page > 1 (retoma incremental), não subdividimos por data pois a paginação é global ao mês.
    if start_page == 1 and total_docs > 0 and total_docs > max_docs_per_chunk and start != end:
        mid = start + timedelta(days=(end - start).days // 2)
        invs1 = _fetch_adaptive_tracker(service, nif, start, mid, as_buyer, tracker, None, max_docs_per_chunk, cancel_check, start_page=1, on_page_fetched=on_page_fetched, fetched_counter=fetched_counter)
        if cancel_check and cancel_check():
            return invs1
        invs2 = _fetch_adaptive_tracker(service, nif, mid + timedelta(days=1), end, as_buyer, tracker, None, max_docs_per_chunk, cancel_check, start_page=1, on_page_fetched=on_page_fetched, fetched_counter=fetched_counter)
        return invs1 + invs2

    # 3. Extração real das páginas deste bloco a partir de start_page
    invoices = []
    page = start_page
    page_size = 500

    while True:
        if cancel_check and cancel_check():
            break

        try:
            response = _request_page(service, nif, start, end, as_buyer, page, page_size)
            code, description = _get_status(response)
            if code == EMPTY_RESULT_CODE:
                break
            if code != SUCCESS_CODE:
                raise ATAPIError(code, description)

            invoice_list = getattr(response, "InvoicesList", None)
            page_invoices = getattr(invoice_list, "Invoice", None) or []
            if fetched_counter is not None:
                fetched_counter[0] += len(page_invoices)

            if on_page_fetched:
                if page_invoices:
                    try:
                        on_page_fetched(page_invoices)
                    except Exception as ope:
                        LOGGER.error(f"Erro no callback on_page_fetched: {ope}")
            elif page_invoices:
                invoices.extend(page_invoices)

            if tracker:
                tracker.add_page(len(page_invoices))

            pagination = getattr(invoice_list, "PaginationTotal", None)
            total_pages = int(getattr(pagination, "totalPages", 1) or 1)
            if page >= total_pages or (max_page is not None and page >= max_page):
                break
            page += 1
            time.sleep(0.05)

        except ATAPIError:
            raise
        except Exception as e:
            if isinstance(e, Fault) and not _is_transient_at_fault(e):
                raise
            if start == end:
                if page_size > 100 and page == 1:
                    page_size = page_size // 2
                    time.sleep(1)
                    continue
                elif isinstance(e, Fault):
                    raise
                else:
                    raise Exception(f"Erro irreversível no dia {start}. Falhou mesmo com blocos de {page_size} faturas.") from e
            elif start_page == 1 and page == 1:
                LOGGER.warning(
                    f"⚠️ Subdivisão adaptativa ativada em {start}..{end} após falha ({e}). A dividir intervalo ao meio..."
                )
                mid = start + timedelta(days=(end - start).days // 2)
                invs1 = _fetch_adaptive_tracker(service, nif, start, mid, as_buyer, tracker, None, max_docs_per_chunk, cancel_check, start_page=1, on_page_fetched=on_page_fetched, fetched_counter=fetched_counter)
                if cancel_check and cancel_check():
                    return invs1
                invs2 = _fetch_adaptive_tracker(service, nif, mid + timedelta(days=1), end, as_buyer, tracker, None, max_docs_per_chunk, cancel_check, start_page=1, on_page_fetched=on_page_fetched, fetched_counter=fetched_counter)
                return invs1 + invs2
            else:
                raise

    return invoices

def _fetch_adaptive(service, nif, start, end, as_buyer, max_docs_per_chunk=100000, progress_callback=None, cancel_check=None):
    """Wrapper de retrocompatibilidade para _fetch_adaptive_tracker."""
    tracker = GlobalProgressTracker(progress_callback, cancel_check, as_buyer=as_buyer)
    invs = _fetch_adaptive_tracker(service, nif, start, end, as_buyer, tracker, None, max_docs_per_chunk, cancel_check)
    return invs, len(invs)

def get_invoices(
    nif,
    nif_subuser,
    password,
    start_date,
    end_date,
    as_buyer=True,
    page_size=500,
    service=None,
    progress_callback=None,
    return_totals=False,
    cancel_check=None,
    on_scout_done=None,
    on_period_done=None,
    on_page_fetched=None,
    docs_existentes_fn=None,
    reimportar_tudo=False,
    docs_intervalo_fn=None,
):
    """
    Liga à AT e devolve todas as faturas do intervalo usando algoritmo adaptativo
    com rastreio global e contínuo de progresso (0% a 100% sem repetições)
    e suporte a retoma inteligente a partir do offset já guardado na BD.
    """
    start_date = _normalise_date(start_date)
    end_date = _normalise_date(end_date)

    today = date.today()
    if start_date > today:
        if return_totals:
            return [], 0
        return []

    with secure_vault.ephemeral_producer_cert() as pem_path:
        service = service or get_at_client(nif_subuser, password, pem_path=pem_path)
        
        valid_periods = []
        for period_start, period_end in iter_month_periods(start_date, end_date):
            if period_start > today:
                break
            valid_periods.append((period_start, period_end))

        # 1. Batedor Rápido Global: determina o total real de todos os meses em ~1 segundo
        tipo_str = "compras" if as_buyer else "vendas"
        if progress_callback:
            _notify_progress(progress_callback, f"A consultar índice de faturas de {tipo_str} na AT...", docs=0, total=0)

        period_totals = {}
        period_density = {}
        period_subblocks = {}
        scout_items = []
        grand_total = 0
        for p_start, p_end in valid_periods:
            if cancel_check and cancel_check():
                break

            def _scout_sub(b):
                b_s, b_e = b
                try:
                    r = _request_page(service, nif, b_s, b_e, as_buyer, page=1, page_size=1)
                    c, _ = _get_status(r)
                    if c == EMPTY_RESULT_CODE:
                        return 0
                    if c == SUCCESS_CODE:
                        p = getattr(getattr(r, "InvoicesList", None), "PaginationTotal", None)
                        return int(getattr(p, "totalDocs", 0) or 0)
                except Fault as f_sub:
                    if not _is_transient_at_fault(f_sub):
                        raise
                except Exception:
                    pass
                return None

            period_density[(p_start, p_end)] = False
            try:
                resp = _request_page(service, nif, p_start, p_end, as_buyer, page=1, page_size=1)
                code, _ = _get_status(resp)
                if code == EMPTY_RESULT_CODE:
                    period_totals[(p_start, p_end)] = 0
                    scout_items.append({"ano": p_start.year, "mes": p_start.month, "total_esperado": 0})
                elif code == SUCCESS_CODE:
                    inv_list = getattr(resp, "InvoicesList", None)
                    pag = getattr(inv_list, "PaginationTotal", None)
                    p_docs = int(getattr(pag, "totalDocs", 0) or 0)
                    period_totals[(p_start, p_end)] = p_docs
                    grand_total += p_docs
                    scout_items.append({"ano": p_start.year, "mes": p_start.month, "total_esperado": p_docs})
                    if p_docs >= 3500 and (p_end - p_start).days >= 5:
                        period_density[(p_start, p_end)] = True
                        sub_blocos = dividir_periodo_em_blocos(p_start, p_end, dias_bloco=5)
                        bd_parcial = False
                        if not reimportar_tudo and docs_existentes_fn:
                            try:
                                bd_exist = docs_existentes_fn(p_start.year, p_start.month) or 0
                                bd_parcial = 0 < bd_exist < p_docs
                            except Exception:
                                bd_parcial = False
                        if bd_parcial:
                            sub_counts = [_scout_sub(b) for b in sub_blocos]
                            period_subblocks[(p_start, p_end)] = list(zip(sub_blocos, sub_counts))
                        else:
                            period_subblocks[(p_start, p_end)] = [(b, -1) for b in sub_blocos]
                        LOGGER.info(
                            f"⚡ [ALTA DENSIDADE MENSAL] NIF {nif} {p_start.month:02d}/{p_start.year} ({p_docs} docs) "
                            f"particionado em {len(sub_blocos)} blocos de 5 dias."
                        )
                else:
                    period_totals[(p_start, p_end)] = None
            except Fault as f_scout:
                if not _is_transient_at_fault(f_scout):
                    raise
                if (p_end - p_start).days >= 5:
                    period_density[(p_start, p_end)] = True
                    sub_blocos = dividir_periodo_em_blocos(p_start, p_end, dias_bloco=5)
                    sub_counts = [_scout_sub(b) for b in sub_blocos]
                    if any(c is not None for c in sub_counts):
                        period_subblocks[(p_start, p_end)] = list(zip(sub_blocos, sub_counts))
                        p_docs = sum(c for c in sub_counts if c is not None)
                        period_totals[(p_start, p_end)] = p_docs
                        grand_total += p_docs
                        scout_items.append({"ano": p_start.year, "mes": p_start.month, "total_esperado": p_docs})
                    else:
                        period_subblocks[(p_start, p_end)] = [(b, -1) for b in sub_blocos]
                        period_totals[(p_start, p_end)] = None
                else:
                    period_totals[(p_start, p_end)] = None
            except Exception:
                if (p_end - p_start).days >= 5:
                    period_density[(p_start, p_end)] = True
                    sub_blocos = dividir_periodo_em_blocos(p_start, p_end, dias_bloco=5)
                    sub_counts = [_scout_sub(b) for b in sub_blocos]
                    if any(c is not None for c in sub_counts):
                        period_subblocks[(p_start, p_end)] = list(zip(sub_blocos, sub_counts))
                        p_docs = sum(c for c in sub_counts if c is not None)
                        period_totals[(p_start, p_end)] = p_docs
                        grand_total += p_docs
                        scout_items.append({"ano": p_start.year, "mes": p_start.month, "total_esperado": p_docs})
                    else:
                        period_subblocks[(p_start, p_end)] = [(b, -1) for b in sub_blocos]
                        period_totals[(p_start, p_end)] = None
                else:
                    period_totals[(p_start, p_end)] = None

        if on_scout_done and scout_items:
            try:
                on_scout_done(scout_items)
            except Exception as se:
                LOGGER.error(f"Erro no callback on_scout_done: {se}")

        # Verificação do limite de segurança para processamento em folha de cálculo (50.000 faturas)
        LIMITE_DOCS_EXCEL = 50000
        if grand_total > LIMITE_DOCS_EXCEL:
            tipo_rotulo = "compras" if as_buyer else "vendas"
            msg_limite = (
                f"A análise desta entidade ({tipo_rotulo}) inclui um volume de {grand_total:,} documentos, "
                f"ultrapassando a capacidade de processamento desta versão. "
                f"Esta funcionalidade de grande débito estará disponível numa nova versão que irá ficar disponível em breve."
            ).replace(",", ".")
            LOGGER.warning(f"⚠️ [LIMITE EXCEDIDO] NIF {nif}: {grand_total} docs > {LIMITE_DOCS_EXCEL}. {msg_limite}")
            raise LimiteVolumeExcedidoError(msg_limite)

        # Contabilizar documentos que já se encontram na base de dados para retoma
        initial_existing_docs = 0
        if docs_existentes_fn and not reimportar_tudo:
            for p_start, p_end in valid_periods:
                p_docs = period_totals.get((p_start, p_end))
                if p_docs and p_docs > 0:
                    try:
                        bd_count = docs_existentes_fn(p_start.year, p_start.month) or 0
                        if bd_count >= p_docs:
                            initial_existing_docs += p_docs
                        elif period_density.get((p_start, p_end), False):
                            initial_existing_docs += min(bd_count, p_docs)
                        else:
                            initial_existing_docs += (bd_count // page_size) * page_size
                    except Exception:
                        pass

        tracker = GlobalProgressTracker(progress_callback, cancel_check, initial_docs=initial_existing_docs, as_buyer=as_buyer)
        tracker.set_grand_total(grand_total)

        # Se todos os documentos de todos os meses já estão completos na BD
        if not reimportar_tudo and grand_total > 0 and initial_existing_docs >= grand_total:
            if progress_callback:
                _notify_progress(
                    progress_callback,
                    f"Todos os documentos ({grand_total:,} faturas) já se encontram completos na BD.".replace(",", "."),
                    docs=grand_total,
                    total=grand_total
                )
            for p_start, p_end in valid_periods:
                p_expected = period_totals.get((p_start, p_end)) or 0
                if on_period_done:
                    try:
                        on_period_done(p_start, p_end, [], p_expected, True, docs_existentes=p_expected)
                    except Exception as pe:
                        LOGGER.error(f"Erro em on_period_done (all complete): {pe}")
            if return_totals:
                return [], grand_total
            return []

        # Se nenhum documento existir em nenhum mês do período
        if grand_total == 0 and not any(v is None for v in period_totals.values()):
            if progress_callback:
                _notify_progress(progress_callback, "Nenhum documento encontrado no período selecionado.", docs=0, total=0)
            if return_totals:
                return [], 0
            return []

        # 2. Extração Contínua com Progresso Global Cumulativo e Retoma Inteligente
        invoices = []
        total_fetched_counter = [0]
        for period_start, period_end in valid_periods:
            if cancel_check and cancel_check():
                tracker.notify_interrupted()
                break
            
            tracker.set_current_period(period_start.year, period_start.month)
            p_expected = period_totals.get((period_start, period_end))
            if p_expected == 0:
                if on_period_done:
                    try:
                        on_period_done(period_start, period_end, [], 0, True)
                    except Exception as pe:
                        LOGGER.error(f"Erro no callback on_period_done (empty): {pe}")
                continue

            docs_na_bd = 0
            if docs_existentes_fn and not reimportar_tudo:
                try:
                    docs_na_bd = docs_existentes_fn(period_start.year, period_start.month) or 0
                except Exception as de_err:
                    LOGGER.error(f"Erro ao verificar documentos existentes na BD: {de_err}")
                    docs_na_bd = 0

            # 2.1 Se o mês já está COMPLETO na BD, avança sem chamar a AT
            if not reimportar_tudo and p_expected and docs_na_bd >= p_expected:
                if on_period_done:
                    try:
                        on_period_done(period_start, period_end, [], p_expected, True, docs_existentes=docs_na_bd)
                    except Exception as pe:
                        LOGGER.error(f"Erro em on_period_done (skip existente): {pe}")
                if progress_callback:
                    _notify_progress(
                        progress_callback,
                        f"Mês {period_start.month:02d}/{period_start.year} já completo na BD ({docs_na_bd:,} faturas).".replace(",", "."),
                        docs=tracker.docs_downloaded,
                        total=tracker.grand_total
                    )
                continue

            month_fetched_counter = [0]
            period_invs = []
            is_dense = period_density.get((period_start, period_end), False)
            if is_dense:
                sub_blocos_info = period_subblocks.get((period_start, period_end))
                if not sub_blocos_info:
                    raw_blocos = dividir_periodo_em_blocos(period_start, period_end, dias_bloco=5)
                    sub_blocos_info = [(b, None) for b in raw_blocos]

                LOGGER.info(
                    f"🚀 [ALTA DENSIDADE] Mês {period_start.month:02d}/{period_start.year} ({p_expected} docs). "
                    f"A extrair {len(sub_blocos_info)} blocos sequencialmente na sessão SOAP..."
                )

                for item in sub_blocos_info:
                    if cancel_check and cancel_check():
                        break
                    bloco, b_total = item
                    if b_total == 0:
                        continue
                    b_start, b_end = bloco
                    if not reimportar_tudo and docs_intervalo_fn and b_total and b_total > 0:
                        try:
                            b_exist = docs_intervalo_fn(b_start, b_end) or 0
                            if b_exist >= b_total:
                                continue
                        except Exception as d_err:
                            LOGGER.debug(f"Aviso ao verificar sub-bloco existente: {d_err}")
                    b_invs = _fetch_adaptive_tracker(
                        service, nif, b_start, b_end, as_buyer,
                        tracker=tracker, known_total=b_total, cancel_check=cancel_check,
                        start_page=1, on_page_fetched=on_page_fetched, fetched_counter=month_fetched_counter
                    )
                    if b_invs:
                        period_invs.extend(b_invs)

            else:
                # 2.2 Se o mês está INCOMPLETO (parcial) em rota normal, calcula a página de retoma exata
                start_page = 1
                if not reimportar_tudo and docs_na_bd > 0 and (not p_expected or docs_na_bd < p_expected):
                    # Cada página na AT tem page_size (500) faturas.
                    # Exemplo: 2.000 docs na BD = 4 páginas já gravadas -> Próxima página = 5
                    start_page = (docs_na_bd // page_size) + 1
                    LOGGER.info(
                        f"NIF {nif} Mês {period_start.month:02d}/{period_start.year}: "
                        f"Retoma inteligente ativada ({docs_na_bd} docs já na BD, a iniciar na página {start_page})."
                    )

                invs = _fetch_adaptive_tracker(
                    service, nif, period_start, period_end, as_buyer, 
                    tracker=tracker, known_total=p_expected, cancel_check=cancel_check,
                    start_page=start_page, on_page_fetched=on_page_fetched, fetched_counter=month_fetched_counter
                )
                if invs:
                    period_invs.extend(invs)
                
                # Fallback automático: se após a página start_page até ao fim o mês continuar incompleto na BD,
                # significa que o documento em falta na AT estava numa página anterior (1 .. start_page - 1)
                is_cancelled_pre = bool(cancel_check and cancel_check())
                novo_bd_pre = docs_existentes_fn(period_start.year, period_start.month) if docs_existentes_fn else (docs_na_bd + month_fetched_counter[0])
                if not is_cancelled_pre and start_page > 1 and p_expected and novo_bd_pre < p_expected:
                    LOGGER.info(
                        f"NIF {nif} Mês {period_start.month:02d}/{period_start.year}: "
                        f"Documento em falta em página inicial ({novo_bd_pre}/{p_expected}). A verificar páginas 1 a {start_page - 1}..."
                    )
                    invs_iniciais = _fetch_adaptive_tracker(
                        service, nif, period_start, period_end, as_buyer,
                        tracker=tracker, known_total=p_expected, cancel_check=cancel_check,
                        start_page=1, on_page_fetched=on_page_fetched, max_page=start_page - 1, fetched_counter=month_fetched_counter
                    )
                    if invs_iniciais:
                        period_invs.extend(invs_iniciais)

            total_fetched_counter[0] += month_fetched_counter[0]
            is_cancelled = bool(cancel_check and cancel_check())
            if docs_existentes_fn:
                novo_bd = int(docs_existentes_fn(period_start.year, period_start.month) or 0)
            else:
                novo_bd = docs_na_bd + month_fetched_counter[0]

            # 2.3 Recuperação Automática (até 3 tentativas) quando o mês terminar com documentos em falta
            if not is_cancelled and p_expected and p_expected > 0 and novo_bd < p_expected:
                mes_label = f"{period_start.month:02d}/{period_start.year}"
                LOGGER.warning(
                    f"⚠️ Mês {mes_label} incompleto na 1.ª passagem ({novo_bd}/{p_expected}). "
                    f"A iniciar ciclo de recuperação automática (até 3 tentativas)..."
                )
                for tentativa_rec in range(1, 4):
                    if cancel_check and cancel_check():
                        break
                    if progress_callback:
                        _notify_progress(
                            progress_callback,
                            f"A recuperar documentos em falta no Mês {mes_label} ({novo_bd:,} de {p_expected:,}) — Tentativa {tentativa_rec}/3...".replace(",", "."),
                            docs=tracker.docs_downloaded,
                            total=max(tracker.grand_total, p_expected),
                            mes=period_start.month,
                            ano=period_start.year,
                        )
                    time.sleep(1.0 * tentativa_rec)
                    rec_counter = [0]
                    sub_blocos_rec = dividir_periodo_em_blocos(period_start, period_end, dias_bloco=5)

                    if tentativa_rec == 1:
                        # Tentativa 1: re-extrair sub-blocos de 5 dias onde faltem documentos
                        for b_start, b_end in sub_blocos_rec:
                            if cancel_check and cancel_check():
                                break
                            b_bd = int(docs_intervalo_fn(b_start, b_end) or 0) if docs_intervalo_fn else 0
                            b_tot_at = None
                            try:
                                r_sub = _request_page(service, nif, b_start, b_end, as_buyer, page=1, page_size=1)
                                c_sub, _ = _get_status(r_sub)
                                if c_sub == EMPTY_RESULT_CODE:
                                    b_tot_at = 0
                                elif c_sub == SUCCESS_CODE:
                                    p_sub = getattr(getattr(r_sub, "InvoicesList", None), "PaginationTotal", None)
                                    b_tot_at = int(getattr(p_sub, "totalDocs", 0) or 0)
                            except Exception as _se:
                                LOGGER.debug(f"Aviso ao sondar sub-bloco {b_start}..{b_end} (rec {tentativa_rec}/3): {_se}")

                            if b_tot_at == 0 or (b_tot_at is not None and docs_intervalo_fn and b_bd >= b_tot_at):
                                continue
                            rec_invs = _fetch_adaptive_tracker(
                                service, nif, b_start, b_end, as_buyer,
                                tracker=None, known_total=b_tot_at, cancel_check=cancel_check,
                                start_page=1, on_page_fetched=on_page_fetched, fetched_counter=rec_counter
                            )
                            if rec_invs and on_page_fetched is None:
                                period_invs.extend(rec_invs)
                    else:
                        # Tentativas 2 e 3: localizar sub-blocos de 5 dias incompletos e extrair dia a dia (1 dia)
                        for b_start, b_end in sub_blocos_rec:
                            if cancel_check and cancel_check():
                                break
                            b_bd = int(docs_intervalo_fn(b_start, b_end) or 0) if docs_intervalo_fn else 0
                            b_tot_at = None
                            try:
                                r_sub = _request_page(service, nif, b_start, b_end, as_buyer, page=1, page_size=1)
                                c_sub, _ = _get_status(r_sub)
                                if c_sub == EMPTY_RESULT_CODE:
                                    b_tot_at = 0
                                elif c_sub == SUCCESS_CODE:
                                    p_sub = getattr(getattr(r_sub, "InvoicesList", None), "PaginationTotal", None)
                                    b_tot_at = int(getattr(p_sub, "totalDocs", 0) or 0)
                            except Exception:
                                pass

                            if b_tot_at == 0 or (b_tot_at is not None and docs_intervalo_fn and b_bd >= b_tot_at):
                                continue

                            curr_day = b_start
                            while curr_day <= b_end:
                                if cancel_check and cancel_check():
                                    break
                                d_bd = int(docs_intervalo_fn(curr_day, curr_day) or 0) if docs_intervalo_fn else 0
                                d_tot_at = None
                                try:
                                    r_day = _request_page(service, nif, curr_day, curr_day, as_buyer, page=1, page_size=1)
                                    c_day, _ = _get_status(r_day)
                                    if c_day == EMPTY_RESULT_CODE:
                                        d_tot_at = 0
                                    elif c_day == SUCCESS_CODE:
                                        p_day = getattr(getattr(r_day, "InvoicesList", None), "PaginationTotal", None)
                                        d_tot_at = int(getattr(p_day, "totalDocs", 0) or 0)
                                except Exception:
                                    pass

                                if d_tot_at == 0 or (d_tot_at is not None and docs_intervalo_fn and d_bd >= d_tot_at):
                                    curr_day += timedelta(days=1)
                                    continue

                                rec_day_invs = _fetch_adaptive_tracker(
                                    service, nif, curr_day, curr_day, as_buyer,
                                    tracker=None, known_total=d_tot_at, cancel_check=cancel_check,
                                    start_page=1, on_page_fetched=on_page_fetched, fetched_counter=rec_counter
                                )
                                if rec_day_invs and on_page_fetched is None:
                                    period_invs.extend(rec_day_invs)
                                curr_day += timedelta(days=1)

                    if cancel_check and cancel_check():
                        break

                    if docs_existentes_fn:
                        novo_bd_pos = int(docs_existentes_fn(period_start.year, period_start.month) or 0)
                    else:
                        novo_bd_pos = max(novo_bd, docs_na_bd + rec_counter[0])

                    tracker.add_delta(max(0, novo_bd_pos - novo_bd))
                    novo_bd = novo_bd_pos
                    if novo_bd >= p_expected:
                        LOGGER.info(f"✅ Mês {mes_label} recuperado com sucesso na tentativa {tentativa_rec}/3 ({novo_bd}/{p_expected}).")
                        break

                if not (cancel_check and cancel_check()) and novo_bd < p_expected:
                    LOGGER.warning(f"⚠️ Mês {mes_label} continua incompleto após 3 tentativas ({novo_bd}/{p_expected}). A avançar para o mês seguinte.")

            if period_invs:
                invoices.extend(period_invs)

            is_cancelled = bool(cancel_check and cancel_check())
            is_complete = (not is_cancelled) and (novo_bd >= (p_expected or 0))
            if on_period_done:
                try:
                    on_period_done(period_start, period_end, period_invs, p_expected or novo_bd, is_complete, docs_existentes=novo_bd)
                except Exception as pe:
                    LOGGER.error(f"Erro no callback on_period_done: {pe}")

            if is_cancelled:
                tracker.notify_interrupted()
                break

        total_final = tracker.grand_total if tracker.grand_total > 0 else (initial_existing_docs + (len(invoices) or total_fetched_counter[0]))
        if return_totals:
            return invoices, total_final
        return invoices


NOMES_MESES = [
    "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
]


def sondar_totais_documentos(
    nif: str,
    nif_subuser: str,
    password: str,
    start_date: date,
    end_date: date,
    as_buyer: bool = False,
    meses_filtro: list = None,
    service = None,
    cancel_check = None,
) -> dict:
    """
    Sondagem Rápida de Totais (Batedor Ultra-Leve):
    Obtém unicamente a contagem total de documentos (totalDocs) por mês junto da AT,
    sem efetuar download de faturas, linhas fiscais nem gravações pesadas em disco.
    Ideal para aferição imediata em massa de dezenas/centenas de entidades.
    """
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()
    if not nif_clean:
        raise ValueError("NIF inválido ou em branco.")

    tipo_str = "compras" if as_buyer else "vendas"
    today = date.today()
    start_date = _normalise_date(start_date)
    end_date = _normalise_date(end_date)

    if start_date > end_date:
        raise ValueError("A data de início deve ser anterior ou igual à data de fim.")

    valid_periods = []
    for period_start, period_end in iter_month_periods(start_date, end_date):
        if meses_filtro and period_start.month not in meses_filtro:
            continue
        valid_periods.append((period_start, period_end))

    meses_resultado = []
    grand_total = 0

    with secure_vault.ephemeral_producer_cert() as pem_path:
        service = service or get_at_client(nif_subuser, password, pem_path=pem_path)

        for p_start, p_end in valid_periods:
            if cancel_check and cancel_check():
                break

            m_num = p_start.month
            m_ano = p_start.year
            m_nome = NOMES_MESES[m_num] if 1 <= m_num <= 12 else str(m_num)

            # Se for mês no futuro relativo à data de hoje
            if p_start > today:
                meses_resultado.append({
                    "ano": m_ano,
                    "mes": m_num,
                    "nome_mes": m_nome,
                    "total_docs": 0,
                    "status": "futuro"
                })
                continue

            try:
                # Aferição relâmpago de densidade fiscal (~250ms)
                is_dense = aferir_alta_densidade(service, nif_clean, p_start, p_end, as_buyer)

                if is_dense:
                    sub_blocos = dividir_periodo_em_blocos(p_start, p_end, dias_bloco=5)
                    LOGGER.info(
                        f"⚡ [SONDAGEM - ALTA DENSIDADE DETETADA] NIF {nif_clean} {m_num:02d}/{m_ano} "
                        f"particionado em {len(sub_blocos)} blocos de 5 dias. A sondar com 3 workers paralelos..."
                    )

                    def _scout_sub(b):
                        b_s, b_e = b
                        try:
                            r = _request_page(service, nif_clean, b_s, b_e, as_buyer, page=1, page_size=1)
                            c, _ = _get_status(r)
                            if c == EMPTY_RESULT_CODE:
                                return 0
                            if c == SUCCESS_CODE:
                                p = getattr(getattr(r, "InvoicesList", None), "PaginationTotal", None)
                                return int(getattr(p, "totalDocs", 0) or 0)
                        except Exception:
                            pass
                        return 0

                    with concurrent.futures.ThreadPoolExecutor(max_workers=3, thread_name_prefix="ScoutSondagem") as pool:
                        sub_counts = list(pool.map(_scout_sub, sub_blocos))

                    p_docs = sum(sub_counts)
                    grand_total += p_docs
                    meses_resultado.append({
                        "ano": m_ano,
                        "mes": m_num,
                        "nome_mes": m_nome,
                        "total_docs": p_docs,
                        "status": "ok"
                    })
                else:
                    # Pedido com page_size=1 para obter PaginationTotal.totalDocs instantaneamente
                    resp = _request_page(service, nif_clean, p_start, p_end, as_buyer, page=1, page_size=1)
                    code, desc = _get_status(resp)

                    if code == EMPTY_RESULT_CODE:
                        meses_resultado.append({
                            "ano": m_ano,
                            "mes": m_num,
                            "nome_mes": m_nome,
                            "total_docs": 0,
                            "status": "ok"
                        })
                    elif code == SUCCESS_CODE:
                        inv_list = getattr(resp, "InvoicesList", None)
                        pag = getattr(inv_list, "PaginationTotal", None)
                        p_docs = int(getattr(pag, "totalDocs", 0) or 0)
                        grand_total += p_docs
                        meses_resultado.append({
                            "ano": m_ano,
                            "mes": m_num,
                            "nome_mes": m_nome,
                            "total_docs": p_docs,
                            "status": "ok"
                        })
                    else:
                        LOGGER.warning("Resposta inesperada da AT ao sondar %s (%s/%s): %s - %s", nif_clean, m_ano, m_num, code, desc)
                        if str(code).strip() in ("2", "02", "3", "03", "401", "403"):
                            raise ATAPIError(code, desc)

                        meses_resultado.append({
                            "ano": m_ano,
                            "mes": m_num,
                            "nome_mes": m_nome,
                            "total_docs": 0,
                            "status": "erro_at",
                            "detalhe": f"Código AT {code}: {desc}"
                        })
            except ATAPIError:
                raise
            except Exception as ex:
                LOGGER.exception("Exceção ao sondar mês %s/%s para o NIF %s: %s", m_ano, m_num, nif_clean, ex)
                meses_resultado.append({
                    "ano": m_ano,
                    "mes": m_num,
                    "nome_mes": m_nome,
                    "total_docs": 0,
                    "status": "erro_comunicacao",
                    "detalhe": str(ex)
                })

    return {
        "status": "ok",
        "nif": nif_clean,
        "tipo": tipo_str,
        "data_inicio": str(start_date),
        "data_fim": str(end_date),
        "total_documentos": grand_total,
        "meses": meses_resultado
    }



def to_title_case(name: str) -> str:
    """Converte nomes de entidades em MAIÚSCULAS para Title Case conforme o padrão do e-fatura web."""
    if not name or not name.isupper():
        return name or ""
    words = name.split()
    lower_words = {"de", "da", "do", "das", "dos", "e", "em"}
    title_words = []
    for i, w in enumerate(words):
        clean_w = w
        trailing_punct = ""
        if clean_w.endswith(",") or clean_w.endswith(";"):
            trailing_punct = clean_w[-1]
            clean_w = clean_w[:-1]

        w_upper = clean_w.upper()
        if w_upper in ["SA", "LDA", "CRL"]:
            title_words.append(w_upper.capitalize() + trailing_punct)
        elif w_upper in ["S.A.", "L.DA", "CRL.", "SNC", "EEM", "EP", "EPE", "SGPS", "PLC", "A", "S"]:
            title_words.append(w_upper + trailing_punct)
        elif i > 0 and clean_w.lower() in lower_words:
            title_words.append(clean_w.lower() + trailing_punct)
        else:
            title_words.append(clean_w.capitalize() + trailing_punct)
    return " ".join(title_words)


def invoices_to_rows(nif, invoices, as_buyer=True, entity_name="", total_esperado=None):
    """Converte todos os campos documentais e fiscais da AT em duas vistas:
    - Vertical (novos dashboards)
    - Horizontal (legado exatamente conforme a tabela tDocsEfatura)
    """
    vertical_rows = []
    horizontal_rows = []
    cache_nomes_vendas = {}

    # Ordenar faturas por data decrescente (exatamente como o webscraping descarrega do portal)
    invoices = sorted(
        invoices,
        key=lambda inv: str(getattr(inv, "InvoiceDate", "") or ""),
        reverse=True,
    )

    TIPO_DOC_MAP = {
        "FT": "Fatura",
        "FS": "Fatura simplificada",
        "FR": "Fatura-recibo",
        "NC": "Nota de crédito",
        "ND": "Nota de débito",
    }

    SITUACAO_MAP = {
        "N": "Registado",
        "A": "Anulado",
        "R": "Recusado",
    }

    total_retirado = len(invoices)
    if total_esperado is None or total_esperado < total_retirado:
        total_esperado = total_retirado

    # 1. Linha 1 de Totais (aferição real: documentos que devia trazer vs documentos retirados)
    totals_row = {
        "IdDocumento": "TotalDocs:",
        "Atividade de Realização da Aquisição": total_esperado,
        "NIF ComercianteConsumidor": total_retirado,
        "TipoDoc": 0,
        "Situação": 0,
        "Nº Fatura": 0,
        "ATCUD": 0,
        "Data Emissão": "1899-12-31",
        "Total Iva": 0,
        "Total_Liquido": 0,
        "Base Tributável": 0,
        "SerieDoc": 0,
        "N_Doc": 0,
        "intNDoc": 0,
        "S": 0,
        "N": 0,
        "I": 0,
        "Nome ComerConsu": 0,
        "Nome_ComerConsu": 0,
        "NIF EntidadeEfatura": 0,
        "Nome EntidadeEfatura": 0,
        "Cae": 0,
        "MotivoISE": 0,
        "Base_Ise": 0,
        "Base_Red": 0,
        "Iva_Red": 0,
        "Base_Int": 0,
        "Iva_Int": 0,
        "Base_Nor": 0,
        "Iva_Nor": 0,
        "TaxasIva": 0,
        "Realizado no âmbito da atividade profissional": 0,
        "ValorNaoClassificado": 0,
        "DataHoraDownload": 0,
    }
    horizontal_rows.append(totals_row)

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for idx, invoice in enumerate(invoices, start=1):
        if as_buyer:
            counterparty_nif = getattr(invoice, "TaxRegistrationNumber", "")
            counterparty_name = getattr(invoice, "TaxRegistrationName", "") or ""
            counterparty_country = "PT"
        else:
            counterparty_nif = getattr(invoice, "CustomerTaxID", "")
            counterparty_country = (
                getattr(invoice, "CustomerTaxIDCountry", "") or ""
            )
            cp_clean = str(counterparty_nif or "").strip()
            if not cp_clean or cp_clean in ("999999999", "999999990", "99999999"):
                counterparty_name = "Consumidor final"
            else:
                import pb_client
                counterparty_name = pb_client.resolver_nome_nif_local(counterparty_nif, cache_nomes_vendas, nif_titular=nif)

        inv_type = getattr(invoice, "InvoiceType", "") or ""
        doc_status = getattr(invoice, "DocumentStatus", "") or ""

        # Regras Financeiras: NC a negativo, A a zero
        is_nc = (inv_type == "NC")
        mult = 1.0
        if is_nc:
            mult = -1.0
        if doc_status == "A":
            mult = 0.0

        tipo_doc_desc = TIPO_DOC_MAP.get(inv_type, inv_type)
        situacao_desc = SITUACAO_MAP.get(doc_status, "Registado")

        inv_no = getattr(invoice, "InvoiceNo", "") or ""
        atcud = getattr(invoice, "ATCUD", "") or "0"
        inv_date = getattr(invoice, "InvoiceDate", None)
        inv_date_str = str(inv_date) if inv_date else ""

        total_iva = round(float(getattr(invoice, "TaxPayable", 0) or 0) * mult, 2)
        total_liq_doc = round(float(getattr(invoice, "NetTotal", 0) or 0) * mult, 2)
        total_bruto_doc = round(float(getattr(invoice, "GrossTotal", 0) or 0) * mult, 2)

        sector_code = getattr(invoice, "Sector", None) or "C99"
        sec_clean = str(sector_code).strip().upper()
        if sec_clean.isdigit():
            sec_clean = f"C{int(sec_clean):02d}"

        SECTOR_MAP = {
            "C01": "Reparação de veículos",
            "C02": "Reparação de motociclos",
            "C03": "Restauração e alojamento",
            "C04": "Cabeleireiros",
            "C05": "Saúde",
            "C06": "Educação",
            "C07": "Imóveis",
            "C08": "Lares",
            "C09": "Veterinários",
            "C10": "Transportes públicos",
            "C11": "Ginásios",
            "C99": "Outros",
        }
        sector = SECTOR_MAP.get(sec_clean, "Outros")
        cae = ""

        # Gerar IdDocumento único determinístico (<= 25 chars, sem caracteres especiais)
        import pb_client
        clean_issuer = str(counterparty_nif if as_buyer else nif).strip() or "000000000"
        id_doc = pb_client.gerar_chave_documento(
            nif=clean_issuer,
            fatura=inv_no,
            total_doc=total_bruto_doc,
            atcud=atcud,
            prefixo="C" if as_buyer else "V"
        )

        summaries = getattr(invoice, "LineSummary", None) or []

        base_ise = 0.0
        base_red = 0.0
        iva_red = 0.0
        base_int = 0.0
        iva_int = 0.0
        base_nor = 0.0
        iva_nor = 0.0
        taxas_list = []

        for summary in summaries:
            tax = getattr(summary, "Tax", None)
            dc_ind = str(getattr(summary, "DebitCreditIndicator", "") or "").strip().upper()
            # Na AT e no legado VBA (aaChr_importador11.bas):
            # Em faturas normais (não NC), linhas normais são "C" e linhas de acerto/desconto são "D" (-1.0).
            # Em Notas de Crédito (NC), linhas normais são "D" (já invertidas por mult=-1.0) e "C" inverte o sinal (-1.0).
            dc_mult = -1.0 if ((not is_nc and dc_ind == "D") or (is_nc and dc_ind == "C")) else 1.0
            net_amount = round(float(getattr(summary, "NetAmount", 0) or 0) * mult * dc_mult, 2)
            tax_amount = round(float(getattr(summary, "TaxAmount", 0) or 0) * mult * dc_mult, 2)
            tax_code = getattr(tax, "TaxCode", "") or ""
            tax_type = getattr(tax, "TaxType", "") or ""
            tax_perc = getattr(tax, "TaxPercentage", None)

            perc_float = None
            perc_str = ""
            if tax_perc is not None:
                try:
                    perc_float = float(tax_perc)
                    perc_val = int(perc_float) if perc_float.is_integer() else perc_float
                    perc_str = str(perc_val)
                except Exception:
                    perc_str = ""

            # No Legado Excel / e-fatura: Imposto do Selo (IS) NÃO É IVA!
            # Conforme o comportamento do webscraping e da contabilidade SNC:
            # Em operações com Imposto do Selo (tax_type == "IS"), o valor do imposto do selo
            # é somado à base isenta (base_ise += net_amount + tax_amount), o Total IVA é 0.00,
            # e a Base Tributável passa a ser igual ao Total Líquido (GrossTotal).
            if tax_type == "IS":
                base_ise += round(net_amount + tax_amount, 2)
                if perc_str:
                    if perc_str not in taxas_list:
                        taxas_list.append(perc_str)
                else:
                    if "0" not in taxas_list:
                        taxas_list.append("0")
            elif tax_code in ["ISE", "NS"] or tax_type == "NS" or perc_float == 0.0 or (tax_amount == 0 and tax_code not in ["RED", "INT", "NOR"]):
                base_ise += net_amount
                if "0" not in taxas_list:
                    taxas_list.append("0")
            elif tax_code == "RED" or (perc_float is not None and 0 < perc_float <= 6.0 and tax_type != "IS"):
                base_red += net_amount
                iva_red += tax_amount
                if perc_str and perc_str not in taxas_list:
                    taxas_list.append(perc_str)
            elif tax_code == "INT" or (perc_float is not None and 6.0 < perc_float <= 13.0 and tax_type != "IS"):
                base_int += net_amount
                iva_int += tax_amount
                if perc_str and perc_str not in taxas_list:
                    taxas_list.append(perc_str)
            elif tax_code == "NOR" or (perc_float is not None and perc_float > 13.0 and tax_type != "IS"):
                base_nor += net_amount
                iva_nor += tax_amount
                if perc_str and perc_str not in taxas_list:
                    taxas_list.append(perc_str)
            else:
                if tax_amount != 0 and tax_type != "IS":
                    base_nor += net_amount
                    iva_nor += tax_amount
                    if perc_str and perc_str not in taxas_list:
                        taxas_list.append(perc_str)
                else:
                    base_ise += net_amount
                    if "0" not in taxas_list:
                        taxas_list.append("0")

            # Na Nova Base de Dados (Vertical): mantemos a separação rigorosa entre IVA e Imposto do Selo!
            vertical_rows.append({
                "NIF Cliente": str(nif),
                "Fatura": inv_no,
                "ATCUD": atcud,
                "Data": inv_date_str,
                "Tipo Documento": inv_type,
                "Contraparte NIF": str(counterparty_nif or ""),
                "Contraparte": counterparty_name,
                "Estado Documento": doc_status,
                "Tipo Imposto": tax_type or "IVA",
                "Código Taxa": tax_code,
                "Taxa (%)": float(tax_perc) if tax_perc is not None else None,
                "Taxa IVA": float(tax_perc) if tax_perc is not None else None,
                "Base Incidência": net_amount,
                "Valor Imposto": tax_amount,
                "Valor IVA": tax_amount,
                "Código Isenção": getattr(summary, "TaxExemptionCode", None),
                "Região Fiscal": getattr(tax, "TaxCountryRegion", None),
                "Total Líquido Documento": total_liq_doc,
                "Total Documento": total_bruto_doc,
            })

        if not summaries:
            if abs(total_iva) > 0:
                base_nor = total_liq_doc
                iva_nor = total_iva
                taxas_list.append("23")
            else:
                base_ise = total_liq_doc
                taxas_list.append("0")
            vertical_rows.append({
                "NIF Cliente": str(nif),
                "Fatura": inv_no,
                "ATCUD": atcud,
                "Data": inv_date_str,
                "Tipo Documento": inv_type,
                "Contraparte NIF": str(counterparty_nif or ""),
                "Contraparte": counterparty_name,
                "Estado Documento": doc_status,
                "Tipo Imposto": "IVA",
                "Código Taxa": "NOR" if abs(total_iva) > 0 else "ISE",
                "Taxa (%)": 23.0 if abs(total_iva) > 0 else 0.0,
                "Taxa IVA": 23.0 if abs(total_iva) > 0 else 0.0,
                "Base Incidência": total_liq_doc,
                "Valor Imposto": total_iva,
                "Valor IVA": total_iva,
                "Total Líquido Documento": total_liq_doc,
                "Total Documento": total_bruto_doc,
            })

        # O Total Iva na tabela legado tDocsEfatura é estritamente IVA (exclui Imposto do Selo)
        total_iva = round(iva_red + iva_int + iva_nor, 2)
        base_tributavel = round(total_bruto_doc - total_iva, 2)

        taxas_str = " ".join(taxas_list) if taxas_list else "0"
        soma_bases = round(base_ise + base_red + base_int + base_nor, 2)
        dif = round(base_tributavel - soma_bases, 2)
        valor_nao_class = dif if abs(dif) >= 0.01 else ""

        legacy_row = {
            "IdDocumento": id_doc,
            "Atividade de Realização da Aquisição": sector,
            "NIF ComercianteConsumidor": str(counterparty_nif or ""),
            "TipoDoc": tipo_doc_desc,
            "Situação": situacao_desc,
            "Nº Fatura": "'" + inv_no if inv_no else "",
            "ATCUD": atcud,
            "Data Emissão": inv_date_str,
            "Total Iva": total_iva,
            "Total_Liquido": total_bruto_doc,
            "Base Tributável": base_tributavel,
            "SerieDoc": "",
            "N_Doc": "",
            "intNDoc": "",
            "S": "",
            "N": "",
            "I": "",
            "Nome ComerConsu": to_title_case(counterparty_name),
            "Nome_ComerConsu": to_title_case(counterparty_name),
            "NIF EntidadeEfatura": str(nif),
            "Nome EntidadeEfatura": entity_name,
            "Cae": "",
            "MotivoISE": "",
            "Base_Ise": round(base_ise, 2),
            "Base_Red": round(base_red, 2),
            "Iva_Red": round(iva_red, 2),
            "Base_Int": round(base_int, 2),
            "Iva_Int": round(iva_int, 2),
            "Base_Nor": round(base_nor, 2),
            "Iva_Nor": round(iva_nor, 2),
            "TaxasIva": taxas_str,
            "Realizado no âmbito da atividade profissional": "Não",
            "ValorNaoClassificado": valor_nao_class,
            "DataHoraDownload": now_str,
        }
        horizontal_rows.append(legacy_row)

    try:
        import validador_fiscal
        validador_fiscal.validar_lote_extracao(horizontal_rows, vertical_rows, strict=False)
    except Exception as _ve:
        LOGGER.warning(f"Aviso no validador fiscal em invoices_to_rows: {_ve}")

    return horizontal_rows, vertical_rows


# -------------------------------------------------------------------------
# GERADOR DE XML LEGADO (tDocsEfatura / BdsefaturaV3)
# -------------------------------------------------------------------------
def obter_pasta_raiz_dados_padrao() -> str:
    try:
        import pb_client
        return pb_client.obter_pasta_dados_raiz()
    except Exception:
        import legado_bridge
        return legado_bridge.obter_caminho_dados_gexcel() or os.environ.get("GEXCEL_DADOS_DIR", "")

DEFAULT_PASTA_RAIZ_LEGADO = obter_pasta_raiz_dados_padrao()

TAG_ORDER_LEGADO_XML = [
    ("IdDocumento", "IdDocumento"),
    ("Atividade_de_Realiza__o_da_Aquisi__o", "Atividade de Realização da Aquisição"),
    ("NIF_ComercianteConsumidor", "NIF ComercianteConsumidor"),
    ("TipoDoc", "TipoDoc"),
    ("Situa__o", "Situação"),
    ("N__Fatura", "Nº Fatura"),
    ("ATCUD", "ATCUD"),
    ("Data_Emiss_o", "Data Emissão"),
    ("Total_Iva", "Total Iva"),
    ("Total_Liquido", "Total_Liquido"),
    ("BaseTributavel", "Base Tributável"),
    ("SerieDoc", "SerieDoc"),
    ("N_Doc", "N_Doc"),
    ("intNDoc", "intNDoc"),
    ("Nome_ComerConsu", "Nome ComerConsu"),
    ("NIF_Consumidor", "NIF EntidadeEfatura"),
    ("Nome_Consumidor", "Nome EntidadeEfatura"),
    ("Cae", "Cae"),
    ("MotivoISE", "MotivoISE"),
    ("Base_Ise", "Base_Ise"),
    ("Base_Red", "Base_Red"),
    ("Iva_Red", "Iva_Red"),
    ("Base_Int", "Base_Int"),
    ("Iva_Int", "Iva_Int"),
    ("Base_Nor", "Base_Nor"),
    ("Iva_Nor", "Iva_Nor"),
    ("taxasIva", "TaxasIva"),
    ("Realizado_Fora_da_atividade_profissional", "Realizado no âmbito da atividade profissional"),
    ("ValorNaoClassificado", "ValorNaoClassificado"),
    ("DataHoraDownload", "DataHoraDownload"),
]


def to_excel_serial_date(val=None):
    """Converte datetime, date ou ISO string para o número de série de data do Excel (base 1899-12-30)."""
    if val is None or val == "" or val == 0:
        return 0
    if isinstance(val, (int, float)):
        return val
    if isinstance(val, datetime):
        dt = val
    elif isinstance(val, date):
        dt = datetime.combine(val, datetime.min.time())
    elif isinstance(val, str):
        try:
            dt = datetime.fromisoformat(val)
        except Exception:
            return val
    else:
        return val
    delta = dt - datetime(1899, 12, 30)
    return delta.total_seconds() / 86400.0


def formatar_valor_xml_legado(val, xml_tag=None):
    """Formata os valores respeitando estritamente o formato legado de produção:
    - Decimais arredondados até 2 casas (sem zeros à direita para inteiros, ex: 4084 em vez de 4084.0)
    - DataHoraDownload como número de série Excel com precisão total
    - Remoção do apóstrofo inicial (') usado no Excel para texto
    """
    if val is None or val == "":
        return ""
    if xml_tag == "DataHoraDownload":
        if val == 0 or val == "0":
            return "0"
        serial = to_excel_serial_date(val)
        if isinstance(serial, (int, float)):
            return f"{float(serial):.10f}".rstrip("0")
        return str(serial)
    if isinstance(val, (int, float)):
        f_val = float(val)
        if f_val.is_integer():
            return str(int(f_val))
        return str(round(f_val, 2))
    s_val = str(val).strip()
    if s_val.startswith("'"):
        s_val = s_val[1:]
    return s_val


def gerar_xml_legado_string(horizontal_rows):
    """Gera a string XML oficial no formato <tDocsEfatura>."""
    lines = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<tDocsEfatura xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    ]
    for idx, row in enumerate(horizontal_rows):
        lines.append('\t<Linha>')
        is_first_line = (idx == 0)
        for xml_tag, row_key in TAG_ORDER_LEGADO_XML:
            raw_val = row.get(row_key, "")
            val_str = formatar_valor_xml_legado(raw_val, xml_tag=xml_tag)
            if is_first_line:
                if val_str == "":
                    val_str = "0"
                escaped = val_str.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                lines.append(f'\t\t<{xml_tag}>{escaped}</{xml_tag}>')
            else:
                if val_str != "":
                    escaped = val_str.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    lines.append(f'\t\t<{xml_tag}>{escaped}</{xml_tag}>')
        lines.append('\t</Linha>')
    lines.append('</tDocsEfatura>\n')
    return "\r\n".join(lines)


def construir_caminho_xml_legado(pasta_raiz, nif, ano, mes, as_buyer):
    """Constrói o caminho oficial de produção:
    {pasta_raiz}\\BdsefaturaV3\\{C|V}\\{ano}\\{nif}\\{ano}.{mes:02d}.{nif}.efat{C|V}.xml
    """
    tipo_cv = "C" if as_buyer else "V"
    mes_str = f"{int(mes):02d}"
    ano_str = str(ano)
    nif_str = str(nif).strip()
    pasta_destino = os.path.join(pasta_raiz, "BdsefaturaV3", tipo_cv, ano_str, nif_str)
    nome_ficheiro = f"{ano_str}.{mes_str}.{nif_str}.efat{tipo_cv}.xml"
    return os.path.join(pasta_destino, nome_ficheiro)


def salvar_xml_legado_ficheiro(horizontal_rows, caminho_completo):
    """Grava o XML legado no caminho especificado criando diretórios pais se necessário."""
    pasta_pai = os.path.dirname(caminho_completo)
    if pasta_pai:
        os.makedirs(pasta_pai, exist_ok=True)
    xml_str = gerar_xml_legado_string(horizontal_rows)
    with open(caminho_completo, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(xml_str)
    return caminho_completo


def exportar_lote_xml_legado(
    nif,
    invoices,
    as_buyer=True,
    entity_name="",
    pasta_raiz=None,
    caminho_personalizado=None,
    period_totals=None,
    data_inicio=None,
    data_fim=None,
):
    """Particiona as faturas por mês/ano e gera os respetivos XMLs legados.
    Se pasta_raiz for fornecida, grava os ficheiros na hierarquia padrão BdsefaturaV3.
    Retorna uma lista de metadados dos ficheiros gerados e a string do último XML gerado.
    """
    ficheiros_gerados = []
    ultimo_xml_string = ""

    por_mes = {}
    if data_inicio and data_fim:
        try:
            for p_start, p_end in iter_month_periods(data_inicio, data_fim):
                por_mes[(p_start.year, p_start.month)] = []
        except Exception:
            pass

    for inv in invoices:
        inv_date = getattr(inv, "InvoiceDate", None)
        if inv_date:
            d_obj = _normalise_date(inv_date)
            key = (d_obj.year, d_obj.month)
        else:
            key = (date.today().year, date.today().month)
        por_mes.setdefault(key, []).append(inv)

    if not por_mes and not invoices:
        return ficheiros_gerados, ultimo_xml_string

    raiz = pasta_raiz or obter_pasta_raiz_dados_padrao()

    for (ano, mes), mes_invoices in sorted(por_mes.items()):
        p_expected = None
        if period_totals:
            for (p_start, p_end), tot in period_totals.items():
                if p_start.year == ano and p_start.month == mes:
                    p_expected = tot
                    break
        if p_expected is None:
            p_expected = len(mes_invoices)

        h_rows, _ = invoices_to_rows(
            nif, mes_invoices, as_buyer=as_buyer, entity_name=entity_name, total_esperado=p_expected
        )

        xml_str = gerar_xml_legado_string(h_rows)
        ultimo_xml_string = xml_str

        caminho_final = None
        if caminho_personalizado:
            caminho_final = caminho_personalizado
        elif raiz:
            caminho_final = construir_caminho_xml_legado(raiz, nif, ano, mes, as_buyer)

        if caminho_final:
            salvar_xml_legado_ficheiro(h_rows, caminho_final)
            ficheiros_gerados.append({
                "ano": ano,
                "mes": mes,
                "caminho": caminho_final,
                "nome_ficheiro": os.path.basename(caminho_final),
                "total_documentos": len(mes_invoices),
                "total_esperado": p_expected,
            })

    return ficheiros_gerados, ultimo_xml_string


# -------------------------------------------------------------------------
# STAGING PERSISTENTE LOCAL (JSONL) COM RETOMA AUTOMÁTICA
# -------------------------------------------------------------------------
_IN_FLIGHT_LOCKS = {}
_LOCKS_MUTEX = threading.Lock()

def get_month_lock(nif: str, ano: int, mes: int, tipo: str) -> threading.Lock:
    """Garante que apenas uma thread/pedido extrai o mesmo (NIF, Ano, Mês, Tipo) em simultâneo."""
    key = f"{str(nif).strip()}_{int(ano)}_{int(mes):02d}_{str(tipo).strip().lower()}"
    with _LOCKS_MUTEX:
        if key not in _IN_FLIGHT_LOCKS:
            _IN_FLIGHT_LOCKS[key] = threading.Lock()
        return _IN_FLIGHT_LOCKS[key]

def get_staging_dir() -> str:
    """Retorna a pasta de staging temporário em <EndDadosGexcelApps>\\BdsefaturaV4\\staging."""
    try:
        import pb_client
        staging_dir = os.path.join(pb_client.obter_pasta_v4(), "staging")
    except Exception:
        import legado_bridge
        raiz = legado_bridge.obter_caminho_dados_gexcel() or os.environ.get("GEXCEL_DADOS_DIR", "")
        staging_dir = os.path.join(raiz, "BdsefaturaV4", "staging") if raiz else os.path.join(os.path.expanduser("~"), "BdsefaturaV4", "staging")
    os.makedirs(staging_dir, exist_ok=True)
    return staging_dir

def get_staging_path(nif: str, ano: int, mes: int, tipo: str) -> str:
    """Caminho do ficheiro de staging JSONL para o mês e entidade."""
    nif_clean = str(nif).strip()
    tipo_clean = str(tipo).strip().lower()
    filename = f"staging_{nif_clean}_{int(ano)}_{int(mes):02d}_{tipo_clean}.jsonl"
    return os.path.join(get_staging_dir(), filename)

def contar_staging(nif: str, ano: int, mes: int, tipo: str) -> int:
    """Conta rapidamente o número de faturas salvas no staging local (~2ms)."""
    path = get_staging_path(nif, ano, mes, tipo)
    if not os.path.exists(path):
        return 0
    count = 0
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    count += 1
    except Exception as e:
        LOGGER.warning(f"Erro ao contar staging ({path}): {e}")
    return count

def carregar_staging(nif: str, ano: int, mes: int, tipo: str) -> list[dict]:
    """Carrega todas as faturas do staging local com auto-deduplicação composta."""
    path = get_staging_path(nif, ano, mes, tipo)
    if not os.path.exists(path):
        return []
    dedup = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line_str = line.strip()
                if not line_str:
                    continue
                try:
                    row = json.loads(line_str)
                    doc_id = row.get("IdDocumento")
                    if doc_id and doc_id != "TotalDocs:":
                        chave_dedup = f"{row.get('NIF ComercianteConsumidor', '')}|{row.get('Nº Fatura', '')}|{doc_id}"
                        dedup[chave_dedup] = row
                except Exception:
                    continue
    except Exception as e:
        LOGGER.error(f"Erro ao carregar staging ({path}): {e}")
    return list(dedup.values())

_STAGING_LOCK = threading.Lock()

def append_staging(nif: str, ano: int, mes: int, tipo: str, rows: list[dict]):
    """Grava incrementalmente páginas de faturas no staging local em modo append (~2ms)."""
    if not rows:
        return
    path = get_staging_path(nif, ano, mes, tipo)
    try:
        with _STAGING_LOCK:
            with open(path, "a", encoding="utf-8") as f:
                for r in rows:
                    if r.get("IdDocumento") == "TotalDocs:":
                        continue
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
    except Exception as e:
        LOGGER.error(f"Erro ao gravar staging ({path}): {e}")

def limpar_staging(nif: str, ano: int, mes: int, tipo: str):
    """Elimina o ficheiro de staging de um mês específico (usado em Wipe & Fetch / reimportar tudo)."""
    cands_tipo = {str(tipo).lower(), "compras" if str(tipo).lower().startswith("c") else "vendas", "c" if str(tipo).lower().startswith("c") else "v"}
    for t_cand in cands_tipo:
        path = get_staging_path(nif, ano, mes, t_cand)
        if os.path.exists(path):
            try:
                os.remove(path)
                LOGGER.info(f"Staging limpo com sucesso: {path}")
            except Exception as e:
                LOGGER.warning(f"Falha ao apagar staging ({path}): {e}")
    try:
        import pb_client
        v4_dir = pb_client.obter_pasta_v4()
        if v4_dir:
            v4_staging = os.path.join(v4_dir, "staging")
            if os.path.isdir(v4_staging):
                for t_cand in cands_tipo:
                    p_old = os.path.join(v4_staging, f"staging_{nif}_{ano}_{int(mes):02d}_{t_cand}.jsonl")
                    if os.path.exists(p_old):
                        try:
                            os.remove(p_old)
                            LOGGER.info(f"Staging legado em BdsefaturaV4 limpo: {p_old}")
                        except Exception:
                            pass
    except Exception:
        pass

def limpar_xml_legado_periodo(nif: str, ano: int, mes: int, as_buyer: bool = True):
    """
    Elimina o ficheiro XML de cache mensal legado em BdsefaturaV3/{C|V}/{ano}/{nif}/{ano}.{mes:02d}.{nif}.efat{C|V}.xml
    quando o utilizador solicita reimportação total (-r / reimportar_tudo).
    """
    try:
        import pb_client
        nif_clean = "".join(ch for ch in str(nif or "") if ch.isdigit())[:9]
        if not nif_clean:
            return
        v4_dir = pb_client.obter_pasta_v4()
        if not v4_dir:
            return
        raiz_dados = os.path.dirname(v4_dir)
        cv_upper = "C" if as_buyer else "V"
        cv_lower = cv_upper.lower()
        for pasta_cv in (cv_upper, cv_lower):
            ender = os.path.join(raiz_dados, "BdsefaturaV3", pasta_cv, str(int(ano)), nif_clean)
            if not os.path.isdir(ender):
                continue
            for sufixo_cv in (cv_upper, cv_lower):
                nmxml = f"{int(ano)}.{int(mes):02d}.{nif_clean}.efat{sufixo_cv}.xml"
                caminho_xml = os.path.join(ender, nmxml)
                if os.path.exists(caminho_xml):
                    try:
                        os.remove(caminho_xml)
                        LOGGER.info(f"Cache XML legado BdsefaturaV3 apagada (-r): {caminho_xml}")
                    except Exception as e_rm:
                        LOGGER.warning(f"Não foi possível apagar XML legado ({caminho_xml}): {e_rm}")
    except Exception as e:
        LOGGER.warning(f"Erro ao limpar XML legado BdsefaturaV3 ({nif}, {mes}/{ano}): {e}")

def reconstruir_horizontal_com_totais(rows: list[dict], total_esperado: int = None) -> list[dict]:
    """
    Recebe faturas do staging, deduplica deterministicamente por chave composta,
    ordena por data decrescente e insere a Linha 1 de Totais oficial no topo.
    """
    dedup = {}
    for r in rows:
        id_doc = r.get("IdDocumento")
        if id_doc and id_doc != "TotalDocs:":
            chave_dedup = f"{r.get('NIF ComercianteConsumidor', '')}|{r.get('Nº Fatura', '')}|{id_doc}"
            dedup[chave_dedup] = r

    docs = sorted(dedup.values(), key=lambda r: str(r.get("Data Emissão", "") or ""), reverse=True)
    total_retirado = len(docs)
    if total_esperado is None or total_esperado < total_retirado:
        total_esperado = total_retirado

    totals_row = {
        "IdDocumento": "TotalDocs:",
        "Atividade de Realização da Aquisição": total_esperado,
        "NIF ComercianteConsumidor": total_retirado,
        "TipoDoc": 0,
        "Situação": 0,
        "Nº Fatura": 0,
        "ATCUD": 0,
        "Data Emissão": "1899-12-31",
        "Total Iva": 0,
        "Total_Liquido": 0,
        "Base Tributável": 0,
        "SerieDoc": 0,
        "N_Doc": 0,
        "intNDoc": 0,
        "S": 0,
        "N": 0,
        "I": 0,
        "Nome ComerConsu": 0,
        "Nome_ComerConsu": 0,
        "NIF EntidadeEfatura": 0,
        "Nome EntidadeEfatura": 0,
        "Cae": 0,
        "MotivoISE": 0,
        "Base_Ise": 0,
        "Base_Red": 0,
        "Iva_Red": 0,
        "Base_Int": 0,
        "Iva_Int": 0,
        "Base_Nor": 0,
        "Iva_Nor": 0,
        "TaxasIva": 0,
        "Realizado no âmbito da atividade profissional": 0,
        "ValorNaoClassificado": 0,
        "DataHoraDownload": 0,
    }
    return [totals_row] + docs

def exportar_lote_xml_legado_de_horizontal(
    nif,
    horizontal_rows,
    as_buyer=True,
    pasta_raiz=None,
    caminho_personalizado=None,
    data_inicio=None,
    data_fim=None,
    total_esperado=None,
):
    """Gera ficheiros XML legados estruturados na hierarquia BdsefaturaV3 a partir de linhas horizontais."""
    ficheiros_gerados = []
    ultimo_xml_string = ""

    por_mes = {}
    if data_inicio and data_fim:
        try:
            for p_start, p_end in iter_month_periods(data_inicio, data_fim):
                por_mes[(p_start.year, p_start.month)] = []
        except Exception:
            pass

    for row in horizontal_rows:
        if row.get("IdDocumento") == "TotalDocs:":
            continue
        d_str = row.get("Data Emissão", "")
        if d_str and len(d_str) >= 7:
            try:
                parts = d_str.split("-")
                key = (int(parts[0]), int(parts[1]))
            except Exception:
                key = (date.today().year, date.today().month)
        else:
            key = (date.today().year, date.today().month)
        por_mes.setdefault(key, []).append(row)

    if not por_mes and not horizontal_rows:
        return ficheiros_gerados, ultimo_xml_string

    raiz = pasta_raiz or obter_pasta_raiz_dados_padrao()

    for (ano, mes), mes_rows in sorted(por_mes.items()):
        p_expected = total_esperado if total_esperado is not None else len(mes_rows)
        h_rows = reconstruir_horizontal_com_totais(mes_rows, total_esperado=p_expected)
        xml_str = gerar_xml_legado_string(h_rows)
        ultimo_xml_string = xml_str

        caminho_final = None
        if caminho_personalizado:
            caminho_final = caminho_personalizado
        elif raiz:
            caminho_final = construir_caminho_xml_legado(raiz, nif, ano, mes, as_buyer)

        if caminho_final:
            if len(mes_rows) == 0 and os.path.exists(caminho_final):
                # Mês saltado na extração por já estar completo: preserva o XML existente
                continue
            salvar_xml_legado_ficheiro(h_rows, caminho_final)
            ficheiros_gerados.append({
                "ano": ano,
                "mes": mes,
                "caminho": caminho_final,
                "nome_ficheiro": os.path.basename(caminho_final),
                "total_documentos": len(mes_rows),
                "total_esperado": p_expected,
            })

    return ficheiros_gerados, ultimo_xml_string


