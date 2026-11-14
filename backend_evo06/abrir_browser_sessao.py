# -*- coding: utf-8 -*-
"""
Ecossistema Gexcel EVO - Abertura de Navegador Autenticado Interativo (e-Fatura / Portal AT).
Inicia o navegador (Edge ou Chrome) visível com login automático na AT, traz a janela para primeiro plano,
ultrapassa popups facultativos de 2FA e mantém a janela aberta para navegação livre do utilizador.
"""

import os
import sys
import time
import argparse
from pathlib import Path

# Ajustar sys.path para carregar logins_Gov
BASE_DIR = Path(__file__).parent.resolve()
candidatos = [
    BASE_DIR.parent / "SCR-01_Logins_Gov",
    BASE_DIR.parent.parent / "SCR-01_Logins_Gov",
    Path(r"C:\DEV\Ecossistema_Gexcel\03_EVO_Ecossistema_Evo\03.9_SCR_EVO_Scrapers_Gov\SCR-01_Logins_Gov")
]
LOGINS_GOV_DIR = next((p.resolve() for p in candidatos if p.exists()), candidatos[0].resolve())
if str(LOGINS_GOV_DIR) not in sys.path:
    sys.path.insert(0, str(LOGINS_GOV_DIR))

try:
    from playwright.sync_api import sync_playwright
    from logins_Gov import (
        launch_browser,
        verificar_bloqueio_senha,
        registar_senha_rejeitada,
        limpar_bloqueio_sucesso,
        detetar_erro_credenciais
    )
except ImportError as e:
    print(f"[ERRO] Falha ao importar dependências: {e}", file=sys.stderr)
    sys.exit(1)


def focar_janela_navegador():
    """Traz a janela do navegador para primeiro plano no ambiente de trabalho do Windows."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32

        def enum_windows_callback(hwnd, extra):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buff, length + 1)
                    title = buff.value.lower()
                    if any(termo in title for termo in ["acesso.gov.pt", "portaldasfinancas", "finanças", "e-fatura", "efatura", "google chrome", "microsoft edge"]):
                        user32.keybd_event(0x12, 0, 0, 0) # Alt down
                        user32.ShowWindow(hwnd, 9) # SW_RESTORE
                        user32.SetForegroundWindow(hwnd)
                        user32.BringWindowToTop(hwnd)
                        user32.keybd_event(0x12, 0, 2, 0) # Alt up
                        return False
            return True

        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
        user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
    except Exception:
        pass


def main():
    import re
    parser = argparse.ArgumentParser(description="Abre navegador com sessão e-Fatura iniciada.")
    parser.add_argument("--nif", type=str, default="", help="NIF ou Subutilizador da entidade")
    parser.add_argument("--password", type=str, default="", help="Palavra-passe AT")
    parser.add_argument("--canal", type=str, default="auto", help="'auto', 'msedge' ou 'chrome'")
    parser.add_argument("--destino", type=str, default="efatura", help="'efatura' ou 'portal'")
    args = parser.parse_args()

    nif = (args.nif or os.environ.get("GOV_NIF", "")).strip()
    nif_empresa = (os.environ.get("GOV_NIF_EMPRESA", "") or re.sub(r"[^0-9]", "", nif)[:9]).strip()
    password = (args.password or os.environ.get("GOV_PWD", "")).strip()
    canal = (args.canal or os.environ.get("GOV_CANAL", "auto")).strip()
    destino = (args.destino or os.environ.get("GOV_DESTINO", "efatura")).strip()

    if not nif or not password:
        print("[ERRO] NIF/Subutilizador e palavra-passe são obrigatórios.", file=sys.stderr)
        sys.exit(1)

    # Salvaguarda Central: Recusar disparo se a senha já estiver marcada como inválida nos Dados Gexcel Apps
    bloq_emp, det_emp = verificar_bloqueio_senha(nif_empresa or nif, "EFATURA", password)
    if bloq_emp:
        print(f"🛑 [LOGIN BLOQUEADO] A senha atual para {nif} já consta como rejeitada pela AT na base central ({det_emp}).", file=sys.stderr)
        sys.exit(2)

    print("=" * 60)
    print("GEXCEL EVO - LOGIN INTERATIVO NO NAVEGADOR")
    print(f"Utilizador: {nif[:3]}***{nif[-2:] if len(nif) >= 5 else ''} | Destino: {destino} | Canal: {canal}")
    print("=" * 60)
    sys.stdout.flush()

    p = sync_playwright().start()
    browser = None
    try:
        browser, canal_usado = launch_browser(
            p,
            canal=canal,
            headless=False,
            slow_mo=50
        )
        context = browser.new_context(no_viewport=True)
        page = context.new_page()

        if destino.lower() in ["efatura", "e-fatura"]:
            url_alvo = "https://faturas.portaldasfinancas.gov.pt/painelAdquirente.action"
        else:
            url_alvo = "https://www.acesso.gov.pt/v2/loginForm?partID=PFAP&path=/geral/home"

        print(f"A abrir portal no {canal_usado}: {url_alvo}")
        sys.stdout.flush()

        try:
            page.goto(url_alvo, wait_until="domcontentloaded", timeout=25000)
        except Exception as ge:
            print(f"[AVISO NAVEGAÇÃO] {ge}")

        # Trazer logo a janela para primeiro plano
        try:
            page.bring_to_front()
            focar_janela_navegador()
        except Exception:
            pass

        # Preenchimento automático do formulário de autenticação
        try:
            # Selecionar separador NIF se presente
            try:
                page.locator("button:has-text('NIF')").filter(visible=True).first.click(timeout=3000)
                page.wait_for_timeout(350)
            except Exception:
                pass

            # Preencher NIF / Subutilizador
            campo_nif = page.locator("input[name='username']").filter(visible=True).first
            try:
                campo_nif.click(timeout=3000)
            except Exception:
                pass
            campo_nif.fill(nif, timeout=8000)

            # Preencher Senha
            campo_pwd = page.locator("input[name='password']").filter(visible=True).first
            try:
                campo_pwd.click(timeout=3000)
            except Exception:
                pass
            campo_pwd.fill(password, timeout=8000)

            # Submeter formulário
            btn_sub = page.locator("form[name='loginForm'] button[type='submit'], button#btnSubmit, button:has-text('Autenticar')").filter(visible=True).first
            btn_sub.click(timeout=8000)
            print("Credenciais submetidas automaticamente na AT. A aguardar resposta...")
            sys.stdout.flush()

            # Aguardar resposta inicial do portal
            page.wait_for_timeout(2200)

            # 🚨 Verificar imediatamente se a AT rejeitou a password submetida
            erro_cred = detetar_erro_credenciais(page)
            if erro_cred:
                registar_senha_rejeitada(nif_empresa or nif, "EFATURA", password, erro_cred)
                if nif != (nif_empresa or nif):
                    registar_senha_rejeitada(nif, "EFATURA", password, erro_cred)
                print(f"⚠️ [SENHA REJEITADA PELA AT] {erro_cred} -> Registada na base central (Dados Gexcel Apps) para proteger contra bloqueio!")
                sys.stdout.flush()
            else:
                # 🛡️ Deteção e resolução do popup facultativo "Adira ao Segundo Fator de Autenticação" (particulares)
                seletores_continuar = [
                    "button:has-text('Continuar Login')",
                    "input[value*='Continuar Login' i]",
                    "a:has-text('Continuar Login')",
                    "button:has-text('Continuar')"
                ]
                for _ in range(6):
                    clicado = False
                    for sel in seletores_continuar:
                        try:
                            btn_c = page.locator(sel).filter(visible=True).first
                            if btn_c.is_visible(timeout=400):
                                print("🛡️ [POPUP DETETADO] 'Adira ao Segundo Fator de Autenticação'. A clicar em 'Continuar Login'...")
                                sys.stdout.flush()
                                btn_c.click(timeout=3000)
                                page.wait_for_timeout(1500)
                                clicado = True
                                break
                        except Exception:
                            pass
                    if clicado or ("submissaoformulariologin" not in page.url.lower() and "loginform" not in page.url.lower()):
                        break
                    page.wait_for_timeout(500)

                # Re-verificar se surgiu erro de credenciais após transição; caso contrário e se entrou, limpa bloqueios antigos
                erro_cred_pos = detetar_erro_credenciais(page)
                if erro_cred_pos:
                    registar_senha_rejeitada(nif_empresa or nif, "EFATURA", password, erro_cred_pos)
                    if nif != (nif_empresa or nif):
                        registar_senha_rejeitada(nif, "EFATURA", password, erro_cred_pos)
                    print(f"⚠️ [SENHA REJEITADA PELA AT] {erro_cred_pos} -> Registada na base central (Dados Gexcel Apps)!")
                    sys.stdout.flush()
                elif "submissaoformulariologin" not in page.url.lower() and "loginform" not in page.url.lower():
                    limpar_bloqueio_sucesso(nif_empresa or nif, "EFATURA")
                    limpar_bloqueio_sucesso(nif, "EFATURA")

        except Exception as err_fill:
            print(f"[AVISO NO PREENCHIMENTO] {err_fill}")
            sys.stdout.flush()

        # Focar novamente a janela em primeiro plano após o login
        try:
            page.bring_to_front()
            focar_janela_navegador()
        except Exception:
            pass

        print("\n✅ Janela do navegador ativa no ecrã (Primeiro Plano).")
        print("Pode navegar livremente. A sessão permanecerá aberta até fechar o navegador.\n")
        sys.stdout.flush()

        # Mantém a janela aberta enquanto houver pelo menos uma página aberta e o browser ligado
        while browser.is_connected() and len(context.pages) > 0:
            time.sleep(1)

    except Exception as exc:
        print(f"[ERRO GERAL] {exc}", file=sys.stderr)
        sys.stderr.flush()
    finally:
        try:
            if browser and browser.is_connected():
                browser.close()
        except Exception:
            pass
        try:
            p.stop()
        except Exception:
            pass
        print("Sessão terminada.")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
