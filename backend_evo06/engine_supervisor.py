# -*- coding: utf-8 -*-
"""
engine_supervisor.py - Supervisor e Gestor de Arranque Resiliente Dual-Slot (Beta vs Stable).
Garante execução prioritária do canal Beta com fallback automático instantâneo para Stable
e reporte assíncrono de telemetria para o PocketBase (coleção engine_beta_fallbacks).
"""

import os
import sys
import json
import time
import socket
import urllib.request
import urllib.error
import subprocess
import threading
import hashlib
from typing import Dict, Any, Optional

POCKETBASE_URL = "https://licencas.evogex.com"
FALLBACKS_ENDPOINT = f"{POCKETBASE_URL}/api/collections/engine_beta_fallbacks/records"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 GexcelAuth/1.6.22"
ASSINATURA_OFICIAL = "API Importador e-Fatura Gexcel"
PORTA_PADRAO = 8015


def obter_pasta_slots(engine_dir: Optional[str] = None) -> str:
    """Resolve a pasta de slots do motor."""
    if not engine_dir:
        local_app = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
        engine_dir = os.path.join(local_app, "GExcelAYD", "gexcelEvo", "engines", "gevo_ef2026")
    slots_dir = os.path.join(engine_dir, "slots")
    os.makedirs(os.path.join(slots_dir, "stable"), exist_ok=True)
    os.makedirs(os.path.join(slots_dir, "beta"), exist_ok=True)
    return slots_dir


def carregar_estado_slots(slots_dir: str) -> Dict[str, Any]:
    """Carrega o ficheiro engine_state.json com defaults seguros."""
    caminho_estado = os.path.join(slots_dir, "engine_state.json")
    if os.path.exists(caminho_estado):
        try:
            with open(caminho_estado, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "engine_name": "gevo_ef2026",
        "active_channel": "stable",
        "stable_version": "4.2.28",
        "beta_version": None,
        "quarantine": False,
        "quarantine_reason": None,
        "quarantine_until": None,
        "last_healthcheck": None
    }


def guardar_estado_slots(slots_dir: str, estado: Dict[str, Any]):
    """Persiste o ficheiro engine_state.json de forma atómica."""
    caminho_estado = os.path.join(slots_dir, "engine_state.json")
    caminho_tmp = caminho_estado + ".tmp"
    try:
        with open(caminho_tmp, "w", encoding="utf-8") as f:
            json.dump(estado, f, indent=2, ensure_ascii=False)
        os.replace(caminho_tmp, caminho_estado)
    except Exception as e:
        print(f"[AVISO] Não foi possível guardar engine_state.json: {e}")


def enviar_telemetria_fallback_async(engine_name: str, beta_ver: str, stable_ver: str, erro_msg: str, hardware_id: str = "", recovered_ok: bool = True):
    """Envia o relatório de queda e fallback para o PocketBase em thread secundária (fire-and-forget)."""
    def _worker():
        try:
            erro_hash = hashlib.md5(erro_msg[:200].encode("utf-8", errors="ignore")).hexdigest()
            payload = {
                "engine_name": engine_name,
                "beta_version": beta_ver or "desconhecida",
                "stable_version": stable_ver or "desconhecida",
                "error_hash": erro_hash,
                "error_message": erro_msg[:2000],
                "hardware_id": hardware_id or socket.gethostname(),
                "recovered_ok": recovered_ok
            }
            dados = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                FALLBACKS_ENDPOINT,
                data=dados,
                headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                pass  # Telemetria enviada com sucesso
        except Exception:
            pass  # Falha silenciosa para não travar o cliente em falhas de rede

    t = threading.Thread(target=_worker, daemon=True)
    t.start()


def verificar_healthcheck(porta: int = PORTA_PADRAO, timeout: float = 1.0) -> bool:
    """Verifica se o motor responde com a assinatura oficial na porta especificada."""
    url = f"http://127.0.0.1:{porta}/"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            return ASSINATURA_OFICIAL in data.get("assinatura", "")
    except Exception:
        return False


def arrancar_binario_slot(caminho_exe: str) -> Optional[subprocess.Popen]:
    """Arranca um executável do motor em segundo plano sem janela visível de consola."""
    if not os.path.exists(caminho_exe):
        return None
    try:
        creationflags = 0x08000000  # CREATE_NO_WINDOW
        proc = subprocess.Popen(
            [caminho_exe],
            creationflags=creationflags,
            close_fds=True
        )
        return proc
    except Exception as e:
        print(f"[ERRO] Falha ao arrancar binário {caminho_exe}: {e}")
        return None


def arrancar_motor_resiliente(engine_dir: Optional[str] = None, porta: int = PORTA_PADRAO) -> Dict[str, Any]:
    """
    Orquestra o arranque resiliente:
    1. Se já está operacional na porta -> retorna de imediato.
    2. Tenta arrancar o slot Beta se existir e não estiver em quarentena.
    3. Monitoriza healthcheck por 3 segundos.
    4. Se a Beta falhar: mata o processo, arranca o slot Stable, coloca a Beta em quarentena e envia telemetria.
    """
    if verificar_healthcheck(porta):
        return {"status": "already_running", "porta": porta}

    slots_dir = obter_pasta_slots(engine_dir)
    estado = carregar_estado_slots(slots_dir)

    caminho_beta = os.path.join(slots_dir, "beta", "gevo_ef2026.exe")
    caminho_stable = os.path.join(slots_dir, "stable", "gevo_ef2026.exe")

    usar_beta = (
        os.path.exists(caminho_beta)
        and not estado.get("quarantine", False)
    )

    if usar_beta:
        print("[SUPERVISOR] A iniciar motor no Canal BETA...")
        proc_beta = arrancar_binario_slot(caminho_beta)
        
        # Monitorizar arranque do Beta durante até 3.5 segundos
        sucesso_beta = False
        for _ in range(7):
            time.sleep(0.5)
            if verificar_healthcheck(porta):
                sucesso_beta = True
                break

        if sucesso_beta:
            estado["active_channel"] = "beta"
            estado["last_healthcheck"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            guardar_estado_slots(slots_dir, estado)
            print("[SUPERVISOR] Motor BETA operacional com sucesso!")
            return {"status": "ok", "channel": "beta", "porta": porta}

        # Falha na Beta detectada: acionar Auto-Healing / Fallback Imediato
        print("[SUPERVISOR] [ALERTA] Falha de arranque no Canal BETA! A acionar Fallback imediato...")
        if proc_beta:
            try:
                proc_beta.terminate()
            except Exception:
                pass

        # Ativar quarentena local
        estado["quarantine"] = True
        estado["quarantine_reason"] = "Falha no healthcheck de arranque"
        estado["active_channel"] = "stable"
        guardar_estado_slots(slots_dir, estado)

        # Telemetria assíncrona para PocketBase
        enviar_telemetria_fallback_async(
            engine_name="gevo_ef2026",
            beta_ver=estado.get("beta_version") or "beta",
            stable_ver=estado.get("stable_version") or "4.2.28",
            erro_msg="Motor Beta falhou o healthcheck inicial de 3.5s na porta 8015",
            recovered_ok=True
        )

    # Arrancar Slot Stable
    print("[SUPERVISOR] A iniciar motor no Canal ESTÁVEL...")
    proc_stable = arrancar_binario_slot(caminho_stable)
    sucesso_stable = False
    for _ in range(8):
        time.sleep(0.5)
        if verificar_healthcheck(porta):
            sucesso_stable = True
            break

    if sucesso_stable:
        estado["active_channel"] = "stable"
        estado["last_healthcheck"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        guardar_estado_slots(slots_dir, estado)
        print("[SUPERVISOR] Motor ESTÁVEL operacional com sucesso!")
        return {"status": "ok", "channel": "stable", "porta": porta}

    print("[SUPERVISOR] [ERRO CRÍTICO] Ambos os motores (Beta e Estável) falharam o arranque!")
    return {"status": "error", "message": "Falha no arranque dos dois slots"}


if __name__ == "__main__":
    resultado = arrancar_motor_resiliente()
    print(json.dumps(resultado, indent=2))
