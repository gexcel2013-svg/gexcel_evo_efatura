# -*- coding: utf-8 -*-
"""
Gexcel EVO - Importador e-Fatura
Launcher Unificado Desktop (Motor Python + PocketBase Core + Frontend)
"""

import os
import sys
import time
import socket
import subprocess
import webbrowser
import threading

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE_DIR)

PB_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "EVO-02_Core_BD"))
MOTOR_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "EVO-05_API_Efatura"))

def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex(('127.0.0.1', port)) == 0

def ensure_pocketbase():
    """Garante que a base de dados central PocketBase (:8090) está operacional."""
    if is_port_in_use(8090):
        print("[OK] PocketBase Core BD (:8090) ja operacional.")
        return

    pb_exe = os.path.join(PB_DIR, "pocketbase.exe")
    if not os.path.exists(pb_exe):
        print(f"[AVISO] pocketbase.exe nao encontrado em: {PB_DIR}")
        return

    print("[ARRANQUE] A iniciar PocketBase Core BD (:8090)...")
    flags = 0x08000000 if sys.platform == "win32" else 0
    subprocess.Popen([pb_exe, "serve", "--http=127.0.0.1:8090"], cwd=PB_DIR, creationflags=flags)
    
    for _ in range(16):
        time.sleep(0.3)
        if is_port_in_use(8090):
            print("[SUCESSO] PocketBase Core BD ativo!")
            return
    print("[AVISO] PocketBase demorou a responder.")

def ensure_motor():
    """Garante que a API Motor e-Fatura (:8015) está operacional."""
    if is_port_in_use(8015):
        print("[OK] Motor API e-Fatura (:8015) ja operacional.")
        return

    motor_exe = os.path.join(MOTOR_DIR, "dist", "gevo_efatura_api.exe")
    flags = 0x08000000 if sys.platform == "win32" else 0

    if os.path.exists(motor_exe):
        print("[ARRANQUE] A iniciar Motor API e-Fatura compilado (:8015)...")
        subprocess.Popen([motor_exe], cwd=MOTOR_DIR, creationflags=flags)
    else:
        py_exe = os.path.join(MOTOR_DIR, "venv", "Scripts", "pythonw.exe")
        if not os.path.exists(py_exe):
            py_exe = os.path.join(MOTOR_DIR, ".venv", "Scripts", "pythonw.exe")
        if not os.path.exists(py_exe):
            py_exe = os.path.join(MOTOR_DIR, "venv", "Scripts", "python.exe")
        if not os.path.exists(py_exe):
            py_exe = sys.executable

        print("[ARRANQUE] A iniciar Motor API e-Fatura (:8015)...")
        subprocess.Popen([py_exe, "run.py"], cwd=MOTOR_DIR, creationflags=flags)

    for _ in range(20):
        time.sleep(0.4)
        if is_port_in_use(8015):
            print("[SUCESSO] Motor API e-Fatura ativo!")
            return
    print("[AVISO] Motor e-Fatura demorou a responder.")

def open_app(url: str):
    """Abre a aplicação em janela dedicada no Chrome ou no browser padrão."""
    print(f"[APP] A abrir interface de utilizador em {url}...")
    chrome_paths = [
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]
    chrome_exe = next((p for p in chrome_paths if os.path.exists(p)), None)
    if chrome_exe:
        subprocess.Popen([chrome_exe, f"--app={url}"])
    else:
        webbrowser.open(url)

def main():
    print("=" * 65)
    print("   GEXCEL EVO - IMPORTADOR E-FATURA")
    print("   Inicializador Unificado de Servicos")
    print("=" * 65)

    # 1. Garantir serviços de retaguarda (Apenas Motor e-Fatura :8015)
    ensure_motor()

    # 2. Iniciar Frontend Vite (Porta 5173) se não estiver ativo
    frontend_url = "http://localhost:5173"
    if not is_port_in_use(5173):
        print("\n[FRONTEND] A iniciar servidor Vite Dev...")
        npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
        flags = 0x08000000 if sys.platform == "win32" else 0
        subprocess.Popen([npm_cmd, "run", "dev"], cwd=BASE_DIR, creationflags=flags)
        for _ in range(30):
            time.sleep(0.4)
            if is_port_in_use(5173):
                print(f"[SUCESSO] Frontend ativo em {frontend_url}!")
                break
    else:
        print(f"\n[OK] Frontend ativo em {frontend_url}.")

    # 3. Abrir interface no navegador após prontidão dos servidores
    open_app(frontend_url)

if __name__ == "__main__":
    main()
