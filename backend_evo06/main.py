# -*- coding: utf-8 -*-
"""
API Importador e-Fatura Gexcel V4 (efaturaV4api).
Arquitetura 100% Stateless (Zero Base de Dados local).
Todas as credenciais são transmitidas em tempo real pela aplicação cliente
e eliminadas da memória RAM imediatamente após a conclusão do pedido.
Integração nativa de licenciamento com Gexcel Auth oficial (modo silencioso).
"""

from zeep.exceptions import Fault
import os
import re
import html
import json
import concurrent.futures
import logging
import uuid
import threading
import heapq
import time
import random
import subprocess
import requests
from fastapi import FastAPI, HTTPException, Depends, Header, Query
from datetime import date, datetime
from pydantic import BaseModel, Field, model_validator
from typing import Optional, List, Dict, Any, Callable, Union

try:
    import psutil
except ImportError:
    psutil = None

import efatura_api
import legado_bridge
import license_bridge
import pb_client
import scheduler
from scheduler import SCHEDULER_ENGINE
import cofre_ledger
import auth_manager
import start_hub_evo06
import pipeline_worker
import pendentes_service
import workspace_context

# -------------------------------------------------------------------------
# INTEGRAÇÃO COM A BIBLIOTECA DE WEB SCRAPING E COFRE DE ESTADOS
# -------------------------------------------------------------------------
import sys
from pathlib import Path

# Inclusão do ambiente de bibliotecas portátil (prioriza Dados_evoGex\motor e mantém fallback %LOCALAPPDATA%\GExcelAYD)
_local_app = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~\\AppData\\Local")
_env_dados_dir = (os.environ.get("GEXCEL_DADOS_DIR") or "").strip()
if _env_dados_dir and os.path.exists(_env_dados_dir):
    _ayd_dir = Path(_env_dados_dir) / "motor"
elif sys.platform == "win32" and os.path.exists(r"C:\Dados_evoGex\motor"):
    _ayd_dir = Path(r"C:\Dados_evoGex\motor")
else:
    _ayd_dir = Path(_local_app) / "GExcelAYD"

_py311_libs = _ayd_dir / "libs" / "py311"
for _cand_lib in [_py311_libs, Path(_local_app) / "GExcelAYD" / "libs" / "py311"]:
    if _cand_lib.exists() and str(_cand_lib) not in sys.path:
        sys.path.insert(0, str(_cand_lib))

_INSTALL_LOCK = threading.Lock()
_INSTALL_CONCLUIDO = threading.Event()
_INSTALL_ERRO = None
_BOOTSTRAP_STATUS_MSG = "A instalar dependências, aguarde..."

iniciar_sessao_efatura = None
EFaturaCompras = None
EFaturaVendas = None
ExtratorDetalhes = None
CofreEstadosLedger = None
PersistenciaSQLite = None
GovAuthError = Exception
_BROWSER_SESSION_SEMAPHORE = threading.BoundedSemaphore(2)


def _iniciar_sessao_efatura_segura(nif: str, password: str, headless: bool = True, canal: str = "auto"):
    """
    Inicia sessão web no e-Fatura com limite de arranques simultâneos de navegador (máx. 2),
    prevenindo estrangulamento de CPU/rede e bloqueios WAF em extrações concorrentes de Vendas.
    """
    with _BROWSER_SESSION_SEMAPHORE:
        return iniciar_sessao_efatura(
            nif=nif,
            password=password,
            headless=headless,
            canal=canal,
        )

def _garantir_uv_exe() -> Optional[Path]:
    """Assegura a existência do binário uv.exe em %LOCALAPPDATA%\\GExcelAYD."""
    try:
        uv_exe = _ayd_dir / "uv.exe"
        if uv_exe.exists() and uv_exe.stat().st_size > 1000000:
            return uv_exe
        _ayd_dir.mkdir(parents=True, exist_ok=True)
        logging.getLogger("gexcel.efatura").info("[BOOTSTRAP AYD] A descarregar uv.exe oficial para GExcelAYD...")
        url_uv = "https://gexcelupdates.com/ArqPyd/uv.exe"
        import urllib.request
        req = urllib.request.Request(url_uv, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=40) as r:
            temp_uv = _ayd_dir / "uv.exe.tmp"
            temp_uv.write_bytes(r.read())
            if temp_uv.exists() and temp_uv.stat().st_size > 1000000:
                if uv_exe.exists():
                    try:
                        uv_exe.unlink()
                    except Exception:
                        pass
                temp_uv.replace(uv_exe)
        if uv_exe.exists():
            logging.getLogger("gexcel.efatura").info("[BOOTSTRAP AYD] uv.exe descarregado com sucesso!")
            return uv_exe
    except Exception as e:
        logging.getLogger("gexcel.efatura").warning(f"[BOOTSTRAP AYD] Erro ao descarregar uv.exe: {e}")
    return None


def _garantir_python_engine(uv_exe: Path) -> bool:
    """Garante o interpretador CPython 3.11 portátil em %LOCALAPPDATA%\\GExcelAYD\\python_engine."""
    try:
        py_engine_dir = _ayd_dir / "python_engine"
        if py_engine_dir.exists():
            pythons = list(py_engine_dir.glob("**/python.exe"))
            if pythons:
                return True
        py_engine_dir.mkdir(parents=True, exist_ok=True)
        logging.getLogger("gexcel.efatura").info("[BOOTSTRAP AYD] A preparar Python 3.11 portátil em python_engine via uv...")
        env_cmd = os.environ.copy()
        env_cmd["UV_PYTHON_INSTALL_DIR"] = str(py_engine_dir)
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        cmd = [str(uv_exe), "python", "install", "3.11"]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=180, creationflags=flags, env=env_cmd)
        if res.returncode == 0:
            logging.getLogger("gexcel.efatura").info("[BOOTSTRAP AYD] Python 3.11 instalado com sucesso em python_engine!")
            return True
        else:
            logging.getLogger("gexcel.efatura").warning(f"[BOOTSTRAP AYD] Falha ao instalar Python 3.11: {res.stderr[:200]}")
    except Exception as e:
        logging.getLogger("gexcel.efatura").warning(f"[BOOTSTRAP AYD] Erro ao garantir python_engine: {e}")
    return False


def _sincronizar_requirements_gsheet() -> tuple[bool, str]:
    """
    Sincroniza o ficheiro requirements311.txt com o Google Sheet oficial do Ecossistema Gexcel
    e instala/atualiza dependências na pasta %LOCALAPPDATA%\\GExcelAYD\\libs\\py311 via uv.exe.
    Replica com exatidão a rotina oficial do Excel VBA (arquitetura_pyd.bas / consultaOpçõesOnline.bas).
    """
    try:
        import html
        import urllib.request
        uv_exe = _garantir_uv_exe()
        if not uv_exe:
            return False, "uv.exe não encontrado em GExcelAYD"

        _garantir_python_engine(uv_exe)

        url_sheet = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTy3H6S1cR13J1Dts9MgiBtPJvjSP4fgdKhn8ezIqvEEAkomROIcTdibcP0hnuE2s6q8l8DBF-5_BPK/pubhtml/sheet?headers=false&gid=0"
        req = urllib.request.Request(url_sheet, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            conteudo = resp.read().decode("utf-8", errors="ignore")

        unescaped = html.unescape(conteudo)
        m_vers = re.search(r"<pv6_vers[aã]o_REQ311>(.*?)</pv6_vers[aã]o_REQ311>", unescaped, re.I)
        m_link = re.search(r"<pv6_link1_REQ311>(.*?)</pv6_link1_REQ311>", unescaped, re.I)
        if not m_vers or not m_link:
            return False, "Tags de versão/link não encontradas na Google Sheet"

        versao_remota = m_vers.group(1).strip()
        link_remoto = m_link.group(1).strip()

        # Ler versão instalada no versões.ini local
        ini_path = _ayd_dir / "versões.ini"
        versao_local = ""
        if ini_path.exists():
            try:
                ini_txt = ini_path.read_text(encoding="utf-8", errors="ignore")
                m_loc = re.search(r"<pv6_vers[aã]o_REQ311>(.*?)</pv6_vers[aã]o_REQ311>", ini_txt, re.I)
                if m_loc:
                    versao_local = m_loc.group(1).strip()
            except Exception:
                pass

        req_local = _ayd_dir / "requirements311.txt"
        precisa_atualizar = (versao_remota != versao_local) or (not req_local.exists())

        if precisa_atualizar:
            logging.getLogger("gexcel.efatura").info(
                f"[LIBS AYD] A descarregar requirements311.txt {versao_remota} (local: {versao_local or 'N/A'})..."
            )
            req_dl = urllib.request.Request(link_remoto, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req_dl, timeout=15) as r_dl:
                req_local.write_bytes(r_dl.read())

            _py311_libs.mkdir(parents=True, exist_ok=True)
            python_engine_dir = _ayd_dir / "python_engine"
            env_cmd = os.environ.copy()
            if python_engine_dir.exists():
                env_cmd["UV_PYTHON_INSTALL_DIR"] = str(python_engine_dir)

            cmd = [
                str(uv_exe), "pip", "install", "-r", str(req_local),
                "--python", "311", "--target", str(_py311_libs)
            ]
            flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=180, creationflags=flags, env=env_cmd)
            if res.returncode == 0:
                try:
                    conteudo_ini = ini_path.read_text(encoding="utf-8", errors="ignore") if ini_path.exists() else ""
                    if "<pv6_versão_REQ311>" in conteudo_ini:
                        novo_ini = re.sub(
                            r"<pv6_vers[aã]o_REQ311>.*?</pv6_vers[aã]o_REQ311>",
                            f"<pv6_versão_REQ311>{versao_remota}</pv6_versão_REQ311>",
                            conteudo_ini, flags=re.I
                        )
                    else:
                        novo_ini = conteudo_ini.strip() + f"\n<pv6_versão_REQ311>{versao_remota}</pv6_versão_REQ311>\n"
                    ini_path.write_text(novo_ini, encoding="utf-8")
                except Exception:
                    pass
                return True, f"Atualizado com sucesso para {versao_remota}"
            else:
                return False, f"Falha uv.exe pip install: {res.stderr[:200]}"

        return True, f"Já na versão mais recente ({versao_local})"
    except Exception as e:
        return False, str(e)


def _tentar_importar_scraper() -> bool:
    """Tenta importar a biblioteca efatura_scraper garantindo os caminhos necessários."""
    global iniciar_sessao_efatura, EFaturaCompras, EFaturaVendas, ExtratorDetalhes
    global CofreEstadosLedger, PersistenciaSQLite, GovAuthError, _INSTALL_ERRO

    import importlib.util
    base_evo = Path(__file__).resolve().parent.parent
    dev_paths = [
        base_evo / "03.9_SCR_EVO_Scrapers_Gov" / "SCR-01_Logins_Gov",
        base_evo / "03.9_SCR_EVO_Scrapers_Gov" / "SCR-02_Scrap_Efatura",
        Path(r"C:\DEV\Ecossistema_Gexcel\03_EVO_Ecossistema_Evo\03.9_SCR_EVO_Scrapers_Gov\SCR-01_Logins_Gov"),
        Path(r"C:\DEV\Ecossistema_Gexcel\03_EVO_Ecossistema_Evo\03.9_SCR_EVO_Scrapers_Gov\SCR-02_Scrap_Efatura"),
    ]
    for dp in dev_paths:
        if dp.exists() and str(dp) not in sys.path:
            sys.path.insert(0, str(dp))

    if _py311_libs.exists() and str(_py311_libs) not in sys.path:
        sys.path.insert(0, str(_py311_libs))

    for pkg_obrigatorio in ("playwright", "pyee", "greenlet"):
        if not (_py311_libs / pkg_obrigatorio).exists() and importlib.util.find_spec(pkg_obrigatorio) is None:
            _INSTALL_ERRO = f"Dependência '{pkg_obrigatorio}' ausente em {_py311_libs}"
            iniciar_sessao_efatura = None
            EFaturaCompras = None
            EFaturaVendas = None
            ExtratorDetalhes = None
            CofreEstadosLedger = None
            PersistenciaSQLite = None
            GovAuthError = Exception
            return False

    try:
        from efatura_scraper import (
            iniciar_sessao_efatura as _ise,
            EFaturaCompras as _efc,
            EFaturaVendas as _efv,
            ExtratorDetalhes as _ed,
            CofreEstadosLedger as _cel,
            PersistenciaSQLite as _psl,
            GovAuthError as _gae
        )
        iniciar_sessao_efatura = _ise
        EFaturaCompras = _efc
        EFaturaVendas = _efv
        ExtratorDetalhes = _ed
        CofreEstadosLedger = _cel
        PersistenciaSQLite = _psl
        GovAuthError = _gae
        _INSTALL_ERRO = None
        return True
    except Exception as e:
        _INSTALL_ERRO = f"{type(e).__name__}: {e}"
        logging.getLogger("gexcel.efatura").warning(f"[BOOTSTRAP AYD] Falha ao importar efatura_scraper: {_INSTALL_ERRO}")
        iniciar_sessao_efatura = None
        EFaturaCompras = None
        EFaturaVendas = None
        ExtratorDetalhes = None
        CofreEstadosLedger = None
        PersistenciaSQLite = None
        GovAuthError = Exception
        return False


def _garantir_playwright_e_ambiente(progress_cb=None) -> bool:
    """
    Garante a cadeia completa e autónoma de dependências em %LOCALAPPDATA%\\GExcelAYD:
    1. uv.exe
    2. python_engine (Python 3.11)
    3. libs\\py311\\playwright
    4. Sincronização com Google Sheet (requirements311.txt)
    """
    with _INSTALL_LOCK:
        global _INSTALL_ERRO, _BOOTSTRAP_STATUS_MSG
        try:
            _BOOTSTRAP_STATUS_MSG = "A configurar ambiente de execução, aguarde..."
            if progress_cb: progress_cb(_BOOTSTRAP_STATUS_MSG)
            uv_exe = _garantir_uv_exe()
            if not uv_exe:
                _INSTALL_ERRO = "uv.exe indisponível"
                return False

            _BOOTSTRAP_STATUS_MSG = "A preparar componentes do sistema, aguarde..."
            if progress_cb: progress_cb(_BOOTSTRAP_STATUS_MSG)
            if not _garantir_python_engine(uv_exe):
                _INSTALL_ERRO = "Falha ao preparar python_engine 3.11"
                return False

            _py311_libs.mkdir(parents=True, exist_ok=True)
            if str(_py311_libs) not in sys.path:
                sys.path.insert(0, str(_py311_libs))

            try:
                _sincronizar_requirements_gsheet()
            except Exception:
                pass

            pkgs_webscraping = ("playwright", "pyee", "greenlet")
            faltam_deps = any(not (_py311_libs / pkg).exists() for pkg in pkgs_webscraping)
            if faltam_deps or not _tentar_importar_scraper():
                _BOOTSTRAP_STATUS_MSG = "A instalar dependências, aguarde..."
                if progress_cb: progress_cb(_BOOTSTRAP_STATUS_MSG)
                logging.getLogger("gexcel.efatura").info(
                    "[BOOTSTRAP AYD] A instalar/reparar playwright, pyee e greenlet em libs\\py311..."
                )
                env_cmd = os.environ.copy()
                env_cmd["UV_PYTHON_INSTALL_DIR"] = str(_ayd_dir / "python_engine")
                flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
                cmd = [
                    str(uv_exe), "pip", "install", "playwright", "pyee", "greenlet",
                    "--python", "311", "--target", str(_py311_libs)
                ]
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=120, creationflags=flags, env=env_cmd)
                if res.returncode != 0:
                    logging.getLogger("gexcel.efatura").warning(f"[BOOTSTRAP AYD] Aviso na instalação: {res.stderr[:200]}")

            import importlib
            importlib.invalidate_caches()

            _BOOTSTRAP_STATUS_MSG = "A concluir preparação das dependências..."
            if progress_cb: progress_cb(_BOOTSTRAP_STATUS_MSG)

            sucesso = _tentar_importar_scraper()
            _INSTALL_CONCLUIDO.set()
            return sucesso
        except Exception as e:
            _INSTALL_ERRO = str(e)
            logging.getLogger("gexcel.efatura").error(f"[BOOTSTRAP AYD] Erro na auto-instalação de dependências: {e}")
            _INSTALL_CONCLUIDO.set()
            return False

def _carregar_efatura_scraper() -> bool:
    """Carrega o efatura_scraper se disponível; caso contrário, dispara o bootstrap em segundo plano."""
    if _tentar_importar_scraper():
        _INSTALL_CONCLUIDO.set()
        return True

    if sys.platform != "win32":
        _INSTALL_CONCLUIDO.set()
        return False

    # Se ainda não está disponível, lança o bootstrap completo em background
    # para NÃO atrasar o arranque do servidor nem falhar o healthcheck inicial
    threading.Thread(target=_garantir_playwright_e_ambiente, daemon=True, name="BootstrapAYD").start()
    return False

_carregar_efatura_scraper()

if sys.platform != "win32":
    try:
        import resource
        _soft_lim, _hard_lim = resource.getrlimit(resource.RLIMIT_NOFILE)
        _target_lim = min(max(_soft_lim, 65536), _hard_lim)
        if _target_lim > _soft_lim:
            resource.setrlimit(resource.RLIMIT_NOFILE, (_target_lim, _hard_lim))
    except Exception:
        pass

API_VERSION = os.environ.get("GEXCEL_EFATURA_VERSION", "4.2.29")
BUILD_NUMBER = 53
_PROCESS_BOOT_STR = datetime.now().strftime("%d/%m %H:%M")
_PROCESS_BOOT_SHORT = datetime.now().strftime("%H:%M")
_PROCESS_MODE = "EXE" if getattr(sys, "frozen", False) else "DEV"
LOGGER = logging.getLogger("gexcel.efatura")

def obter_tag_versao_build() -> str:
    """
    Retorna a tag oficial de versão, modo (DEV/EXE) e hora real de arranque do processo em memória.
    Permite aos clientes (Excel VBA / Desktop) visualizarem de forma imediata e assertiva qual a instância ativa.
    """
    return f"[v{API_VERSION} · {_PROCESS_MODE} {_PROCESS_BOOT_STR}]"

def formatar_msg_com_build(msg: str) -> str:
    """Anexa a tag de versão/build no início da mensagem caso ainda não esteja presente."""
    tag = obter_tag_versao_build()
    msg_limpa = str(msg or "").strip()
    if not tag or not msg_limpa:
        return msg_limpa or tag
    if msg_limpa.startswith(tag) or msg_limpa.startswith(f"[v{API_VERSION}"):
        return msg_limpa
    return f"{tag} {msg_limpa}"

app = FastAPI(title="API Importador e-Fatura Gexcel", description="API local de alta performance", version=API_VERSION)

from fastapi import Request, Response
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_credentials=True, allow_methods=['*'], allow_headers=['*'])

@app.middleware("http")
async def add_pna_headers(request: Request, call_next):
    if request.method == "OPTIONS":
        resp = Response(status_code=204)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "*"
        resp.headers["Access-Control-Allow-Private-Network"] = "true"
        return resp
    raw_ws = request.headers.get("x-evo-workspace-id") or request.query_params.get("ws_id") or ""
    tok_ws = workspace_context.set_current_ws_id(raw_ws)
    ws_empty_hdr = "0"
    try:
        response = await call_next(request)
        if workspace_context.is_cloud_zero_storage() and not workspace_context.get_entidades_ram():
            ws_empty_hdr = "1"
    finally:
        workspace_context.reset_current_ws_id(tok_ws)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Access-Control-Expose-Headers"] = "X-Evo-Zero-Storage, X-Evo-Ws-Empty"
    response.headers["X-Evo-Zero-Storage"] = "1" if workspace_context.is_cloud_zero_storage() else "0"
    response.headers["X-Evo-Ws-Empty"] = ws_empty_hdr
    return response

# -------------------------------------------------------------------------
# DEPENDÊNCIA DE SEGURANÇA E LICENCIAMENTO GEXCEL AUTH
# -------------------------------------------------------------------------
def verificar_licenca_ativa():
    """
    Valida a licença silenciosamente através do Gexcel Auth oficial.
    Rejeita com HTTP 403 caso o posto de trabalho não esteja autorizado.
    """
    lic = license_bridge.verificar_licenca()
    if not lic.get("autorizado", False):
        raise HTTPException(
            status_code=403,
            detail={
                "erro": "LICENCA_NAO_AUTORIZADA",
                "motivo": lic.get("motivo", "SEM_LICENCA"),
                "app_id": "efaturaV4api",
                "hardware_id": lic.get("hardware_id"),
                "mensagem": "Este posto de trabalho não possui uma licença ativa do Gexcel Auth para o módulo efaturaV4api."
            }
        )
    return lic

# -------------------------------------------------------------------------
# MODELOS DE DADOS STATELESS (Pydantic)
# -------------------------------------------------------------------------
class TestConnectionRequest(BaseModel):
    nif: str
    subutilizador: str
    password: str

class ExtracaoRequest(BaseModel):
    nif: str
    subutilizador: Optional[str] = ""
    password: Optional[str] = ""
    data_inicio: date
    data_fim: date
    tipo: str = Field(default="compras", description="'compras' ou 'vendas'")
    nome_entidade: Optional[str] = Field(default="", description="Nome opcional da empresa")
    reimportar_tudo: bool = Field(default=False, description="Se True, apaga os registos antigos no PB antes de extrair (Wipe & Fetch)")
    reimportar: Optional[Union[bool, str]] = Field(default=None, description="Suporta 'R', 'r', True para compatibilidade com parâmetro R do Excel")
    modo: Optional[str] = Field(default=None, description="Modo de operação (ex: 'R' para reimportação)")
    volume_estimado: Optional[int] = Field(default=None, description="Volume estimado de faturas para ordenação da fila SJF")
    gerar_xml_legado: bool = Field(default=False, description="Se True, gera os ficheiros XML legados com estrutura BdsefaturaV3")
    modo_saida: Optional[str] = Field(default="sqlite", description="Modo de saída dos dados: 'sqlite' (padrão EVO: alta performance), 'memoria', 'xml', 'ambos'")
    anos_retencao: Optional[int] = Field(default=3, description="Janela deslizante de anos a manter no SQLite local (default 3). 0 desativa a purga")
    pasta_raiz_dados: Optional[str] = Field(default=None, description="Pasta raiz dos dados GexcelApps (ex: C:\\Users\\...\\AA_MultiIntegrador)")
    caminho_xml_personalizado: Optional[str] = Field(default=None, description="Caminho completo de ficheiro XML customizado (opcional)")
    obter_anuladas: bool = Field(default=False, description="Se True, executa scraping adicional a pedido de faturas canceladas na AT")
    forcar_scraper: bool = Field(default=False, description="Se True, força a recolha pelo Portal Web e-Fatura (ignorando SOAP e cache local)")

    @model_validator(mode="before")
    @classmethod
    def normalizar_reimportar(cls, values):
        if isinstance(values, dict):
            chaves_candidatas = [
                "reimportar", "modo", "reimportar_tudo", "parametro", "parametros",
                "opcao", "opcoes", "flag", "cmd", "acao", "action", "importar", "import_ir",
                "force", "forcar", "wipe"
            ]
            tem_chave_reimportar = any(k in values for k in chaves_candidatas)
            for k in chaves_candidatas:
                v = values.get(k)
                if v is True:
                    values["reimportar_tudo"] = True
                    break
                if v is not None:
                    v_str = str(v).strip().lstrip("-/ ").upper()
                    if v_str in ("R", "REIMPORTAR", "TRUE", "1", "YES", "SIM", "WIPE"):
                        values["reimportar_tudo"] = True
                        break
                    if v_str in ("W", "WEB", "SCRAPER", "PORTAL", "S", "RW", "WR", "REIMPORTAR_WEB"):
                        values["reimportar_tudo"] = True
                        values["forcar_scraper"] = True
                        break
            # Compatibilidade com livros Excel legados em que api_efatura311 não enviava a chave reimportar_tudo:
            # força reimportar_tudo=True para garantir zero cache quando o utilizador coloca -r / r no Excel.
            if not tem_chave_reimportar and "modo_saida" not in values and "gerar_xml_legado" not in values:
                values["reimportar_tudo"] = True

            chaves_scraper = ["forcar_scraper", "usar_scraper", "modo_scraper", "web_scraping"]
            for ks in chaves_scraper:
                vs = values.get(ks)
                if vs is True:
                    values["forcar_scraper"] = True
                    break
                if vs is not None:
                    vs_str = str(vs).strip().lstrip("-/ ").upper()
                    if vs_str in ("TRUE", "1", "YES", "SIM", "W", "WEB", "SCRAPER", "PORTAL"):
                        values["forcar_scraper"] = True
                        break

            chaves_anuladas = ["obter_anuladas", "incluir_anuladas", "anuladas", "canceladas", "scrape_anuladas"]
            for ka in chaves_anuladas:
                va = values.get(ka)
                if va is True:
                    values["obter_anuladas"] = True
                    break
                if va is not None:
                    va_str = str(va).strip().lstrip("-/ ").upper()
                    if va_str in ("TRUE", "1", "YES", "SIM", "ANULADAS", "A"):
                        values["obter_anuladas"] = True
                        break
        return values

class ManutencaoRetencaoRequest(BaseModel):
    nif: Optional[str] = Field(default=None, description="NIF específico ou None/TODOS para todas as entidades")
    tipo: str = Field(default="ambos", description="'compras', 'vendas' ou 'ambos'")
    anos_retencao: int = Field(default=3, description="Número de anos civis a manter na base de dados")
    ano_referencia: Optional[int] = Field(default=None, description="Ano de corte de referência (None = ano corrente)")

class ExportarXmlRequest(BaseModel):
    nif: str
    horizontal_rows: list[dict]
    pasta_raiz_dados: Optional[str] = Field(default=None, description="Pasta raiz dos dados GexcelApps")
    caminho_personalizado: Optional[str] = Field(default=None, description="Caminho completo do ficheiro XML a gravar")
    ano: Optional[int] = Field(default=None, description="Ano fiscal de referência")
    mes: Optional[int] = Field(default=None, description="Mês civil de referência (1-12)")
    tipo: Optional[str] = Field(default="compras", description="'compras' ou 'vendas'")

class SondagemTotaisRequest(BaseModel):
    nif: str = Field(..., description="NIF da entidade a consultar")
    subutilizador: Optional[str] = Field(default="", description="Subutilizador AT (opcional se registado no PocketBase)")
    password: Optional[str] = Field(default="", description="Senha AT (opcional se registada no PocketBase)")
    ano: Optional[int] = Field(default=None, description="Ano civil de referência (ex: 2026). Por defeito, ano corrente")
    meses: Optional[List[int]] = Field(default=None, description="Lista opcional de meses a consultar [1..12]")
    data_inicio: Optional[date] = Field(default=None, description="Data início customizada (alternativa ao ano)")
    data_fim: Optional[date] = Field(default=None, description="Data fim customizada (alternativa ao ano)")
    tipo: str = Field(default="vendas", description="'vendas' ou 'compras'")

class SondagemTotaisLoteRequest(BaseModel):
    nifs: Optional[List[str]] = Field(default=None, description="Lista de NIFs a consultar. Se omitido/vazio, consulta todas as entidades do PocketBase com senha configurada")
    ano: Optional[int] = Field(default=None, description="Ano civil de referência (ex: 2026). Por defeito, ano corrente")
    meses: Optional[List[int]] = Field(default=None, description="Lista opcional de meses a consultar [1..12]")
    tipo: str = Field(default="vendas", description="'vendas' ou 'compras'")
    max_concorrencia: int = Field(default=2, ge=1, le=5, description="Número de trabalhadores concorrentes (1 a 5)")

class ScrapeAnuladasRequest(BaseModel):
    nif: str = Field(..., description="NIF da entidade titular")
    ano: Optional[int] = Field(default=None, description="Ano da consulta (ex: 2024)")
    mes: Optional[int] = Field(default=None, description="Mês específico (1 a 12)")
    data_inicio: Optional[str] = Field(default=None, description="Data de início (YYYY-MM-DD)")
    data_fim: Optional[str] = Field(default=None, description="Data de fim (YYYY-MM-DD)")
    modulo: str = Field(default="compras", description="'compras' ou 'vendas'")
    canal: Optional[str] = Field(default="msedge", description="Navegador ('msedge', 'chrome', 'auto')")
    password: Optional[str] = Field(default=None, description="Senha opcional da AT. Se omitida, recupera de tCredenciais.xml / entidades_senhas")
    threads: Optional[int] = Field(default=6, description="Threads paralelas para extração de detalhes")
    gravar_db: Optional[bool] = Field(default=True, description="Se True, grava nas bases SQLite e no Cofre")

class LoginBrowserRequest(BaseModel):
    nif: str = Field(..., description="NIF da entidade a abrir no navegador")
    canal: Optional[str] = Field(default="auto", description="Navegador ('auto', 'msedge', 'chrome')")
    destino: Optional[str] = Field(default="efatura", description="Destino: 'efatura' ou 'portal'")
    password: Optional[str] = Field(default=None, description="Senha opcional da AT. Se omitida, recupera de tCredenciais.xml / entidades_senhas")



def classificar_erro_at(erro_obj_ou_str) -> dict:
    """
    Classifica com rigor e precisão a origem da falha retornada pela AT.
    Distingue:
    - 'senha_invalida': Credenciais comprovadamente erradas (ex: utilizador/senha inválidos). Apenas este memoriza em senhas_invalidas_at.
    - 'servidor_at': Erro 500 ou falha de comunicação interna nos servidores da AT (senha correta, NÃO bloquear!).
    - 'permissao_subuser': Subutilizador sem perfil ativo no Portal das Finanças.
    - 'timeout_rede': Timeout de ligação com a AT.
    - 'rate_limit': Limite de chamadas concorrentes da AT excedido.
    - 'outro': Outro erro genérico.
    """
    texto = str(erro_obj_ou_str or "").strip()
    texto_lower = texto.lower()

    # 1. Falha interna dos servidores da AT (HTTP 500 / Falha comunicacao com Servidor de Autenticacao)
    # A AT devolve "Falha comunicacao com Servidor de Autenticacao (500)" quando o seu próprio LDAP/SSO falha.
    # A senha NÃO está errada!
    if any(p in texto_lower for p in [
        "falha comunicacao com servidor de autenticacao",
        "falha comunicacao com servidor",
        "falha de comunicacao",
        "(500)",
        "internal server error",
        "servidor indisponivel",
        "serviço indisponível",
        "servico temporariamente indisponivel",
        "server unavailable",
        "em manutenção",
        "em manutencao",
        "502", "503", "504"
    ]):
        return {
            "tipo_erro": "servidor_at",
            "memorizar_invalida": False,
            "badge_label": "Servidor AT (500)",
            "mensagem_amigavel": "Instabilidade Temporária no Servidor da AT (500)",
            "detalhe": "Os servidores internos da AT falharam a resposta interna. A senha está correta; tente novamente daqui a momentos."
        }

    # 2. Timeout ou quebra de ligação de rede / falha de carregamento do site
    if any(p in texto_lower for p in [
        "impossível carregar o site", "impossivel carregar o site", "carregar o site",
        "após 3 tentativas", "apos 3 tentativas",
        "timeout", "timed out", "connection reset", "connection refused", 
        "remote end closed", "socket", "eof occurred in violation"
    ]):
        return {
            "tipo_erro": "timeout_rede",
            "memorizar_invalida": False,
            "badge_label": "Timeout AT",
            "mensagem_amigavel": "Tempo Limite da AT Excedido (Timeout de Rede)",
            "detalhe": "A ligação ao portal da AT expirou ou demorou a carregar. A senha está intacta; tente novamente."
        }

    # 3. Rate Limit / Bloqueio temporário de pedidos
    if any(p in texto_lower for p in [
        "rate limit", "limite de pedidos", "demasiados pedidos", "too many requests", "429"
    ]):
        return {
            "tipo_erro": "rate_limit",
            "memorizar_invalida": False,
            "badge_label": "Rate Limit AT",
            "mensagem_amigavel": "Limite de Chamadas da AT Excedido",
            "detalhe": "A AT restringiu temporariamente os pedidos para este NIF. Aguarde alguns minutos."
        }

    # 4. Falta de permissões do subutilizador
    if any(p in texto_lower for p in [
        "permissao", "permissões", "não autorizado", "nao autorizado", 
        "sem autorizacao", "sem perfil", "perfil insuficiente", "permissao insuficiente"
    ]):
        return {
            "tipo_erro": "permissao_subuser",
            "memorizar_invalida": False,
            "badge_label": "Sem Permissão AT",
            "mensagem_amigavel": "Subutilizador Sem Permissão no Portal das Finanças",
            "detalhe": "O subutilizador não tem a opção 'Consultar Faturas' ativa no Portal das Finanças."
        }

    # 5. Limite de volume excedido para esta versão
    if any(p in texto_lower for p in ["limite suportado", "capacidade de processamento", "grande débito"]):
        return {
            "tipo_erro": "volume_excedido",
            "memorizar_invalida": False,
            "badge_label": "Volume Elevado",
            "mensagem_amigavel": texto,
            "detalhe": texto
        }

    # 6. Segundo Fator de Autenticação (2FA / SMS / Email) pendente ou expirado
    if any(p in texto_lower for p in [
        "2fa", "dois fatores", "segundo fator", "duplo fator", "sms", "otp", 
        "código de validação", "codigo de validacao", "código não recebido", "codigo nao recebido"
    ]):
        return {
            "tipo_erro": "timeout_2fa",
            "memorizar_invalida": False,
            "badge_label": "2FA Expirado",
            "mensagem_amigavel": "Autenticação 2FA Pendente / Expirada",
            "detalhe": "A AT solicitou validação por 2º fator (SMS/Email) que não foi introduzida a tempo. O lote prosseguiu."
        }

    # 7. Credencial temporariamente suspensa pela AT por tentativas excedidas
    if any(p in texto_lower for p in [
        "temporariamente suspensa", "tentativas de login excedido", "tentativas excedido", "bloqueada temporariamente"
    ]):
        return {
            "tipo_erro": "conta_suspensa",
            "memorizar_invalida": False,
            "badge_label": "Conta Suspensa AT",
            "mensagem_amigavel": "Acesso Temporariamente Suspenso pela AT",
            "detalhe": "A AT suspendeu temporariamente o login por tentativas consecutivas no portal. Aguarde cerca de 15 a 30 minutos antes de tentar novamente."
        }

    # 8. Senha ou utilizador comprovadamente incorretos / rejeitados (nunca em falsos-positivos de rede/site)
    if not pb_client.is_erro_falso_positivo_at(texto) and any(p in texto_lower for p in [
        "senha invalida", "senha inválida", "password invalida", "password inválida",
        "utilizador ou senha invalidos", "utilizador ou senha inválidos",
        "utilizador ou a senha", "credenciais invalidas", "credenciais inválidas",
        "credenciais rejeitadas pelo portal",
        "utilizador inexistente", "autenticacao invalida", "autenticação inválida",
        "erro na autenticacao dos contribuintes", "erro na autenticação dos contribuintes",
        "erro na autenticacao", "erro na autenticação",
        "tem mais 4 tentativas", "tem mais 3 tentativas", "tem mais 2 tentativas", "tem mais 1 tentativa",
        "restam-lhe", "verifique se não está a utilizar maiúsculas", "verifique se nao esta a utilizar maiusculas",
        "invalid credentials", "authentication failed"
    ]):
        return {
            "tipo_erro": "senha_invalida",
            "memorizar_invalida": True,
            "badge_label": "Senha Rejeitada AT",
            "mensagem_amigavel": "Senha ou Subutilizador Rejeitado pela AT",
            "detalhe": f"A AT recusou formalmente as credenciais: {texto}."
        }

    # 6. Fallback genérico para Faults não categorizados
    return {
        "tipo_erro": "outro",
        "memorizar_invalida": False,
        "badge_label": "Erro AT",
        "mensagem_amigavel": "Erro na Comunicação com a AT",
        "detalhe": texto or "A AT devolveu um erro inesperado."
    }

_MODO_TESTE_SCRAPER = {
    "ativo": str(os.environ.get("GEXCEL_SIMULAR_RECUSA_SOAP", "")).strip().lower() in ("1", "true", "sim", "on", "yes"),
    "ultimas_extracoes": [],
}


def _deve_acionar_failover_scraper(ws_err: Any) -> bool:
    """
    Determina se uma falha ou recusa do Webservice SOAP da AT deve acionar contingência transparente
    para o Portal Web e-Fatura (incluindo subutilizadores sem perfil WFA ou 'Ocorreu um erro na autenticacao dos contribuintes.').
    Apenas bloqueia failover em limites de volume ou conta AT formalmente suspensa por excesso de tentativas.
    """
    if isinstance(ws_err, efatura_api.LimiteVolumeExcedidoError):
        return False
    msg = str(getattr(ws_err, "description", "") or getattr(ws_err, "message", "") or ws_err or "").lower()
    termos_suspensao = (
        "temporariamente suspensa",
        "bloqueada temporariamente",
        "tentativas de login excedido",
        "tentativas excedido",
        "acesso suspenso",
    )
    if any(t in msg for t in termos_suspensao):
        return False
    return True


def _garantir_scraper_pronto(progress_cb: Optional[Callable[[str], None]] = None, ano_ref: Optional[int] = None) -> None:
    """Garante que o motor de Web Scraping e o Playwright estão carregados antes da extração/contingência."""
    if iniciar_sessao_efatura is None:
        inicio_espera = time.time()
        while not _INSTALL_CONCLUIDO.is_set() and (time.time() - inicio_espera < 180):
            if progress_cb:
                try:
                    progress_cb(_BOOTSTRAP_STATUS_MSG)
                except Exception:
                    pass
            _INSTALL_CONCLUIDO.wait(timeout=1.0)
        _carregar_efatura_scraper()
        if iniciar_sessao_efatura is None:
            _garantir_playwright_e_ambiente(progress_cb=progress_cb)
            _carregar_efatura_scraper()
    if iniciar_sessao_efatura is None:
        ref_txt = f" do ano {ano_ref}" if ano_ref else ""
        raise RuntimeError(
            f"A consulta pelo Portal Web{ref_txt} requer dependências adicionais, mas a instalação não foi concluída a tempo. Tente novamente dentro de momentos."
        )


def _registar_auditoria_extracao(nif: str, periodo: str, tipo: str, metodo: str, total_docs: int, motivo: str = "") -> None:
    """Regista em memória as últimas extrações e o canal efetivamente utilizado (soap_api vs web_scraping)."""
    try:
        reg = {
            "em": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "nif": re.sub(r"[^0-9]", "", str(nif or "")).strip()[:9],
            "periodo": periodo,
            "tipo": tipo,
            "metodo": metodo,
            "total_documentos": int(total_docs or 0),
            "motivo": motivo,
        }
        lista = _MODO_TESTE_SCRAPER.setdefault("ultimas_extracoes", [])
        lista.insert(0, reg)
        if len(lista) > 30:
            del lista[30:]
    except Exception:
        pass


class ModoTesteScraperRequest(BaseModel):
    ativo: bool = True


# -------------------------------------------------------------------------
# ROTAS DO SISTEMA E HEALTHCHECK
# -------------------------------------------------------------------------
@app.get("/")
@app.get("/api/health")
@app.get("/api/efatura/health")
async def read_root():
    """Endpoint oficial de healthcheck consumido por clientes VBA, Desktop e Plataforma Cloud."""
    try:
        porta_ativa = int(os.environ.get("GEXCEL_EFATURA_PORT", "8015"))
    except ValueError:
        porta_ativa = 8015
    tag_build = obter_tag_versao_build()
    sim_ativa = bool(_MODO_TESTE_SCRAPER.get("ativo"))
    sufixo_sim = " · [Simulação Portal Web Ativa]" if sim_ativa else ""
    return {
        "status": "ok",
        "assinatura": "API Importador e-Fatura Gexcel",
        "app_id": "efaturaV4api",
        "versao": API_VERSION,
        "versao_base": API_VERSION,
        "build_number": BUILD_NUMBER,
        "origem_motor": "cloud" if sys.platform != "win32" else "local",
        "pid": os.getpid(),
        "modo_execucao": _PROCESS_MODE,
        "arranque_em": _PROCESS_BOOT_STR,
        "tag_build": tag_build,
        "porta": porta_ativa,
        "modo": "STATELESS",
        "modo_teste_scraper": sim_ativa,
        "message": f"API do importador e-fatura está operacional {tag_build}{sufixo_sim}."
    }


@app.get("/api/modo-teste-scraper")
def obter_modo_teste_scraper():
    """Consulta o estado da simulação de recusa SOAP (para testar Web Scraping em 2025/2026) e histórico recente."""
    return {
        "status": "ok",
        "assinatura": "API Importador e-Fatura Gexcel",
        "modo_teste_scraper": bool(_MODO_TESTE_SCRAPER.get("ativo")),
        "ultimas_extracoes": list(_MODO_TESTE_SCRAPER.get("ultimas_extracoes", [])),
    }


@app.post("/api/modo-teste-scraper")
def alterar_modo_teste_scraper(req: ModoTesteScraperRequest):
    """Ativa ou desativa em tempo real a simulação de recusa do Webservice SOAP para forçar contingência Portal Web."""
    _MODO_TESTE_SCRAPER["ativo"] = bool(req.ativo)
    estado_txt = "ATIVADO" if _MODO_TESTE_SCRAPER["ativo"] else "DESATIVADO"
    LOGGER.info(f"🧪 [MODO TESTE SCRAPER] Simulador de recusa SOAP {estado_txt}.")
    return {
        "status": "ok",
        "assinatura": "API Importador e-Fatura Gexcel",
        "modo_teste_scraper": bool(_MODO_TESTE_SCRAPER["ativo"]),
        "mensagem": f"Modo de teste Portal Web {estado_txt.lower()}.",
    }

@app.post("/api/motor/ligar")
async def api_ligar_motor():
    """Confirma prontidão do motor e-Fatura."""
    return await read_root()

@app.get("/api/entidades")
def api_obter_entidades():
    """
    Devolve a lista de entidades disponíveis para a interface.
    Lê diretamente de tCredenciais.xml via legado_bridge (ou fallback SQLite).
    """
    entidades = pb_client.get_lista_entidades_ui()
    return {
        "status": "ok",
        "assinatura": "API Importador e-Fatura Gexcel",
        "total": len(entidades),
        "entidades": entidades
    }

@app.get("/api/licenca/estado")
def get_licenca_estado():
    """Consulta o estado atual da licença no Gexcel Auth oficial."""
    return license_bridge.verificar_licenca()

@app.post("/api/licenca/abrir-painel")
def abrir_painel_licenca():
    """Abre a janela de suporte e registo de licenças em segundo plano."""
    threading.Thread(target=license_bridge.abrir_painel_suporte, daemon=True).start()
    return {"status": "ok", "mensagem": "Painel de suporte acionado com sucesso."}

# -------------------------------------------------------------------------
# TESTE DE CONEXÃO DIRETO À AT
# -------------------------------------------------------------------------
@app.post("/api/test-connection")
def api_test_connection(req: TestConnectionRequest, lic = Depends(verificar_licenca_ativa)):
    """Valida a autenticação na AT com as credenciais fornecidas no pedido."""
    today = date.today()
    try:
        invoices = efatura_api.get_invoices(
            req.nif,
            req.subutilizador,
            req.password,
            today,
            today,
            page_size=1,
        )
        return {
            "status": "ok",
            "assinatura": "API Importador e-Fatura Gexcel",
            "message": "Ligação autenticada com sucesso na AT.",
            "documents_on_date": len(invoices),
        }
    except efatura_api.ATAPIError as e:
        info = classificar_erro_at(e.description or e)
        raise HTTPException(
            status_code=502,
            detail={
                "at_code": e.code,
                "at_message": e.description,
                "tipo_erro": info["tipo_erro"],
                "badge_label": info["badge_label"],
                "mensagem": info["mensagem_amigavel"],
                "detalhe": info["detalhe"],
            },
        )
    except Fault as f:
        info = classificar_erro_at(getattr(f, 'message', str(f)))
        raise HTTPException(
            status_code=502,
            detail={
                "at_code": "Fault",
                "at_message": getattr(f, 'message', str(f)),
                "tipo_erro": info["tipo_erro"],
                "badge_label": info["badge_label"],
                "mensagem": info["mensagem_amigavel"],
                "detalhe": info["detalhe"],
            },
        )
    except Exception as e:
        info = classificar_erro_at(e)
        raise HTTPException(
            status_code=500,
            detail={
                "at_code": "Exception",
                "at_message": str(e),
                "tipo_erro": info["tipo_erro"],
                "badge_label": info["badge_label"],
                "mensagem": info["mensagem_amigavel"],
                "detalhe": info["detalhe"],
            },
        )

# -------------------------------------------------------------------------
# SONDAGEM RÁPIDA DE TOTAIS (BATEDOR ULTRA-LEVE EM MEMÓRIA)
# -------------------------------------------------------------------------
@app.post("/api/sondagem-totais")
def api_sondagem_totais(req: SondagemTotaisRequest, lic = Depends(verificar_licenca_ativa)):
    """
    Sonda a AT para apurar unicamente o número total de documentos mês a mês.
    Resposta rápida em memória (JSON), sem descarregar nem gravar linhas fiscais.
    """
    nif_clean = re.sub(r'[^0-9]', '', str(req.nif or "")).strip()
    if not nif_clean:
        raise HTTPException(status_code=400, detail="NIF não fornecido ou inválido.")

    # 1. Resolver credenciais caso não venham no pedido
    sub = req.subutilizador
    pwd = req.password
    if not pwd:
        pb_sub, pb_pwd = pb_client.get_credentials(nif_clean)
        if pb_pwd:
            sub = pb_sub or sub
            pwd = pb_pwd

    if not pwd:
        raise HTTPException(status_code=400, detail="Senha AT não fornecida no pedido nem encontrada no PocketBase Central.")

    # 2. Validar se a senha não está marcada como inválida
    is_invalida, detalhe_erro = pb_client.check_if_password_marked_invalid(nif_clean, pwd)
    if is_invalida:
        raise HTTPException(
            status_code=400,
            detail=f"Autenticação Bloqueada: Senha já testada e rejeitada pela AT ({detalhe_erro})."
        )

    # 3. Resolver intervalo de datas
    ano_alvo = req.ano or (req.data_inicio.year if req.data_inicio else date.today().year)
    d_inicio = req.data_inicio or date(ano_alvo, 1, 1)
    d_fim = req.data_fim or min(date(ano_alvo, 12, 31), date.today())
    as_buyer = req.tipo.strip().lower() == "compras"

    try:
        res = efatura_api.sondar_totais_documentos(
            nif=nif_clean,
            nif_subuser=sub or nif_clean,
            password=pwd,
            start_date=d_inicio,
            end_date=d_fim,
            as_buyer=as_buyer,
            meses_filtro=req.meses
        )
        res["nome"] = pb_client.get_entidade_nome(nif_clean)
        res["assinatura"] = "API Importador e-Fatura Gexcel"
        return res
    except efatura_api.ATAPIError as e:
        info = classificar_erro_at(e.description or e)
        raise HTTPException(
            status_code=502,
            detail={
                "at_code": e.code,
                "at_message": e.description,
                "tipo_erro": info["tipo_erro"],
                "badge_label": info["badge_label"],
                "mensagem": info["mensagem_amigavel"],
                "detalhe": info["detalhe"],
            }
        )
    except Fault as f:
        info = classificar_erro_at(getattr(f, 'message', str(f)))
        raise HTTPException(
            status_code=502,
            detail={
                "at_code": "Fault",
                "at_message": getattr(f, 'message', str(f)),
                "tipo_erro": info["tipo_erro"],
                "badge_label": info["badge_label"],
                "mensagem": info["mensagem_amigavel"],
                "detalhe": info["detalhe"],
            }
        )
    except Exception as e:
        info = classificar_erro_at(e)
        raise HTTPException(
            status_code=500,
            detail={
                "at_code": "Exception",
                "at_message": str(e),
                "tipo_erro": info["tipo_erro"],
                "badge_label": info["badge_label"],
                "mensagem": info["mensagem_amigavel"],
                "detalhe": info["detalhe"],
            }
        )


@app.get("/api/sondagem-totais")
def api_sondagem_totais_get(
    nif: str,
    ano: Optional[int] = None,
    tipo: str = "vendas",
    lic = Depends(verificar_licenca_ativa)
):
    """Atalho GET para sondagem rápida de totais via navegador ou cliente simples."""
    req = SondagemTotaisRequest(nif=nif, ano=ano, tipo=tipo)
    return api_sondagem_totais(req, lic=lic)


@app.post("/api/sondagem-totais/lote")
def api_sondagem_totais_lote(req: SondagemTotaisLoteRequest, lic = Depends(verificar_licenca_ativa)):
    """
    Sondagem em lote de múltiplas entidades (ideal para dezenas/centenas de empresas).
    Executa com concorrência adaptativa e tratamento isolado de exceções por entidade.
    """
    # 1. Obter entidades e credenciais do PocketBase
    entidades_db = pb_client.get_entidades_com_credenciais(nifs_filtro=req.nifs)
    if not entidades_db and req.nifs:
        # Fallback individual caso alguma entidade não esteja na tabela de senhas mas tenha tCredenciais
        entidades_db = []
        for n in req.nifs:
            n_clean = re.sub(r'[^0-9]', '', str(n)).strip()
            sub, pwd = pb_client.get_credentials(n_clean)
            nome = pb_client.get_entidade_nome(n_clean)
            entidades_db.append({
                "nif": n_clean,
                "nome": nome,
                "subutilizador": sub or n_clean,
                "password": pwd or "",
                "senha_invalida": False,
                "erro_detalhe": ""
            })

    if not entidades_db:
        return {
            "status": "ok",
            "assinatura": "API Importador e-Fatura Gexcel",
            "tipo": req.tipo,
            "ano": req.ano or date.today().year,
            "total_entidades": 0,
            "sucessos": 0,
            "erros": 0,
            "total_geral_documentos": 0,
            "entidades": []
        }

    ano_alvo = req.ano or date.today().year
    d_inicio = date(ano_alvo, 1, 1)
    d_fim = min(date(ano_alvo, 12, 31), date.today())
    as_buyer = req.tipo.strip().lower() == "compras"

    def _processar_uma(ent):
        n_clean = ent["nif"]
        nome = ent.get("nome") or pb_client.get_entidade_nome(n_clean)
        pwd = ent.get("password")
        sub = ent.get("subutilizador") or n_clean

        if not pwd:
            return {
                "nif": n_clean,
                "nome": nome,
                "status": "sem_senha",
                "mensagem": "Sem senha AT configurada no PocketBase",
                "total_documentos": 0,
                "meses": []
            }

        if ent.get("senha_invalida"):
            return {
                "nif": n_clean,
                "nome": nome,
                "status": "senha_invalida",
                "mensagem": f"Senha rejeitada anteriormente pela AT ({ent.get('erro_detalhe')})",
                "total_documentos": 0,
                "meses": []
            }

        try:
            res_ent = efatura_api.sondar_totais_documentos(
                nif=n_clean,
                nif_subuser=sub,
                password=pwd,
                start_date=d_inicio,
                end_date=d_fim,
                as_buyer=as_buyer,
                meses_filtro=req.meses
            )
            res_ent["nome"] = nome
            return res_ent
        except efatura_api.ATAPIError as e:
            return {
                "nif": n_clean,
                "nome": nome,
                "status": "erro_at",
                "codigo_at": e.code,
                "mensagem": e.description,
                "total_documentos": 0,
                "meses": []
            }
        except Exception as e:
            return {
                "nif": n_clean,
                "nome": nome,
                "status": "erro",
                "mensagem": str(e),
                "total_documentos": 0,
                "meses": []
            }

    workers = max(1, min(req.max_concorrencia, 5))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        resultados = list(executor.map(workspace_context.wrap_thread_target(_processar_uma), entidades_db))

    sucessos = sum(1 for r in resultados if r.get("status") == "ok")
    total_docs_geral = sum(r.get("total_documentos", 0) for r in resultados)

    return {
        "status": "ok",
        "assinatura": "API Importador e-Fatura Gexcel",
        "tipo": req.tipo,
        "ano": ano_alvo,
        "total_entidades": len(resultados),
        "sucessos": sucessos,
        "erros": len(resultados) - sucessos,
        "total_geral_documentos": total_docs_geral,
        "entidades": resultados
    }


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
    "REGISTADO": "Registado",
    "ANULADA": "Anulado",
    "ANULADO": "Anulado",
}

def executar_scraping_anuladas_paralelo(
    nif: str,
    password: str,
    data_inicio: str,
    data_fim: str,
    as_buyer: bool,
    nome_entidade: str = "",
    subuser: Optional[str] = None,
    job_id: Optional[str] = None
) -> tuple[list[dict], list[dict]]:
    """
    Executa a consulta de faturas anuladas via Scraper em paralelo com a consulta SOAP da AT.
    Retorna (anuladas_h_rows, anuladas_v_rows).
    """
    if iniciar_sessao_efatura is None or not password:
        return [], []

    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    login_user = str(subuser).strip() if subuser and str(subuser).strip() else (str(nif).strip() if "/" in str(nif) else nif_clean)
    LOGGER.info(f"🔄 [SCRAPER PARALELO] A iniciar verificação de anuladas para NIF {nif_clean} (Login: {login_user}, {data_inicio} a {data_fim})...")

    sessao = None
    try:
        sessao = _iniciar_sessao_efatura_segura(
            nif=login_user,
            password=password,
            headless=True,
            canal="auto"
        )
        if as_buyer:
            extrator = EFaturaCompras(sessao, visual=False)
        else:
            extrator = EFaturaVendas(sessao, visual=False)

        faturas_anuladas = extrator.consultar_anuladas(str(data_inicio), str(data_fim))
        if not faturas_anuladas:
            LOGGER.info(f"✅ [SCRAPER PARALELO] Nenhuma fatura anulada encontrada para NIF {nif_clean} no período.")
            if job_id and job_id in JOBS and JOBS[job_id].get("fase") == "anuladas":
                JOBS[job_id]["mensagem"] = "Sem faturas canceladas no período."
                JOBS[job_id]["percentagem"] = 100
            return [], []

        total_anul = len(faturas_anuladas)
        LOGGER.info(f"🎯 [SCRAPER PARALELO] Detetadas {total_anul} fatura(s) anulada(s) para NIF {nif_clean}. A extrair detalhes...")
        if job_id and job_id in JOBS and JOBS[job_id].get("fase") == "anuladas":
            JOBS[job_id]["sub_atuais"] = 0
            JOBS[job_id]["sub_total"] = total_anul
            JOBS[job_id]["percentagem"] = 0
            JOBS[job_id]["mensagem"] = f"A descarregar faturas canceladas (0 de {total_anul})..."

        def _cb_anuladas(concluidos, total):
            if job_id and job_id in JOBS and JOBS[job_id].get("fase") == "anuladas":
                pct = int((concluidos / max(1, total)) * 100)
                JOBS[job_id]["sub_atuais"] = concluidos
                JOBS[job_id]["sub_total"] = total
                JOBS[job_id]["mensagem"] = f"A descarregar faturas canceladas ({concluidos} de {total})..."
                JOBS[job_id]["percentagem"] = pct

        extrator_detalhes = ExtratorDetalhes(sessao, max_workers=6)
        linhas_extraidas = extrator_detalhes.extrair_detalhes_lote(
            documentos=faturas_anuladas,
            nif_titular=nif_clean,
            tipo_fluxo="compras" if as_buyer else "vendas",
            callback_progresso=_cb_anuladas
        )

        anuladas_h_rows = []
        anuladas_v_rows = []
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        linhas_por_fatura = {}
        for l in linhas_extraidas:
            chave_fat = (str(l.contraparte_nif or "").strip(), str(l.fatura or "").strip())
            linhas_por_fatura.setdefault(chave_fat, []).append(l)

        for f in faturas_anuladas:
            fat_no = getattr(f, "numero_documento", "") or ""
            atcud = getattr(f, "atcud", "") or "0"
            data_emissao = str(getattr(f, "data_emissao", "") or "")
            tipo_doc = getattr(f, "tipo_documento", "") or "FT"
            tipo_doc_desc = getattr(f, "tipo_documento_desc", "") or TIPO_DOC_MAP.get(tipo_doc, tipo_doc)
            nif_em = getattr(f, "nif_emitente", "") or ""
            nome_em = getattr(f, "nome_emitente", "") or ""
            nif_ad = getattr(f, "nif_adquirente", "") or ""
            nome_ad = getattr(f, "nome_adquirente", "") or ""

            counterparty_nif = nif_em if as_buyer else nif_ad
            counterparty_name = nome_em if as_buyer else nome_ad
            if not as_buyer and (not counterparty_nif or str(counterparty_nif).strip() in ("999999999", "999999990", "99999999")):
                counterparty_name = "Consumidor final"
            sector = getattr(f, "actividade_emitente_desc", "") or "Outros"

            linhas_doc = linhas_por_fatura.get((str(counterparty_nif or "").strip(), str(fat_no or "").strip()), [])
            if not linhas_doc:
                linhas_doc = linhas_por_fatura.get(("", str(fat_no or "").strip()), [])

            taxas_list = []
            for l in linhas_doc:
                tp = l.taxa_percentagem
                if tp is not None:
                    p_str = str(int(tp)) if tp.is_integer() else str(tp)
                    if p_str not in taxas_list:
                        taxas_list.append(p_str)
            taxas_str = " ".join(taxas_list) if taxas_list else "0"

            clean_issuer = str(counterparty_nif if as_buyer else nif_clean).strip() or "000000000"
            id_doc = pb_client.gerar_chave_documento(
                nif=clean_issuer,
                fatura=fat_no,
                total_doc=0.0,
                atcud=atcud,
                prefixo="C" if as_buyer else "V"
            )

            h_row = {
                "IdDocumento": id_doc,
                "Atividade de Realização da Aquisição": sector,
                "NIF ComercianteConsumidor": str(counterparty_nif or ""),
                "TipoDoc": tipo_doc_desc,
                "Situação": "Anulado",
                "Nº Fatura": "'" + fat_no if fat_no else "",
                "ATCUD": atcud,
                "Data Emissão": data_emissao,
                "Total Iva": 0.0,
                "Total_Liquido": 0.0,
                "Base Tributável": 0.0,
                "SerieDoc": "",
                "N_Doc": "",
                "intNDoc": "",
                "S": "",
                "N": "",
                "I": "",
                "Nome ComerConsu": efatura_api.to_title_case(counterparty_name or ""),
                "Nome_ComerConsu": efatura_api.to_title_case(counterparty_name or ""),
                "NIF EntidadeEfatura": str(nif_clean),
                "Nome EntidadeEfatura": nome_entidade or "",
                "Cae": "",
                "MotivoISE": "",
                "Base_Ise": 0.0,
                "Base_Red": 0.0,
                "Iva_Red": 0.0,
                "Base_Int": 0.0,
                "Iva_Int": 0.0,
                "Base_Nor": 0.0,
                "Iva_Nor": 0.0,
                "TaxasIva": taxas_str,
                "Realizado no âmbito da atividade profissional": "Não",
                "ValorNaoClassificado": "",
                "DataHoraDownload": now_str,
            }
            anuladas_h_rows.append(h_row)

            if linhas_doc:
                for l in linhas_doc:
                    anuladas_v_rows.append({
                        "NIF Cliente": str(nif_clean),
                        "Fatura": fat_no,
                        "ATCUD": atcud,
                        "Data": data_emissao,
                        "Tipo Documento": tipo_doc,
                        "Contraparte NIF": str(counterparty_nif or ""),
                        "Contraparte": counterparty_name,
                        "Estado Documento": "A",
                        "Tipo Imposto": l.tipo_imposto or "IVA",
                        "Código Taxa": l.codigo_taxa or "",
                        "Taxa (%)": float(l.taxa_percentagem) if l.taxa_percentagem is not None else None,
                        "Taxa IVA": float(l.taxa_percentagem) if l.taxa_percentagem is not None else None,
                        "Base Incidência": 0.0,
                        "Valor Imposto": 0.0,
                        "Valor IVA": 0.0,
                        "Código Isenção": l.codigo_isencao or None,
                        "Região Fiscal": l.regiao_fiscal or "PT",
                        "Total Líquido Documento": 0.0,
                        "Total Documento": 0.0,
                    })
            else:
                anuladas_v_rows.append({
                    "NIF Cliente": str(nif_clean),
                    "Fatura": fat_no,
                    "ATCUD": atcud,
                    "Data": data_emissao,
                    "Tipo Documento": tipo_doc,
                    "Contraparte NIF": str(counterparty_nif or ""),
                    "Contraparte": counterparty_name,
                    "Estado Documento": "A",
                    "Tipo Imposto": "IVA",
                    "Código Taxa": "",
                    "Taxa (%)": None,
                    "Taxa IVA": None,
                    "Base Incidência": 0.0,
                    "Valor Imposto": 0.0,
                    "Valor IVA": 0.0,
                    "Código Isenção": None,
                    "Região Fiscal": "PT",
                    "Total Líquido Documento": 0.0,
                    "Total Documento": 0.0,
                })

        LOGGER.info(f"✅ [SCRAPER PARALELO] Processadas {len(anuladas_h_rows)} faturas anuladas ({len(anuladas_v_rows)} linhas verticais).")
        return anuladas_h_rows, anuladas_v_rows

    except Exception as e:
        LOGGER.warning(f"⚠️ [SCRAPER PARALELO] Falha na recolha paralela de anuladas: {e}")
        return [], []
    finally:
        if sessao is not None:
            try:
                sessao.close()
            except Exception:
                pass


def executar_scraping_completo(
    nif: str,
    password: str,
    data_inicio: str,
    data_fim: str,
    as_buyer: bool,
    nome_entidade: str = "",
    subuser: Optional[str] = None,
    salvar_sqlite: bool = True,
    progress_callback: Optional[Callable] = None,
    cancel_check: Optional[Callable] = None,
    reimportar_tudo: bool = False,
) -> tuple[list[dict], list[dict], int]:
    """
    Executa a extração completa de faturas (ativas e anuladas com detalhes) via Web Scraping (efatura_scraper).
    Utilizado automaticamente para anos < 2025 ou em contingência transparente se a API SOAP da AT falhar.
    Suporta importação incremental: pula o descarregamento de detalhes de faturas já existentes na BD local.
    Retorna (horizontal_rows, vertical_rows, total_esperado).
    """
    if not password:
        raise RuntimeError("Credenciais em falta: Chave de acesso não configurada no ficheiro de credenciais.")

    def _notificar(msg, docs=None, total=None):
        if progress_callback:
            try:
                msg_ui = str(msg or "")
                if msg_ui and not msg_ui.startswith("[Portal Web]"):
                    msg_ui = f"[Portal Web] {msg_ui}"
                progress_callback(msg_ui, docs, total)
            except Exception:
                pass
        LOGGER.info(f"🌐 [ENGINE] {msg}")

    _garantir_scraper_pronto(progress_cb=lambda m: _notificar(m, 0, 0))

    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    sub_candidato = subuser if (subuser and str(subuser).strip()) else (str(nif).strip() if "/" in str(nif or "") else "")
    sub_norm = legado_bridge.normalizar_subutilizador_at(nif_clean, sub_candidato)
    login_user = sub_norm if sub_norm else nif_clean
    _notificar(f"A inicializar ligação ao e-Fatura (Login: {login_user})...", 0, 0)

    sessao = None
    try:
        sessao = _iniciar_sessao_efatura_segura(
            nif=login_user,
            password=password,
            headless=True,
            canal="auto"
        )

        # Autenticação limpa: limpar marcação de senha inválida no banco local se existia
        pb_client.clear_invalid_password_if_success(nif_clean)
        try:
            import logins_Gov
            logins_Gov.limpar_bloqueio_sucesso(login_user, "AT")
            logins_Gov.limpar_bloqueio_sucesso(nif_clean, "AT")
            logins_Gov.limpar_bloqueio_sucesso(login_user, "EFATURA")
            logins_Gov.limpar_bloqueio_sucesso(nif_clean, "EFATURA")
        except Exception:
            pass

        if cancel_check and cancel_check():
            return [], [], 0

        _notificar(f"A consultar documentos ({data_inicio} a {data_fim})...", 0, 0)
        if as_buyer:
            extrator = EFaturaCompras(sessao, visual=False)
        else:
            extrator = EFaturaVendas(sessao, visual=False)

        def _on_progresso_lista(docs_obtidos, total_docs):
            if total_docs > 0:
                pct = round((docs_obtidos / total_docs) * 100)
                _notificar(f"A recolher lista: {docs_obtidos} de {total_docs} documentos ({pct}%)...", docs_obtidos, total_docs)
            else:
                _notificar(f"A consultar documentos ({data_inicio} a {data_fim})...", 0, 0)

        faturas = extrator.consultar_intervalo(str(data_inicio), str(data_fim), callback_progresso=_on_progresso_lista)
        total_retirado = len(faturas)

        if total_retirado == 0:
            _notificar("Nenhum documento encontrado no período.", 0, 0)
        else:
            _notificar(f"Detetados {total_retirado} documentos. A processar detalhes...", 0, total_retirado)

        if cancel_check and cancel_check():
            return [], [], 0

        # Identificar chaves de faturas já existentes na BD para colheita estritamente incremental
        chaves_existentes = set()
        if not reimportar_tudo and salvar_sqlite:
            chaves_existentes = pb_client.obter_chaves_faturas_existentes(
                nif_clean, str(data_inicio), str(data_fim), "compras" if as_buyer else "vendas"
            )

        linhas_por_fatura = {}
        if faturas and ExtratorDetalhes is not None:
            try:
                # Filtrar apenas faturas novas se não for reimportação forçada
                faturas_alvo = faturas
                if not reimportar_tudo and chaves_existentes:
                    faturas_alvo = []
                    for f in faturas:
                        f_num = str(getattr(f, "numero_documento", "") or "").strip()
                        f_cp = str(getattr(f, "nif_emitente" if as_buyer else "nif_adquirente", "") or "").strip()
                        if (f_cp, f_num) not in chaves_existentes:
                            faturas_alvo.append(f)
                    num_ignoradas = len(faturas) - len(faturas_alvo)
                    if num_ignoradas > 0:
                        LOGGER.info(
                            f"⚡ [SCRAPER INCREMENTAL] {num_ignoradas} de {len(faturas)} faturas já existem com detalhes na BD local. "
                            f"A extrair apenas {len(faturas_alvo)} faturas novas."
                        )

                if faturas_alvo:
                    extrator_detalhes = ExtratorDetalhes(sessao, max_workers=6)

                    ultimo_envio = 0.0
                    def _progresso_detalhes(concluidos, total):
                        nonlocal ultimo_envio
                        agora = time.time()
                        if concluidos == total or (concluidos % 5 == 0) or (agora - ultimo_envio >= 0.25):
                            ultimo_envio = agora
                            pct = round((concluidos / total) * 100) if total > 0 else 0
                            _notificar(f"A recolher detalhes: {concluidos} de {total} ({pct}%)...", concluidos, total)

                    linhas_extraidas = extrator_detalhes.extrair_detalhes_lote(
                        documentos=faturas_alvo,
                        nif_titular=nif_clean,
                        tipo_fluxo="compras" if as_buyer else "vendas",
                        callback_progresso=_progresso_detalhes
                    )
                    for l in linhas_extraidas:
                        chave_fat = (str(l.contraparte_nif or "").strip(), str(l.fatura or "").strip())
                        linhas_por_fatura.setdefault(chave_fat, []).append(l)
                if not faturas_alvo:
                    _notificar("Todas as faturas já possuem detalhes na base local. A compilar...", total_retirado, total_retirado)
            except Exception as e_det:
                LOGGER.warning(f"Aviso ao extrair detalhes das faturas: {e_det}")

        # Carregar linhas existentes na BD SQLite para faturas já gravadas (evitando zeros nas bases de IVA)
        linhas_bd_por_fatura = {}
        if not reimportar_tudo and chaves_existentes:
            try:
                db_path_inc = pb_client.obter_db_cliente_path(nif_clean, "compras" if as_buyer else "vendas")
                tabela_inc = "efatura_linhas" if as_buyer else "efatura_vendas_linhas"
                if os.path.exists(db_path_inc):
                    d_ini_inc = str(data_inicio)[:10]
                    d_fim_inc = str(data_fim)[:10]
                    with pb_client.db_connect(db_path_inc, timeout=15) as conn_inc:
                        c_inc = conn_inc.cursor()
                        c_inc.execute(f"""
                            SELECT contraparte_nif, fatura, tipo_imposto, codigo_taxa, taxa_percentagem,
                                   base_incidencia, valor_imposto, codigo_isencao, regiao_fiscal
                            FROM {tabela_inc}
                            WHERE substr(data_emissao, 1, 10) >= ? AND substr(data_emissao, 1, 10) <= ?
                        """, (d_ini_inc, d_fim_inc))
                        for r_cp, r_fat, r_ti, r_ct, r_tp, r_bi, r_vi, r_ci, r_rf in c_inc.fetchall():
                            k_bd = (str(r_cp or "").strip(), str(r_fat or "").strip())
                            linhas_bd_por_fatura.setdefault(k_bd, []).append(type("LinhaBD", (), {
                                "tipo_imposto": r_ti,
                                "codigo_taxa": r_ct,
                                "taxa_percentagem": r_tp,
                                "base_incidencia": r_bi,
                                "valor_imposto": r_vi,
                                "codigo_isencao": r_ci,
                                "regiao_fiscal": r_rf,
                            })())
            except Exception as e_bd_inc:
                LOGGER.warning(f"Aviso ao carregar linhas existentes da BD para compilação incremental: {e_bd_inc}")

        if total_retirado > 0:
            _notificar(f"A compilar {total_retirado} documentos...", total_retirado, total_retirado)

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        h_rows = []
        v_rows = []

        for f in faturas:
            fat_no = getattr(f, "numero_documento", "") or ""
            atcud = getattr(f, "atcud", "") or "0"
            data_emissao = str(getattr(f, "data_emissao", "") or "")
            tipo_doc = getattr(f, "tipo_documento", "") or "FT"
            tipo_doc_desc = getattr(f, "tipo_documento_desc", "") or TIPO_DOC_MAP.get(tipo_doc, tipo_doc)
            situacao_doc = str(getattr(f, "situacao_documento", "") or "N").strip().upper()
            situacao_desc = SITUACAO_MAP.get(situacao_doc, "Registado")

            if as_buyer:
                counterparty_nif = getattr(f, "nif_emitente", "") or ""
                counterparty_name = getattr(f, "nome_emitente", "") or ""
                sector = getattr(f, "actividade_emitente_desc", "") or "Outros"
            else:
                counterparty_nif = getattr(f, "nif_adquirente", "") or ""
                counterparty_name = getattr(f, "nome_adquirente", "") or ""
                if not counterparty_nif or str(counterparty_nif).strip() in ("999999999", "999999990", "99999999"):
                    counterparty_name = "Consumidor final"
                sector = "Outros"

            mult = 1.0
            if tipo_doc == "NC":
                mult = -1.0
            if situacao_doc in ("A", "ANULADA", "ANULADO"):
                mult = 0.0

            linhas_doc = linhas_por_fatura.get((str(counterparty_nif or "").strip(), str(fat_no or "").strip()), [])
            if not linhas_doc:
                linhas_doc = linhas_por_fatura.get(("", str(fat_no or "").strip()), [])

            base_ise = 0.0
            base_red = 0.0
            iva_red = 0.0
            base_int = 0.0
            iva_int = 0.0
            base_nor = 0.0
            iva_nor = 0.0
            taxas_list = []

            is_ja_existente = (str(counterparty_nif or "").strip(), str(fat_no or "").strip()) in chaves_existentes if (not reimportar_tudo and chaves_existentes) else False
            if is_ja_existente and not linhas_doc:
                linhas_doc = linhas_bd_por_fatura.get((str(counterparty_nif or "").strip(), str(fat_no or "").strip()), [])
                mult_linha = 1.0
            else:
                mult_linha = mult

            if linhas_doc:
                for l in linhas_doc:
                    net_amount = round(float(l.base_incidencia or 0.0) * mult_linha, 2)
                    tax_amount = round(float(l.valor_imposto or 0.0) * mult_linha, 2)
                    tax_code = str(l.codigo_taxa or "").strip().upper()
                    tax_type = str(l.tipo_imposto or "IVA").strip().upper()
                    tax_perc = l.taxa_percentagem

                    perc_float = None
                    perc_str = ""
                    if tax_perc is not None:
                        try:
                            perc_float = float(tax_perc)
                            perc_val = int(perc_float) if perc_float.is_integer() else perc_float
                            perc_str = str(perc_val)
                        except Exception:
                            perc_str = ""

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

                    if not is_ja_existente:
                        v_rows.append({
                            "NIF Cliente": str(nif_clean),
                            "Fatura": fat_no,
                            "ATCUD": atcud,
                            "Data": data_emissao,
                            "Tipo Documento": tipo_doc,
                            "Contraparte NIF": str(counterparty_nif or ""),
                            "Contraparte": counterparty_name,
                            "Estado Documento": "A" if situacao_doc in ("A", "ANULADA", "ANULADO") else "N",
                            "Tipo Imposto": tax_type or "IVA",
                            "Código Taxa": tax_code,
                            "Taxa (%)": perc_float,
                            "Taxa IVA": perc_float,
                            "Base Incidência": net_amount,
                            "Valor Imposto": tax_amount,
                            "Valor IVA": tax_amount,
                            "Código Isenção": l.codigo_isencao or None,
                            "Região Fiscal": l.regiao_fiscal or "PT",
                            "Total Líquido Documento": round(float(getattr(f, "base_tributavel", 0.0) or 0.0) * mult, 2),
                            "Total Documento": round(float(getattr(f, "valor_total", 0.0) or 0.0) * mult, 2),
                        })
            else:
                total_bruto_doc = round(float(getattr(f, "valor_total", 0.0) or 0.0) * mult, 2)
                total_liq_doc = round(float(getattr(f, "base_tributavel", 0.0) or 0.0) * mult, 2)
                total_iva_doc = round(float(getattr(f, "valor_iva", 0.0) or 0.0) * mult, 2)

                if abs(total_iva_doc) > 0:
                    base_nor = total_liq_doc
                    iva_nor = total_iva_doc
                    taxas_list.append("23")
                else:
                    base_ise = total_liq_doc
                    taxas_list.append("0")

                if not is_ja_existente:
                    v_rows.append({
                        "NIF Cliente": str(nif_clean),
                        "Fatura": fat_no,
                        "ATCUD": atcud,
                        "Data": data_emissao,
                        "Tipo Documento": tipo_doc,
                        "Contraparte NIF": str(counterparty_nif or ""),
                        "Contraparte": counterparty_name,
                        "Estado Documento": "A" if situacao_doc in ("A", "ANULADA", "ANULADO") else "N",
                        "Tipo Imposto": "IVA",
                        "Código Taxa": "NOR" if abs(total_iva_doc) > 0 else "ISE",
                        "Taxa (%)": 23.0 if abs(total_iva_doc) > 0 else 0.0,
                        "Taxa IVA": 23.0 if abs(total_iva_doc) > 0 else 0.0,
                        "Base Incidência": total_liq_doc,
                        "Valor Imposto": total_iva_doc,
                        "Valor IVA": total_iva_doc,
                        "Código Isenção": None,
                        "Região Fiscal": "PT",
                        "Total Líquido Documento": total_liq_doc,
                        "Total Documento": total_bruto_doc,
                    })

            total_bruto_doc = round(float(getattr(f, "valor_total", 0.0) or 0.0) * mult, 2)
            total_iva = round(iva_red + iva_int + iva_nor, 2)
            base_tributavel = round(total_bruto_doc - total_iva, 2)

            taxas_str = " ".join(taxas_list) if taxas_list else "0"
            soma_bases = round(base_ise + base_red + base_int + base_nor, 2)
            dif = round(base_tributavel - soma_bases, 2)
            valor_nao_class = dif if abs(dif) >= 0.01 else ""

            id_doc = pb_client.gerar_chave_documento(
                nif=str(counterparty_nif if as_buyer else nif_clean).strip() or "000000000",
                fatura=fat_no,
                total_doc=total_bruto_doc,
                atcud=atcud,
                prefixo="C" if as_buyer else "V"
            )

            h_row = {
                "IdDocumento": id_doc,
                "Atividade de Realização da Aquisição": sector,
                "NIF ComercianteConsumidor": str(counterparty_nif or ""),
                "TipoDoc": tipo_doc_desc,
                "Situação": situacao_desc,
                "Nº Fatura": "'" + fat_no if fat_no else "",
                "ATCUD": atcud,
                "Data Emissão": data_emissao,
                "Total Iva": total_iva,
                "Total_Liquido": total_bruto_doc,
                "Base Tributável": base_tributavel,
                "SerieDoc": "",
                "N_Doc": "",
                "intNDoc": "",
                "S": "",
                "N": "",
                "I": "",
                "Nome ComerConsu": efatura_api.to_title_case(counterparty_name or ""),
                "Nome_ComerConsu": efatura_api.to_title_case(counterparty_name or ""),
                "NIF EntidadeEfatura": str(nif_clean),
                "Nome EntidadeEfatura": nome_entidade or "",
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
            h_rows.append(h_row)

        total_esperado = total_retirado
        totals_row = {
            "IdDocumento": "TotalDocs:",
            "Atividade de Realização da Aquisição": total_esperado,
            "NIF ComercianteConsumidor": total_retirado,
            "TipoDoc": 0, "Situação": 0, "Nº Fatura": 0, "ATCUD": 0,
            "Data Emissão": "1899-12-31", "Total Iva": 0, "Total_Liquido": 0, "Base Tributável": 0,
            "SerieDoc": 0, "N_Doc": 0, "intNDoc": 0, "S": 0, "N": 0, "I": 0,
            "Nome ComerConsu": 0, "Nome_ComerConsu": 0, "NIF EntidadeEfatura": 0, "Nome EntidadeEfatura": 0,
            "Cae": 0, "MotivoISE": 0, "Base_Ise": 0, "Base_Red": 0, "Iva_Red": 0,
            "Base_Int": 0, "Iva_Int": 0, "Base_Nor": 0, "Iva_Nor": 0, "TaxasIva": 0,
            "Realizado no âmbito da atividade profissional": 0, "ValorNaoClassificado": 0, "DataHoraDownload": 0
        }
        horizontal_rows = [totals_row] + h_rows

        try:
            import validador_fiscal
            validador_fiscal.validar_lote_extracao(
                horizontal_rows, v_rows, data_inicio=str(data_inicio), data_fim=str(data_fim), strict=False
            )
        except Exception as _ve:
            LOGGER.warning(f"Aviso no validador fiscal em executar_scraping_completo: {_ve}")

        if salvar_sqlite and v_rows:
            if as_buyer:
                pb_client.upsert_faturas_direto(v_rows)
            else:
                pb_client.upsert_vendas_direto(v_rows)

        # Registo no Ledger de Estados
        if (v_rows or horizontal_rows) and CofreEstadosLedger is not None:
            try:
                cofre = CofreEstadosLedger()
                linhas_para_cofre = v_rows if v_rows else horizontal_rows[1:]
                cofre.registar_e_confrontar(linhas_para_cofre, nif_titular=nif_clean)
            except Exception as e_cofre:
                LOGGER.warning(f"Aviso ao registar faturas no Cofre de Estados: {e_cofre}")

        _notificar(f"Concluído ({total_retirado} documentos)", total_retirado, total_esperado)
        return horizontal_rows, v_rows, total_esperado

    except GovAuthError as g_err:
        info_erro = classificar_erro_at(g_err)
        if info_erro["memorizar_invalida"] and not pb_client.is_erro_falso_positivo_at(g_err):
            LOGGER.warning(f"Credenciais rejeitadas pelo e-Fatura: {g_err}")
            pb_client.record_invalid_password(nif_clean, password, str(g_err))
            raise RuntimeError(f"Credenciais e-Fatura rejeitadas pela AT: {g_err}")
        LOGGER.warning(f"Falha transitória/rede no acesso web ao e-Fatura (senha NÃO bloqueada): {g_err}")
        raise RuntimeError(f"Falha temporária no portal da AT ({info_erro['badge_label']}): {g_err}")
    finally:
        if sessao is not None:
            try:
                sessao.close()
            except Exception:
                pass


def reconstruir_horizontal_vertical_de_sqlite(
    nif: str,
    data_inicio: str,
    data_fim: str,
    as_buyer: bool,
    nome_entidade: str = "",
) -> tuple[list[dict], list[dict], int]:
    """
    Reconstrói a estrutura horizontal (incluindo linha TotalDocs:) e vertical diretamente a partir
    da base SQLite particionada do cliente (compras_{nif}.db ou vendas_{nif}.db).
    Garante que o cliente VBA recebe sempre dados_legacy_horizontal completo quando há SCRAPER SKIP.
    """
    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    if not nif_clean:
        return [], [], 0

    db_path = pb_client.obter_db_cliente_path(nif_clean, "compras" if as_buyer else "vendas")
    tabela = "efatura_linhas" if as_buyer else "efatura_vendas_linhas"
    if not os.path.exists(db_path):
        return [], [], 0

    d_ini = str(data_inicio)[:10]
    d_fim = str(data_fim)[:10]
    if not nome_entidade:
        try:
            nome_entidade = pb_client.get_entidade_nome(nif_clean) or ""
        except Exception:
            nome_entidade = ""

    rows_raw = []
    try:
        with pb_client.db_connect(db_path, timeout=20) as conn:
            c = conn.cursor()
            c.execute(f"""
                SELECT id_fatura_unico, fatura, atcud, substr(data_emissao, 1, 10) AS dt_emissao,
                       tipo_documento, estado_documento, contraparte_nif, contraparte_nome,
                       setor_atividade, tipo_imposto, codigo_taxa, taxa_percentagem,
                       base_incidencia, valor_imposto, codigo_isencao, regiao_fiscal,
                       total_liquido_doc, total_doc, substr(updated, 1, 19) AS dt_upd
                FROM {tabela}
                WHERE substr(data_emissao, 1, 10) >= ? AND substr(data_emissao, 1, 10) <= ?
                ORDER BY dt_emissao DESC, fatura ASC
            """, (d_ini, d_fim))
            rows_raw = c.fetchall()
    except Exception as e:
        LOGGER.warning(f"Erro ao reconstruir dados do SQLite ({db_path}, {d_ini}..{d_fim}): {e}")
        return [], [], 0

    if not rows_raw:
        return [], [], 0

    now_fallback = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    docs_grouped = {}
    v_rows = []

    for (
        id_fat, fat_no, atcud, dt_em, tipo_doc, est_doc, cp_nif, cp_nome,
        setor, tipo_imp, cod_taxa, taxa_perc, base_inc, val_imp, cod_ise,
        reg_fisc, tot_liq, tot_doc, dt_upd
    ) in rows_raw:
        id_key = str(id_fat or "").strip()
        if not id_key:
            id_key = pb_client.gerar_chave_documento(
                nif=str(cp_nif if as_buyer else nif_clean).strip() or "000000000",
                fatura=str(fat_no or ""),
                total_doc=float(tot_doc or 0.0),
                atcud=str(atcud or "0"),
                prefixo="C" if as_buyer else "V"
            )

        perc_float = None
        if taxa_perc is not None:
            try:
                perc_float = float(taxa_perc)
            except Exception:
                perc_float = None

        v_rows.append({
            "NIF Cliente": str(nif_clean),
            "Fatura": str(fat_no or ""),
            "ATCUD": str(atcud or "0"),
            "Data": str(dt_em or ""),
            "Tipo Documento": str(tipo_doc or "FT"),
            "Contraparte NIF": str(cp_nif or ""),
            "Contraparte": str(cp_nome or ""),
            "Estado Documento": "A" if str(est_doc or "").strip().upper() in ("A", "ANULADA", "ANULADO") else "N",
            "Tipo Imposto": str(tipo_imp or "IVA"),
            "Código Taxa": str(cod_taxa or ""),
            "Taxa (%)": perc_float,
            "Taxa IVA": perc_float,
            "Base Incidência": round(float(base_inc or 0.0), 2),
            "Valor Imposto": round(float(val_imp or 0.0), 2),
            "Valor IVA": round(float(val_imp or 0.0), 2),
            "Código Isenção": cod_ise or None,
            "Região Fiscal": str(reg_fisc or "PT"),
            "Total Líquido Documento": round(float(tot_liq or 0.0), 2),
            "Total Documento": round(float(tot_doc or 0.0), 2),
        })

        doc_group_key = (id_key, str(fat_no or "").strip())
        if doc_group_key not in docs_grouped:
            docs_grouped[doc_group_key] = {
                "id_doc": id_key,
                "fat_no": str(fat_no or ""),
                "atcud": str(atcud or "0") or "0",
                "dt_em": str(dt_em or ""),
                "tipo_doc": str(tipo_doc or "FT"),
                "est_doc": str(est_doc or "N").strip().upper(),
                "cp_nif": str(cp_nif or ""),
                "cp_nome": str(cp_nome or ""),
                "setor": str(setor or "Outros") or "Outros",
                "tot_doc": round(float(tot_doc or 0.0), 2),
                "dt_upd": str(dt_upd or "").replace("T", " ") or now_fallback,
                "linhas": [],
            }
        docs_grouped[doc_group_key]["linhas"].append((
            str(tipo_imp or "IVA").strip().upper(),
            str(cod_taxa or "").strip().upper(),
            perc_float,
            round(float(base_inc or 0.0), 2),
            round(float(val_imp or 0.0), 2),
        ))

    # Desduplicação defensiva contra linhas multiplicadas 2x/3x legadas na BD
    v_rows_limpas = pb_client._desduplicar_linhas_fatura_vertical(v_rows, is_vendas=(not as_buyer))
    if len(v_rows_limpas) < len(v_rows):
        v_rows = v_rows_limpas
        try:
            pb_client.sanear_duplicados_bd_cliente(nif_clean, "compras" if as_buyer else "vendas")
        except Exception:
            pass
        for g in docs_grouped.values():
            linhas_g = g["linhas"]
            if len(linhas_g) > 1:
                tot_g = abs(float(g["tot_doc"] or 0.0))
                soma_g = sum(float(x[3] or 0.0) + float(x[4] or 0.0) for x in linhas_g)
                if tot_g > 0.01 and abs(abs(soma_g) - tot_g) > 0.05:
                    unicas_g = []
                    vistas_g = set()
                    for x in linhas_g:
                        if x not in vistas_g:
                            vistas_g.add(x)
                            unicas_g.append(x)
                    soma_u = sum(float(x[3] or 0.0) + float(x[4] or 0.0) for x in unicas_g)
                    if abs(abs(soma_u) - tot_g) <= abs(abs(soma_g) - tot_g):
                        g["linhas"] = unicas_g

    h_rows = []
    for g in docs_grouped.values():
        base_ise = 0.0
        base_red = 0.0
        iva_red = 0.0
        base_int = 0.0
        iva_int = 0.0
        base_nor = 0.0
        iva_nor = 0.0
        taxas_list = []

        for tax_type, tax_code, perc_float, net_amount, tax_amount in g["linhas"]:
            perc_str = ""
            if perc_float is not None:
                perc_val = int(perc_float) if perc_float.is_integer() else perc_float
                perc_str = str(perc_val)

            if tax_type == "IS":
                base_ise += round(net_amount + tax_amount, 2)
                if perc_str:
                    if perc_str not in taxas_list:
                        taxas_list.append(perc_str)
                elif "0" not in taxas_list:
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

        est_doc = g["est_doc"]
        is_anulada = est_doc in ("A", "ANULADA", "ANULADO")
        situacao_desc = "Anulado" if is_anulada else SITUACAO_MAP.get(est_doc, "Registado")
        tipo_doc = g["tipo_doc"]
        tipo_doc_desc = TIPO_DOC_MAP.get(tipo_doc, tipo_doc)

        if is_anulada:
            total_bruto_doc = 0.0
            total_iva = 0.0
            base_tributavel = 0.0
            base_ise = base_red = iva_red = base_int = iva_int = base_nor = iva_nor = 0.0
            valor_nao_class = ""
        else:
            total_bruto_doc = round(g["tot_doc"], 2)
            total_iva = round(iva_red + iva_int + iva_nor, 2)
            base_tributavel = round(total_bruto_doc - total_iva, 2)
            soma_bases = round(base_ise + base_red + base_int + base_nor, 2)
            dif = round(base_tributavel - soma_bases, 2)
            valor_nao_class = dif if abs(dif) >= 0.01 else ""

        cp_nif = g["cp_nif"]
        cp_nome = g["cp_nome"]
        if not as_buyer and (not cp_nif or cp_nif in ("999999999", "999999990", "99999999")):
            cp_nome = "Consumidor final"

        taxas_str = " ".join(taxas_list) if taxas_list else "0"
        fat_no = g["fat_no"]

        h_rows.append({
            "IdDocumento": g["id_doc"],
            "Atividade de Realização da Aquisição": g["setor"],
            "NIF ComercianteConsumidor": cp_nif,
            "TipoDoc": tipo_doc_desc,
            "Situação": situacao_desc,
            "Nº Fatura": "'" + fat_no if fat_no else "",
            "ATCUD": g["atcud"],
            "Data Emissão": g["dt_em"],
            "Total Iva": total_iva,
            "Total_Liquido": total_bruto_doc,
            "Base Tributável": base_tributavel,
            "SerieDoc": "",
            "N_Doc": "",
            "intNDoc": "",
            "S": "",
            "N": "",
            "I": "",
            "Nome ComerConsu": efatura_api.to_title_case(cp_nome or ""),
            "Nome_ComerConsu": efatura_api.to_title_case(cp_nome or ""),
            "NIF EntidadeEfatura": str(nif_clean),
            "Nome EntidadeEfatura": nome_entidade or "",
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
            "DataHoraDownload": g["dt_upd"],
        })

    total_retirado = len(h_rows)
    totals_row = {
        "IdDocumento": "TotalDocs:",
        "Atividade de Realização da Aquisição": total_retirado,
        "NIF ComercianteConsumidor": total_retirado,
        "TipoDoc": 0, "Situação": 0, "Nº Fatura": 0, "ATCUD": 0,
        "Data Emissão": "1899-12-31", "Total Iva": 0, "Total_Liquido": 0, "Base Tributável": 0,
        "SerieDoc": 0, "N_Doc": 0, "intNDoc": 0, "S": 0, "N": 0, "I": 0,
        "Nome ComerConsu": 0, "Nome_ComerConsu": 0, "NIF EntidadeEfatura": 0, "Nome EntidadeEfatura": 0,
        "Cae": 0, "MotivoISE": 0, "Base_Ise": 0, "Base_Red": 0, "Iva_Red": 0,
        "Base_Int": 0, "Iva_Int": 0, "Base_Nor": 0, "Iva_Nor": 0, "TaxasIva": 0,
        "Realizado no âmbito da atividade profissional": 0, "ValorNaoClassificado": 0, "DataHoraDownload": 0
    }
    full_h_rows = [totals_row] + h_rows
    try:
        import validador_fiscal
        res_val = validador_fiscal.validar_lote_extracao(
            full_h_rows, v_rows, data_inicio=d_ini, data_fim=d_fim, strict=False
        )
        if not res_val["valido"]:
            LOGGER.warning(
                f"🚨 [CACHE REJEITADA] A reconstrução SQLite de {nif_clean} ({d_ini}..{d_fim}) falhou a validação fiscal "
                f"({res_val['faturas_invalidas']} faturas inválidas). A limpar cache do período..."
            )
            if as_buyer:
                pb_client.delete_faturas_periodo(nif_clean, d_ini, d_fim)
            else:
                pb_client.delete_vendas_periodo(nif_clean, d_ini, d_fim)
            return [], [], 0
    except Exception as _ve:
        LOGGER.warning(f"Aviso na validação de reconstrução SQLite: {_ve}")

    return full_h_rows, v_rows, total_retirado


def fundir_faturas_anuladas(
    horizontal_rows: list[dict],
    vertical_rows: list[dict],
    anuladas_h_rows: list[dict],
    anuladas_v_rows: list[dict],
    nif: str,
    tipo_str: str,
    salvar_sqlite: bool,
    as_buyer: bool
) -> tuple[list[dict], list[dict]]:
    """
    Funde faturas anuladas recolhidas pelo Scraper nas listas horizontais e verticais.
    Atualiza faturas existentes ou adiciona novas faturas anuladas, persiste no Staging,
    SQLite particionado e Cofre Permanente de Estados.
    """
    if not anuladas_h_rows and not anuladas_v_rows:
        return horizontal_rows, vertical_rows

    nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()

    h_idx_map = {}
    for idx in range(1, len(horizontal_rows)):
        r = horizontal_rows[idx]
        cp_nif = str(r.get("NIF ComercianteConsumidor") or "").strip()
        fat_no = str(r.get("Nº Fatura") or "").strip().lstrip("'")
        h_idx_map[(cp_nif, fat_no)] = idx

    novas_h = []
    for ah in anuladas_h_rows:
        cp_nif = str(ah.get("NIF ComercianteConsumidor") or "").strip()
        fat_no = str(ah.get("Nº Fatura") or "").strip().lstrip("'")
        chave = (cp_nif, fat_no)

        if chave in h_idx_map:
            idx = h_idx_map[chave]
            horizontal_rows[idx]["Situação"] = "Anulado"
            horizontal_rows[idx]["Total Iva"] = 0.0
            horizontal_rows[idx]["Total_Liquido"] = 0.0
            horizontal_rows[idx]["Base Tributável"] = 0.0
            horizontal_rows[idx]["Base_Ise"] = 0.0
            horizontal_rows[idx]["Base_Red"] = 0.0
            horizontal_rows[idx]["Iva_Red"] = 0.0
            horizontal_rows[idx]["Base_Int"] = 0.0
            horizontal_rows[idx]["Iva_Int"] = 0.0
            horizontal_rows[idx]["Base_Nor"] = 0.0
            horizontal_rows[idx]["Iva_Nor"] = 0.0
        else:
            novas_h.append(ah)

    if novas_h:
        horizontal_rows.extend(novas_h)
        for nh in novas_h:
            dt_str = nh.get("Data Emissão", "")
            if dt_str and len(dt_str) >= 7:
                try:
                    ano_doc = int(dt_str[:4])
                    mes_doc = int(dt_str[5:7])
                    efatura_api.append_staging(nif_clean, ano_doc, mes_doc, tipo_str, [nh])
                except Exception as st_err:
                    LOGGER.warning(f"Aviso ao persistir no staging: {st_err}")

    if horizontal_rows:
        total_docs_reais = max(0, len(horizontal_rows) - 1)
        horizontal_rows[0]["NIF ComercianteConsumidor"] = total_docs_reais
        horizontal_rows[0]["Atividade de Realização da Aquisição"] = total_docs_reais

    v_fat_keys = set()
    for v in vertical_rows:
        cp_nif = str(v.get("Contraparte NIF") or "").strip()
        fat_no = str(v.get("Fatura") or "").strip()
        v_fat_keys.add((cp_nif, fat_no))

    anuladas_fat_set = {
        (str(av.get("Contraparte NIF") or "").strip(), str(av.get("Fatura") or "").strip())
        for av in anuladas_v_rows
    }
    for v in vertical_rows:
        chave_v = (str(v.get("Contraparte NIF") or "").strip(), str(v.get("Fatura") or "").strip())
        if chave_v in anuladas_fat_set:
            v["Estado Documento"] = "A"
            v["Base Incidência"] = 0.0
            v["Valor Imposto"] = 0.0
            v["Valor IVA"] = 0.0
            v["Total Líquido Documento"] = 0.0
            v["Total Documento"] = 0.0

    novas_v = []
    for av in anuladas_v_rows:
        chave_av = (str(av.get("Contraparte NIF") or "").strip(), str(av.get("Fatura") or "").strip())
        if chave_av not in v_fat_keys:
            novas_v.append(av)

    if novas_v:
        vertical_rows.extend(novas_v)

    if anuladas_v_rows and salvar_sqlite:
        try:
            if as_buyer:
                pb_client.upsert_faturas_direto(anuladas_v_rows)
            else:
                pb_client.upsert_vendas_direto(anuladas_v_rows)
        except Exception as sqle:
            LOGGER.warning(f"Aviso ao persistir faturas anuladas no SQLite: {sqle}")

    LOGGER.info(
        f"🎯 [FUSÃO CONCLUÍDA] Faturas anuladas integradas: "
        f"{len(anuladas_h_rows)} processadas ({len(novas_h)} novas adicionadas ao Excel, {len(novas_v)} novas verticais)."
    )
    return horizontal_rows, vertical_rows


def resolver_e_completar_nomes_vendas(
    nif_titular: str,
    password: str,
    subuser: Optional[str],
    horizontal_rows: list[dict],
    vertical_rows: list[dict],
    salvar_sqlite: bool = True,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    job_id: Optional[str] = None,
    modo_sincrono: bool = False
) -> tuple[list[dict], list[dict]]:
    """
    Garante o preenchimento dos nomes em faturas de vendas sem bloquear computadores lentos:
    1. Preenche 'Consumidor final' em todos os 999999999, 999999990 ou vazios.
    2. Consulta em lote único (RAM) a cache persistente local de NIFs (controlo_geral.db e BDs cliente).
    3. Resolve NIFs empresariais e particulares respeitando um orçamento estrito de tempo no modo síncrono (VBA),
       delegando o excedente para o pipeline_worker em segundo plano.
    4. Grava os nomes descobertos em lote único na cache central e atualiza a base SQLite de vendas.
    """
    if not horizontal_rows and not salvar_sqlite:
        return horizontal_rows, vertical_rows

    nif_clean = re.sub(r'[^0-9]', '', str(nif_titular or "")).strip()[:9]
    missing_nifs = {}

    # Carregamento único em lote (máx. 3 queries SQLite no total em vez de dezenas de milhares por linha)
    mapa_local = pb_client.carregar_mapa_nomes_nifs_locais(nif_titular=nif_clean)

    # 1. Primeira passagem: preenchimento imediato de Consumidor final e resolução local em memória O(1)
    if horizontal_rows and len(horizontal_rows) > 1:
        for r in horizontal_rows[1:]:
            raw_cp_nif = str(r.get("NIF ComercianteConsumidor") or "").strip()
            cp_nif = re.sub(r'[^0-9]', '', raw_cp_nif).strip()
            if not cp_nif or cp_nif in ("999999999", "999999990", "99999999"):
                r["Nome ComerConsu"] = "Consumidor final"
                r["Nome_ComerConsu"] = "Consumidor final"
            else:
                curr_name = str(r.get("Nome ComerConsu") or "").strip()
                if not curr_name or curr_name.lower() in ("consumidor final", "consumidor final.", "[sem nome registado]"):
                    nome_local = mapa_local.get(cp_nif, "")
                    if nome_local and nome_local.lower() not in ("consumidor final", "consumidor final.", "[sem nome registado]"):
                        nome_fmt = efatura_api.to_title_case(nome_local)
                        r["Nome ComerConsu"] = nome_fmt
                        r["Nome_ComerConsu"] = nome_fmt
                    else:
                        if cp_nif not in missing_nifs:
                            missing_nifs[cp_nif] = {
                                "nif": cp_nif,
                                "fatura": str(r.get("Nº Fatura") or "").strip().lstrip("'"),
                                "data": str(r.get("Data Emissão") or "").strip()
                            }

        for vr in vertical_rows:
            raw_cp_nif = str(vr.get("Contraparte NIF") or "").strip()
            cp_nif = re.sub(r'[^0-9]', '', raw_cp_nif).strip()
            if not cp_nif or cp_nif in ("999999999", "999999990", "99999999"):
                vr["Contraparte"] = "Consumidor final"
            else:
                curr_name = str(vr.get("Contraparte") or "").strip()
                if not curr_name or curr_name.lower() in ("consumidor final", "consumidor final.", "[sem nome registado]"):
                    nome_local = mapa_local.get(cp_nif, "")
                    if nome_local and nome_local.lower() not in ("consumidor final", "consumidor final.", "[sem nome registado]"):
                        vr["Contraparte"] = efatura_api.to_title_case(nome_local)

    # 1.1 Se guarda em SQLite, verifica também se há NIFs sem nome na base de dados de vendas local
    if salvar_sqlite:
        db_missing = pb_client.obter_nifs_vendas_sem_nome(nif_clean)
        nomes_cache_para_bd = {}
        for cp_nif, info in db_missing.items():
            if cp_nif not in missing_nifs:
                nome_c = mapa_local.get(cp_nif, "")
                if nome_c and nome_c.lower() not in ("consumidor final", "consumidor final.", "[sem nome registado]"):
                    nomes_cache_para_bd[cp_nif] = efatura_api.to_title_case(nome_c)
                else:
                    missing_nifs[cp_nif] = info
        if nomes_cache_para_bd:
            pb_client.atualizar_nomes_vendas_db(nif_clean, nomes_cache_para_bd)

    nomes_resolvidos = {}

    # 2. Resolução Concorrente Multithread para Entidades Coletivas / Empresariais
    # Cobre empresas (5xx), organismos públicos (6xx), associações/cooperativas e fundações
    nifs_coletivos = [
        n for n in missing_nifs.keys() 
        if n and n[0] not in ("1", "2", "3") and n not in ("999999990", "999999999", "99999999")
    ]
    if nifs_coletivos:
        total_col = len(nifs_coletivos)
        print(f"\n[EMPRESAS] A identificar {total_col} entidade(s) empresarial(is)...")
        if job_id and job_id in JOBS:
            JOBS[job_id]["fase"] = "nomes"
            JOBS[job_id]["mensagem"] = f"A identificar entidades empresariais (0 de {total_col})..."
            JOBS[job_id]["percentagem"] = 0

        def _cb_empresas(concluidos, total):
            if job_id and job_id in JOBS:
                JOBS[job_id]["fase"] = "nomes"
                JOBS[job_id]["mensagem"] = f"A identificar entidades empresariais ({concluidos} de {total})..."
                JOBS[job_id]["percentagem"] = int((concluidos / max(1, total)) * 100)

        try:
            orcamento_emp = 10.0 if modo_sincrono else 45.0
            empresas_nomes = pb_client.resolver_nifs_empresariais_lote(
                nifs_coletivos,
                max_workers=10,
                callback=_cb_empresas,
                timeout_global=orcamento_emp
            )
            if empresas_nomes:
                nomes_resolvidos.update(empresas_nomes)
                for n in empresas_nomes.keys():
                    missing_nifs.pop(n, None)
                print(f"[EMPRESAS] Concluído: {len(empresas_nomes)} de {total_col} entidade(s) identificada(s)!")
        except Exception as e_emp:
            LOGGER.warning(f"Aviso na resolução de entidades empresariais: {e_emp}")

    # 3. Resolução Rápida em Lote para Particulares (1xx, 2xx, 3xx)
    # Em modo síncrono (VBA) com grande volume (> 300 faturas ou > 8 particulares) ou em PC fraco,
    # não lança browser Edge bloqueante: delega automaticamente para o pipeline_worker em segundo plano.
    nifs_particulares = [
        n for n in missing_nifs.keys()
        if n and n[0] in ("1", "2", "3") and n not in ("999999990", "999999999", "99999999")
    ]
    total_faturas_lote = max(0, len(horizontal_rows) - 1) if horizontal_rows else 0
    deve_delegar_particulares_sync = (
        modo_sincrono and (
            total_faturas_lote > 300
            or len(nifs_particulares) > 8
            or pipeline_worker.is_computador_fraco()
        )
    )
    if deve_delegar_particulares_sync and nifs_particulares:
        LOGGER.info(
            f"⚡ [MODO SÍNCRONO RÁPIDO] {len(nifs_particulares)} NIF(s) particular(es) em {total_faturas_lote} faturas "
            f"delegados para resolução em segundo plano (evita timeout no Excel/VBA em PCs lentos)."
        )
    elif nifs_particulares and password and iniciar_sessao_efatura is not None and ExtratorDetalhes is not None:
        login_user = str(subuser).strip() if subuser and str(subuser).strip() else (str(nif_titular).strip() if "/" in str(nif_titular) else nif_clean)
        sessao = None
        try:
            sessao = _iniciar_sessao_efatura_segura(
                nif=login_user,
                password=password,
                headless=True,
                canal="auto"
            )
            extrator = ExtratorDetalhes(sessao)
            try:
                adapter = requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20)
                extrator.session.mount("https://", adapter)
            except Exception:
                pass

            try:
                sessao.close()
                sessao = None
            except Exception:
                pass

            # 3.1 Identificar períodos envolvidos nas faturas em falta
            datas_envolvidas = set()
            for n in nifs_particulares:
                info = missing_nifs.get(n, {})
                d_str = str(info.get("data") or "").strip()[:10]
                if len(d_str) == 10:
                    datas_envolvidas.add(d_str)

            periodos_busca = []
            if data_inicio and data_fim:
                periodos_busca.append((str(data_inicio)[:10], str(data_fim)[:10]))
            elif datas_envolvidas:
                meses_map = {}
                for d_str in sorted(datas_envolvidas):
                    m_key = d_str[:7]
                    meses_map.setdefault(m_key, []).append(d_str)
                for m_key, d_list in meses_map.items():
                    periodos_busca.append((min(d_list), max(d_list)))
            else:
                hoje_str = date.today().strftime("%Y-%m-%d")
                periodos_busca.append((hoje_str, hoje_str))

            # 3.2 Obter lista de IDs do portal web via JSON (1 a 2 pedidos rápidos)
            mapa_ids_por_nif = {}
            mapa_ids_por_fatura = {}

            headers_json = {
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest"
            }
            url_pesq = "https://faturas.portaldasfinancas.gov.pt/json/obterDocumentosEmitente.action"

            for idx_p, (d_ini, d_fim) in enumerate(periodos_busca):
                if idx_p > 0:
                    time.sleep(1.0)
                params = {
                    "classeDocumentoFilter": "SI",
                    "dataInicioFilter": d_ini,
                    "dataFimFilter": d_fim,
                    "semRecibosVerdesFilter": "N"
                }
                try:
                    r = extrator.session.get(url_pesq, params=params, headers=headers_json, timeout=10)
                    if r.status_code == 200:
                        try:
                            dados_j = json.loads(r.content.decode("iso-8859-15"))
                        except Exception:
                            dados_j = r.json()
                        linhas_lote = dados_j.get("linhas", [])
                        for l in linhas_lote:
                            id_l = l.get("idDocumento")
                            dt_l = l.get("dataEmissaoDocumento") or d_ini
                            nif_l = str(l.get("nifAdquirente") or "").strip()
                            fat_l = str(l.get("numerodocumento") or "").strip()
                            fat_l_clean = re.sub(r'[^0-9A-Za-z]', '', fat_l).upper()

                            if id_l and nif_l:
                                mapa_ids_por_nif[nif_l] = (id_l, dt_l)
                            if id_l and fat_l_clean:
                                mapa_ids_por_fatura[(fat_l_clean, dt_l)] = (id_l, dt_l)
                except Exception as e_lote:
                    LOGGER.debug(f"Aviso na recolha JSON ({d_ini} a {d_fim}): {e_lote}")

            # 3.3 Mapear os NIFs particulares que obtiveram ID
            nifs_com_id = {}
            for cp_nif in nifs_particulares:
                info = missing_nifs.get(cp_nif, {})
                fatura_raw = str(info.get("fatura") or "").strip().lstrip("'")
                fat_clean = re.sub(r'[^0-9A-Za-z]', '', fatura_raw).upper()
                dt = str(info.get("data") or "").strip()[:10]

                if cp_nif in mapa_ids_por_nif:
                    nifs_com_id[cp_nif] = mapa_ids_por_nif[cp_nif]
                elif (fat_clean, dt) in mapa_ids_por_fatura:
                    nifs_com_id[cp_nif] = mapa_ids_por_fatura[(fat_clean, dt)]

            # 3.4 Extração Paralela Direta dos Detalhes (Velocidade Máxima)
            if nifs_com_id:
                total_part_id = len(nifs_com_id)
                print(f" [NOMES PARTICULARES] A extrair {total_part_id} nome(s) de particular(es) mapeado(s) em lote...")
                if job_id and job_id in JOBS:
                    JOBS[job_id]["fase"] = "nomes"
                    JOBS[job_id]["mensagem"] = f"A identificar clientes particulares (0 de {total_part_id})..."
                    JOBS[job_id]["percentagem"] = 0

                def _extrair_detalhe_direto(item_id):
                    cp_nif, (id_doc, dt_doc) = item_id
                    url_det = (
                        f"https://faturas.portaldasfinancas.gov.pt/detalheDocumentoEmitente.action"
                        f"?idDocumento={id_doc}&dataEmissaoDocumento={dt_doc}"
                    )
                    for tentativa_d in range(2):
                        try:
                            r_det = extrator.session.get(url_det, timeout=8)
                            if r_det.status_code == 200:
                                m = re.search(r'id=["\']nomeAdquirente["\'][^>]*>([^<]+)</span>', r_det.text)
                                if m:
                                    nome_raw = html.unescape(m.group(1).strip())
                                    if nome_raw and nome_raw.lower() not in ("consumidor final", "consumidor final."):
                                        return cp_nif, efatura_api.to_title_case(nome_raw)
                            break
                        except Exception:
                            time.sleep(0.2)
                    return cp_nif, None

                num_workers = min(6, total_part_id)
                concluidos_part = 0
                nomes_part_lote = {}
                orcamento_part = 12.0 if modo_sincrono else 45.0
                executor = concurrent.futures.ThreadPoolExecutor(max_workers=num_workers)
                try:
                    futures = {
                        executor.submit(workspace_context.wrap_thread_target(_extrair_detalhe_direto), it): it[0]
                        for it in nifs_com_id.items()
                    }
                    try:
                        for fut in concurrent.futures.as_completed(futures, timeout=orcamento_part):
                            concluidos_part += 1
                            cp_nif, nome_fmt = fut.result()
                            if nome_fmt:
                                nomes_resolvidos[cp_nif] = nome_fmt
                                nomes_part_lote[cp_nif] = nome_fmt
                                LOGGER.info(f"✅ [PARTICULAR RESOLVIDO] NIF {cp_nif} -> '{nome_fmt}'")
                            if job_id and job_id in JOBS:
                                JOBS[job_id]["fase"] = "nomes"
                                JOBS[job_id]["mensagem"] = f"A identificar clientes particulares ({concluidos_part} de {total_part_id})..."
                                JOBS[job_id]["percentagem"] = int((concluidos_part / max(1, total_part_id)) * 100)
                    except concurrent.futures.TimeoutError:
                        LOGGER.info(
                            f"⏱️ [PARTICULARES TIMEOUT ORÇAMENTO] Orçamento de {orcamento_part}s atingido. "
                            f"Restantes particulares delegados ao segundo plano."
                        )
                finally:
                    try:
                        executor.shutdown(wait=False, cancel_futures=True)
                    except TypeError:
                        executor.shutdown(wait=False)

                if nomes_part_lote:
                    pb_client.gravar_nomes_nifs_cache_lote(nomes_part_lote, origem="detalhe_efatura")

                # Retira os NIFs resolvidos de missing_nifs
                for cp_nif in nomes_resolvidos:
                    missing_nifs.pop(cp_nif, None)

        except Exception as e_part:
            LOGGER.warning(f"Aviso na recolha rápida de particulares: {e_part}")
        finally:
            if sessao:
                try:
                    sessao.close()
                except Exception:
                    pass

    # 4. Atualização das linhas e da base de dados com todos os nomes resolvidos
    if nomes_resolvidos:
        if horizontal_rows and len(horizontal_rows) > 1:
            for r in horizontal_rows[1:]:
                raw_cp_nif = str(r.get("NIF ComercianteConsumidor") or "").strip()
                cp_nif = re.sub(r'[^0-9]', '', raw_cp_nif).strip()
                if cp_nif in nomes_resolvidos:
                    r["Nome ComerConsu"] = nomes_resolvidos[cp_nif]
                    r["Nome_ComerConsu"] = nomes_resolvidos[cp_nif]
            for vr in vertical_rows:
                raw_cp_nif = str(vr.get("Contraparte NIF") or "").strip()
                cp_nif = re.sub(r'[^0-9]', '', raw_cp_nif).strip()
                if cp_nif in nomes_resolvidos:
                    vr["Contraparte"] = nomes_resolvidos[cp_nif]

        if salvar_sqlite:
            pb_client.atualizar_nomes_vendas_db(nif_clean, nomes_resolvidos)

    # 4. Atribuição de '[Sem Nome Registado]' a NIFs reais cujo nome não foi disponibilizado pelo comerciante/AT
    nomes_sem_registo = {}
    if horizontal_rows and len(horizontal_rows) > 1:
        for r in horizontal_rows[1:]:
            raw_cp_nif = str(r.get("NIF ComercianteConsumidor") or "").strip()
            cp_nif = re.sub(r'[^0-9]', '', raw_cp_nif).strip()
            if cp_nif and cp_nif not in ("999999999", "999999990", "99999999"):
                curr_name = str(r.get("Nome ComerConsu") or "").strip()
                if not curr_name or curr_name.lower() in ("consumidor final", "consumidor final."):
                    r["Nome ComerConsu"] = "[Sem Nome Registado]"
                    r["Nome_ComerConsu"] = "[Sem Nome Registado]"
                    nomes_sem_registo[cp_nif] = "[Sem Nome Registado]"

    if vertical_rows:
        for vr in vertical_rows:
            raw_cp_nif = str(vr.get("Contraparte NIF") or "").strip()
            cp_nif = re.sub(r'[^0-9]', '', raw_cp_nif).strip()
            if cp_nif and cp_nif not in ("999999999", "999999990", "99999999"):
                curr_name = str(vr.get("Contraparte") or "").strip()
                if not curr_name or curr_name.lower() in ("consumidor final", "consumidor final."):
                    vr["Contraparte"] = "[Sem Nome Registado]"
                    nomes_sem_registo[cp_nif] = "[Sem Nome Registado]"

    for cp_nif in missing_nifs:
        if cp_nif and cp_nif not in ("999999999", "999999990", "99999999") and cp_nif not in nomes_resolvidos:
            nomes_sem_registo[cp_nif] = "[Sem Nome Registado]"

    if salvar_sqlite and nomes_sem_registo:
        pb_client.atualizar_nomes_vendas_db(nif_clean, nomes_sem_registo)

    return horizontal_rows, vertical_rows


# -------------------------------------------------------------------------
# EXTRAÇÃO SÍNCRONA
# -------------------------------------------------------------------------
@app.post("/api/extracao")
def extrair_faturas(req: ExtracaoRequest, lic = Depends(verificar_licenca_ativa)):
    """Extrai faturas de forma síncrona diretamente da AT."""
    print(f"\n>>> PEDIDO EXTRACAO: NIF={req.nif}, De={req.data_inicio} Ate={req.data_fim}, Tipo={req.tipo}")
    as_buyer = req.tipo.lower() == "compras"
    tipo_str = "compras" if as_buyer else "vendas"
    
    # 1. Normalizar NIF / Subutilizador e obter credenciais caso o pedido não traga
    nif_raw = str(req.nif or "").strip()
    sub = req.subutilizador
    if "/" in nif_raw:
        parts_sync = nif_raw.split("/", 1)
        req.nif = re.sub(r'[^0-9]', '', parts_sync[0]).strip()[:9]
        if not sub:
            sub = nif_raw
    else:
        req.nif = re.sub(r'[^0-9]', '', nif_raw).strip()[:9]

    pwd = req.password
    if not pwd or not sub:
        pb_sub, pb_pwd = pb_client.get_credentials(req.nif)
        if pb_pwd and not pwd:
            pwd = pb_pwd
        if pb_sub and not sub:
            sub = pb_sub

    sub = legado_bridge.normalizar_subutilizador_at(req.nif, sub or "")

    if not pwd:
         raise HTTPException(status_code=400, detail="Senha AT não fornecida no pedido nem encontrada no PocketBase Central.")
    
    # 1.1 Verificação de senha inválida memorizada
    is_invalida, detalhe_erro = pb_client.check_if_password_marked_invalid(req.nif, pwd)
    if is_invalida:
        raise HTTPException(
            status_code=400, 
            detail=f"Autenticação Bloqueada: Senha já testada e rejeitada pela AT ({detalhe_erro}). Altere a senha no Gestor de Entidades para voltar a testar."
        )

    modo_saida = (req.modo_saida or "sqlite").strip().lower()
    salvar_sqlite = modo_saida not in ("apenas_memoria", "apenas_xml")
    gerar_xml = modo_saida not in ("apenas_memoria", "apenas_sqlite")
    incluir_dados_memoria = True
    pipeline_worker.sinalizar_primeiro_plano(True, nif=req.nif)

    simulacao_soap_ativa = bool(_MODO_TESTE_SCRAPER.get("ativo"))
    forcar_scraper_efetivo = bool(req.forcar_scraper)
    if forcar_scraper_efetivo or simulacao_soap_ativa:
        req.reimportar_tudo = True

    # 2. Se for uma Reimportação Forçada (Wipe & Fetch) ou se a cache do período tiver inconsistências, apagar 100% dos registos locais, caches e staging
    if not req.reimportar_tudo and pb_client.periodo_tem_inconsistencia_faturas(req.nif, req.data_inicio, req.data_fim, tipo_str):
        req.reimportar_tudo = True
    if req.reimportar_tudo:
        if as_buyer:
            pb_client.delete_faturas_periodo(req.nif, req.data_inicio, req.data_fim)
        else:
            pb_client.delete_vendas_periodo(req.nif, req.data_inicio, req.data_fim)
        nif_clean_sync = re.sub(r'[^0-9]', '', str(req.nif)).strip()[:9]
        for p_start, p_end in efatura_api.iter_month_periods(req.data_inicio, req.data_fim):
            efatura_api.limpar_staging(req.nif, p_start.year, p_start.month, tipo_str)
            efatura_api.limpar_xml_legado_periodo(req.nif, p_start.year, p_start.month, as_buyer=as_buyer)
            pb_client.limpar_status_mes(nif_clean_sync, p_start.year, p_start.month, tipo_str)
        
    try:
        # Extração período a período com lock e staging persistente página a página
        all_invoices = []
        scraped_v_rows = []
        fetched_v_rows = []
        paginas_gravadas_no_callback = False
        db_write_lock = threading.Lock()
        grand_total_esperado = 0

        # Disparo do Scraper de Anuladas (estritamente a pedido explícito)
        scraper_future = None
        executor_scraper = None
        if req.obter_anuladas and as_buyer and iniciar_sessao_efatura is not None and pwd:
            try:
                executor_scraper = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="ScraperAnuladasSync")
                scraper_future = executor_scraper.submit(
                    workspace_context.wrap_thread_target(executar_scraping_anuladas_paralelo),
                    nif=req.nif,
                    password=pwd,
                    data_inicio=str(req.data_inicio),
                    data_fim=str(req.data_fim),
                    as_buyer=as_buyer,
                    nome_entidade=req.nome_entidade or "",
                    subuser=sub
                )
            except Exception as e_scr_start:
                LOGGER.warning(f"Aviso ao iniciar thread de scraping de anuladas: {e_scr_start}")
                scraper_future = None
                executor_scraper = None

        precisa_scraper = (req.data_inicio.year < 2025) or (req.data_fim.year < 2025) or forcar_scraper_efetivo
        if precisa_scraper:
            # 1. Se não for reimportação forçada, verificar se todos os meses já estão completos na BD
            meses_pedidos = list(efatura_api.iter_month_periods(req.data_inicio, req.data_fim))
            todos_completos = False
            if not req.reimportar_tudo and salvar_sqlite and meses_pedidos:
                todos_completos = True
                for p_start, p_end in meses_pedidos:
                    st_m = pb_client.obter_status_mes(req.nif, p_start.year, p_start.month, tipo_str)
                    docs_bd = pb_client.contar_docs_na_bd(req.nif, p_start.year, p_start.month, tipo_str)
                    m_comp = (st_m.get("completo") == 1 and docs_bd > 0) or (st_m.get("total_esperado", 0) > 0 and docs_bd >= st_m.get("total_esperado", 0))
                    if not m_comp:
                        todos_completos = False
                        break

            if todos_completos:
                horizontal_rows, vertical_rows, docs_totais_bd = reconstruir_horizontal_vertical_de_sqlite(
                    nif=req.nif,
                    data_inicio=str(req.data_inicio),
                    data_fim=str(req.data_fim),
                    as_buyer=as_buyer,
                    nome_entidade=req.nome_entidade or "",
                )
                if not docs_totais_bd:
                    docs_totais_bd = sum(pb_client.contar_docs_na_bd(req.nif, p_s.year, p_s.month, tipo_str) for p_s, p_e in meses_pedidos)
                LOGGER.info(f"⚡ [SCRAPER SKIP SYNC] Todos os meses ({req.data_inicio} a {req.data_fim}) já estão 100% completos na BD ({docs_totais_bd} docs) para NIF {req.nif}.")
                total_docs_reais = docs_totais_bd
                grand_total_esperado = docs_totais_bd
                ficheiros_xml = []
                xml_conteudo = ""
            else:
                _garantir_scraper_pronto(ano_ref=req.data_inicio.year)
                LOGGER.info(f"🌐 [ROTA SCRAPER SÍNCRONO] A extrair via Portal Web ({req.data_inicio} a {req.data_fim})...")
                horizontal_rows, vertical_rows, grand_total_esperado = executar_scraping_completo(
                    nif=req.nif,
                    password=pwd,
                    data_inicio=str(req.data_inicio),
                    data_fim=str(req.data_fim),
                    as_buyer=as_buyer,
                    nome_entidade=req.nome_entidade or "",
                    subuser=sub,
                    salvar_sqlite=salvar_sqlite,
                    reimportar_tudo=req.reimportar_tudo,
                )
                if not as_buyer:
                    horizontal_rows, vertical_rows = resolver_e_completar_nomes_vendas(
                        nif_titular=req.nif,
                        password=pwd,
                        subuser=sub,
                        horizontal_rows=horizontal_rows,
                        vertical_rows=vertical_rows,
                        salvar_sqlite=salvar_sqlite,
                        data_inicio=req.data_inicio,
                        data_fim=req.data_fim,
                        modo_sincrono=True,
                    )
                total_docs_reais = max(0, len(horizontal_rows) - 1)
                if salvar_sqlite and total_docs_reais == 0:
                    docs_bd_totais = sum(pb_client.contar_docs_na_bd(req.nif, p_s.year, p_s.month, tipo_str) for p_s, p_e in meses_pedidos)
                    if docs_bd_totais > 0:
                        total_docs_reais = docs_bd_totais
                ficheiros_xml = []
                xml_conteudo = ""
            if gerar_xml:
                try:
                    ficheiros_xml, xml_conteudo = efatura_api.exportar_lote_xml_legado_de_horizontal(
                        req.nif,
                        horizontal_rows[1:],
                        as_buyer=as_buyer,
                        pasta_raiz=req.pasta_raiz_dados,
                        caminho_personalizado=req.caminho_xml_personalizado,
                        data_inicio=req.data_inicio,
                        data_fim=req.data_fim,
                        total_esperado=grand_total_esperado,
                    )
                except Exception as xe:
                    LOGGER.error(f"Erro ao gerar XML legado no sync: {xe}")

            if salvar_sqlite:
                nif_clean_sync = re.sub(r'[^0-9]', '', str(req.nif)).strip()[:9]
                is_single_month = (req.data_inicio.year == req.data_fim.year and req.data_inicio.month == req.data_fim.month)
                for p_start, p_end in efatura_api.iter_month_periods(req.data_inicio, req.data_fim):
                    pb_client.atualizar_status_mes(
                        nif_clean_sync, p_start.year, p_start.month, tipo_str,
                        total_esperado=grand_total_esperado if is_single_month else None,
                        docs_gravados=total_docs_reais if is_single_month else None,
                        completo=True
                    )

            pb_client.clear_invalid_password_if_success(req.nif)
            _registar_auditoria_extracao(
                req.nif,
                f"{req.data_inicio}..{req.data_fim}",
                tipo_str,
                "web_scraping",
                total_docs_reais,
                "forcar_scraper" if forcar_scraper_efetivo else "ano_anterior_2025",
            )
            return {
                "status": "sucesso",
                "assinatura": "API Importador e-Fatura Gexcel",
                "nif": req.nif,
                "data_inicio": str(req.data_inicio),
                "data_fim": str(req.data_fim),
                "tipo": tipo_str,
                "total_documentos": total_docs_reais,
                "total_documentos_esperados": grand_total_esperado,
                "total_linhas_vertical": len(vertical_rows),
                "dados_legacy_horizontal": horizontal_rows,
                "dados_resumo_vertical": vertical_rows if incluir_dados_memoria else [],
                "dados_novos_vertical": vertical_rows if incluir_dados_memoria else [],
                "ficheiros_xml_gerados": ficheiros_xml,
                "conteudo_xml": xml_conteudo,
                "metodo": "web_scraping"
            }

        failover_para_scraper = False
        motivo_failover_sync = ""
        for p_start, p_end in efatura_api.iter_month_periods(req.data_inicio, req.data_fim):
            month_lock = efatura_api.get_month_lock(req.nif, p_start.year, p_start.month, tipo_str)
            with month_lock:
                docs_existentes_fn = lambda a, m: (
                    0 if req.reimportar_tudo else max(
                        pb_client.contar_docs_na_bd(req.nif, a, m, tipo_str) if salvar_sqlite else 0,
                        efatura_api.contar_staging(req.nif, a, m, tipo_str)
                    )
                )
                docs_intervalo_fn = lambda d_i, d_f: (
                    0 if req.reimportar_tudo else (
                        pb_client.contar_docs_intervalo_na_bd(req.nif, d_i, d_f, tipo_str) if salvar_sqlite else 0
                    )
                )

                def on_page_fetched(page_invoices):
                    nonlocal paginas_gravadas_no_callback
                    if page_invoices:
                        try:
                            with db_write_lock:
                                p_h, p_v = efatura_api.invoices_to_rows(
                                    req.nif, page_invoices, as_buyer=as_buyer, entity_name=req.nome_entidade or ""
                                )
                                # 1. Gravar no Staging Persistente local (JSONL)
                                if p_h and len(p_h) > 1:
                                    efatura_api.append_staging(req.nif, p_start.year, p_start.month, tipo_str, p_h[1:])
                                # 2. Gravar no SQLite (se modo_saida permitir)
                                if p_v:
                                    fetched_v_rows.extend(p_v)
                                    if salvar_sqlite:
                                        if as_buyer:
                                            pb_client.upsert_faturas_direto(p_v)
                                        else:
                                            pb_client.upsert_vendas_direto(p_v)
                                        paginas_gravadas_no_callback = True
                        except Exception as pe:
                            LOGGER.error(f"Erro no on_page_fetched síncrono: {pe}")

                def on_scout_done(scout_items):
                    if salvar_sqlite:
                        pb_client.registar_scout_mensal(req.nif, tipo_str, scout_items)

                def on_period_done(period_start, period_end, period_invoices, p_expected, is_complete, docs_existentes=None):
                    docs_na_bd = docs_existentes if docs_existentes is not None else docs_existentes_fn(period_start.year, period_start.month)
                    mes_completo = bool(is_complete or (p_expected > 0 and docs_na_bd >= p_expected) or (p_expected == 0))
                    if salvar_sqlite:
                        pb_client.atualizar_status_mes(
                            req.nif, period_start.year, period_start.month, tipo_str,
                            total_esperado=p_expected or docs_na_bd,
                            docs_gravados=docs_na_bd,
                            completo=mes_completo
                        )

                try:
                    if simulacao_soap_ativa:
                        LOGGER.warning(
                            f"🧪 [MODO TESTE SCRAPER SÍNCRONO] A simular recusa SOAP da AT para NIF {req.nif} ({p_start} a {p_end})..."
                        )
                        raise Fault("Ocorreu um erro na autenticacao dos contribuintes.")
                    m_invs, m_total_esp = efatura_api.get_invoices(
                        req.nif,
                        sub,
                        pwd,
                        p_start,
                        p_end,
                        as_buyer=as_buyer,
                        return_totals=True,
                        on_scout_done=on_scout_done,
                        on_period_done=on_period_done,
                        on_page_fetched=on_page_fetched,
                        docs_existentes_fn=docs_existentes_fn,
                        reimportar_tudo=req.reimportar_tudo,
                        docs_intervalo_fn=docs_intervalo_fn,
                    )
                except Exception as ws_err:
                    if _deve_acionar_failover_scraper(ws_err) and pwd:
                        LOGGER.warning(
                            f"⚠️ [FAILOVER SCRAPER SÍNCRONO] AT Webservices recusou/falhou ({ws_err}). "
                            f"A acionar contingência pelo Portal Web para {req.data_inicio} a {req.data_fim}..."
                        )
                        failover_para_scraper = True
                        motivo_failover_sync = str(ws_err)
                        break
                    raise ws_err

                all_invoices.extend(m_invs)
                grand_total_esperado += (m_total_esp or 0)

        if failover_para_scraper:
            _garantir_scraper_pronto(ano_ref=req.data_inicio.year)
            horizontal_rows, vertical_rows, grand_total_esperado = executar_scraping_completo(
                nif=req.nif,
                password=pwd,
                data_inicio=str(req.data_inicio),
                data_fim=str(req.data_fim),
                as_buyer=as_buyer,
                nome_entidade=req.nome_entidade or "",
                subuser=sub,
                salvar_sqlite=salvar_sqlite,
                reimportar_tudo=req.reimportar_tudo,
            )
            paginas_gravadas_no_callback = True
            if salvar_sqlite:
                is_single_month_fo = (req.data_inicio.year == req.data_fim.year and req.data_inicio.month == req.data_fim.month)
                docs_fo = max(0, len(horizontal_rows) - 1)
                for p_s_fo, _ in efatura_api.iter_month_periods(req.data_inicio, req.data_fim):
                    pb_client.atualizar_status_mes(
                        req.nif,
                        p_s_fo.year,
                        p_s_fo.month,
                        tipo_str,
                        total_esperado=grand_total_esperado if is_single_month_fo else None,
                        docs_gravados=docs_fo if is_single_month_fo else None,
                        completo=True,
                    )

        pb_client.clear_invalid_password_if_success(req.nif)

        # Aplicar política de retenção temporal se configurado e gravado em SQLite
        if salvar_sqlite and req.anos_retencao and req.anos_retencao > 0:
            try:
                pb_client.aplicar_retencao_anos(req.nif, tipo_str, req.anos_retencao)
            except Exception as err_ret:
                LOGGER.warning(f"Aviso ao aplicar retenção para {req.nif}: {err_ret}")

        # Montar a lista completa final de documentos a partir do Staging
        # (une o que já estava em cache nas tentativas anteriores com o que acabou de ser descarregado)
        staging_rows = []
        if not failover_para_scraper:
            for p_start, p_end in efatura_api.iter_month_periods(req.data_inicio, req.data_fim):
                m_rows = efatura_api.carregar_staging(req.nif, p_start.year, p_start.month, tipo_str)
                staging_rows.extend(m_rows)

        if failover_para_scraper:
            pass
        elif scraped_v_rows:
            vertical_rows = scraped_v_rows
            totals_row = {
                "IdDocumento": "TotalDocs:",
                "Atividade de Realização da Aquisição": len(all_invoices),
                "NIF ComercianteConsumidor": len(all_invoices),
                "TipoDoc": 0, "Situação": 0, "Nº Fatura": 0, "ATCUD": 0,
                "Data Emissão": "1899-12-31", "Total Iva": 0, "Total_Liquido": 0, "Base Tributável": 0,
            }
            h_rows = [totals_row]
            for doc in all_invoices:
                if hasattr(doc, "to_dict"):
                    h_rows.append(doc.to_dict())
                elif isinstance(doc, dict):
                    h_rows.append(doc)
            horizontal_rows = h_rows
        elif salvar_sqlite and not req.reimportar_tudo and grand_total_esperado > 0 and len(staging_rows) < grand_total_esperado:
            # Retoma incremental: reúne os sub-períodos/meses já na BD SQLite com as páginas recém-gravadas
            h_reconst, v_reconst, docs_bd_reconst = reconstruir_horizontal_vertical_de_sqlite(
                nif=req.nif,
                data_inicio=str(req.data_inicio),
                data_fim=str(req.data_fim),
                as_buyer=as_buyer,
                nome_entidade=req.nome_entidade or "",
            )
            if h_reconst and docs_bd_reconst >= len(staging_rows):
                horizontal_rows = h_reconst
                vertical_rows = v_reconst
            elif staging_rows:
                horizontal_rows = efatura_api.reconstruir_horizontal_com_totais(staging_rows, total_esperado=grand_total_esperado)
                vertical_rows = fetched_v_rows if fetched_v_rows else (
                    efatura_api.invoices_to_rows(
                        req.nif, all_invoices, as_buyer=as_buyer, entity_name=req.nome_entidade or "", total_esperado=grand_total_esperado
                    )[1] if all_invoices else []
                )
            else:
                horizontal_rows, vertical_rows = efatura_api.invoices_to_rows(
                    req.nif, all_invoices, as_buyer=as_buyer, entity_name=req.nome_entidade or "", total_esperado=grand_total_esperado
                )
        elif staging_rows and (not all_invoices or len(staging_rows) >= len(all_invoices)):
            horizontal_rows = efatura_api.reconstruir_horizontal_com_totais(staging_rows, total_esperado=grand_total_esperado)
            if fetched_v_rows and (not all_invoices or len(staging_rows) == len(all_invoices)):
                vertical_rows = fetched_v_rows
            elif all_invoices:
                _, vertical_rows = efatura_api.invoices_to_rows(
                    req.nif, all_invoices, as_buyer=as_buyer, entity_name=req.nome_entidade or "", total_esperado=grand_total_esperado
                )
            else:
                vertical_rows = []
        else:
            horizontal_rows, vertical_rows = efatura_api.invoices_to_rows(
                req.nif, all_invoices, as_buyer=as_buyer, entity_name=req.nome_entidade or "", total_esperado=grand_total_esperado
            )
            if salvar_sqlite and vertical_rows and not paginas_gravadas_no_callback:
                if as_buyer:
                    pb_client.upsert_faturas_direto(vertical_rows)
                else:
                    pb_client.upsert_vendas_direto(vertical_rows)
                paginas_gravadas_no_callback = True

        # Aguardar e fundir faturas anuladas recolhidas pelo Scraper a pedido (apenas compras)
        anuladas_integradas_sync = False
        if req.obter_anuladas and as_buyer and scraper_future is not None:
            try:
                LOGGER.info("A aguardar conclusão do scraper de faturas anuladas em segundo plano...")
                anuladas_h_rows, anuladas_v_rows = scraper_future.result(timeout=60)
                if anuladas_h_rows or anuladas_v_rows:
                    horizontal_rows, vertical_rows = fundir_faturas_anuladas(
                        horizontal_rows=horizontal_rows,
                        vertical_rows=vertical_rows,
                        anuladas_h_rows=anuladas_h_rows,
                        anuladas_v_rows=anuladas_v_rows,
                        nif=req.nif,
                        tipo_str=tipo_str,
                        salvar_sqlite=salvar_sqlite,
                        as_buyer=as_buyer
                    )
                    anuladas_integradas_sync = True
            except Exception as se:
                LOGGER.warning(f"Aviso: Falha ao obter faturas anuladas via scraper: {se}")
            finally:
                if executor_scraper:
                    executor_scraper.shutdown(wait=False)
                scraper_future = None
                executor_scraper = None

        # Resolução cirúrgica de nomes de clientes em vendas
        if not as_buyer:
            horizontal_rows, vertical_rows = resolver_e_completar_nomes_vendas(
                nif_titular=req.nif,
                password=pwd,
                subuser=sub,
                horizontal_rows=horizontal_rows,
                vertical_rows=vertical_rows,
                salvar_sqlite=salvar_sqlite,
                data_inicio=req.data_inicio,
                data_fim=req.data_fim,
                modo_sincrono=True
            )

        # 100% das faturas são auditadas e registadas no Cofre Permanente de Estados (Ledger Forense)
        # (se salvar_sqlite e paginas_gravadas_no_callback, upsert_*_direto já registou página a página)
        if not (paginas_gravadas_no_callback and salvar_sqlite and not anuladas_integradas_sync):
            try:
                cofre = cofre_ledger.CofreEstadosLedger()
                linhas_para_cofre = vertical_rows if vertical_rows else horizontal_rows[1:]
                inconfs_detetadas = cofre.registar_e_confrontar(linhas_para_cofre, nif_titular=req.nif)
                if inconfs_detetadas:
                    LOGGER.warning(
                        f"🚨 [COFRE LEDGER] {len(inconfs_detetadas)} fatura(s) com anulação tardia "
                        f"detetadas para NIF {req.nif}!"
                    )
            except Exception as cle:
                LOGGER.error(f"Erro ao registar no Cofre Ledger: {cle}")

        total_documentos_finais = max(0, len(horizontal_rows) - 1)

        ficheiros_xml = []
        xml_conteudo = ""
        if gerar_xml:
            ficheiros_xml, xml_conteudo = efatura_api.exportar_lote_xml_legado_de_horizontal(
                req.nif,
                horizontal_rows[1:],
                as_buyer=as_buyer,
                pasta_raiz=req.pasta_raiz_dados,
                caminho_personalizado=req.caminho_xml_personalizado,
                data_inicio=req.data_inicio,
                data_fim=req.data_fim,
                total_esperado=grand_total_esperado or total_documentos_finais,
            )

        metodo_final_sync = "web_scraping" if failover_para_scraper else "soap_api"
        _registar_auditoria_extracao(
            req.nif,
            f"{req.data_inicio}..{req.data_fim}",
            tipo_str,
            metodo_final_sync,
            total_documentos_finais,
            f"contingencia_soap: {motivo_failover_sync}" if failover_para_scraper else "soap_direto",
        )
        resp = {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "modo_saida": modo_saida,
            "metodo": metodo_final_sync,
            "total_documentos": total_documentos_finais,
            "total_documentos_esperados": total_documentos_finais,
            "total_linhas_vertical": len(vertical_rows),
            "dados_legacy_horizontal": horizontal_rows,
            "dados_novos_vertical": vertical_rows,
        }
        if ficheiros_xml:
            resp["ficheiros_xml_gerados"] = ficheiros_xml
            resp["conteudo_xml"] = xml_conteudo

        # Limpeza do staging temporário após conclusão com sucesso
        try:
            for p_start, p_end in efatura_api.iter_month_periods(req.data_inicio, req.data_fim):
                efatura_api.limpar_staging(req.nif, p_start.year, p_start.month, tipo_str)
        except Exception as e_clean:
            LOGGER.warning(f"Aviso ao limpar staging pós-conclusão síncrona: {e_clean}")

        # Agendamento automático no Pipeline de Segundo Plano (Anuladas + Nomes de Vendas)
        try:
            tem_particulares = False
            if not as_buyer:
                for vr in vertical_rows:
                    cp_nif = str(vr.get("Contraparte NIF") or "").strip()
                    cp_nome = str(vr.get("Contraparte") or "").strip()
                    if cp_nif and cp_nif not in ("999999990", "999999999", "99999999") and (not cp_nome or cp_nome == "[Sem Nome Registado]"):
                        tem_particulares = True
                        break
            pipeline_worker.adicionar_tarefas_pos_extracao(
                nif=req.nif,
                nome_entidade=req.nome_entidade or "",
                modulo=tipo_str,
                data_inicio=str(req.data_inicio),
                data_fim=str(req.data_fim),
                tem_particulares_sem_nome=tem_particulares
            )
        except Exception as e_pipe:
            LOGGER.warning(f"Aviso ao agendar tarefas de segundo plano pós-extração: {e_pipe}")

        return resp
        
    except efatura_api.ATAPIError as at_err:
        raise HTTPException(
            status_code=502,
            detail={"erro_at_codigo": at_err.code, "erro_at_mensagem": at_err.description},
        )
    except Exception as exc:
        LOGGER.exception("Erro na extração síncrona: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        pipeline_worker.sinalizar_primeiro_plano(False)
        if 'executor_scraper' in locals() and executor_scraper:
            executor_scraper.shutdown(wait=False)
        # Higienização de memória RAM
        req.password = ""

# -------------------------------------------------------------------------
# EXTRAÇÃO ASSÍNCRONA COM GESTOR DINÂMICO ADAPTATIVO DE CONCORRÊNCIA
# -------------------------------------------------------------------------
JOBS = {}

class DynamicConcurrencyManager:
    """
    Gestor Inteligente e Adaptativo de Concorrência (Gexcel EVO Engine).
    Regula o número de workers em paralelo com base no perfil real de hardware,
    na carga em tempo real (CPU/RAM) com objetivo de aproveitamento pleno até 90% de CPU
    e implementa ordenação Shortest Job First (SJF) para máxima vazão de faturas.
    """
    def __init__(self):
        self._active_count = 0
        self._active_by_client = {}
        self._lock = threading.Lock()
        self._wait_queue = []  # Heap priority queue: (fair_priority, volume_estimado, timestamp, event, cancel_fn, client_id)
        
        # 1. Inspecionar núcleos lógicos de CPU
        self.cpu_cores = os.cpu_count() or 4
        self.total_ram_gb = 16.0

        # 2. Inspecionar memória RAM física real (psutil com fallback nativo Windows via ctypes)
        if psutil:
            try:
                mem = psutil.virtual_memory()
                self.total_ram_gb = round(mem.total / (1024 ** 3), 1)
            except Exception:
                pass

        if sys.platform == "win32" and (self.total_ram_gb <= 16.0 or not psutil):
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
                    self.total_ram_gb = round(stat.ullTotalPhys / (1024 ** 3), 1)
            except Exception:
                pass

        # 3. Determinação automática de concorrência Cloud-First (I/O de rede contra a AT)
        cores = self.cpu_cores
        ram = self.total_ram_gb

        if sys.platform != "win32":
            self.tier_name = f"Motor Cloud Hetzner ({cores} vCPUs, {ram:.1f} GB RAM)"
            self.max_allowed = 6 if ram >= 6.0 else 4
        elif cores >= 12 and ram >= 20:
            self.tier_name = f"Ultra Performance ({cores} núcleos, {int(ram)} GB RAM)"
            self.max_allowed = 12
        else:
            self.tier_name = f"Automático Alta Concorrência ({cores} núcleos, {int(ram)} GB RAM)"
            self.max_allowed = 8

        self.mode = "auto"
        self.manual_limit = self.max_allowed

        # Telemetria recente
        self._last_cpu = 0.0
        self._last_ram = 0.0
        self._last_sample_time = 0.0

    def sample_system_load(self):
        agora = time.time()
        # Amostragem com intervalo mínimo de 1.0s
        if agora - self._last_sample_time > 1.0:
            if psutil:
                try:
                    self._last_cpu = psutil.cpu_percent(interval=None)
                    self._last_ram = psutil.virtual_memory().percent
                    self._last_sample_time = agora
                except Exception:
                    pass
            elif sys.platform == "win32":
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
                        self._last_ram = float(stat.dwMemoryLoad)
                        self._last_sample_time = agora
                except Exception:
                    pass
        return self._last_cpu, self._last_ram

    def get_current_limit(self) -> int:
        if self.mode == "manual":
            return max(1, min(self.max_allowed, self.manual_limit))

        # Modo Automático Adaptativo com objetivo de aproveitamento pleno até 90% do CPU:
        cpu, ram = self.sample_system_load()

        # 1. PC no limite extremo (CPU >= 90% ou RAM >= 92%):
        if cpu >= 90.0 or ram >= 92.0:
            return max(2, self.max_allowed // 2)

        # 2. Carga elevada (CPU entre 80% e 90%):
        if cpu >= 80.0:
            return max(2, int(self.max_allowed * 0.8))

        # 3. CPU abaixo de 80%: APROVEITAMENTO PLENO MÁXIMO (100% dos workers disponíveis)
        return self.max_allowed

    def acquire(self, volume: int = 0, cancel_fn=None, client_id: str = "default"):
        """
        Adquire um slot de execução respeitando Quota Justa Multi-Cliente (Fair-Share)
        e prioridade Shortest Job First (SJF).
        """
        cid = str(client_id or "default")
        event = None
        with self._lock:
            if self._active_count < self.get_current_limit() and not self._wait_queue:
                self._active_count += 1
                self._active_by_client[cid] = self._active_by_client.get(cid, 0) + 1
                return
            event = threading.Event()
            active_cli = self._active_by_client.get(cid, 0)
            fair_priority = (active_cli * 2000) + int(volume or 0)
            heapq.heappush(self._wait_queue, (fair_priority, int(volume or 0), time.time(), event, cancel_fn, cid))

        while True:
            if event.wait(timeout=0.5):
                return
            if cancel_fn and cancel_fn():
                with self._lock:
                    self._wait_queue = [item for item in self._wait_queue if item[3] is not event]
                    heapq.heapify(self._wait_queue)
                return

    def cancel_all(self):
        """Cancela e acorda imediatamente todas as tarefas em espera na fila SJF."""
        with self._lock:
            for item in self._wait_queue:
                try:
                    item[3].set()
                except Exception:
                    pass
            self._wait_queue.clear()

    def release(self, client_id: str = "default"):
        cid = str(client_id or "default")
        with self._lock:
            self._active_count = max(0, self._active_count - 1)
            if cid in self._active_by_client:
                self._active_by_client[cid] = max(0, self._active_by_client[cid] - 1)
                if self._active_by_client[cid] == 0:
                    self._active_by_client.pop(cid, None)
            self._process_queue_locked()

    def _process_queue_locked(self):
        while self._wait_queue and self._active_count < self.get_current_limit():
            _, _, _, next_event, cancel_fn, cid = heapq.heappop(self._wait_queue)
            if cancel_fn and cancel_fn():
                continue
            self._active_count += 1
            self._active_by_client[cid] = self._active_by_client.get(cid, 0) + 1
            next_event.set()

    def get_status(self) -> dict:
        cpu, ram = self.sample_system_load()
        limit = self.get_current_limit()
        with self._lock:
            q_len = len(self._wait_queue)
            active_clients = len(self._active_by_client)
        return {
            "mode": self.mode,
            "current_limit": limit,
            "active_workers": self._active_count,
            "active_clients": active_clients,
            "queue_waiting": q_len,
            "max_allowed": self.max_allowed,
            "cpu_percent": round(cpu, 1),
            "ram_percent": round(ram, 1),
            "cpu_cores": self.cpu_cores,
            "total_ram_gb": self.total_ram_gb,
            "hardware_tier": self.tier_name,
            "strategy": "Fair-Share Multi-Cliente + SJF (Shortest Job First)",
        }

    def set_config(self, mode: str, manual_limit: int = 8):
        with self._lock:
            self.mode = "auto"
            if 1 <= manual_limit <= 16:
                self.manual_limit = min(manual_limit, self.max_allowed)
            self._process_queue_locked()

CONCURRENCY_MANAGER = DynamicConcurrencyManager()

def estimar_volume_nif(nif: str, tipo: str, ano: int):
    """
    Calcula a estimativa de volume de documentos para um NIF específico:
    1. Verifica o ano alvo em efatura_controlo_mensal (controlo_geral.db);
    2. Se não tiver docs, verifica o ano anterior mais recente com histórico;
    3. Se não tiver histórico, retorna 0 (prioridade inicial rápida).
    """
    db_path = pb_client.obter_db_controlo_path()
    if not os.path.exists(db_path):
        return 0, "sem_db"

    tipo_clean = str(tipo or "compras").strip().lower()
    nif_clean = re.sub(r"[^0-9]", "", str(nif or "")).strip()[:9]
    try:
        pb_client.init_controlo_db()
        with pb_client.db_connect(db_path, timeout=5) as conn:
            c = conn.cursor()
            c.execute("""
                SELECT COALESCE(SUM(docs_gravados), 0)
                FROM efatura_controlo_mensal
                WHERE nif = ? AND ano = ? AND lower(tipo) = ?
            """, (nif_clean, int(ano), tipo_clean))
            row = c.fetchone()
            docs_ano = int(row[0] or 0) if row else 0
            if docs_ano > 0:
                return docs_ano, f"ano_{ano}"

            c.execute("""
                SELECT ano, SUM(docs_gravados) as docs
                FROM efatura_controlo_mensal
                WHERE nif = ? AND ano < ? AND lower(tipo) = ?
                GROUP BY ano
                ORDER BY ano DESC
                LIMIT 1
            """, (nif_clean, int(ano), tipo_clean))
            hist_row = c.fetchone()
            if hist_row and int(hist_row[1] or 0) > 0:
                return int(hist_row[1]), f"hist_{hist_row[0]}"

            return 0, "sem_historico"
    except Exception as e:
        LOGGER.debug(f"Aviso ao estimar volume para NIF {nif} ({db_path}): {e}")
        return 0, "erro"

def obter_todas_estimativas_volume(ano: int, tipo: str = "compras"):
    """
    Retorna mapa em lote com o volume estimado de todas as entidades conhecidas.
    Executado em ~5ms sobre efatura_controlo_mensal (controlo_geral.db) para alimentar a fila SJF.
    """
    db_path = pb_client.obter_db_controlo_path()
    if not os.path.exists(db_path):
        return {}

    tipo_clean = str(tipo or "compras").strip().lower()
    try:
        pb_client.init_controlo_db()
        with pb_client.db_connect(db_path, timeout=5) as conn:
            c = conn.cursor()
            c.execute("""
                SELECT nif, CAST(ano AS TEXT) as ano_fatura, SUM(docs_gravados) as docs
                FROM efatura_controlo_mensal
                WHERE lower(tipo) = ?
                GROUP BY nif, ano
                ORDER BY nif, ano DESC
            """, (tipo_clean,))
            rows = c.fetchall()

        ano_str = str(ano)
        por_nif = {}
        for nif, a, docs in rows:
            if not nif:
                continue
            if nif not in por_nif:
                por_nif[nif] = {}
            por_nif[nif][str(a)] = int(docs or 0)

        resultado = {}
        for nif, anos_map in por_nif.items():
            if ano_str in anos_map and anos_map[ano_str] > 0:
                resultado[nif] = {
                    "volume_estimado": anos_map[ano_str],
                    "origem": f"ano_{ano_str}",
                    "ano_dados": ano
                }
            else:
                anteriores = sorted([a for a in anos_map.keys() if a < ano_str and anos_map[a] > 0], reverse=True)
                if anteriores:
                    mais_recente = anteriores[0]
                    resultado[nif] = {
                        "volume_estimado": anos_map[mais_recente],
                        "origem": f"historico_{mais_recente}",
                        "ano_dados": int(mais_recente)
                    }
                else:
                    resultado[nif] = {
                        "volume_estimado": 0,
                        "origem": "sem_historico",
                        "ano_dados": ano
                    }
        return resultado
    except Exception as e:
        LOGGER.warning(f"Erro ao obter todas as estimativas de volume: {e}")
        return {}

def _limpar_jobs_antigos():
    """Remove jobs registados há mais de 1 hora para evitar acúmulo desnecessário de RAM."""
    agora = time.time()
    expirados = [jid for jid, info in list(JOBS.items()) if agora - info.get("criado_em", agora) > 3600]
    for jid in expirados:
        JOBS.pop(jid, None)

def executar_extracao_agendamento(
    nif: str,
    nome_entidade: str,
    data_inicio: date,
    data_fim: date,
    tipo: str,
    reimportar_tudo: bool = False
) -> int:
    """Callback de extração invocado pelo motor de agendamento em background."""
    nif = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
    sub, pwd = pb_client.get_credentials(nif)
    sub = legado_bridge.normalizar_subutilizador_at(nif, sub or "")
    if not pwd:
        LOGGER.warning(f"[Scheduler] Sem credenciais configuradas para NIF {nif} ({nome_entidade})")
        return 0

    is_invalida, detalhe = pb_client.check_if_password_marked_invalid(nif, pwd)
    if is_invalida:
        LOGGER.warning(f"[Scheduler] NIF {nif} tem senha inválida registada: {detalhe}")
        return 0

    as_buyer = (tipo.lower() == "compras")
    tipo_str = "compras" if as_buyer else "vendas"
    p_yr = data_inicio.year
    p_mn = data_inicio.month

    # Otimização inteligente: se o mês já está completo na base de dados, salta imediatamente em 0s
    try:
        ctrl = pb_client.obter_controlo_ano(p_yr, tipo_str)
        emp_ctrl = ctrl.get(nif, {}).get(p_mn)
        if emp_ctrl and emp_ctrl.get("completo") == 1 and not reimportar_tudo:
            LOGGER.info(f"[Scheduler] NIF {nif} {p_mn:02d}/{p_yr} ({tipo_str}) já completo ({emp_ctrl.get('docs_gravados', 0)} docs). Ignorado.")
            return 0
    except Exception as ce:
        LOGGER.debug(f"[Scheduler] Verificação prévia de status do mês: {ce}")

    # Concorrência adaptativa com limite de workers
    CONCURRENCY_MANAGER.acquire(volume=500)
    try:
        month_lock = efatura_api.get_month_lock(nif, p_yr, p_mn, tipo_str)
        with month_lock:
            docs_existentes_fn = lambda a, m: efatura_api.contar_staging(nif, a, m, tipo_str)
            db_write_lock = threading.Lock()

            def on_page_fetched(page_invoices):
                if page_invoices:
                    try:
                        with db_write_lock:
                            p_h, p_v = efatura_api.invoices_to_rows(
                                nif, page_invoices, as_buyer=as_buyer, entity_name=nome_entidade or ""
                            )
                            if p_h and len(p_h) > 1:
                                efatura_api.append_staging(nif, p_yr, p_mn, tipo_str, p_h[1:])
                            if p_v:
                                if as_buyer:
                                    pb_client.upsert_faturas_direto(p_v)
                                else:
                                    pb_client.upsert_vendas_direto(p_v)
                    except Exception as pe:
                        LOGGER.error(f"[Scheduler] Erro no on_page_fetched: {pe}")

            def on_scout_done(scout_items):
                with db_write_lock:
                    pb_client.registar_scout_mensal(nif, tipo_str, scout_items)

            def on_period_done(period_start, period_end, period_invoices, p_expected, is_complete, docs_existentes=None):
                docs_na_bd = docs_existentes if docs_existentes is not None else docs_existentes_fn(period_start.year, period_start.month)
                mes_completo = bool(is_complete or (p_expected > 0 and docs_na_bd >= p_expected) or (p_expected == 0))
                with db_write_lock:
                    pb_client.atualizar_status_mes(
                        nif, period_start.year, period_start.month, tipo_str,
                        total_esperado=p_expected or docs_na_bd,
                        docs_gravados=docs_na_bd,
                        completo=mes_completo
                    )

            try:
                if _MODO_TESTE_SCRAPER.get("ativo"):
                    raise Fault("Ocorreu um erro na autenticacao dos contribuintes.")
                invs, _ = efatura_api.get_invoices(
                    nif,
                    sub,
                    pwd,
                    data_inicio,
                    data_fim,
                    as_buyer=as_buyer,
                    return_totals=True,
                    on_scout_done=on_scout_done,
                    on_period_done=on_period_done,
                    on_page_fetched=on_page_fetched,
                    docs_existentes_fn=docs_existentes_fn,
                    reimportar_tudo=reimportar_tudo,
                )
                total_obtido_sched = len(invs)
            except Exception as ws_sched_err:
                if _deve_acionar_failover_scraper(ws_sched_err) and pwd:
                    LOGGER.warning(
                        f"⚠️ [Scheduler FAILOVER SCRAPER] SOAP recusou NIF {nif} ({ws_sched_err}). A acionar Portal Web..."
                    )
                    _garantir_scraper_pronto(ano_ref=data_inicio.year)
                    h_sc, _, esp_sc = executar_scraping_completo(
                        nif=nif,
                        password=pwd,
                        data_inicio=str(data_inicio),
                        data_fim=str(data_fim),
                        as_buyer=as_buyer,
                        nome_entidade=nome_entidade or "",
                        subuser=sub,
                        salvar_sqlite=True,
                        reimportar_tudo=reimportar_tudo,
                    )
                    total_obtido_sched = max(0, len(h_sc) - 1)
                    with db_write_lock:
                        pb_client.atualizar_status_mes(
                            nif,
                            p_yr,
                            p_mn,
                            tipo_str,
                            total_esperado=esp_sc or total_obtido_sched,
                            docs_gravados=total_obtido_sched,
                            completo=True,
                        )
                else:
                    raise

            # Agendar tarefas complementares completas no pipeline de segundo plano (anuladas + nomes)
            try:
                pipeline_worker.adicionar_tarefas_pos_extracao(
                    nif=nif,
                    nome_entidade=nome_entidade or "",
                    modulo=tipo_str,
                    data_inicio=str(data_inicio),
                    data_fim=str(data_fim),
                    tem_particulares_sem_nome=(not as_buyer)
                )
            except Exception as e_sc_pipe:
                LOGGER.debug(f"[Scheduler] Aviso ao agendar tarefas de pipeline: {e_sc_pipe}")

            return total_obtido_sched
    except Exception as ex:
        LOGGER.error(f"[Scheduler] Erro ao extrair NIF {nif} no período {data_inicio} - {data_fim}: {ex}")
        raise
    finally:
        CONCURRENCY_MANAGER.release()

SCHEDULER_ENGINE.set_callback_iniciar_job(executar_extracao_agendamento)

def _run_extracao_worker(
    job_id,
    nif,
    subuser,
    password,
    nome_entidade,
    data_inicio,
    data_fim,
    as_buyer,
    reimportar_tudo,
    volume_estimado=None,
    gerar_xml_legado=False,
    pasta_raiz_dados=None,
    caminho_xml_personalizado=None,
    modo_saida="memoria",
    anos_retencao=3,
    obter_anuladas=False,
    forcar_scraper=False,
):

    def progress_callback(msg, docs_atuais=None, total_docs=None, mes=None, ano=None):
        if job_id in JOBS:
            JOBS[job_id]["fase"] = "faturas"
            JOBS[job_id]["mensagem"] = msg
            if mes is not None:
                JOBS[job_id]["mes_ativo"] = mes
            if ano is not None:
                JOBS[job_id]["ano_ativo"] = ano
            if docs_atuais is not None:
                JOBS[job_id]["docs_atuais"] = docs_atuais
            if total_docs is not None:
                JOBS[job_id]["total_esperado"] = total_docs
                if total_docs > 0 and docs_atuais is not None:
                    pct = min(100, round((docs_atuais / total_docs) * 100))
                    JOBS[job_id]["percentagem"] = pct
            print(f"[{job_id[:8]}] {msg}")

    def cancel_check():
        return JOBS.get(job_id, {}).get("cancelar", False)

    acquired_concurrency = False
    salvar_sqlite = False
    tipo_str = "compras" if as_buyer else "vendas"
    meses_status_atualizados = set()
    meses_tocados_sqlite = set()
    pipeline_worker.sinalizar_primeiro_plano(True, nif=nif)
    try:
        # Separação estrita de NIF de 9 dígitos e subutilizador
        nif_str = str(nif or "").strip()
        if "/" in nif_str:
            parts = nif_str.split("/", 1)
            nif = re.sub(r'[^0-9]', '', parts[0]).strip()[:9]
            if not subuser:
                subuser = nif_str
        else:
            nif = re.sub(r'[^0-9]', '', nif_str).strip()[:9]

        # Fallback para PB credentials
        if not password or not subuser:
            pb_sub, pb_pwd = pb_client.get_credentials(nif)
            if pb_pwd and not password:
                password = pb_pwd
            if pb_sub and not subuser:
                subuser = pb_sub

        subuser = legado_bridge.normalizar_subutilizador_at(nif, subuser or "")
                
        if not password:
            if job_id in JOBS:
                JOBS[job_id]["status"] = "erro"
                JOBS[job_id]["tipo_erro"] = "sem_senha"
                JOBS[job_id]["badge_label"] = "Sem Senha"
                JOBS[job_id]["mensagem"] = "Senha AT não encontrada no tCredenciais ou Base de Dados."
                JOBS[job_id]["erro"] = "Senha AT não encontrada no tCredenciais ou Base de Dados."
            return

        # Verificação inteligente de senhas inválidas: Se a senha atual já foi rejeitada pela AT, aborta sem gastar chamadas
        is_invalida, detalhe_erro = pb_client.check_if_password_marked_invalid(nif, password)
        if is_invalida:
            if job_id in JOBS:
                JOBS[job_id]["status"] = "erro"
                JOBS[job_id]["tipo_erro"] = "senha_invalida"
                JOBS[job_id]["badge_label"] = "Senha Rejeitada AT"
                JOBS[job_id]["mensagem"] = f"Autenticação Bloqueada ({detalhe_erro})"
                JOBS[job_id]["erro"] = f"Autenticação Bloqueada: Senha previamente rejeitada pela AT ({detalhe_erro}). Pode limpar o bloqueio na tabela para voltar a tentar à mão."
            LOGGER.info(f"NIF {nif}: Ignorado chamada à AT pois a senha atual já foi rejeitada.")
            return

        tipo_str = "compras" if as_buyer else "vendas"
        modo_saida_clean = (modo_saida or "sqlite").strip().lower()
        salvar_sqlite = modo_saida_clean not in ("apenas_memoria", "apenas_xml")
        gerar_xml = bool(gerar_xml_legado) or (modo_saida_clean in ("xml", "apenas_xml", "completo", "ambos"))
        apenas_sqlite_direto = (modo_saida_clean in ("sqlite", "apenas_sqlite")) and salvar_sqlite and not gerar_xml and not (obter_anuladas and as_buyer)
        incluir_dados_memoria = not apenas_sqlite_direto

        if volume_estimado is None:
            volume_estimado, _ = estimar_volume_nif(nif, tipo_str, data_inicio.year)

        if job_id in JOBS:
            JOBS[job_id]["volume_estimado"] = volume_estimado
            JOBS[job_id]["modo_saida"] = modo_saida_clean
            JOBS[job_id]["mensagem"] = "A iniciar processamento..."

        CONCURRENCY_MANAGER.acquire(volume=volume_estimado, cancel_fn=cancel_check)
        acquired_concurrency = True

        if cancel_check():
            if job_id in JOBS:
                JOBS[job_id]["status"] = "cancelado"
                JOBS[job_id]["mensagem"] = "Cancelado pelo utilizador."
            return

        tipo_str = "compras" if as_buyer else "vendas"
        simulacao_soap_ativa = bool(_MODO_TESTE_SCRAPER.get("ativo"))
        forcar_scraper_efetivo = bool(forcar_scraper)
        if forcar_scraper_efetivo or simulacao_soap_ativa:
            reimportar_tudo = True

        # Wipe & Fetch apenas quando explicitamente pedido pelo utilizador (reimportar_tudo)
        if reimportar_tudo:
            if job_id in JOBS:
                JOBS[job_id]["docs_atuais"] = 0
                JOBS[job_id]["mensagem"] = (
                    "[Portal Web] A preparar recolha direta no portal da AT..."
                    if (forcar_scraper_efetivo or simulacao_soap_ativa)
                    else "A limpar registos e caches anteriores (-r)..."
                )
            if as_buyer:
                pb_client.delete_faturas_periodo(nif, data_inicio, data_fim)
            else:
                pb_client.delete_vendas_periodo(nif, data_inicio, data_fim)
            for p_start, p_end in efatura_api.iter_month_periods(data_inicio, data_fim):
                efatura_api.limpar_staging(nif, p_start.year, p_start.month, tipo_str)
                efatura_api.limpar_xml_legado_periodo(nif, p_start.year, p_start.month, as_buyer=as_buyer)
                pb_client.limpar_status_mes(nif, p_start.year, p_start.month, tipo_str)

        # Rota de execução: Se ano < 2025 ou forçado pelo utilizador, roteamos diretamente para Web Scraping.
        precisa_scraper = (data_inicio.year < 2025) or (data_fim.year < 2025) or forcar_scraper_efetivo
        usou_web_scraping = bool(precisa_scraper)
        motivo_web_scraping = (
            "forcar_scraper" if forcar_scraper_efetivo else ("ano_anterior_2025" if precisa_scraper else "soap_direto")
        )

        # Disparo do Scraper de Anuladas (estritamente a pedido explícito)
        scraper_future = None
        executor_scraper = None
        if obter_anuladas and as_buyer and not precisa_scraper and iniciar_sessao_efatura is not None and password:
            try:
                executor_scraper = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"ScraperAnuladasJob_{job_id[:6]}")
                scraper_future = executor_scraper.submit(
                    workspace_context.wrap_thread_target(executar_scraping_anuladas_paralelo),
                    nif=nif,
                    password=password,
                    data_inicio=str(data_inicio),
                    data_fim=str(data_fim),
                    as_buyer=as_buyer,
                    nome_entidade=nome_entidade or "",
                    subuser=subuser,
                    job_id=job_id,
                )
            except Exception as e_scr_start:
                LOGGER.warning(f"Aviso ao iniciar thread de scraping de anuladas no job {job_id[:8]}: {e_scr_start}")
                scraper_future = None
                executor_scraper = None

        docs_existentes_fn = lambda a, m: (
            max(
                pb_client.contar_docs_na_bd(nif, a, m, tipo_str) if salvar_sqlite else 0,
                efatura_api.contar_staging(nif, a, m, tipo_str)
            )
        )
        docs_intervalo_fn = lambda d_i, d_f: (
            pb_client.contar_docs_intervalo_na_bd(nif, d_i, d_f, tipo_str) if salvar_sqlite else 0
        )

        # Deteção prévia de documentos já presentes na BD/Staging para retoma imediata
        if not reimportar_tudo:
            try:
                docs_ja_gravados = 0
                for p_start, p_end in efatura_api.iter_month_periods(data_inicio, data_fim):
                    docs_ja_gravados += docs_existentes_fn(p_start.year, p_start.month)
                if docs_ja_gravados > 0 and job_id in JOBS:
                    JOBS[job_id]["docs_atuais"] = docs_ja_gravados
                    JOBS[job_id]["mensagem"] = f"A verificar e retomar ({docs_ja_gravados:,} docs já na BD)...".replace(",", ".")
            except Exception as pe:
                LOGGER.warning(f"Erro ao pré-contar docs na BD para retoma: {pe}")
        else:
            if job_id in JOBS:
                JOBS[job_id]["docs_atuais"] = 0
                JOBS[job_id]["mensagem"] = "A reimportar faturas da AT..."

        db_write_lock = threading.Lock()
        fetched_v_rows = []
        paginas_gravadas_no_callback = False
        total_linhas_gravadas_callback = 0

        def on_scout_done(scout_items):
            if salvar_sqlite:
                with db_write_lock:
                    pb_client.registar_scout_mensal(nif, tipo_str, scout_items)

        def on_page_fetched(page_invoices):
            nonlocal paginas_gravadas_no_callback, total_linhas_gravadas_callback
            # Gravação contínua e instantânea página a página no Staging e SQLite (~25ms)
            if page_invoices:
                try:
                    with db_write_lock:
                        p_h, p_vert = efatura_api.invoices_to_rows(
                            nif, page_invoices, as_buyer=as_buyer, entity_name=nome_entidade
                        )
                        meses_pagina = set()
                        for r_v in p_vert:
                            dt_v = str(r_v.get("Data") or "")[:10]
                            if len(dt_v) >= 7 and dt_v[:4].isdigit() and dt_v[5:7].isdigit():
                                meses_pagina.add((int(dt_v[:4]), int(dt_v[5:7])))
                        if not meses_pagina and page_invoices:
                            inv_sample = page_invoices[0]
                            inv_date = getattr(inv_sample, "InvoiceDate", None)
                            p_yr_fb = efatura_api._normalise_date(inv_date).year if inv_date else data_inicio.year
                            p_mn_fb = efatura_api._normalise_date(inv_date).month if inv_date else data_inicio.month
                            meses_pagina.add((p_yr_fb, p_mn_fb))
                        # 1. Staging persistente local (apenas se precisar de gerar XML / resposta em memória)
                        if not apenas_sqlite_direto and p_h and len(p_h) > 1:
                            inv_sample = page_invoices[0]
                            inv_date = getattr(inv_sample, "InvoiceDate", None)
                            p_yr = efatura_api._normalise_date(inv_date).year if inv_date else data_inicio.year
                            p_mn = efatura_api._normalise_date(inv_date).month if inv_date else data_inicio.month
                            efatura_api.append_staging(nif, p_yr, p_mn, tipo_str, p_h[1:])
                        # 2. SQLite (se modo_saida permitir) e atualização intermédia de controlo_geral.db
                        if p_vert:
                            if not apenas_sqlite_direto:
                                fetched_v_rows.extend(p_vert)
                            if salvar_sqlite:
                                if as_buyer:
                                    pb_client.upsert_faturas_direto(p_vert)
                                else:
                                    pb_client.upsert_vendas_direto(p_vert)
                                paginas_gravadas_no_callback = True
                                total_linhas_gravadas_callback += len(p_vert)
                                for p_yr_m, p_mn_m in meses_pagina:
                                    meses_tocados_sqlite.add((p_yr_m, p_mn_m))
                                    pb_client.atualizar_status_mes(nif, p_yr_m, p_mn_m, tipo_str, completo=False)
                except Exception as pe:
                    LOGGER.error(f"Erro ao gravar página no SQLite/Staging: {pe}")

        def on_period_done(period_start, period_end, period_invoices, p_expected, is_complete, docs_existentes=None):
            # 1. Gravar faturas deste período imediatamente no SQLite se on_page_fetched não tiver gravado
            if period_invoices and salvar_sqlite and not on_page_fetched:
                with db_write_lock:
                    _, p_vertical = efatura_api.invoices_to_rows(
                        nif, period_invoices, as_buyer=as_buyer, entity_name=nome_entidade, total_esperado=p_expected
                    )
                    if p_vertical:
                        if as_buyer:
                            pb_client.upsert_faturas_direto(p_vertical)
                        else:
                            pb_client.upsert_vendas_direto(p_vertical)

            # 2. Contar documentos reais existentes na BD
            docs_na_bd = docs_existentes if docs_existentes is not None else (
                pb_client.contar_docs_na_bd(nif, period_start.year, period_start.month, tipo_str) if salvar_sqlite else docs_existentes_fn(period_start.year, period_start.month)
            )
            
            # O mês é completo se docs_na_bd >= p_expected ou se marcado como completo
            mes_completo = bool(is_complete or (p_expected > 0 and docs_na_bd >= p_expected) or (p_expected == 0))

            # 3. Registar status do mês na tabela persistente de controlo
            if salvar_sqlite:
                with db_write_lock:
                    pb_client.atualizar_status_mes(
                        nif, period_start.year, period_start.month, tipo_str, 
                        total_esperado=p_expected or docs_na_bd, 
                        docs_gravados=docs_na_bd, 
                        completo=mes_completo
                    )
                    meses_status_atualizados.add((period_start.year, period_start.month))

        horizontal_rows = []
        vertical_rows = []
        invoices = []
        total_esperado = 0
        veio_de_sqlite_reconstruido = False

        if precisa_scraper:
            # 1. Se não for reimportação forçada, verificar se os meses solicitados já estão completos na BD
            meses_pedidos = list(efatura_api.iter_month_periods(data_inicio, data_fim))
            meses_a_extrair = []
            if not reimportar_tudo and salvar_sqlite and meses_pedidos:
                for p_start, p_end in meses_pedidos:
                    st_m = pb_client.obter_status_mes(nif, p_start.year, p_start.month, tipo_str)
                    docs_bd = pb_client.contar_docs_na_bd(nif, p_start.year, p_start.month, tipo_str)
                    is_comp = (st_m.get("completo") == 1 and docs_bd > 0) or (st_m.get("total_esperado", 0) > 0 and docs_bd >= st_m.get("total_esperado", 0))
                    if not is_comp:
                        meses_a_extrair.append((p_start, p_end))
            else:
                meses_a_extrair = list(meses_pedidos)

            if not meses_a_extrair and not reimportar_tudo and meses_pedidos:
                horizontal_rows, vertical_rows, docs_totais_bd = reconstruir_horizontal_vertical_de_sqlite(
                    nif=nif,
                    data_inicio=str(data_inicio),
                    data_fim=str(data_fim),
                    as_buyer=as_buyer,
                    nome_entidade=nome_entidade or "",
                )
                veio_de_sqlite_reconstruido = True
                if not docs_totais_bd:
                    docs_totais_bd = sum(pb_client.contar_docs_na_bd(nif, p_s.year, p_s.month, tipo_str) for p_s, p_e in meses_pedidos)
                LOGGER.info(f"⚡ [SCRAPER SKIP] Todos os {len(meses_pedidos)} meses ({data_inicio} a {data_fim}) já estão 100% completos na BD ({docs_totais_bd} docs) para NIF {nif}. A devolver dados da BD.")
                if job_id in JOBS:
                    JOBS[job_id]["docs_atuais"] = docs_totais_bd
                    JOBS[job_id]["total_esperado"] = docs_totais_bd
                    JOBS[job_id]["total_documentos"] = docs_totais_bd
                    JOBS[job_id]["percentagem"] = 100
                    JOBS[job_id]["mensagem"] = f"Mês(es) já completo(s) ({docs_totais_bd} docs na BD)."
                total_esperado = docs_totais_bd
            else:
                scrap_ini = meses_a_extrair[0][0] if meses_a_extrair else data_inicio
                scrap_fim = meses_a_extrair[-1][1] if meses_a_extrair else data_fim
                _garantir_scraper_pronto(
                    progress_cb=lambda msg: progress_callback(msg, 0, 0),
                    ano_ref=data_inicio.year,
                )
                # Compasso de espera (curto se for pedido direto, jitter normal em lote) para evitar rajada de logins concorrentes contra a AT
                time.sleep(0.2 if (forcar_scraper_efetivo or simulacao_soap_ativa) else random.uniform(1.2, 2.5))
                LOGGER.info(f"🌐 [ROTA SCRAPER] A extrair intervalo {scrap_ini} a {scrap_fim} ({len(meses_a_extrair)} meses a processar)...")
                with concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"ScraperWorker_{job_id[:6]}") as pool_scraper:
                    scraper_future_run = pool_scraper.submit(
                        workspace_context.wrap_thread_target(executar_scraping_completo),
                        nif=nif,
                        password=password,
                        data_inicio=str(scrap_ini),
                        data_fim=str(scrap_fim),
                        as_buyer=as_buyer,
                        nome_entidade=nome_entidade or "",
                        subuser=subuser,
                        salvar_sqlite=salvar_sqlite,
                        progress_callback=progress_callback,
                        cancel_check=cancel_check,
                        reimportar_tudo=reimportar_tudo,
                    )
                    try:
                        horizontal_rows, vertical_rows, total_esperado = scraper_future_run.result(timeout=1800)
                    except concurrent.futures.TimeoutError:
                        raise RuntimeError("Tempo limite de extração excedido (1800s). Tarefa abortada para libertar a fila.")

                # Se houve meses saltados por já estarem completos, reunir o período completo a partir da BD SQLite
                if salvar_sqlite and not cancel_check() and (scrap_ini != data_inicio or scrap_fim != data_fim):
                    h_full, v_full, docs_full = reconstruir_horizontal_vertical_de_sqlite(
                        nif=nif,
                        data_inicio=str(data_inicio),
                        data_fim=str(data_fim),
                        as_buyer=as_buyer,
                        nome_entidade=nome_entidade or "",
                    )
                    if h_full and docs_full >= max(0, len(horizontal_rows) - 1):
                        horizontal_rows = h_full
                        total_esperado = docs_full
        else:
            try:
                if simulacao_soap_ativa:
                    LOGGER.warning(
                        f"🧪 [MODO TESTE SCRAPER] A simular recusa SOAP da AT para NIF {nif} ({data_inicio} a {data_fim})..."
                    )
                    raise Fault("Ocorreu um erro na autenticacao dos contribuintes.")
                invoices, total_esperado = efatura_api.get_invoices(
                    nif,
                    subuser,
                    password,
                    data_inicio,
                    data_fim,
                    as_buyer=as_buyer,
                    progress_callback=progress_callback,
                    return_totals=True,
                    cancel_check=cancel_check,
                    on_scout_done=on_scout_done,
                    on_period_done=on_period_done,
                    on_page_fetched=on_page_fetched,
                    docs_existentes_fn=docs_existentes_fn,
                    reimportar_tudo=reimportar_tudo,
                    docs_intervalo_fn=docs_intervalo_fn,
                )
            except (efatura_api.ATAPIError, Fault, Exception) as ws_err:
                if _deve_acionar_failover_scraper(ws_err) and password:
                    LOGGER.warning(
                        f"⚠️ [FAILOVER SCRAPER] AT Webservices recusou/falhou ({ws_err}). "
                        f"A acionar contingência pelo Portal Web para NIF {nif}..."
                    )
                    _garantir_scraper_pronto(
                        progress_cb=lambda msg: progress_callback(msg, 0, 0),
                        ano_ref=data_inicio.year,
                    )
                    usou_web_scraping = True
                    motivo_web_scraping = f"contingencia_soap: {ws_err}"
                    progress_callback("[Portal Web] Contingência ativa: a iniciar recolha direta no portal da AT...", 0, 0)
                    time.sleep(0.2 if simulacao_soap_ativa else random.uniform(1.0, 2.2))
                    with concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"ScraperFailover_{job_id[:6]}") as pool_failover:
                        failover_future = pool_failover.submit(
                            workspace_context.wrap_thread_target(executar_scraping_completo),
                            nif=nif,
                            password=password,
                            data_inicio=str(data_inicio),
                            data_fim=str(data_fim),
                            as_buyer=as_buyer,
                            nome_entidade=nome_entidade or "",
                            subuser=subuser,
                            salvar_sqlite=salvar_sqlite,
                            progress_callback=progress_callback,
                            cancel_check=cancel_check,
                            reimportar_tudo=reimportar_tudo,
                        )
                        try:
                            horizontal_rows, vertical_rows, total_esperado = failover_future.result(timeout=1800)
                        except concurrent.futures.TimeoutError:
                            raise RuntimeError("Tempo limite de extração excedido (1800s) no failover do scraper.")
                else:
                    raise

        foi_interrompido = cancel_check()

        if not precisa_scraper and not horizontal_rows and not (apenas_sqlite_direto and not usou_web_scraping and paginas_gravadas_no_callback):
            if apenas_sqlite_direto and not usou_web_scraping and salvar_sqlite:
                # Todos os meses já completos no SQLite (nenhuma página nova descarregada): evita reconstrução pesada em RAM
                veio_de_sqlite_reconstruido = True
            else:
                staging_rows = []
                for p_start, p_end in efatura_api.iter_month_periods(data_inicio, data_fim):
                    m_rows = efatura_api.carregar_staging(nif, p_start.year, p_start.month, tipo_str)
                    staging_rows.extend(m_rows)

                if reimportar_tudo and invoices:
                    if staging_rows and len(staging_rows) >= len(invoices) and fetched_v_rows:
                        horizontal_rows = efatura_api.reconstruir_horizontal_com_totais(staging_rows, total_esperado=total_esperado)
                        vertical_rows = fetched_v_rows
                    else:
                        horizontal_rows, vertical_rows = efatura_api.invoices_to_rows(
                            nif, invoices, as_buyer=as_buyer, entity_name=nome_entidade, total_esperado=total_esperado
                        )
                else:
                    # Se não é reimportação forçada e já havia dados prévios em SQLite (sub-intervalos/meses saltados),
                    # reúne tudo diretamente do SQLite onde on_page_fetched já gravou as páginas em falta
                    if salvar_sqlite and not reimportar_tudo and total_esperado > 0 and len(staging_rows) < total_esperado:
                        h_reconst, v_reconst, docs_bd_reconst = reconstruir_horizontal_vertical_de_sqlite(
                            nif=nif,
                            data_inicio=str(data_inicio),
                            data_fim=str(data_fim),
                            as_buyer=as_buyer,
                            nome_entidade=nome_entidade or "",
                        )
                        if h_reconst and docs_bd_reconst >= len(staging_rows):
                            horizontal_rows = h_reconst
                            vertical_rows = v_reconst
                            veio_de_sqlite_reconstruido = True
                            if docs_bd_reconst > 0 and not total_esperado:
                                total_esperado = docs_bd_reconst

                    if not horizontal_rows:
                        if staging_rows and (not invoices or len(staging_rows) >= len(invoices)):
                            horizontal_rows = efatura_api.reconstruir_horizontal_com_totais(staging_rows, total_esperado=total_esperado)
                            if fetched_v_rows and (not invoices or len(staging_rows) == len(invoices)):
                                vertical_rows = fetched_v_rows
                            elif invoices:
                                _, vertical_rows = efatura_api.invoices_to_rows(
                                    nif, invoices, as_buyer=as_buyer, entity_name=nome_entidade, total_esperado=total_esperado
                                )
                            else:
                                vertical_rows = []
                        elif invoices:
                            horizontal_rows, vertical_rows = efatura_api.invoices_to_rows(
                                nif, invoices, as_buyer=as_buyer, entity_name=nome_entidade, total_esperado=total_esperado
                            )
                        elif salvar_sqlite and not reimportar_tudo:
                            horizontal_rows, vertical_rows, docs_bd_reconst = reconstruir_horizontal_vertical_de_sqlite(
                                nif=nif,
                                data_inicio=str(data_inicio),
                                data_fim=str(data_fim),
                                as_buyer=as_buyer,
                                nome_entidade=nome_entidade or "",
                            )
                            veio_de_sqlite_reconstruido = True
                            if docs_bd_reconst > 0 and not total_esperado:
                                total_esperado = docs_bd_reconst
                        else:
                            horizontal_rows, vertical_rows = efatura_api.invoices_to_rows(
                                nif, invoices, as_buyer=as_buyer, entity_name=nome_entidade, total_esperado=total_esperado
                            )

        # Aguardar e fundir faturas anuladas recolhidas pelo Scraper a pedido (Job - apenas compras)
        if obter_anuladas and as_buyer and not precisa_scraper and scraper_future is not None:
            try:
                if job_id in JOBS:
                    JOBS[job_id]["fase"] = "anuladas"
                    JOBS[job_id]["mensagem"] = "A verificar faturas canceladas no portal da AT..."
                    JOBS[job_id]["percentagem"] = 0
                LOGGER.info("A aguardar conclusão do scraper de faturas anuladas em segundo plano (Job)...")
                anuladas_h_rows, anuladas_v_rows = scraper_future.result(timeout=40)
                if anuladas_h_rows or anuladas_v_rows:
                    if job_id in JOBS:
                        JOBS[job_id]["fase"] = "anuladas"
                        JOBS[job_id]["mensagem"] = f"A integrar faturas canceladas ({len(anuladas_h_rows)} canceladas detetadas)..."
                        JOBS[job_id]["percentagem"] = 100
                    horizontal_rows, vertical_rows = fundir_faturas_anuladas(
                        horizontal_rows=horizontal_rows,
                        vertical_rows=vertical_rows,
                        anuladas_h_rows=anuladas_h_rows,
                        anuladas_v_rows=anuladas_v_rows,
                        nif=nif,
                        tipo_str=tipo_str,
                        salvar_sqlite=salvar_sqlite,
                        as_buyer=as_buyer
                    )
                    veio_de_sqlite_reconstruido = False
                else:
                    if job_id in JOBS:
                        JOBS[job_id]["fase"] = "anuladas"
                        JOBS[job_id]["mensagem"] = "Sem faturas canceladas detetadas."
                        JOBS[job_id]["percentagem"] = 100
            except concurrent.futures.TimeoutError:
                LOGGER.warning("Aviso no Job: Tempo limite (40s) no scraper de anuladas; a avançar com as faturas recolhidas.")
                if job_id in JOBS:
                    JOBS[job_id]["mensagem"] = "Verificação de canceladas concluída por timeout."
            except Exception as se:
                LOGGER.warning(f"Aviso no Job: Falha ao obter faturas anuladas via scraper: {se}")
            finally:
                if executor_scraper:
                    executor_scraper.shutdown(wait=False)
                scraper_future = None
                executor_scraper = None

        # Resolução cirúrgica de nomes de clientes em vendas
        if not as_buyer:
            horizontal_rows, vertical_rows = resolver_e_completar_nomes_vendas(
                nif_titular=nif,
                password=password,
                subuser=subuser,
                horizontal_rows=horizontal_rows,
                vertical_rows=vertical_rows,
                salvar_sqlite=salvar_sqlite,
                data_inicio=data_inicio,
                data_fim=data_fim,
                job_id=job_id
            )

        # 100% das faturas são auditadas e registadas no Cofre Permanente de Estados (Ledger Forense)
        if not (paginas_gravadas_no_callback and salvar_sqlite):
            try:
                cofre = cofre_ledger.CofreEstadosLedger()
                linhas_para_cofre = vertical_rows if vertical_rows else horizontal_rows[1:]
                inconfs_detetadas = cofre.registar_e_confrontar(linhas_para_cofre, nif_titular=nif)
                if inconfs_detetadas:
                    LOGGER.warning(
                        f"🚨 [COFRE LEDGER] {len(inconfs_detetadas)} fatura(s) com anulação tardia "
                        f"detetadas para NIF {nif} no job {job_id[:8]}!"
                    )
            except Exception as cle:
                LOGGER.error(f"Erro ao registar no Cofre Ledger no job {job_id[:8]}: {cle}")

        # Persistência das faturas na base de dados SQLite particionada do cliente
        if job_id in JOBS:
            JOBS[job_id]["fase"] = "gravacao"
            JOBS[job_id]["mensagem"] = "A gravar registos e a organizar totais..."
            JOBS[job_id]["percentagem"] = 98

        linhas_gravadas = total_linhas_gravadas_callback if (paginas_gravadas_no_callback and salvar_sqlite) else len(vertical_rows)
        if vertical_rows and salvar_sqlite and not veio_de_sqlite_reconstruido and not paginas_gravadas_no_callback:
            try:
                if as_buyer:
                    linhas_gravadas = pb_client.upsert_faturas_direto(vertical_rows)
                else:
                    linhas_gravadas = pb_client.upsert_vendas_direto(vertical_rows)
                LOGGER.info(f"💾 [SQLITE] {linhas_gravadas} linhas gravadas para NIF {nif} no job {job_id[:8]}.")
            except Exception as dbe:
                LOGGER.warning(f"Aviso ao persistir no SQLite local (ignorado em cliente): {dbe}")

        # Atualização da tabela de controlo mensal apenas para meses não atualizados por on_period_done
        if salvar_sqlite:
            is_single_month = (data_inicio.year == data_fim.year and data_inicio.month == data_fim.month)
            for p_start, p_end in efatura_api.iter_month_periods(data_inicio, data_fim):
                if (p_start.year, p_start.month) in meses_status_atualizados:
                    continue
                try:
                    pb_client.atualizar_status_mes(
                        nif, p_start.year, p_start.month, tipo_str,
                        total_esperado=total_esperado if is_single_month else None,
                        docs_gravados=None,
                        completo=(not foi_interrompido)
                    )
                    meses_status_atualizados.add((p_start.year, p_start.month))
                except Exception as ame:
                    LOGGER.warning(f"Aviso ao atualizar controlo mensal no job {job_id[:8]}: {ame}")

        # Aplicar política de retenção se configurado e gravado no SQLite
        if salvar_sqlite and anos_retencao and anos_retencao > 0:
            try:
                pb_client.aplicar_retencao_anos(nif, tipo_str, anos_retencao)
            except Exception as err_ret:
                LOGGER.warning(f"Aviso ao aplicar retenção para {nif}: {err_ret}")

        # Gerar XML legado se solicitado
        ficheiros_xml = []
        xml_conteudo = ""
        if gerar_xml:
            try:
                ficheiros_xml, xml_conteudo = efatura_api.exportar_lote_xml_legado_de_horizontal(
                    nif,
                    horizontal_rows[1:],
                    as_buyer=as_buyer,
                    pasta_raiz=pasta_raiz_dados,
                    caminho_personalizado=caminho_xml_personalizado,
                    data_inicio=data_inicio,
                    data_fim=data_fim,
                    total_esperado=total_esperado,
                )
            except Exception as xe:
                LOGGER.error(f"Erro ao gerar XML legado no job {job_id[:8]}: {xe}")

        # Contagem real de documentos descarregados em memória/staging ou persistidos na BD
        total_docs_reais = max(0, len(horizontal_rows) - 1)
        if salvar_sqlite and total_docs_reais == 0:
            total_docs_reais = pb_client.contar_docs_intervalo_na_bd(nif, str(data_inicio), str(data_fim), tipo_str)
        if horizontal_rows and len(horizontal_rows) > 1 and not foi_interrompido:
            total_esperado_final = total_docs_reais
            horizontal_rows[0]["Atividade de Realização da Aquisição"] = total_docs_reais
            horizontal_rows[0]["NIF ComercianteConsumidor"] = total_docs_reais
        elif apenas_sqlite_direto and salvar_sqlite and not foi_interrompido and total_docs_reais > 0:
            total_esperado_final = total_docs_reais
        else:
            total_esperado_final = max(total_esperado or 0, total_docs_reais)

        if foi_interrompido:
            if job_id in JOBS:
                JOBS[job_id]["status"] = "interrompido"
                JOBS[job_id]["parcial"] = True
                JOBS[job_id]["mensagem"] = f"Interrompido ({total_docs_reais} de {total_esperado_final} docs)"
                JOBS[job_id]["docs_atuais"] = total_docs_reais
                JOBS[job_id]["total_esperado"] = total_esperado_final
                JOBS[job_id]["percentagem"] = round((total_docs_reais / total_esperado_final * 100)) if total_esperado_final > 0 else 0
                JOBS[job_id]["total_documentos"] = total_docs_reais
                JOBS[job_id]["total_documentos_esperados"] = total_esperado_final
                if gerar_xml:
                    JOBS[job_id]["ficheiros_xml_gerados"] = ficheiros_xml
                    JOBS[job_id]["conteudo_xml"] = xml_conteudo
            LOGGER.info(f"Job {job_id[:8]} interrompido pelo utilizador com {total_docs_reais} faturas.")
            return

        # Validação estrita de consistência AT sobre os dados reais descarregados
        if total_esperado_final > 0 and total_docs_reais < total_esperado_final and (total_esperado_final - total_docs_reais) > 5:
            if job_id in JOBS:
                JOBS[job_id]["status"] = "erro"
                JOBS[job_id]["mensagem"] = f"Inconsistência AT: Esperados {total_esperado_final} docs, mas foram obtidos {total_docs_reais} docs."
                JOBS[job_id]["erro"] = f"Inconsistência AT: Esperados {total_esperado_final} docs, mas foram obtidos {total_docs_reais} docs."
            return

        # Autenticação teve sucesso: limpar qualquer registo anterior de senha inválida
        pb_client.clear_invalid_password_if_success(nif)

        metodo_job = "web_scraping" if (usou_web_scraping and not veio_de_sqlite_reconstruido) else ("cache_sqlite" if veio_de_sqlite_reconstruido else "soap_api")
        _registar_auditoria_extracao(
            nif,
            f"{data_inicio}..{data_fim}",
            tipo_str,
            metodo_job,
            total_docs_reais,
            motivo_web_scraping,
        )

        if job_id in JOBS:
            JOBS[job_id]["status"] = "concluido"
            JOBS[job_id]["fase"] = "concluido"
            JOBS[job_id]["parcial"] = False
            JOBS[job_id]["metodo"] = metodo_job
            sufixo_canal = " (Portal Web)" if (usou_web_scraping and not veio_de_sqlite_reconstruido) else ""
            JOBS[job_id]["mensagem"] = f"Concluído{sufixo_canal}: {total_docs_reais:,} faturas de {tipo_str} importadas com sucesso.".replace(",", ".")
            JOBS[job_id]["docs_atuais"] = total_docs_reais
            JOBS[job_id]["total_documentos_esperados"] = total_esperado_final
            JOBS[job_id]["total_esperado"] = total_esperado_final
            JOBS[job_id]["total_documentos"] = total_docs_reais
            JOBS[job_id]["percentagem"] = 100
            JOBS[job_id]["total_linhas_vertical"] = total_linhas_gravadas_callback if (apenas_sqlite_direto and total_linhas_gravadas_callback > 0) else len(vertical_rows)
            JOBS[job_id]["dados_legacy_horizontal"] = [] if apenas_sqlite_direto else horizontal_rows
            JOBS[job_id]["dados_novos_vertical"] = [] if apenas_sqlite_direto else vertical_rows
            if ficheiros_xml:
                JOBS[job_id]["ficheiros_xml_gerados"] = ficheiros_xml
                JOBS[job_id]["conteudo_xml"] = xml_conteudo

            # Limpeza do staging temporário após conclusão com sucesso
            try:
                for p_start, p_end in efatura_api.iter_month_periods(data_inicio, data_fim):
                    efatura_api.limpar_staging(nif, p_start.year, p_start.month, tipo_str)
            except Exception as e_clean:
                LOGGER.warning(f"Aviso ao limpar staging pós-conclusão no job {job_id[:8]}: {e_clean}")

            # Agendamento automático no Pipeline de Segundo Plano (Anuladas + Nomes de Vendas)
            try:
                tem_particulares = False
                if not as_buyer:
                    if vertical_rows:
                        for vr in vertical_rows:
                            cp_nif = str(vr.get("Contraparte NIF") or "").strip()
                            cp_nome = str(vr.get("Contraparte") or "").strip()
                            if cp_nif and cp_nif not in ("999999990", "999999999", "99999999") and (not cp_nome or cp_nome == "[Sem Nome Registado]"):
                                tem_particulares = True
                                break
                    elif salvar_sqlite:
                        tem_particulares = bool(pb_client.obter_nifs_vendas_sem_nome(nif))
                pipeline_worker.adicionar_tarefas_pos_extracao(
                    nif=nif,
                    nome_entidade=nome_entidade or "",
                    modulo=tipo_str,
                    data_inicio=str(data_inicio),
                    data_fim=str(data_fim),
                    tem_particulares_sem_nome=tem_particulares
                )
            except Exception as e_pipe:
                LOGGER.warning(f"Aviso no job {job_id[:8]} ao agendar tarefas de segundo plano: {e_pipe}")


    except efatura_api.LimiteVolumeExcedidoError as vol_err:
        msg_vol = str(vol_err)
        LOGGER.warning(f"Job {job_id[:8]} rejeitado por limite de volume: {msg_vol}")
        if job_id in JOBS:
            JOBS[job_id]["status"] = "erro"
            JOBS[job_id]["tipo_erro"] = "volume_excedido"
            JOBS[job_id]["badge_label"] = "Volume Elevado"
            JOBS[job_id]["mensagem"] = msg_vol
            JOBS[job_id]["erro"] = msg_vol
            JOBS[job_id]["percentagem"] = 0
    except Fault as f:
        LOGGER.warning("Job %s rejeitado pela AT com Fault: %s", job_id[:8], getattr(f, 'message', str(f)))
        info_erro = classificar_erro_at(getattr(f, 'message', str(f)))
        if info_erro["memorizar_invalida"] and not pb_client.is_erro_falso_positivo_at(info_erro["detalhe"]):
            pb_client.record_invalid_password(nif, password, info_erro["detalhe"])
            LOGGER.warning("NIF %s: Credenciais formalmente rejeitadas pela AT. Senha memorizada como inválida.", nif)
        else:
            LOGGER.info("NIF %s: Falha classificada como '%s' (%s). Senha NÃO memorizada como inválida.", nif, info_erro["tipo_erro"], info_erro["badge_label"])
            
        if job_id in JOBS:
            JOBS[job_id]["status"] = "erro"
            JOBS[job_id]["tipo_erro"] = info_erro["tipo_erro"]
            JOBS[job_id]["badge_label"] = info_erro["badge_label"]
            JOBS[job_id]["mensagem"] = info_erro["mensagem_amigavel"]
            JOBS[job_id]["erro"] = info_erro["detalhe"]
    except efatura_api.ATAPIError as at_err:
        LOGGER.warning("Job %s devolveu erro AT código=%s: %s", job_id[:8], at_err.code, at_err.description)
        info_erro = classificar_erro_at(at_err.description or at_err)
        if info_erro["memorizar_invalida"] and not pb_client.is_erro_falso_positivo_at(info_erro["detalhe"]):
            pb_client.record_invalid_password(nif, password, info_erro["detalhe"])
            LOGGER.warning("NIF %s: Credenciais formalmente rejeitadas pela AT. Senha memorizada como inválida.", nif)
        else:
            LOGGER.info("NIF %s: Falha classificada como '%s' (%s). Senha NÃO memorizada como inválida.", nif, info_erro["tipo_erro"], info_erro["badge_label"])
            
        if job_id in JOBS:
            JOBS[job_id]["status"] = "erro"
            JOBS[job_id]["tipo_erro"] = info_erro["tipo_erro"]
            JOBS[job_id]["badge_label"] = info_erro["badge_label"]
            JOBS[job_id]["mensagem"] = info_erro["mensagem_amigavel"]
            JOBS[job_id]["erro"] = info_erro["detalhe"]
    except Exception as exc:
        LOGGER.exception("Job %s terminou com erro interno do tipo %s", job_id[:8], type(exc).__name__)
        info_erro = classificar_erro_at(exc)
        if info_erro["memorizar_invalida"] and not pb_client.is_erro_falso_positivo_at(info_erro["detalhe"]):
            pb_client.record_invalid_password(nif, password, info_erro["detalhe"])
        if job_id in JOBS:
            JOBS[job_id]["status"] = "erro"
            JOBS[job_id]["tipo_erro"] = info_erro["tipo_erro"]
            JOBS[job_id]["badge_label"] = info_erro["badge_label"]
            JOBS[job_id]["mensagem"] = info_erro["mensagem_amigavel"] if info_erro["tipo_erro"] != "outro" else str(exc)
            JOBS[job_id]["erro"] = str(exc)
    finally:
        if salvar_sqlite and meses_tocados_sqlite:
            for (yr_t, mn_t) in sorted(meses_tocados_sqlite - meses_status_atualizados):
                try:
                    pb_client.atualizar_status_mes(nif, yr_t, mn_t, tipo_str, completo=False)
                except Exception as _e_fin:
                    LOGGER.warning(f"Aviso ao sincronizar estado final do mês {mn_t}/{yr_t} ({nif}): {_e_fin}")
        pipeline_worker.sinalizar_primeiro_plano(False)
        if 'executor_scraper' in locals() and executor_scraper:
            executor_scraper.shutdown(wait=False)
        if acquired_concurrency:
            CONCURRENCY_MANAGER.release()
        # Higienização de senha
        password = None

@app.post("/api/extracao/iniciar")
def iniciar_extracao_async(req: ExtracaoRequest, lic = Depends(verificar_licenca_ativa)):
    """Inicia uma tarefa de extração assíncrona devolvendo imediatamente um job_id."""
    _limpar_jobs_antigos()
    print(f"\n>>> PEDIDO EXTRACAO ASYNC: NIF={req.nif}, De={req.data_inicio} Ate={req.data_fim}, Tipo={req.tipo}")
    as_buyer = req.tipo.lower() == "compras"

    vol_est = req.volume_estimado
    if vol_est is None:
        tipo_str_est = "compras" if as_buyer else "vendas"
        vol_est, _ = estimar_volume_nif(req.nif, tipo_str_est, req.data_inicio.year)

    job_id = str(uuid.uuid4())
    JOBS[job_id] = {
        "status": "em_progresso",
        "nif": req.nif,
        "nome_empresa": req.nome_entidade or "",
        "mensagem": "A iniciar processamento...",
        "volume_estimado": vol_est,
        "docs_atuais": 0,
        "total_esperado": 0,
        "percentagem": 0,
        "parcial": False,
        "cancelar": False,
        "total_documentos": 0,
        "dados_legacy_horizontal": None,
        "dados_novos_vertical": None,
        "erro": None,
        "tipo_erro": None,
        "badge_label": None,
        "criado_em": time.time(),
    }

    thread = threading.Thread(
        target=workspace_context.wrap_thread_target(_run_extracao_worker),
        args=(
            job_id,
            req.nif,
            req.subutilizador,
            req.password,
            req.nome_entidade or "",
            req.data_inicio,
            req.data_fim,
            as_buyer,
            req.reimportar_tudo,
            vol_est,
            req.gerar_xml_legado,
            req.pasta_raiz_dados,
            req.caminho_xml_personalizado,
            req.modo_saida,
            req.anos_retencao,
            req.obter_anuladas,
            req.forcar_scraper,
        ),
        daemon=True,
    )
    thread.start()

    return {
        "status": "iniciado",
        "assinatura": "API Importador e-Fatura Gexcel",
        "job_id": job_id,
        "volume_estimado": vol_est,
        "mensagem": "Job iniciado com sucesso",
    }

@app.post("/api/extracao/parar/{job_id}")
async def parar_extracao_individual(job_id: str):
    """Sinaliza uma tarefa de extração específica para interromper imediatamente."""
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job ID não encontrado.")
    
    JOBS[job_id]["cancelar"] = True
    JOBS[job_id]["status"] = "cancelado"
    JOBS[job_id]["mensagem"] = "Cancelado pelo utilizador."
    return {
        "status": "cancelado",
        "job_id": job_id,
        "mensagem": "Tarefa cancelada pelo utilizador."
    }

@app.post("/api/extracao/parar-tudo")
async def parar_todas_extracoes():
    """Sinaliza todas as tarefas ativas para parar e limpa a fila SJF imediatamente."""
    parados = 0
    for jid, job in list(JOBS.items()):
        if job.get("status") in ("em_progresso", "iniciado"):
            job["cancelar"] = True
            job["status"] = "cancelado"
            job["mensagem"] = "Cancelado pelo utilizador."
            parados += 1
    CONCURRENCY_MANAGER.cancel_all()
    LOGGER.info(f"🛑 [PARAR TUDO] {parados} tarefa(s) cancelada(s). Fila SJF limpa.")
    return {
        "status": "paragem_geral_concluida",
        "jobs_afetados": parados,
        "mensagem": f"Interrupção concluída para {parados} tarefa(s)."
    }

@app.get("/api/extracao/status/{job_id}")
async def obter_status_job(job_id: str):
    """Consulta o progresso ou dados de um job assíncrono."""
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job ID não encontrado ou expirado.")

    job = JOBS[job_id]
    docs_atuais = job.get("docs_atuais", job.get("total_documentos", 0))
    total_esperado = job.get("total_esperado", job.get("total_documentos_esperados", 0))
    percentagem = job.get("percentagem", 0)
    if percentagem == 0 and total_esperado > 0 and docs_atuais > 0:
        percentagem = min(100, round((docs_atuais / total_esperado) * 100))

    tag_build = obter_tag_versao_build()
    msg_raw = str(job.get("mensagem") or "")
    msg_formatada = formatar_msg_com_build(msg_raw)

    resp = {
        "status": job["status"],
        "nif": job.get("nif", ""),
        "mensagem": msg_formatada,
        "versao": API_VERSION,
        "tag_build": tag_build,
        "nome_empresa": job.get("nome_empresa", ""),
        "docs_atuais": docs_atuais,
        "total_esperado": total_esperado,
        "percentagem": percentagem,
        "fase": job.get("fase", "faturas"),
        "mes_ativo": job.get("mes_ativo"),
        "ano_ativo": job.get("ano_ativo"),
        "sub_atuais": job.get("sub_atuais"),
        "sub_total": job.get("sub_total"),
        "parcial": job.get("parcial", False),
        "metodo": job.get("metodo"),
        "volume_estimado": job.get("volume_estimado", 0),
        "tipo_erro": job.get("tipo_erro"),
        "badge_label": job.get("badge_label"),
        "assinatura": "API Importador e-Fatura Gexcel",
    }
    if job["status"] in ("concluido", "interrompido"):
        resp["total_documentos_esperados"] = total_esperado
        resp["total_documentos"] = docs_atuais
        resp["total_linhas_vertical"] = job.get("total_linhas_vertical", 0)
        resp["dados_legacy_horizontal"] = job.get("dados_legacy_horizontal")
        resp["dados_novos_vertical"] = job.get("dados_novos_vertical")
        if "ficheiros_xml_gerados" in job:
            resp["ficheiros_xml_gerados"] = job.get("ficheiros_xml_gerados")
            resp["conteudo_xml"] = job.get("conteudo_xml")
    elif job["status"] == "erro":
        erro_raw = str(job.get("erro") or "")
        resp["erro"] = formatar_msg_com_build(erro_raw)
        resp["tipo_erro"] = job.get("tipo_erro", "outro")
        resp["badge_label"] = job.get("badge_label", "Erro AT")

    return resp

@app.post("/api/xml-legado/exportar")
def exportar_xml_legado_endpoint(req: ExportarXmlRequest, lic = Depends(verificar_licenca_ativa)):
    """
    Gera o XML legado a partir de dados horizontais e, opcionalmente,
    grava-o no disco na estrutura oficial BdsefaturaV3 ou no caminho especificado.
    """
    as_buyer = (req.tipo or "compras").lower() == "compras"
    xml_str = efatura_api.gerar_xml_legado_string(req.horizontal_rows)

    caminho_final = None
    if req.caminho_personalizado:
        caminho_final = req.caminho_personalizado
    elif req.pasta_raiz_dados and req.ano and req.mes:
        caminho_final = efatura_api.construir_caminho_xml_legado(
            req.pasta_raiz_dados, req.nif, req.ano, req.mes, as_buyer
        )
    elif req.ano and req.mes:
        caminho_final = efatura_api.construir_caminho_xml_legado(
            efatura_api.DEFAULT_PASTA_RAIZ_LEGADO, req.nif, req.ano, req.mes, as_buyer
        )

    if caminho_final:
        efatura_api.salvar_xml_legado_ficheiro(req.horizontal_rows, caminho_final)

    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "nif": req.nif,
        "ano": req.ano,
        "mes": req.mes,
        "caminho_ficheiro": caminho_final,
        "total_linhas": len(req.horizontal_rows),
        "conteudo_xml": xml_str,
    }


@app.get("/api/estatisticas/volume-estimado")
def obter_estimativas_volume_api(ano: int, tipo: str = "compras"):
    """
    Retorna o volume estimado de documentos para ordenação inteligente (SJF - Shortest Job First).
    Analisa o ano solicitado e, na sua ausência, o ano anterior mais recente com histórico.
    """
    volumes = obter_todas_estimativas_volume(ano, tipo)
    return {
        "status": "sucesso",
        "ano": ano,
        "tipo": tipo,
        "volumes": volumes,
        "assinatura": "API Importador e-Fatura Gexcel"
    }


@app.post("/api/estatisticas/recalibrar-matriz")
def recalibrar_matriz_api(ano: Optional[int] = None, tipo: str = "ambos", nif: Optional[str] = None):
    """Recalibra o controlo_geral.db a partir das bases SQLite locais dos clientes."""
    res = pb_client.recalibrar_controlo_mensal_de_bases_reais(ano=ano, tipo=tipo, nif_filtro=nif)
    return res

@app.get("/api/estatisticas/matriz-anual/{ano}")
def obter_matriz_anual(ano: int, tipo: str = "compras"):
    """Retorna a matriz agregada de documentos por empresa e por mês para o ano solicitado (compras ou vendas) em ~10ms."""
    import sqlite3
    is_vendas = tipo.lower() == "vendas"
    tipo_str = "vendas" if is_vendas else "compras"
    
    pb_client.init_controlo_db()
    resultado = {}
    try:
        controlo_ano = pb_client.obter_controlo_ano(ano, tipo_str)
        
        # Se controlo_ano não tiver registos para este ano, verificar se existem bases particionadas de clientes
        if not controlo_ano:
            v4_dir = pb_client.obter_pasta_v4()
            if os.path.exists(v4_dir):
                nifs_pastas = [d for d in os.listdir(v4_dir) if os.path.isdir(os.path.join(v4_dir, d)) and d.isdigit()]
                for n_cli in nifs_pastas:
                    db_cli = pb_client.obter_db_cliente_path(n_cli, tipo_str)
                    if os.path.exists(db_cli):
                        tabela = "efatura_vendas_linhas" if is_vendas else "efatura_linhas"
                        try:
                            with sqlite3.connect(db_cli, timeout=5) as conn_cli:
                                c_cli = conn_cli.cursor()
                                c_cli.execute(f"SELECT DISTINCT cast(strftime('%m', data_emissao) as integer) FROM {tabela} WHERE cast(strftime('%Y', data_emissao) as integer) = ?", (ano,))
                                meses_cli = [r[0] for r in c_cli.fetchall() if r[0]]
                                for m_cli in meses_cli:
                                    pb_client.atualizar_status_mes(n_cli, ano, m_cli, tipo_str, total_esperado=0, docs_gravados=0, completo=True)
                        except Exception:
                            pass
                controlo_ano = pb_client.obter_controlo_ano(ano, tipo_str)

        for nif_raw, meses_dict in controlo_ano.items():
            if not nif_raw:
                continue
            nif = re.sub(r'[^0-9]', '', str(nif_raw)).strip()[:9]
            if not nif:
                continue
            if nif not in resultado:
                resultado[nif] = {
                    "meses": {},
                    "total_docs_ano": 0,
                    "total_linhas_ano": 0,
                    "total_base_ano": 0.0,
                    "total_iva_ano": 0.0,
                    "tem_incompletos": False,
                    "meses_incompletos": []
                }
            meses_incompletos = []
            for mes_num, c_item in sorted(meses_dict.items()):
                docs = int(c_item.get("docs_gravados", 0) or 0)
                linhas = int(c_item.get("total_linhas", 0) or 0)
                base = float(c_item.get("soma_base", 0.0) or 0.0)
                iva = float(c_item.get("soma_iva", 0.0) or 0.0)
                tot_esp = int(c_item.get("total_esperado", 0) or 0)
                comp = int(c_item.get("completo", 0) or 0)
                
                is_inc = False
                if tot_esp > 0 and docs >= tot_esp:
                    is_inc = False
                elif comp == 0 and docs > 0:
                    is_inc = True
                    meses_incompletos.append(mes_num)
                elif tot_esp > 0 and docs < tot_esp and (comp == 0 or (tot_esp - docs) > 5):
                    is_inc = True
                    meses_incompletos.append(mes_num)
                
                resultado[nif]["meses"][mes_num] = {
                    "docs": docs,
                    "linhas": linhas,
                    "base": base,
                    "iva": iva,
                    "total_esperado": tot_esp,
                    "incompleto": is_inc
                }
                resultado[nif]["total_docs_ano"] += docs
                resultado[nif]["total_linhas_ano"] += linhas
                resultado[nif]["total_base_ano"] = round(resultado[nif]["total_base_ano"] + base, 2)
                resultado[nif]["total_iva_ano"] = round(resultado[nif]["total_iva_ano"] + iva, 2)
                
            resultado[nif]["tem_incompletos"] = len(meses_incompletos) > 0
            resultado[nif]["meses_incompletos"] = sorted(list(set(meses_incompletos)))

        # Obter lista de NIFs com senhas comprovadamente rejeitadas pela AT
        invalidas = pb_client.obter_mapa_senhas_invalidas()

        return {
            "status": "ok",
            "ano": ano,
            "tipo": tipo_str,
            "assinatura": "API Importador e-Fatura Gexcel",
            "empresas": resultado,
            "senhas_invalidas": invalidas
        }
    except Exception as e:
        LOGGER.error(f"Erro ao obter matriz anual ({tipo}): {e}")
        raise HTTPException(status_code=500, detail=str(e))

def validar_operador_admin(
    authorization: Any = Header(None),
    x_auth_token: Any = Header(None),
    token: Any = Query(None)
) -> Dict[str, Any]:
    """Valida se o operador tem sessão ativa com privilégios de Administrador ou Superadministrador."""
    tk = token or x_auth_token
    if not tk and authorization and authorization.startswith("Bearer "):
        tk = authorization.split(" ", 1)[1].strip()
    
    if not tk:
        cfg = auth_manager.obter_config_geral()
        if cfg.get("modo_dados") == "integrado" or not cfg.get("setup_completo") or len(auth_manager.listar_utilizadores()) == 0:
            return {"id": 1, "username": "admin_local", "role": "admin"}
        raise HTTPException(
            status_code=401, 
            detail="Autenticação obrigatória. Inicie sessão com privilégios de Administrador."
        )
    
    caller = auth_manager.validar_token_sessao(tk)
    if not caller:
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada. Inicie sessão novamente.")
    
    if caller.get("role") not in ("admin", "superadmin"):
        raise HTTPException(
            status_code=403, 
            detail="Permissão negada. Esta funcionalidade é estritamente reservada a Administradores."
        )
    caller["token"] = tk
    return caller

@app.post("/api/manutencao/retencao")
def api_manutencao_retencao(
    req: ManutencaoRetencaoRequest,
    operador: Any = Depends(validar_operador_admin)
):
    """
    Executa a política de manutenção temporal por janela deslizante (Rolling Window).
    Elimina faturas de anos anteriores a (ano_referencia - anos_retencao + 1) e executa VACUUM nas bases.
    Suporta filtragem por entidade (req.nif) ou execução global para todas as empresas.
    """
    try:
        res = pb_client.aplicar_retencao_anos(
            nif=req.nif,
            tipo=req.tipo,
            anos_retencao=req.anos_retencao,
            ano_referencia=req.ano_referencia
        )
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "resultado": res
        }
    except Exception as e:
        LOGGER.error(f"Erro ao executar manutenção de retenção: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/senhas-invalidas/reset/{nif}")
@app.delete("/api/senhas-invalidas/{nif}")
def api_reset_senha_invalida(nif: str):
    """Limpa a marcação de senha inválida de um NIF específico na base central, permitindo nova tentativa manual."""
    try:
        nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip()[:9]
        if not nif_clean:
            raise HTTPException(status_code=400, detail="NIF inválido.")
        pb_client.clear_invalid_password_if_success(nif_clean)
        try:
            import logins_Gov
            sub, _ = pb_client.get_credentials(nif_clean)
            if sub:
                logins_Gov.limpar_bloqueio_sucesso(sub, "AT")
                logins_Gov.limpar_bloqueio_sucesso(sub, "EFATURA")
            logins_Gov.limpar_bloqueio_sucesso(nif_clean, "AT")
            logins_Gov.limpar_bloqueio_sucesso(nif_clean, "EFATURA")
        except Exception:
            pass
        LOGGER.info(f"Bloqueio de autenticação do NIF {nif_clean} limpo manualmente na base central.")
        return {
            "status": "sucesso",
            "mensagem": f"Bloqueio de senha para NIF {nif_clean} removido com sucesso.",
            "nif": nif_clean
        }
    except Exception as e:
        LOGGER.error(f"Erro ao resetar senha inválida para NIF {nif}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/base-dados/limpar")
def api_limpar_base_dados(
    reset_senhas: bool = False, 
    tipo: str = "tudo",
    nif: Optional[str] = None,
    ano: Optional[int] = None,
    mes: Optional[int] = None,
    operador: Any = Depends(validar_operador_admin)
):
    """
    Endpoint oficial para limpar faturas importadas (compras, vendas ou tudo).
    Permite limpar a base toda, uma empresa inteira, um ano específico ou um mês específico.
    """
    try:
        linhas, senhas = pb_client.limpar_toda_a_base_dados(
            limpar_senhas_invalidas=reset_senhas, 
            tipo=tipo,
            nif=nif,
            ano=ano,
            mes=mes
        )
        msg_alvo = "Base de dados"
        if nif:
            msg_alvo = f"Entidade {nif}"
            if ano:
                msg_alvo += f" ({ano}"
                if mes:
                    msg_alvo += f"/{mes:02d}"
                msg_alvo += ")"
        return {
            "status": "sucesso",
            "mensagem": f"{msg_alvo} ({tipo}) limpa com sucesso. {linhas} registos eliminados.",
            "linhas_apagadas": linhas,
            "senhas_resetadas": senhas
        }
    except Exception as e:
        LOGGER.error(f"Erro ao limpar base de dados: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/faturas/consultar")
def api_consultar_faturas(
    tipo: str = "compras",
    nif: str = "",
    data_inicio: str = "",
    data_fim: str = "",
    pesquisa: str = "",
    taxa: Optional[float] = None,
    limite: int = 250,
    offset: int = 0,
    ordenar_por: str = "data_emissao",
    ordem: str = "desc"
):
    """Endpoint oficial para consulta e drilldown de faturas e linhas individuais."""
    try:
        dados = pb_client.consultar_faturas_linhas(
            tipo=tipo,
            nif=nif,
            data_inicio=data_inicio,
            data_fim=data_fim,
            pesquisa=pesquisa,
            taxa=taxa,
            limite=limite,
            offset=offset,
            ordenar_por=ordenar_por,
            ordem=ordem
        )
        return {
            "status": "ok",
            "assinatura": "API Importador e-Fatura Gexcel",
            "tipo": tipo,
            **dados
        }
    except Exception as e:
        LOGGER.error(f"Erro na rota /api/faturas/consultar: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/inconformidades")
def api_consultar_inconformidades(
    nif: str = "",
    modulo: str = "",
    data_inicio: str = "",
    data_fim: str = "",
    limite: int = 100,
    offset: int = 0
):
    """Endpoint oficial para auditoria forense de inconformidades (anulações tardias de faturas)."""
    try:
        dados = pb_client.consultar_inconformidades(
            nif=nif,
            modulo=modulo,
            data_inicio=data_inicio,
            data_fim=data_fim,
            limite=limite,
            offset=offset
        )
        return {
            "status": "ok",
            "assinatura": "API Importador e-Fatura Gexcel",
            **dados
        }
    except Exception as e:
        LOGGER.error(f"Erro na rota /api/inconformidades: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# -------------------------------------------------------------------------
# ENDPOINTS OFICIAIS DE WEB SCRAPING E COFRE DE ESTADOS (LEDGER)
# -------------------------------------------------------------------------
@app.post("/api/efatura/login-browser")
def api_efatura_login_browser(req: LoginBrowserRequest, lic = Depends(verificar_licenca_ativa)):
    """
    Inicia o navegador (Edge ou Chrome) visível com sessão autenticada no e-Fatura para a entidade indicada.
    Verifica previamente na base central (Dados Gexcel Apps) se a senha já está marcada como inválida.
    """
    nif_raw = str(req.nif or "").strip()
    nif_clean = re.sub(r'[^0-9]', '', nif_raw)[:9]
    if not nif_clean:
        raise HTTPException(status_code=400, detail="NIF inválido.")

    # 1. Recuperar credenciais se não fornecidas diretamente
    pwd = (req.password or "").strip()
    sub = ""
    if not pwd:
        sub, pwd = pb_client.get_credentials(nif_clean)
    else:
        sub, _ = pb_client.get_credentials(nif_clean)

    if not pwd:
        raise HTTPException(
            status_code=400,
            detail=f"Nenhuma palavra-passe configurada para o NIF {nif_clean}. Registe as credenciais no Gestor de Identidades."
        )

    # 1.1 Proteção Central: Bloquear login manual se a senha atual já constar como recusada pela AT na base central
    is_invalida, detalhe_erro = pb_client.check_if_password_marked_invalid(nif_clean, pwd)
    if is_invalida:
        raise HTTPException(
            status_code=400,
            detail=f"Login Manual Bloqueado: A senha atual do NIF {nif_clean} já foi recusada pela AT ({detalhe_erro}). Atualize a senha nas credenciais antes de tentar novamente."
        )

    # Determinar utilizador de autenticação preservando subutilizador (ex: 508772753/2)
    login_user = str(sub).strip() if sub and str(sub).strip() else (nif_raw if "/" in nif_raw else nif_clean)
    dest_clean = (req.destino or "efatura").lower().strip()
    if dest_clean in ["recibos", "recibos_verdes", "recibos-verdes", "rv", "sire"]:
        portal_url = "https://www.acesso.gov.pt/v2/loginForm?partID=SIRE&path=/recibos/portal/consultar"
    elif dest_clean in ["efatura", "e-fatura"]:
        portal_url = "https://faturas.portaldasfinancas.gov.pt/painelAdquirente.action"
    else:
        portal_url = "https://www.acesso.gov.pt/v2/loginForm?partID=PFAP&path=/geral/home"

    # Se executado num servidor Cloud Linux sem interface gráfica local, devolver metadados para abertura direta no browser
    if sys.platform != "win32" and not os.environ.get("DISPLAY"):
        return {
            "status": "sucesso",
            "modo": "cloud_redirect",
            "assinatura": "API Importador e-Fatura Gexcel",
            "mensagem": f"A abrir Portal das Finanças para {login_user}...",
            "nif": nif_clean,
            "utilizador": login_user,
            "destino": req.destino or "efatura",
            "portal_url": portal_url,
        }

    # 2. Localizar Python com Playwright (logins_Gov\.venv) - preferir python.exe com CREATE_NO_WINDOW para estabilidade dos pipes Playwright Node.js
    base_evo = Path(__file__).resolve().parent.parent
    candidatos_py = [
        base_evo / "03.9_SCR_EVO_Scrapers_Gov" / "SCR-01_Logins_Gov" / ".venv" / "Scripts" / "python.exe",
        base_evo / "03.9_SCR_EVO_Scrapers_Gov" / "SCR-01_Logins_Gov" / "venv" / "Scripts" / "python.exe",
        Path(r"C:\DEV\Ecossistema_Gexcel\03_EVO_Ecossistema_Evo\03.9_SCR_EVO_Scrapers_Gov\SCR-01_Logins_Gov\.venv\Scripts\python.exe"),
        Path(r"C:\DEV\Ecossistema_Gexcel\03_EVO_Ecossistema_Evo\03.9_SCR_EVO_Scrapers_Gov\SCR-01_Logins_Gov\venv\Scripts\python.exe"),
        Path(sys.executable)
    ]
    py_exe = next((str(p) for p in candidatos_py if p.exists()), sys.executable)

    # 3. Localizar o script de abertura do navegador
    candidatos_script = [
        base_evo / "03.9_SCR_EVO_Scrapers_Gov" / "SCR-02_Scrap_Efatura" / "abrir_browser_sessao.py",
        Path(r"C:\DEV\Ecossistema_Gexcel\03_EVO_Ecossistema_Evo\03.9_SCR_EVO_Scrapers_Gov\SCR-02_Scrap_Efatura\abrir_browser_sessao.py"),
        Path(__file__).parent / "abrir_browser_sessao.py"
    ]
    script_path = next((str(p) for p in candidatos_script if p.exists()), None)
    if not script_path:
        raise HTTPException(status_code=500, detail="Script 'abrir_browser_sessao.py' não encontrado no sistema.")

    # Preparar ficheiro de log de auditoria da sessão de browser
    local_app = os.environ.get("LOCALAPPDATA", "") or os.path.expanduser("~\\AppData\\Local")
    pasta_logs = Path(local_app) / "GExcelAYD" / "logs"
    pasta_logs.mkdir(parents=True, exist_ok=True)
    log_browser_path = pasta_logs / "efatura_browser_login.log"

    # 4. Passar credenciais e pasta central de dados via variáveis de ambiente
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["GOV_NIF"] = login_user
    env["GOV_NIF_EMPRESA"] = nif_clean
    env["GOV_PWD"] = pwd
    env["GOV_CANAL"] = req.canal or "auto"
    env["GOV_DESTINO"] = req.destino or "efatura"
    env["GEXCEL_BROWSER_LOG_PATH"] = str(log_browser_path)
    try:
        pasta_raiz = pb_client.obter_pasta_dados_raiz()
        if pasta_raiz:
            env["GEXCEL_DADOS_DIR"] = pasta_raiz
    except Exception:
        pass

    try:
        creationflags = 0
        if sys.platform == "win32":
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

        log_file = open(log_browser_path, "a", encoding="utf-8")
        cmd = [py_exe, "-u", script_path, "--nif", login_user, "--canal", req.canal or "auto", "--destino", req.destino or "efatura"]
        subprocess.Popen(
            cmd,
            env=env,
            creationflags=creationflags,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            close_fds=True if sys.platform != "win32" else False
        )
        LOGGER.info("Browser Playwright lançado em background para utilizador %s (NIF: %s, Canal: %s, Destino: %s)", login_user, nif_clean, req.canal, req.destino)
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "mensagem": f"Navegador aberto com login em curso para {login_user}.",
            "nif": nif_clean,
            "utilizador": login_user,
            "destino": req.destino or "efatura"
        }
    except Exception as e:
        LOGGER.exception("Falha ao abrir navegador para NIF %s: %s", nif_clean, e)
        raise HTTPException(status_code=500, detail=f"Erro ao iniciar navegador: {e}")

@app.post("/api/efatura/scrape/anuladas")
def api_efatura_scrape_anuladas(req: ScrapeAnuladasRequest, lic = Depends(verificar_licenca_ativa)):
    """
    Executa a extração cirúrgica de faturas anuladas via Web Scraping no Portal das Finanças.
    Recupera automaticamente as credenciais, executa sessão headless, extrai linhas
    com ExtratorDetalhes e persiste no Core BD (data.db / efatura_vendas.db) e no Cofre permanente.
    """
    if iniciar_sessao_efatura is None:
        raise HTTPException(
            status_code=500,
            detail="A biblioteca 'efatura_scraper' não está disponível no sistema."
        )

    nif_clean = re.sub(r'[^0-9]', '', str(req.nif or "")).strip()
    if not nif_clean:
        raise HTTPException(status_code=400, detail="NIF inválido.")

    # 1. Determinar intervalo de datas
    import calendar
    data_ini = req.data_inicio
    data_fim = req.data_fim

    if req.ano and req.mes:
        ult_dia = calendar.monthrange(req.ano, req.mes)[1]
        data_ini = f"{req.ano:04d}-{req.mes:02d}-01"
        data_fim = f"{req.ano:04d}-{req.mes:02d}-{ult_dia:02d}"
    elif req.ano and not req.mes and not (data_ini and data_fim):
        data_ini = f"{req.ano:04d}-01-01"
        data_fim = f"{req.ano:04d}-12-31"

    if not data_ini or not data_fim:
        raise HTTPException(
            status_code=400,
            detail="É obrigatório indicar ano/mes ou data_inicio e data_fim (formato YYYY-MM-DD)."
        )

    # 2. Recuperar senha da entidade (via tCredenciais.xml / entidades_senhas)
    senha = req.password
    sub = getattr(req, "subutilizador", None)
    if not senha or not sub:
        pb_sub, pb_senha = pb_client.get_credentials(nif_clean)
        if pb_senha and not senha:
            senha = pb_senha
        if pb_sub and not sub:
            sub = pb_sub

    if not senha:
        raise HTTPException(
            status_code=400,
            detail=f"Senha da AT não encontrada para o NIF {nif_clean} em tCredenciais.xml nem em entidades_senhas."
        )

    modulo_clean = req.modulo.strip().lower()
    is_vendas = modulo_clean == "vendas"

    login_user = str(sub).strip() if sub and str(sub).strip() else nif_clean
    LOGGER.info(
        f"🎯 [SCRAPE ANULADAS] A iniciar extração cirúrgica para NIF {nif_clean} (Login: {login_user}) "
        f"({modulo_clean}) no período {data_ini} a {data_fim}..."
    )

    try:
        sessao = iniciar_sessao_efatura(
            nif=login_user,
            password=senha,
            headless=True,
            canal=req.canal or "msedge"
        )
    except GovAuthError as ge:
        LOGGER.error(f"Erro de autenticação no portal e-Fatura para NIF {nif_clean}: {ge}")
        raise HTTPException(status_code=401, detail=f"Falha na autenticação do portal e-Fatura: {ge}")
    except Exception as e:
        LOGGER.error(f"Falha ao iniciar sessão de scraping para NIF {nif_clean}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao iniciar sessão no e-Fatura: {e}")

    try:
        # 3. Consulta cirúrgica de faturas anuladas
        if is_vendas:
            extrator = EFaturaVendas(sessao, visual=False)
        else:
            extrator = EFaturaCompras(sessao, visual=False)

        faturas_anuladas = extrator.consultar_anuladas(data_ini, data_fim)

        linhas_extraidas = []
        if faturas_anuladas:
            extrator_detalhes = ExtratorDetalhes(sessao, max_workers=req.threads or 6)
            linhas_extraidas = extrator_detalhes.extrair_detalhes_lote(
                documentos=faturas_anuladas,
                nif_titular=nif_clean,
                tipo_fluxo="vendas" if is_vendas else "compras"
            )

        # 4. Gravação e Auditoria no Core BD e CofreEstadosLedger
        linhas_gravadas = 0
        novas_inconformidades = 0

        if req.gravar_db:
            if faturas_anuladas:
                try:
                    pb_client.upsert_anuladas_direto(
                        nif_clean,
                        faturas_anuladas,
                        modulo="vendas" if is_vendas else "compras"
                    )
                except Exception as e_anul_db:
                    LOGGER.warning(f"Aviso ao gravar em anuladas_{nif_clean}.db: {e_anul_db}")

            persistencia = PersistenciaSQLite()
            if linhas_extraidas:
                if is_vendas:
                    linhas_gravadas, novas_inconformidades = persistencia.gravar_linhas_vendas(linhas_extraidas)
                else:
                    linhas_gravadas, novas_inconformidades = persistencia.gravar_linhas_compras(linhas_extraidas)

                # Sincronizar também na base particionada do cliente em BdsefaturaV4
                v_rows = [l.to_dict() for l in linhas_extraidas]
                if is_vendas:
                    pb_client.upsert_vendas_direto(v_rows)
                else:
                    pb_client.upsert_faturas_direto(v_rows)
            elif faturas_anuladas:
                # Caso haja faturas anuladas sem linhas de taxa, garantir registo no Cofre
                cofre = cofre_ledger.CofreEstadosLedger()
                novas_inconf_list = cofre.registar_e_confrontar(faturas_anuladas, nif_titular=nif_clean)
                novas_inconformidades = len(novas_inconf_list)

        LOGGER.info(
            f"✅ [SCRAPE ANULADAS CONCLUÍDO] NIF {nif_clean}: {len(faturas_anuladas)} faturas anuladas, "
            f"{len(linhas_extraidas)} linhas extraídas ({linhas_gravadas} gravadas). Novas inconformidades: {novas_inconformidades}."
        )

        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "nif": nif_clean,
            "modulo": "vendas" if is_vendas else "compras",
            "periodo": {
                "data_inicio": data_ini,
                "data_fim": data_fim
            },
            "total_faturas_anuladas": len(faturas_anuladas),
            "total_linhas_extraidas": len(linhas_extraidas),
            "linhas_gravadas_db": linhas_gravadas,
            "novas_inconformidades_detetadas": novas_inconformidades,
            "faturas": [f.to_dict() for f in faturas_anuladas],
            "linhas": [l.to_dict() for l in linhas_extraidas]
        }

    finally:
        try:
            sessao.close()
        except Exception:
            pass


@app.get("/api/efatura/inconformidades")
def api_efatura_obter_inconformidades(
    nif: Optional[str] = None,
    lic = Depends(verificar_licenca_ativa)
):
    """
    Retorna do CofreEstadosLedger a lista oficial de inconformidades detetadas
    (faturas anuladas à posteriori) para consulta pelo CRM / Frontend Desktop.
    """
    try:
        from cofre_ledger import CofreEstadosLedger
        cofre = CofreEstadosLedger()
        nif_clean = re.sub(r'[^0-9]', '', str(nif or "")).strip() if nif else None
        inconfs = cofre.obter_inconformidades(nif_clean)
        total_ledger = cofre.total_faturas_registadas(nif_clean)
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "nif": nif_clean,
            "total_inconformidades": len(inconfs),
            "total_faturas_registadas_ledger": total_ledger,
            "inconformidades": inconfs
        }
    except Exception as e:
        LOGGER.error(f"Erro na rota /api/efatura/inconformidades: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# -------------------------------------------------------------------------
# ENDPOINTS DE GESTÃO DE PERFORMANCE E CONCORRÊNCIA ADAPTATIVA
# -------------------------------------------------------------------------
class PerformanceConfigRequest(BaseModel):
    mode: str = Field(..., description="'auto' ou 'manual'")
    manual_limit: Optional[int] = Field(default=4, description="Limite de workers simultâneos em modo manual")

@app.get("/api/config/performance")
def obter_config_performance():
    """Devolve a telemetria do computador, limite de workers atual e modo ativo."""
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        **CONCURRENCY_MANAGER.get_status()
    }

@app.post("/api/config/performance")
def alterar_config_performance(req: PerformanceConfigRequest):
    """Permite alternar entre o modo Automático Adaptativo e o modo Manual em tempo real."""
    CONCURRENCY_MANAGER.set_config(req.mode, req.manual_limit or 4)
    return {
        "status": "sucesso",
        "mensagem": "Configuração de desempenho atualizada com sucesso.",
        **CONCURRENCY_MANAGER.get_status()
    }


# -------------------------------------------------------------------------
# CICLO DE VIDA DO MOTOR DO AGENDADOR EM SEGUNDO PLANO
# -------------------------------------------------------------------------
@app.on_event("startup")
def startup_event():
    """Inicia os subsistemas autónomos no arranque da API."""
    try:
        if sys.platform == "win32":
            SCHEDULER_ENGINE.start()
            LOGGER.info("API e-Fatura pronta e reativa (Agendador autónomo de background ativo).")
        else:
            LOGGER.info("API e-Fatura pronta em modo Cloud Online (Agendador reservado ao Conector Local).")
    except Exception as e_sc:
        LOGGER.warning(f"Aviso ao iniciar agendador no arranque: {e_sc}")

@app.on_event("shutdown")
def shutdown_event():
    """Termina os serviços em background de forma limpa."""
    try:
        SCHEDULER_ENGINE.stop()
        LOGGER.info("Motor do Agendador parado com sucesso.")
    except Exception as e:
        LOGGER.error("Falha ao parar motor do agendador: %s", e)


# -------------------------------------------------------------------------
# MODELOS E ROTAS DA API DO AGENDADOR AUTÓNOMO
# -------------------------------------------------------------------------
class AgendamentoCriarRequest(BaseModel):
    nome: str = Field(..., description="Nome descritivo da tarefa agendada")
    nifs: List[str] = Field(default_factory=lambda: ["TODOS"], description="Lista de NIFs ou ['TODOS']")
    ano: int = Field(default_factory=lambda: date.today().year, description="Ano fiscal a sincronizar")
    meses: List[int] = Field(default_factory=lambda: list(range(1, 13)), description="Lista de meses (1-12)")
    tipo: str = Field(default="ambos", description="'compras', 'vendas' ou 'ambos'")
    recorrencia: str = Field(default="diaria", description="'diaria', 'semanal', 'mensal' ou 'unica'")
    hora: str = Field(default="03:00", description="Hora de disparo 'HH:MM'")
    dias_semana: Optional[str] = Field(default="", description="Para semanal: 'seg,ter,qua,qui,sex,sab,dom'")
    dia_mes: Optional[int] = Field(default=1, description="Para mensal: dia do mês (1-31)")
    politica_atraso: str = Field(default="auto_catchup", description="'auto_catchup', 'perguntar' ou 'skip'")
    ativo: bool = Field(default=True)

class AgendamentoAtualizarRequest(BaseModel):
    nome: Optional[str] = None
    nifs: Optional[List[str]] = None
    ano: Optional[int] = None
    meses: Optional[List[int]] = None
    tipo: Optional[str] = None
    recorrencia: Optional[str] = None
    hora: Optional[str] = None
    dias_semana: Optional[str] = None
    dia_mes: Optional[int] = None
    politica_atraso: Optional[str] = None
    ativo: Optional[bool] = None

class ConfirmarAtrasoRequest(BaseModel):
    acao: str = Field(..., description="'executar' ou 'saltar'")


@app.get("/api/agendador/tarefas")
def api_listar_agendamentos():
    """Lista todas as tarefas agendadas registadas no sistema com telemetria ao vivo."""
    tarefas = scheduler.listar_agendamentos()
    progresso_vivo = scheduler.SCHEDULER_ENGINE.obter_progresso_vivo()
    executando_ids = set(scheduler.SCHEDULER_ENGINE._executando_tarefas)

    for t in tarefas:
        tid = t["id"]
        t["em_execucao"] = (tid in executando_ids) or (t.get("ultimo_status") == "em_execucao")
        t["progresso_vivo"] = progresso_vivo.get(tid)

    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "tarefas": tarefas,
        "tarefas_em_execucao": len(executando_ids)
    }

@app.post("/api/agendador/tarefas")
def api_criar_agendamento(req: AgendamentoCriarRequest):
    """Cria uma nova tarefa agendada persistente."""
    if sys.platform != "win32":
        raise HTTPException(
            status_code=503,
            detail="⚠️ Em atualização — disponível em breve (requer Conector Local do escritório)."
        )
    dados = req.dict()
    tarefa = scheduler.criar_agendamento(dados)
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "tarefa": tarefa
    }

@app.put("/api/agendador/tarefas/{task_id}")
def api_atualizar_agendamento(task_id: str, req: AgendamentoAtualizarRequest):
    """Atualiza as configurações de uma tarefa agendada existente."""
    dados = {k: v for k, v in req.dict().items() if v is not None}
    tarefa = scheduler.atualizar_agendamento(task_id, dados)
    if not tarefa:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada.")
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "tarefa": tarefa
    }

@app.delete("/api/agendador/tarefas/{task_id}")
def api_eliminar_agendamento(task_id: str):
    """Elimina uma tarefa agendada e o respetivo histórico."""
    removido = scheduler.eliminar_agendamento(task_id)
    if not removido:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada.")
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "mensagem": "Tarefa eliminada com sucesso."
    }

@app.post("/api/agendador/tarefas/{task_id}/toggle")
def api_toggle_agendamento(task_id: str):
    """Alterna o estado ativo/pausado de uma tarefa."""
    tarefa = scheduler.toggle_agendamento(task_id)
    if not tarefa:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada.")
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "tarefa": tarefa
    }

@app.post("/api/agendador/tarefas/{task_id}/executar")
def api_executar_tarefa_agora(task_id: str):
    """Dispara a execução imediata em background de uma tarefa agendada."""
    if sys.platform != "win32":
        raise HTTPException(
            status_code=503,
            detail="⚠️ Em atualização — disponível em breve (requer Conector Local do escritório)."
        )
    iniciado = SCHEDULER_ENGINE.executar_agora_async(task_id)
    if not iniciado:
        raise HTTPException(status_code=400, detail="Tarefa não encontrada ou já se encontra em execução.")
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "mensagem": "Execução da tarefa agendada iniciada em segundo plano."
    }

@app.get("/api/agendador/tarefas/pendentes")
def api_obter_tarefas_pendentes():
    """Retorna tarefas que falharam a hora prevista por PC desligado com política 'perguntar'."""
    pendentes = scheduler.obter_tarefas_pendentes_confirmacao()
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "pendentes": pendentes
    }

@app.post("/api/agendador/tarefas/{task_id}/confirmar-atraso")
def api_confirmar_atraso(task_id: str, req: ConfirmarAtrasoRequest):
    """Resolve uma tarefa atrasada (executa imediatamente ou salta para a próxima ocorrência)."""
    if req.acao not in ("executar", "saltar"):
        raise HTTPException(status_code=400, detail="Ação inválida. Use 'executar' ou 'saltar'.")
    tarefa = scheduler.resolver_atraso_agendamento(task_id, req.acao)
    if not tarefa:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada.")
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "tarefa": tarefa
    }

@app.get("/api/agendador/logs")
def api_listar_logs_agendamento(agendamento_id: Optional[str] = None, limite: int = 50):
    """Retorna o histórico de auditoria e logs de execução das tarefas agendadas."""
    logs = scheduler.listar_logs_agendamento(agendamento_id, limite)
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "logs": logs
    }

# -------------------------------------------------------------------------
# ENDPOINTS DO PIPELINE DE SEGUNDO PLANO (WORKER DESACOPLADO)
# -------------------------------------------------------------------------

@app.get("/api/pipeline/status")
def api_obter_pipeline_status():
    """Retorna o estado da fila de segundo plano, contagens e tarefa atual em curso."""
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "versao": API_VERSION,
        "tag_build": obter_tag_versao_build(),
        **pipeline_worker.obter_status_pipeline()
    }

@app.post("/api/pipeline/acordar")
def api_acordar_pipeline_worker():
    """Acorda ou reinicia o worker de segundo plano caso haja tarefas pendentes."""
    pipeline_worker.garantir_worker_ativo()
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "mensagem": "Worker de segundo plano acionado/verificado com sucesso."
    }

# =============================================================================
# GESTÃO DE UTILIZADORES LOCAIS, RBAC E MODO DE DADOS (AUTH MANAGER)
# =============================================================================

class AppModoRequest(BaseModel):
    modo: str = Field(..., description="'integrado' ou 'autonomo'")

class AppLoginRequest(BaseModel):
    username: str
    password: str

class AppCriarUserRequest(BaseModel):
    username: str
    nome: str
    password: str
    role: str = "subutilizador"
    email: Optional[str] = ""
    telefone: Optional[str] = ""
    centros_permitidos: Optional[List[str]] = None

class AppAtualizarUserRequest(BaseModel):
    nome: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    role: Optional[str] = None
    ativo: Optional[bool] = None
    nova_password: Optional[str] = None
    centros_permitidos: Optional[List[str]] = None

class AppSetupInicialRequest(BaseModel):
    nome_admin: str
    username_admin: str
    password_admin: str
    email_admin: Optional[str] = ""

class AppXmlLegadoRequest(BaseModel):
    alimentar_xml_legado: bool

class AppCentroDadosRequest(BaseModel):
    hostname: str
    hardware_id: Optional[str] = ""
    ip_local: Optional[str] = "127.0.0.1:8015"
    nome: Optional[str] = None
    pasta_evogex: Optional[str] = None
    pasta_gexcel_antiga: Optional[str] = None
    centro_id: Optional[str] = None

class AppGuardarCentroNomeadoRequest(BaseModel):
    nome: str
    hostname: Optional[str] = ""
    pasta_evogex: Optional[str] = ""
    pasta_gexcel_antiga: Optional[str] = ""
    centro_id: Optional[str] = None
    ip_local: Optional[str] = "127.0.0.1:8015"
    tornar_ativo: bool = True

class AppSelecionarCentroRequest(BaseModel):
    centro_id: str


def _invalidar_caches_mudanca_centro():
    """Limpa caches em memória para que a mudança de Centro de Dados reflita imediatamente as entidades e faturas."""
    try:
        if hasattr(pb_client, "_ENTIDADES_CACHE_MEM"):
            pb_client._ENTIDADES_CACHE_MEM["data"] = None
            pb_client._ENTIDADES_CACHE_MEM["ts"] = 0.0
    except Exception:
        pass
    try:
        recibos_verdes_service.invalidar_cache_xml()
    except Exception:
        pass


@app.get("/api/app/centros-dados")
def api_listar_centros_dados():
    """Lista todos os Centros de Dados nomeados registados na conta do cliente."""
    cfg = auth_manager.obter_config_geral()
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "centros_dados": cfg.get("centros_dados", []),
        "centro_dados_ativo_id": cfg.get("centro_dados_ativo_id"),
        "centro_dados_nome": cfg.get("centro_dados_nome"),
        "config": cfg,
    }


@app.post("/api/app/centros-dados")
def api_guardar_centro_dados_nomeado(
    req: AppGuardarCentroNomeadoRequest,
    operador: Any = Depends(validar_operador_admin)
):
    """Cria ou atualiza um Centro de Dados nomeado (ex: Escritório da Maia, Porto, PHC, Sage) e prepara a pasta Dados_evoGex."""
    try:
        cfg = auth_manager.guardar_centro_dados(
            nome=req.nome,
            hostname=req.hostname or "",
            pasta_evogex=req.pasta_evogex or "",
            pasta_gexcel_antiga=req.pasta_gexcel_antiga or "",
            centro_id=req.centro_id,
            ip_local=req.ip_local or "127.0.0.1:8015",
            tornar_ativo=req.tornar_ativo,
        )
        _invalidar_caches_mudanca_centro()
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "config": api_obter_app_config()["config"],
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/app/centros-dados/selecionar")
def api_selecionar_centro_dados(req: AppSelecionarCentroRequest):
    """Alterna instantaneamente entre Centros de Dados nomeados (ex: Escritório da Maia <-> Escritório do Porto)."""
    try:
        auth_manager.selecionar_centro_dados_ativo(req.centro_id)
        _invalidar_caches_mudanca_centro()
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "config": api_obter_app_config()["config"],
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/app/centros-dados/{centro_id}")
def api_eliminar_centro_dados(
    centro_id: str,
    operador: Any = Depends(validar_operador_admin)
):
    """Remove um Centro de Dados nomeado (protegendo caso seja o único)."""
    try:
        auth_manager.eliminar_centro_dados(centro_id)
        _invalidar_caches_mudanca_centro()
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "config": api_obter_app_config()["config"],
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class ImportarTCredenciaisRequest(BaseModel):
    xml_content: str
    nome_pasta: Optional[str] = ""


@app.post("/api/entidades/importar-tcredenciais")
def api_importar_tcredenciais_direto(req: ImportarTCredenciaisRequest):
    """
    Recebe o conteúdo de tCredenciais.xml lido diretamente pelo browser (File System Access API)
    a partir da pasta Dados_GexcelApps escolhida pelo utilizador e carrega todas as empresas e senhas.
    Em servidor Cloud Zero-Storage mantém os dados estritamente na RAM do workspace autenticado.
    """
    import legado_bridge
    xml_raw = (req.xml_content or "").strip()
    if not xml_raw:
        raise HTTPException(status_code=400, detail="Conteúdo de tCredenciais.xml vazio.")

    if workspace_context.is_cloud_zero_storage():
        ws_id = workspace_context.get_current_ws_id()
        if ws_id == "unlinked_empty":
            raise HTTPException(status_code=400, detail="Sessão de posto inválida para isolamento Zero-Storage.")
        try:
            entidades = legado_bridge.parse_tcredenciais_xml_string(xml_raw)
        except Exception as e_xml:
            raise HTTPException(status_code=400, detail=f"XML tCredenciais inválido: {e_xml}")
        workspace_context.set_entidades_ram(entidades, ws_id=ws_id)
        try:
            pb_client._ENTIDADES_CACHE["timestamp"] = 0.0
        except Exception:
            pass
    else:
        pasta_raiz = Path(pb_client.obter_pasta_dados_raiz())
        pasta_raiz.mkdir(parents=True, exist_ok=True)
        destino_xml = pasta_raiz / "tCredenciais.xml"
        destino_xml.write_text(xml_raw, encoding="utf-8")

        legado_bridge._CACHE_ENTIDADES["timestamp"] = 0.0
        entidades = legado_bridge.carregar_entidades_legadas(str(destino_xml))
        try:
            pb_client.sincronizar_legado_para_pocketbase()
        except Exception:
            pass
        try:
            pb_client._ENTIDADES_CACHE["timestamp"] = 0.0
        except Exception:
            pass

    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "total_entidades": len(entidades),
        "entidades": [
            {
                "id": e["nif"],
                "nif": e["nif"],
                "nif_cc": e["nif"],
                "nomecli": e["nomecli"],
                "ativo": True,
                "tem_credenciais_at": bool(e.get("password")),
            }
            for e in entidades
        ],
    }


@app.get("/api/efatura/exportar-sqlite/{nif}")
def api_exportar_sqlite_nif(nif: str):
    """
    Devolve os ficheiros SQLite (.db) de uma empresa (compras, vendas, controlo_geral.db e pendentes_efatura.db)
    em Base64 para que o browser os grave diretamente na pasta Dados_evoGex\\BdsefaturaV4 do cliente.
    """
    import base64
    nif_clean = re.sub(r"[^0-9]", "", str(nif or "")).strip()[:9]
    pasta_v4 = Path(pb_client.obter_pasta_v4())
    ficheiros = []

    for root_db_name in ("controlo_geral.db", "pendentes_efatura.db"):
        root_db = pasta_v4 / root_db_name
        if root_db.exists() and root_db.is_file():
            ficheiros.append({
                "rel_path": root_db_name,
                "size": root_db.stat().st_size,
                "base64": base64.b64encode(root_db.read_bytes()).decode("ascii"),
            })

    if nif_clean:
        nif_dir = pasta_v4 / nif_clean
        if nif_dir.exists() and nif_dir.is_dir():
            for db_file in nif_dir.glob("*.db"):
                if db_file.is_file():
                    ficheiros.append({
                        "rel_path": f"{nif_clean}/{db_file.name}",
                        "size": db_file.stat().st_size,
                        "base64": base64.b64encode(db_file.read_bytes()).decode("ascii"),
                    })

    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "nif": nif_clean,
        "total_ficheiros": len(ficheiros),
        "ficheiros": ficheiros,
    }


@app.get("/api/efatura/exportar-todos-sqlites")
def api_exportar_todos_sqlites():
    """
    Devolve todos os ficheiros SQLite (.db) presentes em BdsefaturaV4 (controlo_geral.db, pendentes_efatura.db + pastas NIF)
    para sincronização direta e automática na pasta Dados_evoGex\\BdsefaturaV4 escolhida no browser.
    """
    import base64
    pasta_v4 = Path(pb_client.obter_pasta_v4())
    ficheiros = []
    if pasta_v4.exists():
        for root_db_name in ("controlo_geral.db", "pendentes_efatura.db"):
            root_db = pasta_v4 / root_db_name
            if root_db.exists() and root_db.is_file():
                ficheiros.append({
                    "rel_path": root_db_name,
                    "size": root_db.stat().st_size,
                    "base64": base64.b64encode(root_db.read_bytes()).decode("ascii"),
                })
        for sub in sorted(pasta_v4.iterdir()):
            if sub.is_dir() and re.match(r"^\d{9}$", sub.name):
                for db_file in sorted(sub.glob("*.db")):
                    if db_file.is_file():
                        ficheiros.append({
                            "rel_path": f"{sub.name}/{db_file.name}",
                            "size": db_file.stat().st_size,
                            "base64": base64.b64encode(db_file.read_bytes()).decode("ascii"),
                        })
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "total_ficheiros": len(ficheiros),
        "ficheiros": ficheiros,
    }


class HidratarSqlitesRequest(BaseModel):
    ficheiros: List[Dict[str, str]] = Field(default_factory=list)


@app.post("/api/efatura/hidratar-sqlites-locais")
def api_hidratar_sqlites_locais(req: HidratarSqlitesRequest):
    """
    Recebe ficheiros SQLite (.db) lidos localmente no posto do cliente e hidrata apenas
    o buffer efémero isolado do workspace atual para leitura imediata e operações em sessão.
    """
    import base64
    if workspace_context.is_cloud_zero_storage() and workspace_context.get_current_ws_id() == "unlinked_empty":
        raise HTTPException(status_code=400, detail="Sessão de posto inválida para hidratação local.")

    pasta_v4 = Path(pb_client.obter_pasta_v4())
    pasta_v4.mkdir(parents=True, exist_ok=True)
    restaurados = 0

    for item in (req.ficheiros or []):
        rel_raw = str(item.get("rel_path") or "").replace("\\", "/").strip()
        b64_raw = str(item.get("base64") or "").strip()
        if not rel_raw or not b64_raw:
            continue
        if rel_raw.startswith("/") or ".." in rel_raw or not rel_raw.lower().endswith(".db"):
            continue
        if not re.match(r"^(controlo_geral\.db|pendentes_efatura\.db|\d{9}/[A-Za-z0-9_.-]+\.db)$", rel_raw):
            continue

        destino = (pasta_v4 / rel_raw).resolve()
        if pasta_v4.resolve() not in destino.parents:
            continue
        try:
            raw_bytes = base64.b64decode(b64_raw)
        except Exception:
            continue
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(raw_bytes)
        restaurados += 1

    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "restaurados": restaurados,
    }


@app.get("/api/sistema/instalador-centro-dados")
def api_descarregar_instalador_centro_dados(
    request: Request,
    nome: str = "Escritório Principal",
    pasta_evogex: str = r"C:\Dados_evoGex",
    pasta_gexcel_antiga: str = "",
):
    """
    Gera o instalador unificado de 1 clique (.bat) exclusivamente com o binário
    compilado e protegido (.pyd / .exe: gevo_ef2026.exe). NUNCA expõe ficheiros .py.
    """
    nome_clean = (nome or "Escritório Principal").replace('"', '').strip()
    p_evo_clean = (pasta_evogex or r"C:\Dados_evoGex").replace('"', '').strip()
    p_ant_clean = (pasta_gexcel_antiga or "").replace('"', '').strip()

    bat_lines = [
        "@echo off",
        "chcp 65001 >nul",
        f"title Instalador Centro de Dados evoGex - {nome_clean}",
        "echo ============================================================================",
        f"echo   INSTALADOR UNIFICADO - CENTRO DE DADOS EVOGEX ({nome_clean})",
        "echo   Motor Compilado Protegido (.exe/.pyd) + SafeDrive + Bases SQLite",
        "echo ============================================================================",
        "echo.",
        f'set "PASTA_EVOGEX={p_evo_clean}"',
        f'set "PASTA_ANTIGA={p_ant_clean}"',
        f'set "NOME_CENTRO={nome_clean}"',
        "",
        "echo [1/4] A criar estrutura unificada em \"%PASTA_EVOGEX%\" e limpar ficheiros antigos...",
        'if not exist "%PASTA_EVOGEX%" mkdir "%PASTA_EVOGEX%"',
        'if not exist "%PASTA_EVOGEX%\\motor" mkdir "%PASTA_EVOGEX%\\motor"',
        'if exist "%PASTA_EVOGEX%\\motor\\app" rmdir /s /q "%PASTA_EVOGEX%\\motor\\app"',
        'if exist "%PASTA_EVOGEX%\\motor\\venv" rmdir /s /q "%PASTA_EVOGEX%\\motor\\venv"',
        'if not exist "%PASTA_EVOGEX%\\safedrive" mkdir "%PASTA_EVOGEX%\\safedrive"',
        'if not exist "%PASTA_EVOGEX%\\index_core" mkdir "%PASTA_EVOGEX%\\index_core"',
        'if not exist "%PASTA_EVOGEX%\\BdsefaturaV4" mkdir "%PASTA_EVOGEX%\\BdsefaturaV4"',
        'if not exist "%PASTA_EVOGEX%\\logs" mkdir "%PASTA_EVOGEX%\\logs"',
        "",
        "echo [2/4] A gravar manifesto do Centro de Dados (centro_dados.json)...",
        '> "%PASTA_EVOGEX%\\centro_dados.json" (',
        '  echo {',
        '  echo   "nome": "%NOME_CENTRO%",',
        '  echo   "hostname": "%COMPUTERNAME%",',
        '  echo   "pasta_evogex": "%PASTA_EVOGEX:\\=\\%",',
        '  echo   "pasta_gexcel_antiga": "%PASTA_ANTIGA:\\=\\%",',
        '  echo   "porta_motor": 8015',
        '  echo }',
        ')',
        "",
        "echo [3/4] A transferir Motor Compilado Oficial (gevo_ef2026.exe)...",
        'powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri \'https://gexcelupdates.com/ArqPyd/execs_gevo/beta/gevo_ef2026.exe\' -OutFile \'%PASTA_EVOGEX%\\motor\\gevo_ef2026.exe\' -UseBasicParsing"',
        "",
        "echo [4/4] A registar e iniciar o Motor Compilado (Porta 8015)...",
        'set "GEXCEL_DADOS_DIR=%PASTA_EVOGEX%"',
        'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "GexcelEvoCentroDados" /t REG_SZ /d "\\"%PASTA_EVOGEX%\\motor\\gevo_ef2026.exe\\"" /f >nul 2>&1',
        'start "" /b "%PASTA_EVOGEX%\\motor\\gevo_ef2026.exe"',
        'timeout /t 3 >nul',
    ]
    conteudo_bat = "\r\n".join(bat_lines)
    headers = {
        "Content-Disposition": 'attachment; filename="Instalar_Centro_Dados_evoGex.bat"',
        "Content-Type": "application/x-bat; charset=utf-8",
    }
    return Response(content=conteudo_bat.encode("utf-8"), headers=headers, media_type="application/x-bat")


@app.post("/api/app/config/centro-dados")
def api_definir_centro_dados(
    req: AppCentroDadosRequest,
    operador: Any = Depends(validar_operador_admin)
):
    """Designa e regista o computador ou servidor principal do escritório como Centro de Dados."""
    cfg = auth_manager.registar_centro_dados(
        hostname=req.hostname,
        hardware_id=req.hardware_id or "",
        ip_local=req.ip_local or "127.0.0.1:8015",
        nome=req.nome,
        pasta_evogex=req.pasta_evogex,
        pasta_gexcel_antiga=req.pasta_gexcel_antiga,
        centro_id=req.centro_id,
    )
    _invalidar_caches_mudanca_centro()
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "config": api_obter_app_config()["config"]
    }

@app.post("/api/app/config/centro-dados/heartbeat")
def api_heartbeat_centro_dados(req: Optional[AppCentroDadosRequest] = None):
    """Atualiza o sinal de vida (heartbeat) do Centro de Dados Único do escritório."""
    import socket
    cfg_atual = auth_manager.obter_config_geral()
    hname = (req.hostname if req and req.hostname else cfg_atual.get("centro_dados_hostname")) or socket.gethostname()
    hwid = (req.hardware_id if req and req.hardware_id else cfg_atual.get("centro_dados_hwid")) or ""
    ip_loc = (req.ip_local if req and req.ip_local else cfg_atual.get("centro_dados_ip")) or "127.0.0.1:8015"
    cfg = auth_manager.registar_centro_dados(hostname=hname, hardware_id=hwid, ip_local=ip_loc)
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "config": cfg
    }

@app.get("/api/app/config")
def api_obter_app_config():
    """Retorna o estado de configuração geral da app (centros de dados nomeados, XML legado, utilizadores, pastas locais, etc.)."""
    cfg = auth_manager.obter_config_geral()
    try:
        pasta_raiz = Path(pb_client.obter_pasta_dados_raiz())
        cfg["alimentar_xml_legado"] = recibos_verdes_service.obter_alimentar_xml_legado()
        cfg["pasta_v4"] = str(pb_client.obter_pasta_v4())
        cfg["pasta_v3"] = str(pasta_raiz / "BdsefaturaV3")
        cfg["pasta_bdsrv"] = str(recibos_verdes_service.obter_pasta_bdsrv())
        cfg["pasta_pdfs"] = str(recibos_verdes_service.obter_pasta_pdfs_configurada())
    except Exception:
        cfg["alimentar_xml_legado"] = True
    cfg["versao"] = API_VERSION
    cfg["build_number"] = BUILD_NUMBER
    cfg["origem_motor"] = "cloud" if sys.platform != "win32" else "local"
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "config": cfg
    }

@app.post("/api/app/config/xml-legado")
def api_definir_xml_legado(req: AppXmlLegadoRequest):
    """Ativa ou desativa a alimentação paralela dos ficheiros XML legados do Gexcel Apps (BdsefaturaV3 e BdsRV)."""
    ativo = recibos_verdes_service.guardar_alimentar_xml_legado(req.alimentar_xml_legado)
    cfg = auth_manager.obter_config_geral()
    cfg["alimentar_xml_legado"] = ativo
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "alimentar_xml_legado": ativo,
        "config": cfg
    }

@app.post("/api/app/config/modo")
def api_definir_app_modo(
    req: AppModoRequest, 
    operador: Any = Depends(validar_operador_admin)
):
    """Altera o modo de ligação: 'integrado' (Gexcel Apps / CRM) ou 'autonomo'."""
    try:
        cfg = auth_manager.definir_modo_dados(req.modo)
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "config": cfg
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

class UnifiedEvoLoginRequest(BaseModel):
    username: str
    password: str
    appCodigo: Optional[str] = "EVO-06"


class UnifiedEvoActivateRequest(BaseModel):
    token: str
    nome: str
    username: str
    password: str
    email: Optional[str] = ""
    telefone: Optional[str] = ""
    officeName: Optional[str] = ""
    appCodigo: Optional[str] = "EVO-06"


def _forward_evo11_headers(request: Request) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    auth_h = request.headers.get("authorization")
    x_tok = request.headers.get("x-auth-token")
    if auth_h:
        headers["Authorization"] = auth_h
    if x_tok:
        headers["X-Auth-Token"] = x_tok
    return headers


def _extract_token_from_request(request: Request, query_token: str = "") -> str:
    raw = str(query_token or "").strip()
    if not raw:
        raw = str(request.headers.get("x-auth-token") or "").strip()
    if not raw:
        auth_h = str(request.headers.get("authorization") or "")
        if auth_h.lower().startswith("bearer "):
            raw = auth_h[7:].strip()
    return raw


@app.post("/api/auth/login")
def api_unified_evo_login(req: UnifiedEvoLoginRequest, request: Request):
    """Ponte de autenticação unificada SSO (EVO-11 + Canal Dev + DB Local)."""
    from fastapi.responses import JSONResponse
    u_clean = (req.username or "").strip()
    p_clean = (req.password or "").strip()
    if not u_clean or not p_clean:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Introduza o utilizador e a palavra-passe."})

    host_hdr = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").lower()
    origin_hdr = (request.headers.get("origin") or request.headers.get("referer") or "").lower()
    is_dev_channel = (
        host_hdr.startswith("dev.")
        or "://dev." in origin_hdr
        or "localhost" in host_hdr
        or "127.0.0.1" in host_hdr
        or "localhost" in origin_hdr
        or "127.0.0.1" in origin_hdr
    )

    dev_aliases = {
        "@gexcel",
        "gexcel",
        "@evogex",
        "evogex",
        "dev",
        "superadmin",
        "victor",
        "victor.dev@gexcel.pt",
        "victor@gexcel.pt",
        "gexcel2013@gmail.com",
        "admin@gexcel.pt",
    }
    dev_passwords = {"9463", "2olaalip#1", "41238886", "Gexcel#Dev2026!"}

    if u_clean.lower() in dev_aliases:
        if not is_dev_channel:
            return JSONResponse(
                status_code=403,
                content={
                    "ok": False,
                    "error": "Por motivos de segurança, as credenciais de desenvolvedor são exclusivas da consola central DEV e estão bloqueadas nas aplicações de clientes.",
                },
            )
        if p_clean in dev_passwords:
            user_info = {
                "id": 1,
                "username": "superadmin",
                "nome": "Victor Gamboa · SuperAdmin (@Gexcel)",
                "email": "gexcel2013@gmail.com",
                "role": "superadmin",
                "is_system": 1,
            }
            tok = auth_manager._criar_sessao(user_info)
            return {
                "ok": True,
                "token": tok,
                "user": {
                    "id": "1",
                    "username": "@Gexcel",
                    "nome": "Victor Gamboa · SuperAdmin (@Gexcel)",
                    "role": "DEV",
                    "email": "gexcel2013@gmail.com",
                },
            }
        return JSONResponse(status_code=401, content={"ok": False, "error": "Credenciais mestras inválidas."})

    # 1. Tentar autenticar no motor central Gexcel Auth Online (EVO-11 :8010)
    try:
        r_evo11 = requests.post(
            "http://127.0.0.1:8010/api/auth/login",
            json={"username": u_clean, "password": p_clean, "appCodigo": req.appCodigo or "EVO-06"},
            timeout=3,
        )
        data_11 = r_evo11.json()
        if r_evo11.status_code == 200 and data_11.get("ok") and data_11.get("user"):
            u11 = data_11["user"]
            role_raw = str(u11.get("role") or "OPERADOR").upper()
            local_role = "superadmin" if role_raw == "DEV" else "admin" if role_raw == "ADMIN" else "subutilizador"
            tok_11 = str(data_11.get("token") or "").strip()
            offices_11 = data_11.get("offices") or u11.get("offices") or []
            if offices_11:
                try:
                    auth_manager.sincronizar_escritorios_licenciados(offices_11)
                except Exception:
                    pass
            tok = auth_manager._criar_sessao({
                "id": 1,
                "username": str(u11.get("username") or u_clean),
                "role": local_role,
            }, token_override=tok_11 or None)
            return {
                "ok": True,
                "token": tok,
                "user": u11,
                "offices": offices_11,
            }
        err_11 = str(data_11.get("error") or data_11.get("detail") or "")
        if r_evo11.status_code == 403 or "escritório" in err_11.lower() or "desativada" in err_11.lower():
            return JSONResponse(status_code=r_evo11.status_code, content={"ok": False, "error": err_11})
    except Exception:
        pass

    # 2. Fallback para utilizadores locais da aplicação (gevo_efatura_app.db)
    try:
        res_loc = auth_manager.autenticar_utilizador(u_clean, p_clean)
        if res_loc and res_loc.get("user"):
            ul = res_loc["user"]
            role_loc = str(ul.get("role") or "subutilizador").lower()
            mapped_role = "DEV" if role_loc == "superadmin" else "ADMIN" if role_loc == "admin" else "OPERADOR"
            return {
                "ok": True,
                "token": res_loc["token"],
                "user": {
                    "id": str(ul.get("id") or "1"),
                    "username": str(ul.get("username") or u_clean),
                    "nome": str(ul.get("nome") or u_clean),
                    "role": mapped_role,
                    "email": str(ul.get("email") or ""),
                },
            }
    except PermissionError as pe:
        return JSONResponse(status_code=403, content={"ok": False, "error": str(pe)})
    except Exception:
        pass

    return JSONResponse(status_code=401, content={"ok": False, "error": "Credenciais inválidas ou utilizador não encontrado."})


@app.get("/api/auth/token/inspect")
def api_unified_evo_token_inspect(token: str = ""):
    """Encaminha a inspeção de token de convite (?token=...) para o Gexcel Auth Online (:8010)."""
    from fastapi.responses import JSONResponse
    try:
        r = requests.get(f"http://127.0.0.1:8010/api/auth/token/inspect?token={token}", timeout=3)
        return JSONResponse(status_code=r.status_code, content=r.json())
    except Exception:
        return JSONResponse(status_code=503, content={"ok": False, "error": "Serviço de validação de convites temporariamente indisponível."})


@app.post("/api/auth/token/activate")
def api_unified_evo_token_activate(req: UnifiedEvoActivateRequest):
    """Encaminha a ativação do 1.º Administrador para o Gexcel Auth Online (:8010)."""
    from fastapi.responses import JSONResponse
    try:
        r = requests.post(
            "http://127.0.0.1:8010/api/auth/token/activate",
            json=req.model_dump() if hasattr(req, "model_dump") else req.dict(),
            timeout=4,
        )
        data = r.json()
        if r.status_code == 200 and data.get("ok") and data.get("user"):
            u11 = data["user"]
            tok_11 = str(data.get("token") or "").strip()
            offices_11 = data.get("offices") or u11.get("offices") or []
            if offices_11:
                try:
                    auth_manager.sincronizar_escritorios_licenciados(offices_11)
                except Exception:
                    pass
            tok = auth_manager._criar_sessao({
                "id": 1,
                "username": str(u11.get("username") or req.username),
                "role": "admin",
            }, token_override=tok_11 or None)
            data["token"] = tok
            data["offices"] = offices_11
        return JSONResponse(status_code=r.status_code, content=data)
    except Exception:
        return JSONResponse(status_code=503, content={"ok": False, "error": "Não foi possível comunicar com o servidor de autenticação."})


@app.get("/api/auth/verify")
def api_unified_evo_verify(request: Request, token: str = ""):
    """Valida a sessão ativa (gxtk. no EVO-11 :8010 ou sessão local fallback) e sincroniza escritórios licenciados."""
    from fastapi.responses import JSONResponse
    raw_tok = _extract_token_from_request(request, token)
    if not raw_tok:
        return JSONResponse(status_code=401, content={"ok": False, "error": "Token em falta."})

    if raw_tok.startswith("gxtk."):
        try:
            r = requests.get(
                "http://127.0.0.1:8010/api/auth/verify",
                params={"token": raw_tok},
                headers=_forward_evo11_headers(request),
                timeout=3,
            )
            data = r.json()
            if r.status_code == 200 and data.get("ok"):
                offices_11 = data.get("offices") or (data.get("user") or {}).get("offices") or []
                if offices_11:
                    try:
                        auth_manager.sincronizar_escritorios_licenciados(offices_11)
                    except Exception:
                        pass
            return JSONResponse(status_code=r.status_code, content=data)
        except Exception:
            pass

    u_loc = auth_manager.validar_token_sessao(raw_tok)
    if not u_loc:
        return JSONResponse(status_code=401, content={"ok": False, "error": "Sessão inválida ou expirada."})
    role_loc = str(u_loc.get("role") or "subutilizador").lower()
    mapped_role = "DEV" if role_loc == "superadmin" else "ADMIN" if role_loc == "admin" else "OPERADOR"
    return {
        "ok": True,
        "user": {
            "id": str(u_loc.get("id") or "1"),
            "username": str(u_loc.get("username") or ""),
            "nome": str(u_loc.get("nome") or u_loc.get("username") or ""),
            "email": str(u_loc.get("email") or ""),
            "role": mapped_role,
            "client_code": str(u_loc.get("client_code") or ""),
            "centros_permitidos": u_loc.get("centros_permitidos") or ["*"],
            "offices": [],
        },
        "offices": [],
    }


@app.get("/api/auth/client/state")
def api_unified_evo_client_state(request: Request, token: str = ""):
    """Encaminha a consulta multi-escritório da conta do cliente para o EVO-11 (:8010)."""
    from fastapi.responses import JSONResponse
    try:
        r = requests.get(
            "http://127.0.0.1:8010/api/auth/client/state",
            params={"token": token} if token else None,
            headers=_forward_evo11_headers(request),
            timeout=4,
        )
        data = r.json()
        if r.status_code == 200 and data.get("ok") and data.get("offices"):
            try:
                auth_manager.sincronizar_escritorios_licenciados(data["offices"])
            except Exception:
                pass
        return JSONResponse(status_code=r.status_code, content=data)
    except Exception:
        return JSONResponse(status_code=503, content={"ok": False, "error": "Não foi possível comunicar com o servidor de licenças."})


@app.post("/api/auth/client/office/update")
def api_unified_evo_client_office_update(body: Dict[str, Any], request: Request):
    """Atualiza o nome e caminhos do escritório licenciado no EVO-11 (:8010) e sincroniza localmente."""
    from fastapi.responses import JSONResponse
    try:
        r = requests.post(
            "http://127.0.0.1:8010/api/auth/client/office/update",
            json=body,
            headers=_forward_evo11_headers(request),
            timeout=4,
        )
        data = r.json()
        if r.status_code == 200 and data.get("ok") and data.get("offices"):
            try:
                auth_manager.sincronizar_escritorios_licenciados(data["offices"])
            except Exception:
                pass
        return JSONResponse(status_code=r.status_code, content=data)
    except Exception:
        return JSONResponse(status_code=503, content={"ok": False, "error": "Não foi possível atualizar o escritório no servidor central."})


@app.post("/api/auth/client/users/save")
def api_unified_evo_client_users_save(body: Dict[str, Any], request: Request):
    """Cria/atualiza um utilizador da conta do cliente com validação de vagas por escritório no EVO-11 (:8010)."""
    from fastapi.responses import JSONResponse
    try:
        r = requests.post(
            "http://127.0.0.1:8010/api/auth/client/users/save",
            json=body,
            headers=_forward_evo11_headers(request),
            timeout=4,
        )
        return JSONResponse(status_code=r.status_code, content=r.json())
    except Exception:
        return JSONResponse(status_code=503, content={"ok": False, "error": "Não foi possível guardar o utilizador no servidor central."})


@app.post("/api/auth/client/users/delete")
def api_unified_evo_client_users_delete(body: Dict[str, Any], request: Request):
    """Elimina um utilizador não-Admin da conta do cliente no EVO-11 (:8010)."""
    from fastapi.responses import JSONResponse
    try:
        r = requests.post(
            "http://127.0.0.1:8010/api/auth/client/users/delete",
            json=body,
            headers=_forward_evo11_headers(request),
            timeout=4,
        )
        return JSONResponse(status_code=r.status_code, content=r.json())
    except Exception:
        return JSONResponse(status_code=503, content={"ok": False, "error": "Não foi possível remover o utilizador no servidor central."})


@app.post("/api/app/auth/login")
def api_app_login(req: AppLoginRequest):
    """Autentica o utilizador ou aceita a Chave Mestra do Superadministrador."""
    try:
        res = auth_manager.autenticar_utilizador(req.username, req.password)
        if not res:
            raise HTTPException(status_code=401, detail="Nome de utilizador ou palavra-passe incorretos.")
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "token": res["token"],
            "user": res["user"],
            "modo_master": res.get("modo_master", False)
        }
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/app/auth/logout")
def api_app_logout(token: Optional[str] = None):
    """Termina a sessão ativa."""
    if token:
        auth_manager.terminar_sessao(token)
    return {"status": "sucesso", "assinatura": "API Importador e-Fatura Gexcel"}

@app.get("/api/app/auth/me")
def api_app_obter_me(token: Optional[str] = None):
    """Devolve os dados do utilizador autenticado pelo token."""
    user = auth_manager.validar_token_sessao(token)
    if not user:
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada.")
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "user": user
    }

@app.get("/api/app/users")
def api_app_listar_users():
    """Lista todos os utilizadores da aplicação (excluindo contas técnicas de sistema/superadmin)."""
    users = auth_manager.listar_utilizadores(incluir_superadmin=False)
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "utilizadores": users
    }

@app.post("/api/app/users")
def api_app_criar_user(
    req: AppCriarUserRequest, 
    operador: Any = Depends(validar_operador_admin)
):
    """Cria um novo utilizador local com validação estrita de RBAC e centros permitidos."""
    try:
        user = auth_manager.criar_utilizador(
            username=req.username,
            nome=req.nome,
            password=req.password,
            role=req.role,
            email=req.email or "",
            telefone=req.telefone or "",
            centros_permitidos=req.centros_permitidos,
            caller_token=operador.get("token")
        )
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "utilizador": user
        }
    except ValueError as ve:
        raise HTTPException(status_code=403, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/app/users/{user_id}")
def api_app_atualizar_user(
    user_id: int, 
    req: AppAtualizarUserRequest, 
    operador: Any = Depends(validar_operador_admin)
):
    """Atualiza dados, perfil, centros permitidos ou palavra-passe de um utilizador com validação RBAC."""
    try:
        auth_manager.atualizar_utilizador(
            user_id=user_id,
            nome=req.nome,
            email=req.email,
            telefone=req.telefone,
            role=req.role,
            ativo=req.ativo,
            nova_password=req.nova_password,
            centros_permitidos=req.centros_permitidos,
            caller_token=operador.get("token")
        )
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "mensagem": "Utilizador atualizado com sucesso."
        }
    except ValueError as ve:
        raise HTTPException(status_code=403, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/app/users/{user_id}")
def api_app_eliminar_user(
    user_id: int, 
    operador: Any = Depends(validar_operador_admin)
):
    """Elimina um utilizador com validação RBAC e proteção contra auto-eliminação."""
    try:
        auth_manager.eliminar_utilizador(user_id, caller_token=operador.get("token"))
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "mensagem": "Utilizador removido com sucesso."
        }
    except ValueError as ve:
        raise HTTPException(status_code=403, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class StartHubMarkReadPayload(BaseModel):
    notification_ids: List[str] = []
    mark_all: bool = False


class StartHubSubmitRatingPayload(BaseModel):
    stars: int = 5
    comment: Optional[str] = ""
    app_version: Optional[str] = ""
    version_context: Optional[str] = "ATUAL"
    operator_name: Optional[str] = ""
    client_nif: Optional[str] = ""
    client_name: Optional[str] = ""
    office_id: Optional[str] = ""
    dificuldades: List[str] = []
    frequencia: Optional[str] = ""
    pediu_contacto: bool = False
    contacto_nome: Optional[str] = ""
    contacto_telefone: Optional[str] = ""
    contacto_email: Optional[str] = ""
    horario_preferencial: Optional[str] = ""


class StartHubSubmitLogicReportPayload(BaseModel):
    category: str = "REGRA_EFATURA"
    subject: str
    expected_behavior: str
    actual_behavior: Optional[str] = ""
    app_version: Optional[str] = ""
    version_context: Optional[str] = "ATUAL"
    operator_name: Optional[str] = ""
    client_nif: Optional[str] = ""
    client_name: Optional[str] = ""
    office_id: Optional[str] = ""
    pediu_contacto: bool = True
    contacto_nome: Optional[str] = ""
    contacto_telefone: Optional[str] = ""
    contacto_email: Optional[str] = ""
    horario_preferencial: Optional[str] = ""


@app.get("/api/start-hub/overview")
def api_evo06_start_hub_overview(refresh: bool = False):
    return start_hub_evo06.start_hub_evo06.get_overview(refresh_remote=refresh)


@app.post("/api/start-hub/notifications/read")
def api_evo06_start_hub_mark_read(payload: StartHubMarkReadPayload):
    return start_hub_evo06.start_hub_evo06.mark_notifications_read(
        notification_ids=payload.notification_ids,
        mark_all=payload.mark_all,
    )


@app.post("/api/start-hub/rating")
def api_evo06_start_hub_rating(payload: StartHubSubmitRatingPayload):
    try:
        return start_hub_evo06.start_hub_evo06.submit_rating(
            stars=payload.stars,
            comment=payload.comment or "",
            app_version=payload.app_version or "",
            version_context=payload.version_context or "ATUAL",
            operator_name=payload.operator_name or "",
            client_nif=payload.client_nif or "",
            client_name=payload.client_name or "",
            office_id=payload.office_id or "",
            dificuldades=payload.dificuldades,
            frequencia=payload.frequencia or "",
            pediu_contacto=bool(payload.pediu_contacto),
            contacto_nome=payload.contacto_nome or "",
            contacto_telefone=payload.contacto_telefone or "",
            contacto_email=payload.contacto_email or "",
            horario_preferencial=payload.horario_preferencial or "",
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@app.post("/api/start-hub/report-logic")
def api_evo06_start_hub_report_logic(payload: StartHubSubmitLogicReportPayload):
    try:
        return start_hub_evo06.start_hub_evo06.submit_logic_report(
            category=payload.category,
            subject=payload.subject,
            expected_behavior=payload.expected_behavior,
            actual_behavior=payload.actual_behavior or "",
            app_version=payload.app_version or "",
            version_context=payload.version_context or "ATUAL",
            operator_name=payload.operator_name or "",
            client_nif=payload.client_nif or "",
            client_name=payload.client_name or "",
            office_id=payload.office_id or "",
            pediu_contacto=bool(payload.pediu_contacto),
            contacto_nome=payload.contacto_nome or "",
            contacto_telefone=payload.contacto_telefone or "",
            contacto_email=payload.contacto_email or "",
            horario_preferencial=payload.horario_preferencial or "",
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

@app.post("/api/app/setup-inicial")
def api_app_setup_inicial(req: AppSetupInicialRequest):
    """Cria o primeiro Administrador local da entidade."""
    try:
        res = auth_manager.executar_setup_inicial(
            nome_admin=req.nome_admin,
            username_admin=req.username_admin,
            password_admin=req.password_admin,
            email_admin=req.email_admin or ""
        )
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "resultado": res
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =============================================================================
# ENDPOINTS UNIFICADOS DE ANULADOS E INCONFORMIDADES FORENSES
# =============================================================================

class SincronizarAnuladasLoteRequest(BaseModel):
    nifs: List[str] = Field(default_factory=list, description="Lista de NIFs ou vazio/['TODOS'] para todas as entidades")
    ano: int = Field(default_factory=lambda: date.today().year)
    mes: Optional[int] = Field(default=None, description="Mês específico (1-12) ou None para o ano completo")
    modulo: str = Field(default="ambos", description="'compras', 'vendas' ou 'ambos'")

@app.get("/api/anuladas")
def api_consultar_anuladas(
    nif: str = "",
    modulo: str = "",
    filtro_origem: str = "todos",
    origem_filtro: str = "",
    data_inicio: str = "",
    data_fim: str = "",
    pesquisa: str = "",
    ordenar_por: str = "data_emissao",
    ordem: str = "desc",
    limite: int = 250,
    offset: int = 0
):
    """
    Endpoint oficial unificado para a Aba dos Anulados:
    Combina faturas anuladas na origem (anuladas_{NIF}.db / compras / vendas)
    com inconformidades forenses de anulação tardia (N -> A no CofreEstadosLedger).
    """
    try:
        f_orig = origem_filtro if origem_filtro else filtro_origem
        dados = pb_client.consultar_anuladas(
            nif=nif,
            modulo=modulo,
            filtro_origem=f_orig,
            data_inicio=data_inicio,
            data_fim=data_fim,
            pesquisa=pesquisa,
            ordenar_por=ordenar_por,
            ordem=ordem,
            limite=limite,
            offset=offset
        )
        return {
            "status": "ok",
            "assinatura": "API Importador e-Fatura Gexcel",
            **dados
        }
    except Exception as e:
        LOGGER.error(f"Erro na rota /api/anuladas: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/anuladas/sincronizar-lote")
def api_sincronizar_anuladas_lote(req: SincronizarAnuladasLoteRequest, lic = Depends(verificar_licenca_ativa)):
    """Agenda na fila de segundo plano a sincronização de faturas anuladas na AT para as entidades selecionadas."""
    import calendar
    try:
        entidades_ui = pb_client.get_lista_entidades_ui()
        mapa_nomes = {str(e.get("nif") or "").strip(): str(e.get("nomecli") or "").strip() for e in entidades_ui}
        if not req.nifs or "TODOS" in [str(x).upper() for x in req.nifs]:
            nifs_alvo = [str(e.get("nif") or "").strip() for e in entidades_ui if e.get("tem_credenciais_at")]
        else:
            nifs_alvo = [re.sub(r"[^0-9]", "", str(n)).strip()[:9] for n in req.nifs if re.sub(r"[^0-9]", "", str(n)).strip()]

        if req.mes and 1 <= int(req.mes) <= 12:
            ult_dia = calendar.monthrange(int(req.ano), int(req.mes))[1]
            d_ini = f"{int(req.ano):04d}-{int(req.mes):02d}-01"
            d_fim = f"{int(req.ano):04d}-{int(req.mes):02d}-{ult_dia:02d}"
        else:
            d_ini = f"{int(req.ano):04d}-01-01"
            d_fim = f"{int(req.ano):04d}-12-31"

        mod_clean = str(req.modulo or "ambos").strip().lower()
        modulos = ["compras", "vendas"] if mod_clean in ("ambos", "tudo", "all") else (["vendas"] if mod_clean == "vendas" else ["compras"])

        tarefas_criadas = 0
        for n_alvo in nifs_alvo:
            for m_str in modulos:
                pipeline_worker.adicionar_tarefa(
                    nif=n_alvo,
                    nome_entidade=mapa_nomes.get(n_alvo, ""),
                    modulo=m_str,
                    data_inicio=d_ini,
                    data_fim=d_fim,
                    tipo_tarefa="scrape_anuladas",
                    prioridade=3
                )
                tarefas_criadas += 1

        if tarefas_criadas > 0:
            pipeline_worker.garantir_worker_ativo()

        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "tarefas_agendadas": tarefas_criadas,
            "periodo": {"data_inicio": d_ini, "data_fim": d_fim},
            "mensagem": f"{tarefas_criadas} tarefa(s) de sincronização de anuladas adicionada(s) à fila."
        }
    except Exception as e:
        LOGGER.error(f"Erro ao sincronizar lote de anuladas: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# ENDPOINTS DE RECIBOS VERDES E RENDAS (SCR-03 / BdsRV)
# =============================================================================
import recibos_verdes_service

class RecibosVerdesExtracaoRequest(BaseModel):
    nif: str = Field(..., description="NIF da entidade a extrair")
    nome_entidade: Optional[str] = Field(default="")
    ano: int = Field(default_factory=lambda: date.today().year)
    tipo: str = Field(default="compras", description="'compras' (Adquirente/Locatário) ou 'vendas' (Prestador/Locador)")
    incluir_rv: bool = Field(default=True, description="Extrair Recibos Verdes (Fatura-Recibo / Fatura / Recibo)")
    incluir_rendas: bool = Field(default=True, description="Extrair Recibos de Renda (RECIBO-RENDA)")
    baixar_pdfs: bool = Field(default=False, description="Descarregar os PDFs oficiais dos Recibos Verdes e Rendas")
    pasta_pdfs: Optional[str] = Field(default=None, description="Pasta destino para os PDFs")
    id_contab: Optional[str] = Field(default="", description="Código IdContab para o nome dos ficheiros PDF")
    reimportar_tudo: bool = Field(default=False, description="Forçar reimportação completa de todos os detalhes")
    gerar_xml_legado: Optional[bool] = Field(default=None, description="Alimentar em simultâneo o XML legado BdsRV do Gexcel Apps")
    apenas_ano_corrente_rendas: bool = Field(default=False)

class RecibosVerdesConfigRequest(BaseModel):
    pasta_pdfs: Optional[str] = Field(default=None, description="Caminho da pasta onde guardar os PDFs de Recibos Verdes e Rendas")
    alimentar_xml_legado: Optional[bool] = Field(default=None, description="Alimentar ficheiros XML legados do Gexcel Apps (BdsefaturaV3 e BdsRV)")

class RecibosVerdesLimparRequest(BaseModel):
    nif: Optional[str] = None
    ano: Optional[int] = None
    tipo: str = "ambos"

@app.get("/api/recibos-verdes/config")
def api_obter_config_rv():
    """Retorna os caminhos configurados para BdsefaturaV4 (SQLite), BdsRV (XML) e BdsRV_PDFs (PDFs)."""
    return {
        "status": "ok",
        "assinatura": "API Importador e-Fatura Gexcel",
        "pasta_v4": str(pb_client.obter_pasta_v4()),
        "pasta_bdsrv": str(recibos_verdes_service.obter_pasta_bdsrv()),
        "pasta_pdfs": recibos_verdes_service.obter_pasta_pdfs_configurada(),
        "alimentar_xml_legado": recibos_verdes_service.obter_alimentar_xml_legado(),
        "scraper_disponivel": recibos_verdes_service.SCRAPER_RV_DISPONIVEL
    }

@app.post("/api/recibos-verdes/config")
def api_guardar_config_rv(req: RecibosVerdesConfigRequest):
    """Atualiza a pasta destino dos PDFs e/ou a preferência de alimentação do XML legado."""
    nova_pasta = recibos_verdes_service.obter_pasta_pdfs_configurada()
    if req.pasta_pdfs is not None:
        nova_pasta = recibos_verdes_service.guardar_pasta_pdfs_configurada(req.pasta_pdfs)
    if req.alimentar_xml_legado is not None:
        recibos_verdes_service.guardar_alimentar_xml_legado(req.alimentar_xml_legado)
    recibos_verdes_service.invalidar_cache_xml()
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "pasta_pdfs": nova_pasta,
        "pasta_v4": str(pb_client.obter_pasta_v4()),
        "pasta_bdsrv": str(recibos_verdes_service.obter_pasta_bdsrv()),
        "alimentar_xml_legado": recibos_verdes_service.obter_alimentar_xml_legado(),
        "mensagem": "Configurações de Recibos Verdes e Rendas atualizadas com sucesso."
    }

@app.get("/api/recibos-verdes/matriz/{ano}")
def api_obter_matriz_rv(ano: int, tipo: str = "compras"):
    """Retorna a matriz anual (12 meses) de Recibos Verdes e Rendas por entidade."""
    try:
        return recibos_verdes_service.obter_matriz_anual_rv(ano=ano, tipo=tipo)
    except Exception as e:
        LOGGER.error(f"Erro em /api/recibos-verdes/matriz/{ano}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/recibos-verdes/consultar")
def api_consultar_documentos_rv(
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
):
    """Consulta detalhada de Recibos Verdes e Recibos de Renda com filtros e paginação."""
    try:
        return recibos_verdes_service.consultar_documentos_rv(
            tipo=tipo,
            nif=nif,
            ano=ano,
            mes=mes,
            categoria=categoria,
            tipo_doc=tipo_doc,
            situacao=situacao,
            apenas_ano_emissao=apenas_ano_emissao,
            pesquisa=pesquisa,
            limite=limite,
            offset=offset,
            ordenar_por=ordenar_por,
            ordem=ordem
        )
    except Exception as e:
        LOGGER.error(f"Erro em /api/recibos-verdes/consultar: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/recibos-verdes/iniciar")
def api_iniciar_extracao_rv(req: RecibosVerdesExtracaoRequest, lic = Depends(verificar_licenca_ativa)):
    """Inicia um job assíncrono de extração de Recibos Verdes e Rendas (+ download opcional de PDFs)."""
    _limpar_jobs_antigos()
    nif_clean = re.sub(r"[^0-9]", "", str(req.nif or "")).strip()[:9]
    if not nif_clean:
        raise HTTPException(status_code=400, detail="NIF inválido.")

    job_id = str(uuid.uuid4())
    JOBS[job_id] = {
        "status": "em_progresso",
        "nif": req.nif,
        "nome_empresa": req.nome_entidade or "",
        "mensagem": "Na fila de espera para Recibos Verdes e Rendas...",
        "volume_estimado": 15,
        "docs_atuais": 0,
        "total_esperado": 0,
        "percentagem": 5,
        "parcial": False,
        "cancelar": False,
        "total_documentos": 0,
        "dados_legacy_horizontal": None,
        "dados_novos_vertical": None,
        "erro": None,
        "tipo_erro": None,
        "badge_label": None,
        "criado_em": time.time(),
    }

    t = threading.Thread(
        target=workspace_context.wrap_thread_target(recibos_verdes_service.executar_job_recibos_verdes),
        kwargs={
            "job_id": job_id,
            "jobs_dict": JOBS,
            "concurrency_manager": CONCURRENCY_MANAGER,
            "nif": nif_clean,
            "ano": int(req.ano),
            "tipo": req.tipo,
            "incluir_rv": bool(req.incluir_rv),
            "incluir_rendas": bool(req.incluir_rendas),
            "baixar_pdfs": bool(req.baixar_pdfs),
            "pasta_pdfs": req.pasta_pdfs,
            "id_contab": req.id_contab or "",
            "reimportar_tudo": bool(req.reimportar_tudo),
            "gerar_xml_legado": req.gerar_xml_legado,
            "apenas_ano_corrente_rendas": bool(req.apenas_ano_corrente_rendas),
            "headless": True,
        },
        daemon=True
    )
    t.start()

    return {
        "status": "iniciado",
        "assinatura": "API Importador e-Fatura Gexcel",
        "job_id": job_id,
        "nif": nif_clean,
        "ano": req.ano,
        "tipo": req.tipo,
        "mensagem": "Extração de Recibos Verdes e Rendas iniciada."
    }

@app.post("/api/recibos-verdes/limpar")
def api_limpar_dados_rv(req: RecibosVerdesLimparRequest):
    """Elimina ficheiros XML BdsRV da entidade/ano solicitados."""
    apagados = recibos_verdes_service.limpar_dados_rv(nif=req.nif, ano=req.ano, tipo=req.tipo)
    return {
        "status": "sucesso",
        "assinatura": "API Importador e-Fatura Gexcel",
        "ficheiros_apagados": apagados,
        "mensagem": f"{apagados} ficheiro(s) XML eliminado(s) com sucesso."
    }


# =============================================================================
# ENDPOINTS DE PENDENTES E-FATURA (CLASSIFICAÇÃO DE SETORES E ÂMBITO)
# =============================================================================

class PendentesModoTudoForaRequest(BaseModel):
    nifs: List[str]
    ativo: bool
    ano: int = Field(default_factory=lambda: date.today().year)
    aplicar_existentes: bool = True

class PendentesRecolherLoteRequest(BaseModel):
    nifs: List[str] = Field(default_factory=list)
    ano: int = Field(default_factory=lambda: date.today().year)
    forcar_historico_anterior: bool = False

class PendentesClassificarRequest(BaseModel):
    escopo: str = Field(default="documento", description="'documento', 'selecionados', 'fornecedor_cliente', 'tudo_fora_cliente'")
    ano: int = Field(default_factory=lambda: date.today().year)
    nif_cliente: str = ""
    id_documento: str = ""
    chaves_selecionadas: List[str] = Field(default_factory=list)
    nif_emitente: str = ""
    setor_codigo: Optional[str] = None
    ambito_codigo: Optional[str] = None

class PendentesValidarRequest(BaseModel):
    escopo: str = Field(default="documento", description="'documento', 'selecionados', 'fornecedor_cliente', 'cliente_preenchidos'")
    acao: str = Field(default="validar", description="'validar' ou 'desvalidar'")
    ano: int = Field(default_factory=lambda: date.today().year)
    nif_cliente: str = ""
    id_documento: str = ""
    chaves_selecionadas: List[str] = Field(default_factory=list)
    nif_emitente: str = ""
    utilizador: str = ""

class PendentesSubmeterRequest(BaseModel):
    ano: int = Field(default_factory=lambda: date.today().year)
    nifs: Optional[List[str]] = None
    termo_aceite: bool = False
    texto_termo: str = ""
    utilizador: str = ""
    email_utilizador: str = ""
    modo_simulacao: bool = False
    modo_ensaio_visivel: bool = False

class PendentesPalavraChaveRequest(BaseModel):
    palavra: str
    setor_codigo: str
    ambito_codigo: str = ""


@app.get("/api/pendentes/catalogo")
def api_pendentes_catalogo():
    """Retorna os 16 setores da AT, os 3 âmbitos e as palavras-chave configuradas."""
    try:
        cat = pendentes_service.obter_catalogo()
        return {
            "status": "ok",
            "assinatura": "API Importador e-Fatura Gexcel",
            **cat,
        }
    except Exception as e:
        LOGGER.error(f"Erro em /api/pendentes/catalogo: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/pendentes/entidades")
def api_pendentes_entidades(ano: int = Query(default_factory=lambda: date.today().year)):
    """Lista entidades singulares elegíveis para classificação de pendentes no exercício."""
    try:
        entidades = pendentes_service.listar_entidades_pendentes(ano=ano)
        return {
            "status": "ok",
            "assinatura": "API Importador e-Fatura Gexcel",
            "ano": int(ano),
            "entidades": entidades,
        }
    except Exception as e:
        LOGGER.error(f"Erro em /api/pendentes/entidades: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/pendentes/entidades/modo-tudo-fora")
def api_pendentes_modo_tudo_fora(req: PendentesModoTudoForaRequest):
    """Ativa/desativa o modo Tudo Fora para entidades sem movimento ou tudo pessoal."""
    try:
        res = pendentes_service.definir_modo_tudo_fora(
            nifs=req.nifs,
            ativo=bool(req.ativo),
            ano=int(req.ano),
            aplicar_existentes=bool(req.aplicar_existentes),
        )
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            **res,
        }
    except Exception as e:
        LOGGER.error(f"Erro em /api/pendentes/entidades/modo-tudo-fora: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/pendentes/recolher-lote")
def api_pendentes_recolher_lote(req: PendentesRecolherLoteRequest, lic = Depends(verificar_licenca_ativa)):
    """Inicia em segundo plano a recolha de pendentes e histórico para os clientes singulares selecionados."""
    _limpar_jobs_antigos()
    if iniciar_sessao_efatura is None or EFaturaCompras is None:
        _tentar_importar_scraper()

    nifs_alvo = [pendentes_service.limpar_nif(n) for n in (req.nifs or []) if pendentes_service.is_nif_singular(n)]
    if not nifs_alvo:
        ents = pendentes_service.listar_entidades_pendentes(ano=req.ano)
        nifs_alvo = [e["nif"] for e in ents if e.get("tem_credenciais_at")]

    if not nifs_alvo:
        raise HTTPException(status_code=400, detail="Nenhum contribuinte singular com credenciais AT disponíveis.")

    job_id = str(uuid.uuid4())
    JOBS[job_id] = {
        "status": "em_progresso",
        "nif": nifs_alvo[0],
        "nome_empresa": f"{len(nifs_alvo)} contribuinte(s)",
        "mensagem": f"A iniciar recolha de pendentes ({len(nifs_alvo)} cliente(s))...",
        "volume_estimado": len(nifs_alvo) * 30,
        "docs_atuais": 0,
        "total_esperado": len(nifs_alvo),
        "percentagem": 2,
        "fase": "pendentes_recolha",
        "parcial": False,
        "cancelar": False,
        "total_documentos": 0,
        "dados_legacy_horizontal": None,
        "dados_novos_vertical": None,
        "erro": None,
        "tipo_erro": None,
        "badge_label": None,
        "criado_em": time.time(),
    }

    t = threading.Thread(
        target=workspace_context.wrap_thread_target(pendentes_service.executar_job_recolha_pendentes),
        kwargs={
            "job_id": job_id,
            "jobs_dict": JOBS,
            "nifs": nifs_alvo,
            "ano": int(req.ano),
            "forcar_historico_anterior": bool(req.forcar_historico_anterior),
            "iniciar_sessao_fn": iniciar_sessao_efatura,
            "efatura_compras_cls": EFaturaCompras,
            "browser_semaphore": _BROWSER_SESSION_SEMAPHORE,
        },
        daemon=True,
    )
    t.start()

    return {
        "status": "iniciado",
        "assinatura": "API Importador e-Fatura Gexcel",
        "job_id": job_id,
        "total_clientes": len(nifs_alvo),
        "mensagem": f"Recolha e pré-classificação iniciadas para {len(nifs_alvo)} cliente(s).",
    }


@app.get("/api/pendentes/documentos")
def api_pendentes_documentos(
    ano: int = Query(default_factory=lambda: date.today().year),
    nifs: str = "",
    filtro_rapido: str = "todos",
    pesquisa: str = "",
    ordenar_por: str = "grupo_cliente_fornecedor",
    ordem: str = "asc",
):
    """Consulta a tabela única corrida multi-cliente de documentos pendentes e KPIs."""
    try:
        lista_nifs = [x.strip() for x in (nifs or "").split(",") if x.strip()]
        dados = pendentes_service.consultar_pendentes(
            ano=int(ano),
            nifs=lista_nifs or None,
            filtro_rapido=filtro_rapido,
            pesquisa=pesquisa,
            ordenar_por=ordenar_por,
            ordem=ordem,
        )
        return {
            "status": "ok",
            "assinatura": "API Importador e-Fatura Gexcel",
            **dados,
        }
    except Exception as e:
        LOGGER.error(f"Erro em /api/pendentes/documentos: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/pendentes/classificar")
def api_pendentes_classificar(req: PendentesClassificarRequest):
    """Classifica linha, seleção ou fornecedor inteiro em bloco num cliente."""
    try:
        res = pendentes_service.classificar_documentos(
            escopo=req.escopo,
            ano=int(req.ano),
            nif_cliente=req.nif_cliente,
            id_documento=req.id_documento,
            chaves_selecionadas=req.chaves_selecionadas,
            nif_emitente=req.nif_emitente,
            setor_codigo=req.setor_codigo,
            ambito_codigo=req.ambito_codigo,
        )
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            **res,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        LOGGER.error(f"Erro em /api/pendentes/classificar: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/pendentes/validar")
def api_pendentes_validar(req: PendentesValidarRequest):
    """Aprova ou desmarca documentos completos (individual, fornecedor ou preenchidos de um cliente)."""
    try:
        res = pendentes_service.validar_documentos(
            escopo=req.escopo,
            acao=req.acao,
            ano=int(req.ano),
            nif_cliente=req.nif_cliente,
            id_documento=req.id_documento,
            chaves_selecionadas=req.chaves_selecionadas,
            nif_emitente=req.nif_emitente,
            utilizador=req.utilizador,
        )
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            **res,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        LOGGER.error(f"Erro em /api/pendentes/validar: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/pendentes/submeter")
def api_pendentes_submeter(req: PendentesSubmeterRequest, request: Request, lic = Depends(verificar_licenca_ativa)):
    """Regista o Termo de Responsabilidade legal e dispara a submissão dos documentos validados na AT (ou Ensaio Visual DEV sem submeter)."""
    _limpar_jobs_antigos()
    if iniciar_sessao_efatura is None:
        _tentar_importar_scraper()

    if req.modo_ensaio_visivel:
        if not req.termo_aceite:
            raise HTTPException(status_code=400, detail="É obrigatório confirmar o formulário antes de iniciar o ensaio visual.")

        docs_prontos = pendentes_service.obter_documentos_prontos_submissao(
            ano=int(req.ano),
            nifs=req.nifs,
        )
        if not docs_prontos:
            raise HTTPException(status_code=400, detail="Não existem documentos validados pendentes para simular na AT.")

        nifs_ensaio = sorted({d["nif_cliente"] for d in docs_prontos})
        job_id = str(uuid.uuid4())
        JOBS[job_id] = {
            "status": "em_progresso",
            "nif": nifs_ensaio[0] if nifs_ensaio else "",
            "nome_empresa": f"{len(nifs_ensaio)} contribuinte(s)",
            "mensagem": f"A iniciar ensaio visual na AT ({len(docs_prontos)} documento(s) — submissão bloqueada)...",
            "volume_estimado": len(docs_prontos),
            "docs_atuais": 0,
            "total_esperado": len(docs_prontos),
            "percentagem": 2,
            "fase": "pendentes_ensaio_visivel",
            "parcial": False,
            "cancelar": False,
            "total_documentos": 0,
            "dados_legacy_horizontal": None,
            "dados_novos_vertical": None,
            "erro": None,
            "tipo_erro": None,
            "badge_label": None,
            "criado_em": time.time(),
            "modo_ensaio_visivel": True,
            "ensaio_url": "https://faturas.portaldasfinancas.gov.pt/resolverListaPendenciasAdquirenteForm.action",
            "ensaio_passo_atual": "A preparar sessão de ensaio visual...",
            "ensaio_frame_b64": "",
            "ensaio_paginas_b64": [],
            "ensaio_itens": [],
            "janela_nativa_aberta": bool(sys.platform == "win32"),
        }

        t = threading.Thread(
            target=workspace_context.wrap_thread_target(pendentes_service.executar_job_ensaio_visivel_pendentes),
            kwargs={
                "job_id": job_id,
                "jobs_dict": JOBS,
                "ano": int(req.ano),
                "nifs": req.nifs,
                "iniciar_sessao_fn": iniciar_sessao_efatura,
                "browser_semaphore": _BROWSER_SESSION_SEMAPHORE,
            },
            daemon=True,
        )
        t.start()

        return {
            "status": "iniciado",
            "assinatura": "API Importador e-Fatura Gexcel",
            "job_id": job_id,
            "modo_ensaio_visivel": True,
            "total_documentos": len(docs_prontos),
            "mensagem": f"Ensaio visual iniciado ({len(docs_prontos)} documento(s) — submissão bloqueada).",
        }

    ip_cli = ""
    try:
        xff = request.headers.get("x-forwarded-for", "").strip()
        ip_cli = xff.split(",")[0].strip() if xff else (request.client.host if request.client else "")
    except Exception:
        ip_cli = ""

    try:
        reg_termo = pendentes_service.registar_termo_responsabilidade(
            ano=int(req.ano),
            termo_aceite=bool(req.termo_aceite),
            texto_termo=req.texto_termo,
            utilizador=req.utilizador,
            email_utilizador=req.email_utilizador,
            ip_origem=ip_cli,
            nifs=req.nifs,
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    job_id = str(uuid.uuid4())
    JOBS[job_id] = {
        "status": "em_progresso",
        "nif": reg_termo["nifs"][0] if reg_termo["nifs"] else "",
        "nome_empresa": f"{len(reg_termo['nifs'])} contribuinte(s)",
        "mensagem": f"A submeter {reg_termo['total_documentos']} documento(s) validado(s) na AT...",
        "volume_estimado": reg_termo["total_documentos"],
        "docs_atuais": 0,
        "total_esperado": reg_termo["total_documentos"],
        "percentagem": 2,
        "fase": "pendentes_submissao",
        "parcial": False,
        "cancelar": False,
        "total_documentos": 0,
        "dados_legacy_horizontal": None,
        "dados_novos_vertical": None,
        "erro": None,
        "tipo_erro": None,
        "badge_label": None,
        "criado_em": time.time(),
    }

    t = threading.Thread(
        target=workspace_context.wrap_thread_target(pendentes_service.executar_job_submissao_pendentes),
        kwargs={
            "job_id": job_id,
            "jobs_dict": JOBS,
            "ano": int(req.ano),
            "termo_id": reg_termo["termo_id"],
            "nifs": req.nifs,
            "modo_simulacao": bool(req.modo_simulacao),
            "iniciar_sessao_fn": iniciar_sessao_efatura,
            "browser_semaphore": _BROWSER_SESSION_SEMAPHORE,
        },
        daemon=True,
    )
    t.start()

    return {
        "status": "iniciado",
        "assinatura": "API Importador e-Fatura Gexcel",
        "job_id": job_id,
        "termo_id": reg_termo["termo_id"],
        "resumo_sha256": reg_termo["resumo_sha256"],
        "total_documentos": reg_termo["total_documentos"],
        "mensagem": f"Termo registado e submissão iniciada ({reg_termo['total_documentos']} documento(s)).",
    }


@app.get("/api/pendentes/ensaio-status/{job_id}")
def api_pendentes_ensaio_status(job_id: str):
    """Devolve estado, transmissao visual e capturas completas do Ensaio Visual DEV na AT."""
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Sessão de ensaio visual não encontrada ou expirada.")
    return {
        "status": job.get("status", "em_progresso"),
        "assinatura": "API Importador e-Fatura Gexcel",
        "percentagem": int(job.get("percentagem") or 0),
        "mensagem": job.get("mensagem") or "",
        "erro": job.get("erro"),
        "docs_atuais": int(job.get("docs_atuais") or 0),
        "total_esperado": int(job.get("total_esperado") or 0),
        "ensaio_url": job.get("ensaio_url") or "",
        "ensaio_passo_atual": job.get("ensaio_passo_atual") or "",
        "ensaio_frame_b64": job.get("ensaio_frame_b64") or "",
        "ensaio_paginas_b64": job.get("ensaio_paginas_b64") or [],
        "ensaio_itens": job.get("ensaio_itens") or [],
        "janela_nativa_aberta": bool(job.get("janela_nativa_aberta")),
    }


@app.get("/api/pendentes/termos-historico")
def api_pendentes_termos_historico(limite: int = 100):
    """Consulta o registo de auditoria de termos de responsabilidade aceites."""
    try:
        termos = pendentes_service.listar_termos_responsabilidade(limite=limite)
        return {
            "status": "ok",
            "assinatura": "API Importador e-Fatura Gexcel",
            "termos": termos,
        }
    except Exception as e:
        LOGGER.error(f"Erro em /api/pendentes/termos-historico: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/pendentes/palavras-chave")
def api_pendentes_guardar_palavra_chave(req: PendentesPalavraChaveRequest):
    """Adiciona ou atualiza regra de palavra-chave para pré-classificação."""
    try:
        item = pendentes_service.guardar_palavra_chave(
            palavra=req.palavra,
            setor_codigo=req.setor_codigo,
            ambito_codigo=req.ambito_codigo,
        )
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "item": item,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        LOGGER.error(f"Erro em /api/pendentes/palavras-chave: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/pendentes/palavras-chave/{kw_id}")
def api_pendentes_eliminar_palavra_chave(kw_id: int):
    """Remove uma palavra-chave da pré-classificação."""
    try:
        ok = pendentes_service.eliminar_palavra_chave(kw_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Palavra-chave não encontrada.")
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "removida": True,
        }
    except HTTPException:
        raise
    except Exception as e:
        LOGGER.error(f"Erro ao eliminar palavra-chave {kw_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# PONTE LOCAL PARA ABRIR FICHEIROS E PASTAS NO EXPLORADOR DO WINDOWS
# =============================================================================
class AbrirExploradorRequest(BaseModel):
    caminho: str = Field(..., description="Caminho absoluto da pasta ou ficheiro a abrir no Windows Explorer")

@app.post("/api/sistema/abrir-explorador")
def api_abrir_explorador_windows(req: AbrirExploradorRequest):
    """Abre a pasta no Explorador do Windows ou seleciona o ficheiro indicado."""
    caminho_raw = str(req.caminho or "").strip()
    if not caminho_raw:
        raise HTTPException(status_code=400, detail="Caminho vazio.")

    p = Path(caminho_raw)
    try:
        if sys.platform == "win32":
            if p.exists() and p.is_file():
                subprocess.Popen(["explorer.exe", f"/select,{str(p)}"])
            elif p.exists() and p.is_dir():
                os.startfile(str(p))
            elif p.parent.exists():
                os.startfile(str(p.parent))
            else:
                p.mkdir(parents=True, exist_ok=True)
                os.startfile(str(p))
        return {
            "status": "sucesso",
            "assinatura": "API Importador e-Fatura Gexcel",
            "caminho": str(p)
        }
    except Exception as e:
        LOGGER.error(f"Erro ao abrir explorador em {caminho_raw}: {e}")
        raise HTTPException(status_code=500, detail=f"Não foi possível abrir o Explorador: {e}")


@app.post("/api/sistema/desligar")
@app.post("/api/sistema/shutdown")
def api_sistema_shutdown():
    """Permite aos clientes (VBA / Desktop) solicitar um encerramento limpo do motor."""
    def _graceful_exit():
        time.sleep(0.5)
        LOGGER.info("Encerramento limpo solicitado via API.")
        os._exit(0)
    threading.Thread(target=_graceful_exit, daemon=True).start()
    return {
        "status": "ok",
        "assinatura": "API Importador e-Fatura Gexcel",
        "mensagem": "Motor em processo de encerramento controlado."
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8015"))
    uvicorn.run(app, host="127.0.0.1", port=port)








