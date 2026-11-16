# -*- coding: utf-8 -*-
"""
Gexcel EVO - Gestor de Utilizadores Locais, Perfis RBAC e Configuração de Ligação.
Suporta:
- Superadministrador universal de fábrica com chave mestra oficial (41238886).
- Perfis de acesso: superadmin (Nível 3), admin (Nível 2), subutilizador (Nível 1).
- Modos de ligação da aplicação: 'integrado' (Gexcel Apps / CRM) vs 'autonomo' (Local SQLite).
- Armazenamento em %LOCALAPPDATA%\\GexcelApps\\gevo_efatura_app.db.
"""

import os
import re
import sys
import json
import hmac
import base64
import socket
import sqlite3
import hashlib
import secrets
import time
import unicodedata
from datetime import datetime
from typing import Optional, Dict, List, Any

# Chave Mestra Oficial do Programador (Superadministrador Universal)
MASTER_KEY_PLAINTEXT = "41238886"
SUPERADMIN_USERNAMES = ("superadmin", "dev", "victorgamboa")
_MASTER_SECRET = b"GEXCEL_EVO_CB2027_MASTER_KEY_9463_AUTONOMOUS_V2"


def _slugify_centro(nome: str) -> str:
    s = unicodedata.normalize('NFKD', str(nome or 'centro')).encode('ASCII', 'ignore').decode('utf-8')
    s = re.sub(r'[^a-zA-Z0-9]+', '-', s.lower()).strip('-')
    return s or f"centro-{int(time.time())}"


def _detetar_pastas_iniciais() -> Dict[str, str]:
    """Deteta a pasta Dados_evoGex (via GEXCEL_DADOS_DIR / centro_dados.json) e a pasta antiga Dados_GexcelApps."""
    pasta_antiga = ""
    pasta_nova = ""

    for cand_evo in [os.environ.get("GEXCEL_DADOS_DIR", "").strip(), r"C:\Dados_evoGex"]:
        if cand_evo and os.path.exists(cand_evo):
            pasta_nova = os.path.abspath(cand_evo)
            manifest_file = os.path.join(pasta_nova, "centro_dados.json")
            if os.path.exists(manifest_file):
                try:
                    with open(manifest_file, "r", encoding="utf-8") as f:
                        mf = json.load(f)
                    if mf.get("pasta_gexcel_antiga"):
                        pasta_antiga = str(mf["pasta_gexcel_antiga"]).strip()
                except Exception:
                    pass
            break

    if not pasta_antiga:
        try:
            import legado_bridge
            caminho_ini = legado_bridge.resolver_caminho_ini()
            if caminho_ini and os.path.exists(caminho_ini):
                with open(caminho_ini, "r", encoding="utf-8", errors="ignore") as f:
                    conteudo = f.read()
                match = re.search(r"<EndDadosGexcelApps>(.*?)</EndDadosGexcelApps>", conteudo, re.IGNORECASE | re.DOTALL)
                if match and os.path.exists(match.group(1).strip()):
                    pasta_antiga = os.path.abspath(match.group(1).strip())
        except Exception:
            pass

    if not pasta_antiga:
        user_profile = os.environ.get("USERPROFILE") or os.path.expanduser("~")
        drop_cand = os.path.join(user_profile, "Dropbox", "AA_MultiIntegrador")
        if os.path.exists(drop_cand):
            pasta_antiga = os.path.abspath(drop_cand)

    if not pasta_nova:
        if pasta_antiga:
            parent_dir = os.path.dirname(pasta_antiga.rstrip("\\/"))
            cand_side = os.path.join(parent_dir, "Dados_evoGex")
            if os.path.exists(cand_side):
                pasta_nova = cand_side
        if not pasta_nova:
            pasta_nova = r"C:\Dados_evoGex" if os.path.exists(r"C:\Dados_evoGex") else ""

    return {
        "pasta_evogex": pasta_nova,
        "pasta_gexcel_antiga": pasta_antiga,
    }


def garantir_estrutura_pasta_evogex(pasta_evogex: str, pasta_gexcel_antiga: str = "", nome_centro: str = "Escritório Principal") -> Dict[str, str]:
    """
    Garante na pasta única Dados_evoGex a estrutura completa:
    - motor/ (Motor local + runtime + ponte)
    - safedrive/ (Base de dados blindada de ficheiros MinIO camuflado)
    - index_core/ (Base de dados relacional PocketBase camuflado)
    - BdsefaturaV4/ (Bases SQLite diretas por NIF)
    - logs/ (Registos de auditoria)
    """
    p_evo = (pasta_evogex or "").strip()
    if not p_evo:
        p_evo = _detetar_pastas_iniciais()["pasta_evogex"]

    subpastas = {
        "raiz": p_evo,
        "motor": os.path.join(p_evo, "motor"),
        "safedrive": os.path.join(p_evo, "safedrive"),
        "index_core": os.path.join(p_evo, "index_core"),
        "pasta_v4": os.path.join(p_evo, "BdsefaturaV4"),
        "logs": os.path.join(p_evo, "logs"),
    }
    # Só cria fisicamente no disco se estivermos no Windows com caminho explícito válido
    if sys.platform == "win32" and p_evo:
        try:
            for k, sp in subpastas.items():
                os.makedirs(sp, exist_ok=True)
            manifest_path = os.path.join(p_evo, "centro_dados.json")
            manifest = {
                "nome": nome_centro,
                "pasta_evogex": p_evo,
                "pasta_gexcel_antiga": pasta_gexcel_antiga or "",
                "subpastas": subpastas,
                "updated_at": datetime.now().isoformat(),
            }
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
    return subpastas

def obter_caminho_db_app() -> str:
    """Retorna o caminho da base de dados local de utilizadores e configuração da app."""
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if not local_app_data:
        local_app_data = os.path.join(os.path.expanduser("~"), "AppData", "Local")
    
    pasta = os.path.join(local_app_data, "GexcelApps")
    os.makedirs(pasta, exist_ok=True)
    return os.path.join(pasta, "gevo_efatura_app.db")

def _gerar_hash_password(password: str, salt: Optional[str] = None) -> str:
    """Gera hash segura PBKDF2-HMAC-SHA256 no formato 'salt$hash'."""
    if not salt:
        salt = secrets.token_hex(16)
    kdf = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100_000)
    return f"{salt}${kdf.hex()}"

def _verificar_hash_password(password: str, hash_armazenada: str) -> bool:
    """Valida uma password contra a hash armazenada."""
    try:
        salt, _ = hash_armazenada.split('$', 1)
        hash_recalculada = _gerar_hash_password(password, salt)
        return secrets.compare_digest(hash_recalculada, hash_armazenada)
    except Exception:
        return False

def _parse_centros_permitidos(raw: Optional[str]) -> List[str]:
    if not raw or str(raw).strip() in ("", "*"):
        return ["*"]
    try:
        parsed = json.loads(str(raw))
        if isinstance(parsed, list) and parsed:
            return [str(x).strip() for x in parsed if str(x).strip()]
    except Exception:
        pass
    parts = [p.strip() for p in str(raw).split(",") if p.strip()]
    return parts if parts else ["*"]


def _serialize_centros_permitidos(centros: Optional[List[str]]) -> str:
    if not centros or "*" in centros:
        return "*"
    limpos = [str(c).strip() for c in centros if str(c).strip()]
    return json.dumps(limpos, ensure_ascii=False) if limpos else "*"


def inicializar_db_app():
    """Cria e migra as tabelas locais da aplicação e assegura o superadministrador mestre."""
    db_path = obter_caminho_db_app()
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        
        # 1. Tabela de Configuração Geral da Aplicação
        c.execute('''
            CREATE TABLE IF NOT EXISTS app_config (
                chave TEXT PRIMARY KEY,
                valor TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        ''')
        
        # 2. Tabela de Utilizadores Locais (RBAC + Centros Permitidos)
        c.execute('''
            CREATE TABLE IF NOT EXISTS app_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                nome TEXT NOT NULL,
                email TEXT DEFAULT '',
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('superadmin', 'admin', 'subutilizador')),
                ativo INTEGER DEFAULT 1,
                is_system INTEGER DEFAULT 0,
                centros_permitidos TEXT DEFAULT '*',
                created_at TEXT NOT NULL,
                ultimo_login TEXT
            )
        ''')
        try:
            c.execute("ALTER TABLE app_users ADD COLUMN centros_permitidos TEXT DEFAULT '*'")
        except Exception:
            pass
        try:
            c.execute("ALTER TABLE app_users ADD COLUMN telefone TEXT DEFAULT ''")
        except Exception:
            pass
        
        # 3. Tabela de Sessões Ativas
        c.execute('''
            CREATE TABLE IF NOT EXISTS app_sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                role TEXT NOT NULL,
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL,
                FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
            )
        ''')

        # 4. Tabela de Centros de Dados Nomeados (Escritório 1, Maia, Porto, PHC, Sage, etc.)
        c.execute('''
            CREATE TABLE IF NOT EXISTS app_centros_dados (
                id TEXT PRIMARY KEY,
                nome TEXT NOT NULL,
                hostname TEXT NOT NULL,
                pasta_evogex TEXT NOT NULL,
                pasta_gexcel_antiga TEXT DEFAULT '',
                ip_local TEXT DEFAULT '127.0.0.1:8015',
                ativo INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        ''')
        
        # Inserir configuração padrão de modo se não existir
        c.execute('SELECT valor FROM app_config WHERE chave = ?', ('modo_dados',))
        if not c.fetchone():
            agora_str = datetime.now().isoformat()
            c.execute('INSERT INTO app_config (chave, valor, updated_at) VALUES (?, ?, ?)',
                      ('modo_dados', 'integrado', agora_str))

        # Semear Centro de Dados inicial apenas no Windows e quando existir pasta real no disco
        if sys.platform != "win32":
            c.execute("DELETE FROM app_centros_dados WHERE id = 'escritorio-principal' AND hostname IN ('gexcel-evo-01', 'SERVIDOR-ESCRITORIO')")
        else:
            c.execute('SELECT count(*) FROM app_centros_dados')
            if c.fetchone()[0] == 0:
                pastas_ini = _detetar_pastas_iniciais()
                if pastas_ini["pasta_evogex"] or pastas_ini["pasta_gexcel_antiga"]:
                    agora_str = datetime.now().isoformat()
                    hname = socket.gethostname() or "COMPUTADOR-LOCAL"
                    if pastas_ini["pasta_evogex"]:
                        garantir_estrutura_pasta_evogex(
                            pastas_ini["pasta_evogex"],
                            pastas_ini["pasta_gexcel_antiga"],
                            "Escritório Principal"
                        )
                    c.execute('''
                        INSERT INTO app_centros_dados (id, nome, hostname, pasta_evogex, pasta_gexcel_antiga, ip_local, ativo, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, '127.0.0.1:8015', 1, ?, ?)
                    ''', (
                        "escritorio-principal",
                        "Escritório Principal",
                        hname,
                        pastas_ini["pasta_evogex"],
                        pastas_ini["pasta_gexcel_antiga"],
                        agora_str,
                        agora_str,
                    ))
                    c.execute('''
                        INSERT INTO app_config (chave, valor, updated_at)
                        VALUES ('centro_dados_ativo_id', 'escritorio-principal', ?)
                        ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at
                    ''', (agora_str,))
            
        # Assegurar existência do Superadministrador Mestre universal de fábrica
        hash_mestra = _gerar_hash_password(MASTER_KEY_PLAINTEXT)
        agora_str = datetime.now().isoformat()
        
        c.execute('SELECT id FROM app_users WHERE username = ?', ('superadmin',))
        row = c.fetchone()
        if not row:
            c.execute('''
                INSERT INTO app_users (username, nome, email, password_hash, role, ativo, is_system, centros_permitidos, created_at)
                VALUES (?, ?, ?, ?, ?, 1, 1, '*', ?)
            ''', ('superadmin', 'Victor Gamboa (Superadmin)', 'gexcel2013@gmail.com', hash_mestra, 'superadmin', agora_str))
        else:
            # Manter password mestra atualizada, permissão intacta e email oficial
            c.execute('''
                UPDATE app_users 
                SET email = 'gexcel2013@gmail.com', password_hash = ?, role = 'superadmin', ativo = 1, is_system = 1, centros_permitidos = '*'
                WHERE username = 'superadmin'
            ''', (hash_mestra,))
            
        conn.commit()

# Executar inicialização no import
try:
    inicializar_db_app()
except Exception as _e:
    print(f"[AUTH MANAGER AVISO] Falha ao inicializar base de dados: {_e}")

# ==============================================================================
# GESTÃO DE CENTROS DE DADOS NOMEADOS E CONFIGURAÇÃO DA APLICAÇÃO
# ==============================================================================

def listar_centros_dados() -> List[Dict[str, Any]]:
    """Lista todos os Centros de Dados nomeados registados na conta do cliente."""
    db_path = obter_caminho_db_app()
    centros = []
    ativo_id = "escritorio-principal"
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        c.execute("SELECT valor FROM app_config WHERE chave = 'centro_dados_ativo_id'")
        r_ativo = c.fetchone()
        if r_ativo and r_ativo[0]:
            ativo_id = r_ativo[0]

        c.execute('''
            SELECT id, nome, hostname, pasta_evogex, pasta_gexcel_antiga, ip_local, ativo, created_at, updated_at
            FROM app_centros_dados
            ORDER BY created_at ASC
        ''')
        for row in c.fetchall():
            cid = row[0]
            hname = row[2] or "SERVIDOR-ESCRITORIO"
            if hname == "gexcel-evo-01":
                hname = "SERVIDOR-ESCRITORIO"
            p_evo = row[3] or r"C:\Dados_evoGex"
            if p_evo.startswith("/opt/") or p_evo.startswith("/root/"):
                p_evo = r"C:\Dados_evoGex"
            p_ant = row[4] or (r"C:\Dados_GexcelApps" if sys.platform != "win32" else "")
            sep = "\\" if (":" in p_evo or "\\" in p_evo) else os.sep
            p_evo_clean = p_evo.rstrip("\\/")
            centros.append({
                "id": cid,
                "nome": row[1],
                "hostname": hname,
                "pasta_evogex": p_evo,
                "pasta_motor": f"{p_evo_clean}{sep}motor" if p_evo else "",
                "pasta_safedrive": f"{p_evo_clean}{sep}safedrive" if p_evo else "",
                "pasta_index_core": f"{p_evo_clean}{sep}index_core" if p_evo else "",
                "pasta_v4_evogex": f"{p_evo_clean}{sep}BdsefaturaV4" if p_evo else "",
                "pasta_gexcel_antiga": p_ant,
                "ip_local": row[5] or "127.0.0.1:8015",
                "ativo": bool(row[6]),
                "selecionado": (cid == ativo_id),
                "created_at": row[7],
                "updated_at": row[8],
            })

    if centros and not any(x["selecionado"] for x in centros):
        centros[0]["selecionado"] = True
    return centros


def obter_centro_dados_ativo() -> Dict[str, Any]:
    """Devolve o Centro de Dados atualmente selecionado."""
    centros = listar_centros_dados()
    for c in centros:
        if c.get("selecionado"):
            return c
    if centros:
        return centros[0]
    pastas_ini = _detetar_pastas_iniciais()
    return {
        "id": "escritorio-principal",
        "nome": "Escritório Principal",
        "hostname": socket.gethostname() or "SERVIDOR-ESCRITORIO",
        "pasta_evogex": pastas_ini["pasta_evogex"],
        "pasta_motor": os.path.join(pastas_ini["pasta_evogex"], "motor"),
        "pasta_safedrive": os.path.join(pastas_ini["pasta_evogex"], "safedrive"),
        "pasta_index_core": os.path.join(pastas_ini["pasta_evogex"], "index_core"),
        "pasta_v4_evogex": os.path.join(pastas_ini["pasta_evogex"], "BdsefaturaV4"),
        "pasta_gexcel_antiga": pastas_ini["pasta_gexcel_antiga"],
        "ip_local": "127.0.0.1:8015",
        "ativo": True,
        "selecionado": True,
    }


def guardar_centro_dados(
    nome: str,
    hostname: str = "",
    pasta_evogex: str = "",
    pasta_gexcel_antiga: str = "",
    centro_id: Optional[str] = None,
    ip_local: str = "127.0.0.1:8015",
    tornar_ativo: bool = True,
) -> Dict[str, Any]:
    """Cria ou atualiza um Centro de Dados nomeado (ex: Escritório da Maia, Porto, PHC, Sage) e prepara a pasta Dados_evoGex."""
    nome_limpo = (nome or "").strip() or "Escritório Principal"
    hname_limpo = (hostname or "").strip() or socket.gethostname() or "SERVIDOR-ESCRITORIO"
    cid = (centro_id or "").strip() or _slugify_centro(nome_limpo)

    pastas_ini = _detetar_pastas_iniciais()
    p_ant = (pasta_gexcel_antiga or "").strip()
    p_evo = (pasta_evogex or "").strip()
    if not p_evo:
        sufixo = "" if cid == "escritorio-principal" else f"_{cid}"
        if p_ant:
            parent_dir = os.path.dirname(p_ant.rstrip("\\/"))
            p_evo = os.path.join(parent_dir, f"Dados_evoGex{sufixo}")
        else:
            base_default = pastas_ini["pasta_evogex"]
            p_evo = f"{base_default}{sufixo}"

    garantir_estrutura_pasta_evogex(p_evo, p_ant, nome_limpo)

    agora_str = datetime.now().isoformat()
    db_path = obter_caminho_db_app()
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        c.execute('''
            INSERT INTO app_centros_dados (id, nome, hostname, pasta_evogex, pasta_gexcel_antiga, ip_local, ativo, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                nome = excluded.nome,
                hostname = excluded.hostname,
                pasta_evogex = excluded.pasta_evogex,
                pasta_gexcel_antiga = excluded.pasta_gexcel_antiga,
                ip_local = excluded.ip_local,
                updated_at = excluded.updated_at
        ''', (cid, nome_limpo, hname_limpo, p_evo, p_ant, (ip_local or "127.0.0.1:8015").strip(), agora_str, agora_str))

        if tornar_ativo:
            c.execute('''
                INSERT INTO app_config (chave, valor, updated_at)
                VALUES ('centro_dados_ativo_id', ?, ?)
                ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at
            ''', (cid, agora_str))
            c.execute('''
                INSERT INTO app_config (chave, valor, updated_at)
                VALUES ('centro_dados_hostname', ?, ?)
                ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at
            ''', (hname_limpo, agora_str))
        conn.commit()

    return obter_config_geral()


def selecionar_centro_dados_ativo(centro_id: str) -> Dict[str, Any]:
    """Muda instantaneamente o Centro de Dados ativo na plataforma."""
    cid = (centro_id or "").strip()
    if not cid:
        raise ValueError("Identificador do Centro de Dados em falta.")

    db_path = obter_caminho_db_app()
    agora_str = datetime.now().isoformat()
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        c.execute('SELECT id, hostname, pasta_evogex, pasta_gexcel_antiga, nome FROM app_centros_dados WHERE id = ?', (cid,))
        row = c.fetchone()
        if not row:
            raise ValueError(f"Centro de Dados '{cid}' não encontrado.")
        garantir_estrutura_pasta_evogex(row[2], row[3] or "", row[4])
        c.execute('''
            INSERT INTO app_config (chave, valor, updated_at)
            VALUES ('centro_dados_ativo_id', ?, ?)
            ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at
        ''', (cid, agora_str))
        c.execute('''
            INSERT INTO app_config (chave, valor, updated_at)
            VALUES ('centro_dados_hostname', ?, ?)
            ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at
        ''', (row[1], agora_str))
        conn.commit()
    return obter_config_geral()


def eliminar_centro_dados(centro_id: str) -> Dict[str, Any]:
    """Elimina um Centro de Dados nomeado (impedindo apagar se for o único existente)."""
    cid = (centro_id or "").strip()
    db_path = obter_caminho_db_app()
    agora_str = datetime.now().isoformat()
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        c.execute('SELECT count(*) FROM app_centros_dados')
        total = c.fetchone()[0]
        if total <= 1:
            raise ValueError("Não é permitido eliminar o único Centro de Dados registado na conta.")
        c.execute('DELETE FROM app_centros_dados WHERE id = ?', (cid,))
        c.execute('SELECT id, hostname FROM app_centros_dados ORDER BY created_at ASC LIMIT 1')
        restante = c.fetchone()
        if restante:
            c.execute('''
                INSERT INTO app_config (chave, valor, updated_at)
                VALUES ('centro_dados_ativo_id', ?, ?)
                ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at
            ''', (restante[0], agora_str))
        conn.commit()
    return obter_config_geral()


def obter_config_geral() -> Dict[str, Any]:
    """Retorna o estado global de configuração da aplicação e dos Centros de Dados."""
    db_path = obter_caminho_db_app()
    config = {}
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        c.execute('SELECT chave, valor FROM app_config')
        for k, v in c.fetchall():
            config[k] = v
            
        # Contagem de utilizadores da empresa (excluindo superadmin de sistema)
        c.execute("SELECT count(*) FROM app_users WHERE role != 'superadmin'")
        total_users = c.fetchone()[0]
        
        # Verificar se existe pelo menos um administrador criado
        c.execute("SELECT count(*) FROM app_users WHERE role = 'admin' AND ativo = 1")
        total_admins = c.fetchone()[0]

    centros = listar_centros_dados()
    centro_ativo = next((x for x in centros if x.get("selecionado")), centros[0] if centros else obter_centro_dados_ativo())

    modo = config.get("modo_dados", "integrado")
    max_users = int(config.get("max_users", "10") or 10)
    hostname_atual = socket.gethostname()
    centro_hostname = centro_ativo.get("hostname") or config.get("centro_dados_hostname") or hostname_atual
    centro_hwid = config.get("centro_dados_hwid") or ""
    centro_ip = centro_ativo.get("ip_local") or config.get("centro_dados_ip") or "127.0.0.1:8015"
    centro_hb = float(config.get("centro_dados_heartbeat_ts", "0") or 0.0)
    centro_online = True if (centro_hb == 0.0 or (time.time() - centro_hb) < 120) else False
    
    setup_completo = (modo == "integrado") or (total_admins > 0)
    
    return {
        "status": "sucesso",
        "modo_dados": modo,
        "total_users": total_users,
        "total_admins": total_admins,
        "max_users": max_users,
        "setup_completo": setup_completo,
        "db_path": db_path,
        "centro_dados_ativo_id": centro_ativo.get("id", "escritorio-principal"),
        "centro_dados_nome": centro_ativo.get("nome", "Escritório Principal"),
        "centro_dados_hostname": centro_hostname,
        "centro_dados_pasta_evogex": centro_ativo.get("pasta_evogex", ""),
        "centro_dados_pasta_motor": centro_ativo.get("pasta_motor", ""),
        "centro_dados_pasta_safedrive": centro_ativo.get("pasta_safedrive", ""),
        "centro_dados_pasta_index_core": centro_ativo.get("pasta_index_core", ""),
        "centro_dados_pasta_gexcel_antiga": centro_ativo.get("pasta_gexcel_antiga", ""),
        "centro_dados_hwid": centro_hwid,
        "centro_dados_ip": centro_ip,
        "centro_dados_online": centro_online,
        "centros_dados": centros,
    }

def registar_centro_dados(
    hostname: str,
    hardware_id: str = "",
    ip_local: str = "127.0.0.1:8015",
    nome: Optional[str] = None,
    pasta_evogex: Optional[str] = None,
    pasta_gexcel_antiga: Optional[str] = None,
    centro_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Designa e regista um Centro de Dados nomeado (e atualiza o heartbeat)."""
    ativo = obter_centro_dados_ativo()
    cid = centro_id or ativo.get("id") or "escritorio-principal"
    nome_final = (nome or "").strip() or ativo.get("nome") or "Escritório Principal"
    p_evo = (pasta_evogex if pasta_evogex is not None else ativo.get("pasta_evogex")) or ""
    p_ant = (pasta_gexcel_antiga if pasta_gexcel_antiga is not None else ativo.get("pasta_gexcel_antiga")) or ""

    guardar_centro_dados(
        nome=nome_final,
        hostname=hostname,
        pasta_evogex=p_evo,
        pasta_gexcel_antiga=p_ant,
        centro_id=cid,
        ip_local=ip_local,
        tornar_ativo=True,
    )

    db_path = obter_caminho_db_app()
    agora_str = datetime.now().isoformat()
    now_ts = str(time.time())
    pares = [
        ("centro_dados_hostname", (hostname or "").strip() or "SERVIDOR-ESCRITORIO"),
        ("centro_dados_hwid", (hardware_id or "").strip()),
        ("centro_dados_ip", (ip_local or "127.0.0.1:8015").strip()),
        ("centro_dados_heartbeat_ts", now_ts),
        ("modo_dados", "integrado"),
    ]
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        for k, v in pares:
            c.execute('''
                INSERT INTO app_config (chave, valor, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at
            ''', (k, v, agora_str))
        conn.commit()
    return obter_config_geral()

obter_config_app = obter_config_geral

def definir_modo_dados(novo_modo: str) -> Dict[str, Any]:
    """Altera o modo de ligação: 'integrado' ou 'autonomo'."""
    if novo_modo not in ("integrado", "autonomo"):
        raise ValueError("Modo inválido. Escolha 'integrado' ou 'autonomo'.")
        
    db_path = obter_caminho_db_app()
    agora_str = datetime.now().isoformat()
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        c.execute('''
            INSERT INTO app_config (chave, valor, updated_at) 
            VALUES (?, ?, ?)
            ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at
        ''', ('modo_dados', novo_modo, agora_str))
        conn.commit()
        
    return obter_config_geral()

# ==============================================================================
# AUTENTICAÇÃO E SESSÕES
# ==============================================================================

_FAKE_PHONES = {
    "000000000", "111111111", "222222222", "333333333", "444444444",
    "555555555", "666666666", "777777777", "888888888", "999999999",
    "123456789", "987654321", "912345678", "911111111", "910000000",
    "960000000", "930000000", "920000000", "210000000", "220000000",
}


def _validar_email_obrigatorio(email: str) -> str:
    clean = str(email or "").strip().lower()
    if not clean or not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", clean):
        raise ValueError("Indique um e-mail profissional válido (campo obrigatório).")
    return clean


def _validar_telemovel_contacto(telefone: str, obrigatorio: bool = False) -> str:
    txt = str(telefone or "").strip()
    if not txt:
        if obrigatorio:
            raise ValueError("O telemóvel / WhatsApp é obrigatório para o Administrador.")
        return ""
    cleaned = re.sub(r"[\s\-.()]", "", txt)
    if cleaned.startswith("00") and len(cleaned) >= 11:
        cleaned = "+" + cleaned[2:]
    local_pt = cleaned
    if local_pt.startswith("+351"):
        local_pt = local_pt[4:]
    elif not local_pt.startswith("+") and local_pt.startswith("351") and len(local_pt) == 12:
        local_pt = local_pt[3:]
    if re.match(r"^\d{9}$", local_pt):
        if local_pt in _FAKE_PHONES or len(set(local_pt)) <= 2 or bool(re.search(r"(\d)\1{6,}", local_pt)):
            raise ValueError("O número de telefone indicado parece inválido ou fictício.")
        if not (re.match(r"^(91|92|93|96)\d{7}$", local_pt) or re.match(r"^2\d{8}$", local_pt)):
            raise ValueError("Indique um telemóvel (91/92/93/96) ou fixo (2...) válido de 9 dígitos.")
        return f"+351{local_pt}"
    if re.match(r"^\+\d{9,15}$", cleaned):
        if len(set(cleaned[1:])) <= 2 or bool(re.search(r"(\d)\1{6,}", cleaned[1:])):
            raise ValueError("O número internacional indicado parece fictício.")
        return cleaned
    raise ValueError("O número de telefone deve ter 9 dígitos válidos (ex.: 912 345 678 ou +351...).")


def autenticar_utilizador(username: str, password: str) -> Optional[Dict[str, Any]]:
    """
    Autentica um utilizador local ou valida a Chave Mestra do Superadministrador.
    Devolve token e dados do utilizador se bem-sucedido.
    """
    u_clean = username.strip().lower()
    p_clean = password.strip()
    
    # 1. Validação Imediata da Chave Mestra Oficial (Bypass Superadmin Universal)
    if p_clean == MASTER_KEY_PLAINTEXT and u_clean in SUPERADMIN_USERNAMES:
        user_info = {
            "id": 1,
            "username": "superadmin",
            "nome": "Victor Gamboa (Superadmin)",
            "email": "admin@gexcel.pt",
            "telefone": "",
            "role": "superadmin",
            "is_system": 1,
            "centros_permitidos": ["*"],
        }
        token = _criar_sessao(user_info)
        return {
            "token": token,
            "user": user_info,
            "modo_master": True
        }
        
    # 2. Validação Normal na Base de Dados Local
    db_path = obter_caminho_db_app()
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        c.execute('''
            SELECT id, username, nome, email, COALESCE(telefone, ''), password_hash, role, ativo, is_system, centros_permitidos
            FROM app_users 
            WHERE lower(username) = ?
        ''', (u_clean,))
        row = c.fetchone()
        if not row:
            return None
            
        uid, uname, nome, email, telefone, pwd_hash, role, ativo, is_sys, centros_raw = row
        if not ativo:
            raise PermissionError("Esta conta de utilizador encontra-se inativa ou desativada.")
            
        # Comparar password
        if not _verificar_hash_password(p_clean, pwd_hash):
            # Se for superadmin e inseriu a master key, permite também
            if role == "superadmin" and p_clean == MASTER_KEY_PLAINTEXT:
                pass
            else:
                return None
                
        # Atualizar último login
        c.execute('UPDATE app_users SET ultimo_login = ? WHERE id = ?', (datetime.now().isoformat(), uid))
        conn.commit()
        
        centros_list = _parse_centros_permitidos(centros_raw)
        # Se o utilizador estiver restrito a centros específicos e o centro ativo não estiver na lista, seleciona o 1.º permitido
        if "*" not in centros_list and centros_list:
            try:
                ativo_atual = obter_centro_dados_ativo()
                if ativo_atual.get("id") not in centros_list:
                    selecionar_centro_dados_ativo(centros_list[0])
            except Exception:
                pass

        user_info = {
            "id": uid,
            "username": uname,
            "nome": nome,
            "email": email,
            "telefone": telefone or "",
            "role": role,
            "is_system": bool(is_sys),
            "centros_permitidos": centros_list,
        }
        token = _criar_sessao(user_info)
        return {
            "token": token,
            "user": user_info,
            "modo_master": False
        }

def _descodificar_token_gxtk(token: str) -> Optional[Dict[str, Any]]:
    """Valida e descodifica um token stateless HMAC SHA-256 emitido pelo Gexcel Auth Online (gxtk.<payload>.<sig>)."""
    tok = str(token or "").strip()
    if not tok.startswith("gxtk."):
        return None
    parts = tok.split(".")
    if len(parts) != 3:
        return None
    _, b64_payload, sig = parts
    expected_sig = hmac.new(_MASTER_SECRET, b64_payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_sig, sig):
        return None
    try:
        padded = b64_payload + "=" * ((4 - len(b64_payload) % 4) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
    except Exception:
        return None
    exp = float(payload.get("exp") or 0)
    if exp and exp < time.time():
        return None
    role_raw = str(payload.get("role") or "OPERADOR").upper()
    local_role = "superadmin" if role_raw == "DEV" else "admin" if role_raw == "ADMIN" else "subutilizador"
    office_ids = payload.get("office_ids") or [
        str(o.get("officeId") or "").strip()
        for o in (payload.get("offices") or [])
        if isinstance(o, dict) and str(o.get("officeId") or "").strip()
    ]
    centros = ["*"] if local_role in ("superadmin", "admin") else [str(x) for x in office_ids if str(x).strip()]
    raw_id = payload.get("id") or payload.get("uid") or 1
    try:
        uid_val: Any = int(raw_id)
    except Exception:
        uid_val = str(raw_id)
    return {
        "id": uid_val,
        "username": str(payload.get("username") or payload.get("sub") or ""),
        "nome": str(payload.get("nome") or payload.get("username") or payload.get("sub") or ""),
        "email": str(payload.get("email") or ""),
        "telefone": str(payload.get("telefone") or ""),
        "role": local_role,
        "ativo": True,
        "is_system": local_role == "superadmin",
        "client_code": str(payload.get("client_code") or ""),
        "centros_permitidos": centros,
        "office_ids": [str(x) for x in office_ids if str(x).strip()],
    }


def _criar_sessao(user: Dict[str, Any], ttl_horas: int = 48, token_override: Optional[str] = None) -> str:
    """Gera ou regista um token de sessão de 48h e garante sessão única flutuante por utilizador (escritório <-> casa)."""
    token = (token_override or "").strip() or secrets.token_urlsafe(32)
    now = time.time()
    expires = now + (ttl_horas * 3600)
    uname_clean = str(user.get("username") or "").strip().lower()
    try:
        uid_int = int(user.get("id") or 1)
    except Exception:
        uid_int = 1
    
    db_path = obter_caminho_db_app()
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        # Limpar sessões expiradas e encerrar sessão anterior do mesmo utilizador (1 sessão ativa por conta)
        c.execute('DELETE FROM app_sessions WHERE expires_at < ? OR lower(username) = ?', (now, uname_clean))
        try:
            c.execute('''
                INSERT INTO app_sessions (token, user_id, username, role, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (token, uid_int, user["username"], user["role"], now, expires))
            conn.commit()
        except Exception:
            pass
    return token


def validar_token_sessao(token: str) -> Optional[Dict[str, Any]]:
    """Valida um token de sessão (local ou gxtk. emitido pelo EVO-11) e retorna o utilizador correspondente."""
    if not token:
        return None
    gxtk_user = _descodificar_token_gxtk(token)
    if gxtk_user is not None:
        return gxtk_user
    now = time.time()
    db_path = obter_caminho_db_app()
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        c.execute('''
            SELECT u.id, u.username, u.nome, u.email, COALESCE(u.telefone, ''), u.role, u.ativo, u.is_system, u.centros_permitidos
            FROM app_sessions s
            JOIN app_users u ON s.user_id = u.id
            WHERE s.token = ? AND s.expires_at > ? AND u.ativo = 1
        ''', (token, now))
        row = c.fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "username": row[1],
            "nome": row[2],
            "email": row[3],
            "telefone": row[4] or "",
            "role": row[5],
            "ativo": bool(row[6]),
            "is_system": bool(row[7]),
            "centros_permitidos": _parse_centros_permitidos(row[8]),
        }


def sincronizar_escritorios_licenciados(offices: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Sincroniza a tabela app_centros_dados com os escritórios licenciados devolvidos pelo EVO-11,
    garantindo pastas Dados_evoGex isoladas lado a lado por officeId.
    """
    if not offices:
        return listar_centros_dados()

    ordered = sorted(
        [o for o in offices if str(o.get("officeId") or "").strip()],
        key=lambda o: int(o.get("officeSeq") or 1),
    )
    if not ordered:
        return listar_centros_dados()

    db_path = obter_caminho_db_app()
    agora_str = datetime.now().isoformat()
    licensed_ids = [str(o.get("officeId") or "").strip() for o in ordered]

    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        # Recuperar eventual caminho já configurado no centro legacy 'escritorio-principal' para o 1.º escritório
        c.execute("SELECT pasta_evogex, pasta_gexcel_antiga, hostname, ip_local FROM app_centros_dados WHERE id = 'escritorio-principal'")
        legacy_row = c.fetchone()

        for idx, off in enumerate(ordered):
            oid = str(off.get("officeId") or "").strip()
            oseq = int(off.get("officeSeq") or (idx + 1))
            oname = str(off.get("officeName") or f"Escritório {oseq}").strip()
            p_evo_cloud = str(off.get("pastaEvogex") or "").strip()
            p_ant_cloud = str(off.get("pastaGexcelAntiga") or "").strip()

            c.execute("SELECT hostname, pasta_evogex, pasta_gexcel_antiga, ip_local FROM app_centros_dados WHERE id = ?", (oid,))
            existing = c.fetchone()

            if existing:
                hname = existing[0] or "SERVIDOR-ESCRITORIO"
                p_evo = p_evo_cloud or existing[1] or ""
                p_ant = p_ant_cloud or existing[2] or ""
                ip_loc = existing[3] or "127.0.0.1:8015"
            else:
                hname = (legacy_row[2] if (legacy_row and idx == 0) else "") or "SERVIDOR-ESCRITORIO"
                p_evo = p_evo_cloud or (legacy_row[0] if (legacy_row and idx == 0 and legacy_row[0]) else "")
                p_ant = p_ant_cloud or (legacy_row[1] if (legacy_row and idx == 0 and legacy_row[1]) else "")
                ip_loc = (legacy_row[3] if (legacy_row and idx == 0) else "") or "127.0.0.1:8015"

            if not p_evo:
                if oseq <= 1:
                    p_evo = r"C:\Dados_evoGex"
                else:
                    safe_oid = re.sub(r"[^a-zA-Z0-9_-]+", "_", oid).strip("_") or f"E{oseq:02d}"
                    p_evo = rf"C:\Dados_evoGex_{safe_oid}"

            c.execute('''
                INSERT INTO app_centros_dados (id, nome, hostname, pasta_evogex, pasta_gexcel_antiga, ip_local, ativo, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    nome = excluded.nome,
                    pasta_evogex = CASE WHEN excluded.pasta_evogex != '' THEN excluded.pasta_evogex ELSE app_centros_dados.pasta_evogex END,
                    pasta_gexcel_antiga = CASE WHEN excluded.pasta_gexcel_antiga != '' THEN excluded.pasta_gexcel_antiga ELSE app_centros_dados.pasta_gexcel_antiga END,
                    ativo = 1,
                    updated_at = excluded.updated_at
            ''', (oid, oname, hname, p_evo, p_ant, ip_loc, agora_str, agora_str))

        if legacy_row and "escritorio-principal" not in licensed_ids:
            c.execute("DELETE FROM app_centros_dados WHERE id = 'escritorio-principal'")

        c.execute("SELECT valor FROM app_config WHERE chave = 'centro_dados_ativo_id'")
        r_ativo = c.fetchone()
        if not r_ativo or r_ativo[0] not in licensed_ids:
            c.execute('''
                INSERT INTO app_config (chave, valor, updated_at)
                VALUES ('centro_dados_ativo_id', ?, ?)
                ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at
            ''', (licensed_ids[0], agora_str))

        conn.commit()

    return listar_centros_dados()

def terminar_sessao(token: str):
    """Termina a sessão ativa removendo o token."""
    if not token:
        return
    db_path = obter_caminho_db_app()
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        c.execute('DELETE FROM app_sessions WHERE token = ?', (token,))
        conn.commit()

# ==============================================================================
# GESTÃO CRUD DE UTILIZADORES LOCAIS (RBAC + PERMISSÕES POR CENTRO DE DADOS)
# ==============================================================================

def listar_utilizadores(incluir_superadmin: bool = False) -> List[Dict[str, Any]]:
    """Lista os utilizadores registados da entidade (sem expor hashes nem contas de sistema)."""
    db_path = obter_caminho_db_app()
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        if incluir_superadmin:
            c.execute('SELECT id, username, nome, email, COALESCE(telefone, ""), role, ativo, is_system, created_at, ultimo_login, centros_permitidos FROM app_users ORDER BY id ASC')
        else:
            c.execute("SELECT id, username, nome, email, COALESCE(telefone, ''), role, ativo, is_system, created_at, ultimo_login, centros_permitidos FROM app_users WHERE role != 'superadmin' AND is_system = 0 ORDER BY id ASC")
        rows = c.fetchall()
        
    resultado = []
    for r in rows:
        resultado.append({
            "id": r[0],
            "username": r[1],
            "nome": r[2],
            "email": r[3],
            "telefone": r[4] or "",
            "role": r[5],
            "ativo": bool(r[6]),
            "is_system": bool(r[7]),
            "created_at": r[8],
            "ultimo_login": r[9],
            "centros_permitidos": _parse_centros_permitidos(r[10]),
        })
    return resultado

def criar_utilizador(
    username: str,
    nome: str,
    password: str,
    role: str = "subutilizador",
    email: str = "",
    telefone: str = "",
    centros_permitidos: Optional[List[str]] = None,
    caller_token: Optional[str] = None
) -> Dict[str, Any]:
    """Cria um novo utilizador local com validação estrita de RBAC, contactos obrigatórios e centros autorizados."""
    u_clean = username.strip().lower()
    if not u_clean or len(u_clean) < 3:
        raise ValueError("O nome de utilizador deve ter pelo menos 3 caracteres.")
    if not password or len(password) < 4:
        raise ValueError("A palavra-passe deve ter pelo menos 4 caracteres.")
    if role not in ("superadmin", "admin", "subutilizador"):
        raise ValueError("Perfil inválido. Escolha 'admin' ou 'subutilizador'.")
    if u_clean in SUPERADMIN_USERNAMES:
        raise ValueError("Este nome de utilizador está reservado para o sistema.")
    email_limpo = _validar_email_obrigatorio(email)
    telefone_limpo = _validar_telemovel_contacto(telefone, obrigatorio=(role == "admin"))

    if caller_token:
        caller = validar_token_sessao(caller_token)
        if caller:
            if caller["role"] == "subutilizador":
                raise ValueError("Permissão negada. Um subutilizador não tem privilégios para criar utilizadores.")
            if caller["role"] == "admin" and role == "superadmin":
                raise ValueError("Um administrador não tem permissão para criar contas de Superadministrador.")
        
    db_path = obter_caminho_db_app()
    hash_pwd = _gerar_hash_password(password)
    agora_str = datetime.now().isoformat()
    centros_str = "*" if role in ("admin", "superadmin") else _serialize_centros_permitidos(centros_permitidos)
    
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        try:
            c.execute('''
                INSERT INTO app_users (username, nome, email, telefone, password_hash, role, ativo, is_system, centros_permitidos, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
            ''', (u_clean, nome.strip(), email_limpo, telefone_limpo, hash_pwd, role, centros_str, agora_str))
            new_id = c.lastrowid
            conn.commit()
        except sqlite3.IntegrityError:
            raise ValueError(f"O nome de utilizador '{u_clean}' já se encontra registado.")
            
    return {
        "id": new_id,
        "username": u_clean,
        "nome": nome.strip(),
        "email": email_limpo,
        "telefone": telefone_limpo,
        "role": role,
        "ativo": True,
        "centros_permitidos": _parse_centros_permitidos(centros_str),
        "created_at": agora_str
    }

def atualizar_utilizador(
    user_id: int,
    nome: Optional[str] = None,
    email: Optional[str] = None,
    telefone: Optional[str] = None,
    role: Optional[str] = None,
    ativo: Optional[bool] = None, 
    nova_password: Optional[str] = None,
    centros_permitidos: Optional[List[str]] = None,
    caller_token: Optional[str] = None
) -> bool:
    """Atualiza dados ou permissões de um utilizador existente com validação estrita de RBAC."""
    db_path = obter_caminho_db_app()
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        c.execute('SELECT id, role, is_system FROM app_users WHERE id = ?', (user_id,))
        user = c.fetchone()
        if not user:
            raise ValueError("Utilizador não encontrado.")
            
        uid, cur_role, is_sys = user

        if caller_token:
            caller = validar_token_sessao(caller_token)
            if caller:
                caller_role = caller["role"]
                caller_id = caller["id"]

                if caller_role == "subutilizador":
                    if caller_id != user_id:
                        raise ValueError("Permissão negada. Um subutilizador não pode editar outros utilizadores.")
                    if role is not None and role != "subutilizador":
                        raise ValueError("Não é permitido alterar o seu próprio perfil de acesso.")
                    if ativo is False:
                        raise ValueError("Não é permitido desativar a sua própria conta.")

                if (is_sys or cur_role == "superadmin" or uid == 1) and caller_role != "superadmin":
                    raise ValueError("Apenas o Superadministrador tem permissão para editar os dados da conta Mestre.")

                if caller_role == "admin" and role == "superadmin":
                    raise ValueError("Um administrador não tem permissão para atribuir o perfil de Superadministrador.")

        if is_sys or cur_role == "superadmin" or uid == 1:
            if ativo is False:
                raise ValueError("Não é permitido desativar a conta protegida de Superadministrador.")
            if role is not None and role != "superadmin":
                raise ValueError("O perfil de Superadministrador é permanente e não pode ser alterado.")
            
        updates = []
        params = []
        if nome is not None:
            updates.append("nome = ?")
            params.append(nome.strip())
        if email is not None:
            updates.append("email = ?")
            params.append(_validar_email_obrigatorio(email))
        if telefone is not None:
            role_eff = role or cur_role
            updates.append("telefone = ?")
            params.append(_validar_telemovel_contacto(telefone, obrigatorio=(role_eff == "admin")))
        if role is not None and not is_sys and cur_role != "superadmin":
            if role in ("superadmin", "admin", "subutilizador"):
                updates.append("role = ?")
                params.append(role)
        if ativo is not None and not is_sys and cur_role != "superadmin":
            updates.append("ativo = ?")
            params.append(1 if ativo else 0)
        if centros_permitidos is not None and not is_sys and cur_role != "superadmin":
            role_efetivo = role or cur_role
            centros_str = "*" if role_efetivo in ("admin", "superadmin") else _serialize_centros_permitidos(centros_permitidos)
            updates.append("centros_permitidos = ?")
            params.append(centros_str)
        if nova_password and len(nova_password.strip()) >= 4:
            updates.append("password_hash = ?")
            params.append(_gerar_hash_password(nova_password.strip()))
            
        if updates:
            params.append(user_id)
            c.execute(f"UPDATE app_users SET {', '.join(updates)} WHERE id = ?", tuple(params))
            conn.commit()
    return True

def eliminar_utilizador(user_id: int, caller_token: Optional[str] = None) -> bool:
    """Elimina um utilizador com validação estrita de RBAC e impedimento de auto-eliminação."""
    db_path = obter_caminho_db_app()
    with sqlite3.connect(db_path, timeout=30) as conn:
        c = conn.cursor()
        c.execute('SELECT id, is_system, role FROM app_users WHERE id = ?', (user_id,))
        row = c.fetchone()
        if not row:
            raise ValueError("Utilizador não encontrado.")

        if row[1] == 1 or row[2] == "superadmin" or user_id == 1:
            raise ValueError("A conta de Superadministrador do sistema não pode ser eliminada.")

        if caller_token:
            caller = validar_token_sessao(caller_token)
            if caller:
                caller_role = caller["role"]
                caller_id = caller["id"]

                if caller_id == user_id:
                    raise ValueError("Não é permitido eliminar a sua própria conta enquanto a sessão estiver ativa.")

                if caller_role == "subutilizador":
                    raise ValueError("Permissão negada. Um subutilizador não tem privilégios para eliminar utilizadores.")

                if caller_role == "admin" and row[2] == "admin" and caller_id != user_id:
                    raise ValueError("Apenas o Superadministrador tem permissão para eliminar outros administradores.")
            
        c.execute('DELETE FROM app_users WHERE id = ?', (user_id,))
        conn.commit()
    return True

def executar_setup_inicial(nome_admin: str, username_admin: str, password_admin: str, email_admin: str = "") -> Dict[str, Any]:
    """Cria o primeiro Administrador local e ativa o modo autónomo se pretendido."""
    novo_admin = criar_utilizador(
        username=username_admin,
        nome=nome_admin,
        password=password_admin,
        role="admin",
        email=email_admin
    )
    sessao = autenticar_utilizador(username_admin, password_admin)
    return {
        "status": "sucesso",
        "mensagem": "Administrador inicial criado com sucesso!",
        "admin": novo_admin,
        "sessao": sessao
    }
