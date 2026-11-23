# -*- coding: utf-8 -*-
"""
Arrancador e Gestor de Ciclo de Vida da API Importador e-Fatura Gexcel.
- Validação prévia de instâncias em execução (deteção por assinatura oficial).
- Gestão e fallback inteligente de portas de rede (8015 -> 8016..8020).
- Publicação do ficheiro local de descoberta (%LOCALAPPDATA%\\GexcelApps\\gevo_efatura_api.port).
- Lançamento do Uvicorn com instância direta (compatibilidade nativa com PyInstaller/Cython).
"""

import os
import sys
import json
import time
import socket
import logging
from logging.handlers import RotatingFileHandler
import threading
import urllib.request
import multiprocessing
from datetime import datetime
import ctypes

try:
    import psutil
except ImportError:
    psutil = None

ASSINATURA_OFICIAL = "API Importador e-Fatura Gexcel"
PORTA_PADRAO = 8015
VERSAO_API = "4.2.29"
LOGGER = logging.getLogger("gexcel.efatura")

_MUTEX_HANDLE = None

def adquirir_mutex_instancia_unica() -> bool:
    """
    Garante no kernel do Windows que apenas uma instância física do motor
    pode correr em simultâneo na máquina, prevenindo duplicações e zombies.
    """
    global _MUTEX_HANDLE
    if sys.platform != "win32":
        return True

    mutex_name = "Local\\Gexcel_gevo_ef2026_SingleInstance_Mutex"
    ERROR_ALREADY_EXISTS = 183

    try:
        _MUTEX_HANDLE = ctypes.windll.kernel32.CreateMutexW(None, False, mutex_name)
        last_error = ctypes.windll.kernel32.GetLastError()
        if last_error == ERROR_ALREADY_EXISTS:
            return False
    except Exception as e:
        LOGGER.warning("Aviso ao tentar criar Mutex Win32: %s", e)
    return True

def libertar_mutex_instancia_unica():
    """Fecha o handle do mutex no encerramento limpo."""
    global _MUTEX_HANDLE
    if _MUTEX_HANDLE and sys.platform == "win32":
        try:
            ctypes.windll.kernel32.CloseHandle(_MUTEX_HANDLE)
        except Exception:
            pass
        _MUTEX_HANDLE = None


def configurar_logging() -> str:
    """Ativa logging persistente sem impedir o arranque se a pasta não estiver acessível."""
    if LOGGER.handlers:
        handler = LOGGER.handlers[0]
        return getattr(handler, "baseFilename", "")

    local_app_data = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
    pasta_logs = os.path.join(local_app_data, "GExcelAYD", "logs")
    caminho_log = os.path.join(pasta_logs, "gevo_efatura_api.log")
    LOGGER.setLevel(logging.INFO)
    LOGGER.propagate = False

    try:
        os.makedirs(pasta_logs, exist_ok=True)
        handler = RotatingFileHandler(
            caminho_log,
            maxBytes=2 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        handler.setFormatter(logging.Formatter(
            "%(asctime)s | %(levelname)s | pid=%(process)d | %(message)s"
        ))
        LOGGER.addHandler(handler)
        return caminho_log
    except Exception:
        LOGGER.addHandler(logging.NullHandler())
        return ""

def obter_caminho_ficheiro_descoberta() -> str:
    """Retorna o caminho do ficheiro local de descoberta de porta."""
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if not local_app_data:
        local_app_data = os.path.join(os.path.expanduser("~"), "AppData", "Local")
    
    pasta = os.path.join(local_app_data, "GexcelApps")
    os.makedirs(pasta, exist_ok=True)
    return os.path.join(pasta, "gevo_efatura_api.port")

def gravar_registo_descoberta(porta: int, estado: str = "starting", pid: int | None = None):
    """Publica a porta ativa e PID para descoberta rápida por clientes VBA e Desktop."""
    caminho = obter_caminho_ficheiro_descoberta()
    dados = {
        "port": porta,
        "pid": os.getpid() if pid is None else pid,
        "signature": ASSINATURA_OFICIAL,
        "app_id": "efaturaV4api",
        "version": VERSAO_API,
        "status": estado,
        "timestamp": int(time.time())
    }
    try:
        caminho_temp = caminho + ".tmp"
        with open(caminho_temp, "w", encoding="utf-8") as f:
            json.dump(dados, f, indent=2)
        os.replace(caminho_temp, caminho)
        LOGGER.info("Ficheiro de descoberta atualizado: porta=%s estado=%s", porta, estado)
    except Exception as e:
        LOGGER.exception("Não foi possível gravar o ficheiro de descoberta")
        print(f"[AVISO] Nao foi possivel gravar ficheiro de descoberta: {e}")

def obter_info_instancia_na_porta(porta: int) -> dict:
    """Testa se a porta já responde com a assinatura oficial e devolve metadados."""
    url = f"http://127.0.0.1:{porta}/"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GexcelHealthCheck/1.0"})
        with urllib.request.urlopen(req, timeout=0.8) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            if ASSINATURA_OFICIAL in data.get("assinatura", ""):
                ver_raw = str(data.get("versao_base") or data.get("versao") or "").strip()
                ver_limpa = ver_raw.split()[0].lstrip("vV") if ver_raw else ""
                return {"oficial": True, "versao": ver_limpa, "pid": data.get("pid")}
    except Exception:
        pass
    return {"oficial": False, "versao": ""}

def verificar_assinatura_na_porta(porta: int) -> bool:
    """Testa se a porta já responde com a assinatura oficial do ecossistema Gexcel."""
    return obter_info_instancia_na_porta(porta)["oficial"]

def is_socket_in_use(port: int) -> bool:
    """Verifica diretamente no sistema operativo se o socket TCP está ocupado."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0

def obter_pid_na_porta(porta: int) -> int | None:
    """Tenta identificar o PID do processo que está a escutar na porta especificada."""
    if psutil is not None:
        try:
            for conn in psutil.net_connections(kind="inet"):
                if conn.laddr and conn.laddr.port == porta and conn.status == psutil.CONN_LISTEN:
                    return conn.pid
        except Exception:
            pass

    # Consulta secundária no ficheiro de descoberta local
    try:
        caminho = obter_caminho_ficheiro_descoberta()
        if os.path.exists(caminho):
            with open(caminho, "r", encoding="utf-8") as f:
                d = json.load(f)
            if d.get("port") == porta and d.get("pid"):
                return int(d.get("pid"))
    except Exception:
        pass

    # Fallback via netstat no Windows
    try:
        import subprocess
        res = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True,
            text=True,
            timeout=3
        )
        for line in res.stdout.splitlines():
            partes = line.strip().split()
            if len(partes) >= 5 and f":{porta}" in partes[1] and partes[3] == "LISTENING":
                try:
                    return int(partes[4])
                except ValueError:
                    pass
    except Exception:
        pass
    return None

def selecionar_porta_operacional() -> int:
    """
    Assegura que o motor opera estritamente na porta oficial 8015 do ecossistema Gexcel.
    Como esta instância já detém com exclusividade o Mutex Win32, qualquer processo
    que ainda esteja a escutar na porta 8015 é um resíduo/órfão de uma sessão anterior
    e deve ser terminado para permitir o arranque limpo do serviço.
    """
    # 1. Se a porta 8015 estiver livre, usa-a imediatamente
    if not is_socket_in_use(PORTA_PADRAO):
        LOGGER.info("Porta padrão %s disponível", PORTA_PADRAO)
        return PORTA_PADRAO

    # 2. Porta 8015 ocupada por resíduo anterior: identificar e terminar processo órfão
    pid_conflito = obter_pid_na_porta(PORTA_PADRAO)
    LOGGER.warning("Porta padrão %s ocupada por processo residual (PID %s). A efetuar rotação limpa...", PORTA_PADRAO, pid_conflito or "desconhecido")
    if pid_conflito and pid_conflito != os.getpid():
        print(f"[AVISO] Porta {PORTA_PADRAO} detida por processo residual anterior (PID {pid_conflito}). A efetuar libertação...")
        try:
            import subprocess
            subprocess.run(["taskkill", "/F", "/PID", str(pid_conflito)], capture_output=True, timeout=5)
            time.sleep(1.0)
        except Exception as e_kill:
            LOGGER.error("Falha ao tentar terminar PID residual %s: %s", pid_conflito, e_kill)

    # 3. Compasso de espera para libertação do socket pelo SO (ex: TIME_WAIT / CLOSE_WAIT)
    for _ in range(6):
        if not is_socket_in_use(PORTA_PADRAO):
            LOGGER.info("Porta %s libertada com sucesso para o novo processo.", PORTA_PADRAO)
            return PORTA_PADRAO
        time.sleep(0.5)

    if not is_socket_in_use(PORTA_PADRAO):
        return PORTA_PADRAO

    msg_erro = (
        f"A porta oficial {PORTA_PADRAO} do Importador e-Fatura está ocupada"
        + (f" pelo processo PID {pid_conflito}." if pid_conflito else " por outro processo.")
        + f" Termine a tarefa em conflito no Gestor de Tarefas para libertar a porta {PORTA_PADRAO}."
    )
    LOGGER.error(msg_erro)
    raise RuntimeError(msg_erro)

def aguardar_api_pronta(porta: int, limite_segundos: float = 60.0):
    """Publica o estado ready apenas depois de o healthcheck responder corretamente."""
    inicio = time.monotonic()
    while time.monotonic() - inicio < limite_segundos:
        if verificar_assinatura_na_porta(porta):
            gravar_registo_descoberta(porta, "ready")
            LOGGER.info("API pronta na porta %s após %.2fs", porta, time.monotonic() - inicio)
            return
        time.sleep(0.25)
    LOGGER.error("API não ficou pronta na porta %s dentro de %.1fs", porta, limite_segundos)


def marcar_descoberta_como_parada(porta: int):
    """Evita deixar ready obsoleto e não interfere com uma instância substituta."""
    try:
        caminho = obter_caminho_ficheiro_descoberta()
        with open(caminho, "r", encoding="utf-8") as f:
            dados = json.load(f)
        if dados.get("pid") == os.getpid():
            gravar_registo_descoberta(porta, "stopped")
    except FileNotFoundError:
        return
    except Exception:
        LOGGER.exception("Não foi possível marcar o ficheiro de descoberta como stopped")


def main():
    multiprocessing.freeze_support()

    # 0. Se invocado como Worker de Segundo Plano, corre o loop do pipeline e sai
    if "--worker" in sys.argv:
        try:
            import pipeline_worker
            pipeline_worker.executar_worker_loop()
        except Exception as e_w:
            logging.getLogger("gexcel.efatura").error(f"Erro fatal no worker de segundo plano: {e_w}")
        sys.exit(0)

    caminho_log = configurar_logging()

    # 1. Proteção Ativa contra Processos Duplicados e Substituição Automática de Versão Antiga
    if not adquirir_mutex_instancia_unica():
        info = obter_info_instancia_na_porta(PORTA_PADRAO)
        versao_ativa = info.get("versao", "")
        if info["oficial"] and versao_ativa == VERSAO_API:
            print(f"====================================================")
            print(f" [INFO] A {ASSINATURA_OFICIAL} V{versao_ativa} JA SE ENCONTRA EM EXECUCAO!")
            print(f" Porta ativa: {PORTA_PADRAO} (Instancia operacional)")
            print(f"====================================================")
            LOGGER.info("Mutex ativo e instância V%s saudável na porta %s. A terminar arranque secundário.", versao_ativa, PORTA_PADRAO)
            gravar_registo_descoberta(PORTA_PADRAO, "ready", pid=info.get("pid") or 0)
            sys.exit(0)
        elif info["oficial"] and versao_ativa and versao_ativa != VERSAO_API:
            LOGGER.info(
                "Detetada versão anterior V%s na porta %s (nova versão: V%s). A encerrar instância antiga para atualização...",
                versao_ativa, PORTA_PADRAO, VERSAO_API
            )
            try:
                req_off = urllib.request.Request(
                    f"http://127.0.0.1:{PORTA_PADRAO}/api/sistema/shutdown",
                    data=b"{}",
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                urllib.request.urlopen(req_off, timeout=1.0).read()
            except Exception:
                pass
            pid_antigo = info.get("pid") or obter_pid_na_porta(PORTA_PADRAO)
            if pid_antigo and pid_antigo != os.getpid():
                try:
                    import subprocess
                    subprocess.run(["taskkill", "/F", "/PID", str(pid_antigo)], capture_output=True, timeout=5)
                except Exception:
                    pass
            for _ in range(10):
                time.sleep(0.3)
                libertar_mutex_instancia_unica()
                if adquirir_mutex_instancia_unica():
                    break
        else:
            print(f"[AVISO] Já existe uma instância do motor em execução no sistema. A evitar processo duplicado.")
            LOGGER.warning("Mutex Win32 ativo mas a porta %s não respondeu imediatamente. Arranque secundário abortado.", PORTA_PADRAO)
            sys.exit(0)

    LOGGER.info(
        "Arranque iniciado: versão=%s executável=%s frozen=%s log=%s",
        VERSAO_API,
        os.path.abspath(sys.executable),
        bool(getattr(sys, "frozen", False)),
        caminho_log or "indisponível",
    )

    try:
        porta = selecionar_porta_operacional()
        os.environ["GEXCEL_EFATURA_PORT"] = str(porta)
        os.environ["GEXCEL_EFATURA_VERSION"] = VERSAO_API
        gravar_registo_descoberta(porta, "starting")

        # Imports tardios: qualquer falha de dependência fica registada no log de arranque.
        import uvicorn
        from main import app
    except SystemExit:
        raise
    except Exception:
        LOGGER.exception("Falha durante a preparação da API")
        raise

    data_mod = ""
    try:
        mtime = os.path.getmtime(sys.executable if getattr(sys, "frozen", False) else __file__)
        data_mod = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
    except Exception:
        pass
    sufixo_build = f" (Build: {data_mod})" if data_mod else ""

    print(f"====================================================")
    print(f" {ASSINATURA_OFICIAL} - V{VERSAO_API}{sufixo_build}")
    print(f" Modo: 100% Stateless (Memoria RAM protegida)")
    print(f" Porta Ativa: {porta}")
    print(f" Endpoint Healthcheck: http://127.0.0.1:{porta}/")
    print(f"====================================================")

    # Inicia Uvicorn com a instância direta da aplicação FastAPI
    threading.Thread(target=aguardar_api_pronta, args=(porta,), daemon=True).start()

    try:
        uvicorn.run(
            app,
            host="127.0.0.1",
            port=porta,
            log_level="info",
            access_log=False # Otimização de performance e privacidade
        )
    except Exception:
        LOGGER.exception("Falha fatal ao executar o Uvicorn na porta %s", porta)
        raise
    finally:
        LOGGER.info("Processo da API terminou na porta %s", porta)
        marcar_descoberta_como_parada(porta)
        libertar_mutex_instancia_unica()

if __name__ == "__main__":
    main()
