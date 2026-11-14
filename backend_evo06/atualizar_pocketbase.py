# -*- coding: utf-8 -*-
"""
Script de Deploy e Sincronização Online para o PocketBase Oficial da Gexcel.
Coleção: 'versoes_appsGexcel' (https://api.gexcellicencas.com)

Suporta:
- Arquitetura Dual-Slot: canais 'beta' e 'stable' (promoção)
- Autenticação como superutilizador/admin no PocketBase (_superusers)
- Upsert (criação ou atualização) no canal especificado sem sobrescrever o outro
"""

import os
import sys
import json
import hashlib
import argparse
import urllib.request
import urllib.error

POCKETBASE_BASE = os.environ.get("POCKETBASE_URL", "https://api.gexcellicencas.com")
POCKETBASE_RECORDS_URL = f"{POCKETBASE_BASE}/api/collections/versoes_appsGexcel/records"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 GexcelAuth/1.6.22"

COD_APP = "efaturaV4api"
NOME_EXIBICAO = "API Importador e-Fatura Gexcel"
FICHEIRO_ALVO = "gevo_efatura_api.exe"
NOME_PRODUCAO = "gevo_ef2026.exe"


def calcular_hash(caminho: str) -> str:
    """Calcula hash SHA256 do binário especificado."""
    if os.path.exists(caminho):
        h = hashlib.sha256()
        with open(caminho, "rb") as f:
            while chunk := f.read(65536):
                h.update(chunk)
        return h.hexdigest().upper()
    return ""


def autenticar_admin(email: str, password: str) -> str:
    """Obtém o token JWT de superutilizador/admin no PocketBase."""
    endpoints = [
        f"{POCKETBASE_BASE}/api/collections/_superusers/auth-with-password",
        f"{POCKETBASE_BASE}/api/superusers/auth-with-password",
        f"{POCKETBASE_BASE}/api/admins/auth-with-password"
    ]
    payload = json.dumps({"identity": email, "password": password}).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}

    for ep in endpoints:
        try:
            req = urllib.request.Request(ep, data=payload, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                token = data.get("token")
                if token:
                    print("[INFO] Autenticação de superutilizador PocketBase bem-sucedida!")
                    return token
        except urllib.error.HTTPError:
            continue
        except Exception as e:
            print(f"[ERRO] Falha de conexão ao autenticar admin: {e}")
            break

    print("[AVISO] Não foi possível obter token de superutilizador nos endpoints testados.")
    return ""


def sincronizar_versao(canal: str = "beta", versao: str = "", changelog: str = "", token: str = ""):
    """Sincroniza o release no PocketBase para o canal especificado (beta ou stable)."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Determinar caminhos de binário e URLs consoante o canal
    if canal == "beta":
        caminho_bin = os.path.join(base_dir, "dist", "slots", "beta", NOME_PRODUCAO)
        if not os.path.exists(caminho_bin):
            caminho_bin = os.path.join(base_dir, "dist", FICHEIRO_ALVO)
        url_download = f"https://gexcelupdates.com/ArqPyd/execs_gevo/beta/{NOME_PRODUCAO}"
        versao_final = versao or "4.2.29-b1"
        changelog_final = changelog or f"Versão Beta {versao_final}: Contingência automática via Portal Web para subutilizadores AT e normalização de credenciais."
    else:  # stable
        caminho_bin = os.path.join(base_dir, "dist", "slots", "stable", NOME_PRODUCAO)
        if not os.path.exists(caminho_bin):
            caminho_bin = os.path.join(base_dir, "dist", FICHEIRO_ALVO)
        url_download = f"https://gexcelupdates.com/ArqPyd/execs_gevo/{NOME_PRODUCAO}"
        versao_final = versao or "4.2.29"
        changelog_final = changelog or (
            f"Versão Estável {versao_final}: Contingência automática pelo Portal Web quando o Webservice AT recusa "
            f"subutilizadores, desbloqueio automático de falsas rejeições SOAP e normalização de subutilizadores."
        )

    hash_bin = calcular_hash(caminho_bin)

    print("==================================================")
    print(f"[POCKETBASE] Sincronização de Versão: {COD_APP}")
    print(f" -> Canal: {canal.upper()}")
    print(f" -> Versão: {versao_final}")
    print(f" -> Ficheiro Local: {caminho_bin}")
    print(f" -> Hash SHA256: {hash_bin[:16]}...")
    print(f" -> URL Download: {url_download}")
    print("==================================================")

    # 1. Pesquisar registo existente
    url_pesquisa = f"{POCKETBASE_RECORDS_URL}?filter=(codApp=%27{COD_APP}%27)"
    headers_get = {"User-Agent": USER_AGENT}
    if token:
        headers_get["Authorization"] = token

    registo_existente = None
    try:
        req_busca = urllib.request.Request(url_pesquisa, headers=headers_get)
        with urllib.request.urlopen(req_busca, timeout=10) as resp:
            dados = json.loads(resp.read().decode("utf-8"))
            items = dados.get("items", [])
            if items:
                registo_existente = items[0]
    except Exception as e:
        print(f"[AVISO] Não foi possível consultar o registo existente: {e}")

    # 2. Construir payload de atualização cirúrgico por canal
    payload = {
        "codApp": COD_APP,
        "nome_exibicao": NOME_EXIBICAO,
        "ficheiro_alvo": FICHEIRO_ALVO,
        "nome_producao": NOME_PRODUCAO,
    }

    if canal == "beta":
        payload.update({
            "versao_beta": versao_final,
            "url_download_beta": url_download,
            "hash_sha256_beta": hash_bin,
            "beta_ativa": True,
            "changelog_beta": changelog_final,
        })
    else:  # stable / promoção
        payload.update({
            "versao_atual": versao_final,
            "url_download": url_download,
            "hash_sha256": hash_bin,
            "changelog": changelog_final,
            "atualizacao_critica": True,
            "beta_ativa": False,  # Ao promover a estável, desativa a beta anterior
        })

    dados_bytes = json.dumps(payload).encode("utf-8")
    headers_write = {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT
    }
    if token:
        headers_write["Authorization"] = token

    try:
        if registo_existente:
            record_id = registo_existente["id"]
            url_patch = f"{POCKETBASE_RECORDS_URL}/{record_id}"
            print(f"[INFO] A atualizar canal {canal.upper()} no registo ID {record_id} via PATCH...")
            req_update = urllib.request.Request(url_patch, data=dados_bytes, headers=headers_write, method="PATCH")
            with urllib.request.urlopen(req_update, timeout=10) as resp_up:
                print(f"[SUCESSO] Canal {canal.upper()} (V{versao_final}) atualizado no PocketBase com status {resp_up.status}!")
        else:
            print("[INFO] Registo não encontrado. A criar novo registo na coleção via POST...")
            req_post = urllib.request.Request(POCKETBASE_RECORDS_URL, data=dados_bytes, headers=headers_write, method="POST")
            with urllib.request.urlopen(req_post, timeout=10) as resp_post:
                print(f"[SUCESSO] Novo registo {COD_APP} criado no PocketBase com status {resp_post.status}!")
    except urllib.error.HTTPError as e:
        erro_corpo = e.read().decode("utf-8", errors="ignore")
        print(f"[ERRO HTTP {e.code}] Falha ao gravar no PocketBase: {erro_corpo}")
    except Exception as e:
        print(f"[ERRO] Falha de comunicação com PocketBase: {e}")


def carregar_env():
    """Carrega variáveis do ficheiro .env local se existir."""
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k not in os.environ:
                        os.environ[k] = v


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sincronizador PocketBase com Suporte Dual-Slot (Beta / Stable)")
    parser.add_argument("--canal", choices=["beta", "stable"], default="beta", help="Canal de distribuição (padrão: beta)")
    parser.add_argument("--versao", type=str, default="", help="Número de versão a sincronizar")
    parser.add_argument("--changelog", type=str, default="", help="Descrição das alterações")
    args = parser.parse_args()

    carregar_env()
    email = os.environ.get("PB_ADMIN_EMAIL") or os.environ.get("User") or os.environ.get("user") or ""
    pwd = os.environ.get("PB_ADMIN_PASSWORD") or os.environ.get("Password") or os.environ.get("password") or ""

    token = ""
    if email and pwd:
        token = autenticar_admin(email, pwd)

    sincronizar_versao(canal=args.canal, versao=args.versao, changelog=args.changelog, token=token)
