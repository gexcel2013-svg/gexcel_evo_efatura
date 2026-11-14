# -*- coding: utf-8 -*-
"""
Módulo de Integração Direta com Dados Legados Gexcel Apps (gexcel-legado-bridge).
Conforme especificação da skill 'gexcel-legado-bridge':
- Resolução dinâmica de z-GexcelApps.ini
- Extração da tag <EndDadosGexcelApps>
- Leitura em tempo real de tCredenciais.xml com descarte das 3 primeiras linhas
- Descodificação de senhas em Base64 (suporte a xx|<base64>|xx e Base64 direto)
- Modo Read-Only sem qualquer alteração aos ficheiros legados
"""

import os
import re
import base64
import xml.etree.ElementTree as ET
import logging
import time
from typing import List, Dict, Any, Optional

LOGGER = logging.getLogger("gexcel.legado_bridge")

_CACHE_ENTIDADES: Dict[str, Any] = {
    "ficheiro_xml": "",
    "mtime": 0.0,
    "timestamp": 0.0,
    "dados": []
}


def resolver_caminho_ini() -> str:
    """Localiza z-GexcelApps.ini por subida em cascata (até 4 níveis) ou via USERPROFILE."""
    import sys
    base_dir = os.path.dirname(os.path.abspath(sys.executable)) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
    cwd = os.getcwd()
    app_dir = os.environ.get("GEXCEL_APP_DIR", "").strip()
    app_cwd = os.environ.get("GEXCEL_APP_CWD", "").strip()
    user_profile = os.environ.get("USERPROFILE") or os.path.expanduser("~")

    candidatos = []

    # 1. Subida em cascata (até 4 níveis acima) a partir da pasta da aplicação Desktop, executável e CWD
    raizes_busca = [r for r in [app_dir, app_cwd, base_dir, cwd] if r and os.path.exists(r)]
    for raiz in raizes_busca:
        for niveis in [
            ("..", "..", "..", ".."),
            ("..", "..", ".."),
            ("..", ".."),
            ("..",),
            ()
        ]:
            cand = os.path.abspath(os.path.join(raiz, *niveis, "ConfigsGexcelApps", "z-GexcelApps.ini"))
            if cand not in candidatos:
                candidatos.append(cand)

    # 2. Padrão oficial no USERPROFILE (Produção cliente e Dropbox)
    padroes_user = [
        os.path.join(user_profile, "Gexcel Apps", "ConfigsGexcelApps", "z-GexcelApps.ini"),
        os.path.join(user_profile, "Dropbox", "A - A GexcelApps LT2018_19", "GexcelApps", "ConfigsGexcelApps", "z-GexcelApps.ini"),
        os.path.join(user_profile, "Dropbox", "A - A GexcelApps LT5", "ConfigsGexcelApps", "z-GexcelApps.ini"),
        os.path.join(user_profile, "Dropbox", "A - A GexcelApps V2 2023", "ConfigsGexcelApps", "z-GexcelApps.ini"),
        os.path.join(user_profile, "Dropbox", "A - A GexcelApps LT2018_19", "ConfigsGexcelApps", "z-GexcelApps.ini"),
    ]
    for p in padroes_user:
        if p not in candidatos:
            candidatos.append(p)

    for caminho in candidatos:
        if os.path.exists(caminho):
            try:
                with open(caminho, "r", encoding="utf-8", errors="ignore") as f:
                    conteudo = f.read()
                if "<EndDadosGexcelApps>" in conteudo:
                    LOGGER.info("Ficheiro z-GexcelApps.ini com dados localizado em: %s", caminho)
                    return caminho
            except Exception:
                continue

    # Fallback se nenhum contiver a tag explicitamente
    for caminho in candidatos:
        if os.path.exists(caminho):
            return caminho

    return ""


def obter_caminho_dados_gexcel() -> str:
    """Extrai a pasta de dados GexcelApps do Centro de Dados ativo ou da tag <EndDadosGexcelApps> de z-GexcelApps.ini."""
    try:
        import auth_manager
        centro = auth_manager.obter_centro_dados_ativo()
        p_antiga = (centro.get("pasta_gexcel_antiga") or "").strip()
        if p_antiga and os.path.exists(p_antiga):
            return p_antiga
    except Exception:
        pass

    caminho_ini = resolver_caminho_ini()
    if not caminho_ini or not os.path.exists(caminho_ini):
        return ""
    try:
        with open(caminho_ini, "r", encoding="utf-8", errors="ignore") as f:
            conteudo = f.read()
        match = re.search(r"<EndDadosGexcelApps>(.*?)</EndDadosGexcelApps>", conteudo, re.IGNORECASE | re.DOTALL)
        if match:
            caminho_dados = match.group(1).strip()
            LOGGER.info("Caminho de dados GexcelApps obtido da tag: %s", caminho_dados)
            return caminho_dados
    except Exception as e:
        LOGGER.error("Erro ao ler tag <EndDadosGexcelApps> em %s: %s", caminho_ini, e)
    return ""


def descodificar_senha_legada(pwd_str: str) -> str:
    """Descodifica passwords Base64 no formato xx|...|xx ou Base64 direto."""
    if not pwd_str:
        return ""
    limpa = pwd_str.strip()
    if limpa.startswith("xx|") and limpa.endswith("|xx"):
        b64_part = limpa[3:-3]
        try:
            return base64.b64decode(b64_part).decode("utf-8")
        except Exception:
            pass
    try:
        # Se contiver apenas caracteres Base64 válidos e comprimento múltiplo de 4
        if len(limpa) % 4 == 0 and re.match(r"^[A-Za-z0-9+/=]+$", limpa):
            decoded = base64.b64decode(limpa).decode("utf-8")
            if decoded and all(ord(c) >= 32 for c in decoded):
                return decoded
    except Exception:
        pass
    return limpa


def obter_caminho_tcredenciais() -> str:
    """Determina o caminho absoluto de tCredenciais.xml."""
    import sys
    user_profile = os.environ.get("USERPROFILE") or os.path.expanduser("~")

    # 1. Via tag <EndDadosGexcelApps> de z-GexcelApps.ini
    pasta_dados = obter_caminho_dados_gexcel()
    if pasta_dados:
        candidato = os.path.join(pasta_dados, "tCredenciais.xml")
        if os.path.exists(candidato):
            return candidato

    # 2. Possíveis caminhos diretos no ecossistema Dropbox
    candidatos_diretos = [
        os.path.join(user_profile, "Dropbox", "AA_MultiIntegrador", "tCredenciais.xml"),
        os.path.join(user_profile, "Dropbox", "A - A GexcelApps LT2018_19", "A - Painel GexcelApps V5", "Dados GexcelApps", "tCredenciais.xml"),
    ]
    for c in candidatos_diretos:
        if os.path.exists(c):
            return c

    # 3. Possíveis caminhos locais em desenvolvimento ou teste
    base_dir = os.path.dirname(os.path.abspath(sys.executable)) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
    candidatos_locais = [
        os.path.join(base_dir, "tCredenciais.xml"),
        os.path.abspath(os.path.join(base_dir, "..", "tCredenciais.xml")),
        os.path.abspath(os.path.join(base_dir, "..", "..", "tCredenciais.xml")),
    ]
    for c in candidatos_locais:
        if os.path.exists(c):
            return c

    return ""


def normalizar_subutilizador_at(nif: str, sub: str) -> str:
    """
    Normaliza o identificador de subutilizador da AT:
    - Remove espaços acidentais em torno da barra ('500123456 / 1' -> '500123456/1');
    - Converte sufixos curtos ('1', '/1', 'WFA') em formato completo 'NIF/sufixo';
    - Preserva NIFs completos de 9 dígitos ou o próprio NIF titular quando vazio.
    """
    nif_clean = re.sub(r"[^0-9]", "", str(nif or "")).strip()[:9]
    s = str(sub or "").strip()
    if not s:
        return nif_clean
    if "/" in s:
        partes = [p.strip() for p in s.split("/", 1)]
        pref = re.sub(r"[^0-9]", "", partes[0])[:9] or nif_clean
        suf = partes[1]
        return f"{pref}/{suf}" if suf else pref
    # Se colocaram apenas o número/código do subutilizador (ex: '1', '2', 'WFA') sem o NIF antes da barra
    if nif_clean and s != nif_clean and len(s) < 9 and not (len(re.sub(r"[^0-9]", "", s)) == 9):
        return f"{nif_clean}/{s}"
    return s


def carregar_entidades_legadas(caminho_tcredenciais: str = "") -> List[Dict[str, Any]]:
    """
    Lê tCredenciais.xml descartando as 3 primeiras linhas especiais
    e retorna lista de dicionários com entidades e credenciais descodificadas.
    Possui cache inteligente baseado no mtime do ficheiro.
    """
    global _CACHE_ENTIDADES

    caminho = caminho_tcredenciais or obter_caminho_tcredenciais()
    if not caminho or not os.path.exists(caminho):
        return []

    try:
        mtime = os.path.getmtime(caminho)
        agora = time.time()

        # Cache de 15 segundos se o ficheiro não foi modificado
        if (
            _CACHE_ENTIDADES["ficheiro_xml"] == caminho
            and _CACHE_ENTIDADES["mtime"] == mtime
            and (agora - _CACHE_ENTIDADES["timestamp"]) < 15
        ):
            return _CACHE_ENTIDADES["dados"]

        tree = ET.parse(caminho)
        root = tree.getroot()
        linhas = root.findall("Linha")

        # Regra Mandatória: Descartar as 3 primeiras linhas especiais
        linhas_entidades = linhas[3:] if len(linhas) > 3 else []

        entidades = []
        for linha in linhas_entidades:
            nif = (linha.findtext("Nif") or "").strip()
            nif_clean = re.sub(r"[^0-9]", "", nif)
            if len(nif_clean) != 9:
                continue

            nome = (linha.findtext("Nome") or linha.findtext("NomeCli") or "").strip()
            p_efat = (linha.findtext("P_efatura") or "").strip()
            u_efat = (linha.findtext("U_efatura") or "").strip()
            p_at = (linha.findtext("P_AT") or "").strip()
            u_at = (linha.findtext("U_AT") or "").strip()
            if p_efat:
                raw_pwd = p_efat
                sub_raw = u_efat or u_at or nif_clean
            else:
                raw_pwd = p_at
                sub_raw = u_at or u_efat or nif_clean
            subuser = normalizar_subutilizador_at(nif_clean, sub_raw)

            entidades.append({
                "id": nif_clean,
                "nif": nif_clean,
                "nif_cc": nif_clean,
                "nomecli": nome or f"Empresa {nif_clean}",
                "password": descodificar_senha_legada(raw_pwd),
                "subutilizador": subuser,
            })

        # Ordenar alfabeticamente pelo nome da empresa
        entidades.sort(key=lambda x: x["nomecli"].lower())

        _CACHE_ENTIDADES = {
            "ficheiro_xml": caminho,
            "mtime": mtime,
            "timestamp": agora,
            "dados": entidades
        }
        LOGGER.info("Carregadas %d entidades com sucesso a partir de %s", len(entidades), caminho)
        return entidades
    except Exception as e:
        LOGGER.error("Erro ao processar tCredenciais.xml (%s): %s", caminho, e)
        return []
