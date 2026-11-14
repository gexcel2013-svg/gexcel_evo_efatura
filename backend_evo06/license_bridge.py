# -*- coding: utf-8 -*-
"""
Módulo de Integração com o Gexcel Auth Oficial (Bridge Headless).
Executa validação silenciosa (Cache-First + Subprocesso Headless),
com auto-recuperação do executável via PocketBase caso em falta.
"""

import os
import sys
import json
import time
import logging
from datetime import date
import subprocess
import urllib.request
import urllib.error

APP_ID = "efaturaV4api"
POCKETBASE_URL = "https://licencas.evogex.com/api/collections/versoes_appsGexcel/records"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 GexcelAuth/1.6.22"
LOGGER = logging.getLogger("gexcel.efatura")

# Período de Transição 2026: Permite execução sob a licença clássica do Excel até ao final do ano
DATA_LIMITE_TRANSICAO = date(2026, 12, 31)

# Cache em memória volátil da API para evitar chamadas de processo redundantes a cada segundo
_MEM_CACHE = {
    "resultado": None,
    "expira_em": 0
}

def obter_caminho_gexcel_auth() -> str:
    """Retorna o caminho padrão oficial do gexcel_auth.exe em %LOCALAPPDATA%\\GExcelAYD."""
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if not local_app_data:
        local_app_data = os.path.expanduser("~\\AppData\\Local")
    
    caminho_padrao = os.path.join(local_app_data, "GExcelAYD", "gexcel_auth.exe")
    return caminho_padrao

def garantir_gexcel_auth_instalado() -> str:
    """
    Garante que o executável oficial gexcel_auth.exe existe em GExcelAYD.
    Se não existir (ex: máquina nova ou limpeza acidental), descarrega
    automaticamente da coleção PocketBase versoes_appsGexcel.
    """
    caminho_exe = obter_caminho_gexcel_auth()
    if os.path.exists(caminho_exe):
        LOGGER.info("Gexcel Auth encontrado no caminho esperado")
        return caminho_exe

    pasta_ayd = os.path.dirname(caminho_exe)
    os.makedirs(pasta_ayd, exist_ok=True)

    print("[GEXCEL AUTH] Executável oficial não encontrado em GExcelAYD. A iniciar auto-recuperação via PocketBase...")
    LOGGER.warning("Gexcel Auth ausente; a iniciar auto-recuperação")
    url_consulta = f"{POCKETBASE_URL}?filter=(codApp=%27gexcel_auth%27)"
    try:
        req = urllib.request.Request(url_consulta, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            items = data.get("items", [])
            if not items or "url_download" not in items[0]:
                raise RuntimeError("Registo de gexcel_auth não encontrado na coleção PocketBase.")
            
            url_download = items[0]["url_download"]
            print(f"[GEXCEL AUTH] A descarregar gexcel_auth.exe a partir de {url_download}...")
            LOGGER.info("Download do Gexcel Auth iniciado")
            
            req_dl = urllib.request.Request(url_download, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req_dl, timeout=30) as resp_dl, open(caminho_exe, "wb") as f_out:
                f_out.write(resp_dl.read())
            
            print(f"[GEXCEL AUTH] Sucesso! gexcel_auth.exe instalado em {caminho_exe}")
            LOGGER.info("Gexcel Auth instalado: tamanho=%s", os.path.getsize(caminho_exe))
            return caminho_exe
    except Exception as e:
        LOGGER.exception("Falha na auto-recuperação do Gexcel Auth: tipo=%s", type(e).__name__)
        print(f"[GEXCEL AUTH ERRO] Falha na auto-recuperação do gexcel_auth.exe: {e}")
        return caminho_exe

def verificar_licenca(forcar_refresh: bool = False) -> dict:
    """
    Executa a verificação silenciosa do Gexcel Auth para efaturaV4api.
    Usa cache de memória rápida (TTL 60s) para não sobrecarregar com processos.
    """
    agora = time.time()
    if not forcar_refresh and _MEM_CACHE["resultado"] and agora < _MEM_CACHE["expira_em"]:
        return _MEM_CACHE["resultado"]

    if sys.platform != "win32":
        lic_cloud = {
            "autorizado": True,
            "plano": "ENTERPRISE_CLOUD_HETZNER",
            "motivo": "EXECUCAO_PLATAFORMA_HETZNER",
            "expira_em": "31/12/2099",
            "hardware_id": "HETZNER_CLOUD_NODE",
            "modo": "ONLINE_ZERO_STORAGE"
        }
        _MEM_CACHE["resultado"] = lic_cloud
        _MEM_CACHE["expira_em"] = agora + 300
        return lic_cloud

    caminho_exe = garantir_gexcel_auth_instalado()
    if not os.path.exists(caminho_exe):
        hoje = date.today()
        if hoje <= DATA_LIMITE_TRANSICAO:
            lic_transicao = {
                "autorizado": True,
                "plano": "BETA_TRANSICAO_2026",
                "motivo": "PERIODO_TRANSICAO_LEGACY_ATE_31_12_2026",
                "expira_em": "31/12/2026",
                "hardware_id": "HW_TRANSICAO_GEXCEL",
                "modo": "TRANSICAO_LEGACY_2026"
            }
            _MEM_CACHE["resultado"] = lic_transicao
            _MEM_CACHE["expira_em"] = agora + 60
            return lic_transicao

        res_erro = {
            "autorizado": False,
            "motivo": "GEXCEL_AUTH_AUSENTE",
            "plano": "FREE",
            "erro": f"Executável gexcel_auth.exe não encontrado em {caminho_exe}."
        }
        return res_erro

    cmd = [caminho_exe, "--app", APP_ID, "--acao", "silencioso"]
    try:
        LOGGER.info("Validação silenciosa do Gexcel Auth iniciada")
        startupinfo = None
        if sys.platform == "win32":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = 0 # SW_HIDE

        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10,
            startupinfo=startupinfo,
            encoding="utf-8",
            errors="ignore"
        )
        stdout_str = proc.stdout.strip()
        LOGGER.info("Gexcel Auth terminou: returncode=%s stdout_valido=%s", proc.returncode, bool(stdout_str))
        last_line = stdout_str.splitlines()[-1] if stdout_str.splitlines() else "{}"
        
        try:
            dados = json.loads(last_line)
        except json.JSONDecodeError:
            dados = {
                "autorizado": False,
                "motivo": "ERRO_RESPOSTA",
                "plano": "FREE",
                "erro": f"Resposta inválida do Gexcel Auth: {stdout_str}"
            }

        # 1. Se o Gexcel Auth já autorizar formalmente, devolve o plano oficial
        if dados.get("autorizado", False):
            LOGGER.info("Gexcel Auth autorizou o módulo: plano=%s", dados.get("plano", ""))
            _MEM_CACHE["resultado"] = dados
            _MEM_CACHE["expira_em"] = agora + 60
            return dados

        # 2. Se o cliente ainda não estiver registado no Gexcel Auth, valida o período de transição 2026
        hoje = date.today()
        if hoje <= DATA_LIMITE_TRANSICAO:
            lic_transicao = {
                "autorizado": True,
                "plano": "BETA_TRANSICAO_2026",
                "motivo": "PERIODO_TRANSICAO_LEGACY_ATE_31_12_2026",
                "expira_em": "31/12/2026",
                "hardware_id": dados.get("hardware_id", "HW_TRANSICAO_GEXCEL") if isinstance(dados, dict) else "HW_TRANSICAO_GEXCEL",
                "modo": "TRANSICAO_LEGACY_2026"
            }
            _MEM_CACHE["resultado"] = lic_transicao
            _MEM_CACHE["expira_em"] = agora + 60
            return lic_transicao

        # 3. Se já ultrapassou 31/12/2026, o bloqueio do Gexcel Auth torna-se estrito
        _MEM_CACHE["resultado"] = dados
        _MEM_CACHE["expira_em"] = agora + 60 # 60 segundos de TTL
        return dados
    except Exception as e:
        LOGGER.exception("Falha ao executar o Gexcel Auth: tipo=%s", type(e).__name__)
        hoje = date.today()
        if hoje <= DATA_LIMITE_TRANSICAO:
            lic_transicao = {
                "autorizado": True,
                "plano": "BETA_TRANSICAO_2026",
                "motivo": "PERIODO_TRANSICAO_LEGACY_ATE_31_12_2026",
                "expira_em": "31/12/2026",
                "hardware_id": "HW_TRANSICAO_GEXCEL",
                "modo": "TRANSICAO_LEGACY_2026"
            }
            _MEM_CACHE["resultado"] = lic_transicao
            _MEM_CACHE["expira_em"] = agora + 60
            return lic_transicao

        res_erro = {
            "autorizado": False,
            "motivo": "ERRO_EXECUCAO",
            "plano": "FREE",
            "erro": str(e)
        }
        return res_erro

def abrir_painel_suporte():
    """Abre a janela de suporte e gestão de licença em processo isolado."""
    caminho_exe = garantir_gexcel_auth_instalado()
    if os.path.exists(caminho_exe):
        subprocess.Popen([caminho_exe, "--app", APP_ID, "--acao", "painel"])
