# -*- coding: utf-8 -*-
"""
workspace_context.py - Isolamento Estrito Zero-Storage por Posto/Browser na Cloud.

Garante que, em servidores Cloud Linux (Hetzner), cada sessao de browser/posto
recebe um identificador isolado (`X-Evo-Workspace-Id`) e opera estritamente:
- Entidades e credenciais (`tCredenciais.xml`) apenas em RAM efemera por workspace_id
  (nunca lendo nem escrevendo entidades no disco partilhado do servidor).
- Bases SQLite temporarias apenas em `/tmp/gexcel_evo06_ws/<workspace_id>/BdsefaturaV4`
  enquanto sincronizadas de/para a pasta local `Dados_evoGex` do cliente via browser.
- Postos sem workspace vinculado veem sempre 0 entidades (`[]`).
"""

from __future__ import annotations

import contextvars
import os
import re
import shutil
import sys
import tempfile
import threading
import time
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

_CTX_WS_ID: contextvars.ContextVar[str] = contextvars.ContextVar("evo_ws_id", default="")
_CTX_RAW_WS_ID: contextvars.ContextVar[str] = contextvars.ContextVar("evo_raw_ws_id", default="")
_CTX_AUTH_USER: contextvars.ContextVar[Optional[Dict[str, Any]]] = contextvars.ContextVar("evo_auth_user", default=None)
_WS_LOCK = threading.RLock()
_WORKSPACES_RAM: Dict[str, Dict[str, Any]] = {}
_WS_OWNERS: Dict[str, str] = {}
_LAST_SWEEP_TS: float = 0.0
_TTL_INATIVO_SEG = 12 * 3600  # 12 horas
_TMP_BASE_DIR = Path("/tmp/gexcel_evo06_ws") if sys.platform != "win32" else (Path(tempfile.gettempdir()) / "gexcel_evo06_ws")
_SANDBOX_BASE_DIR = Path("/dev/shm/evo_support_sandboxes") if Path("/dev/shm").is_dir() else (Path(tempfile.gettempdir()) / "evo_support_sandboxes")


def set_current_auth_user(user: Optional[Dict[str, Any]]) -> contextvars.Token:
    return _CTX_AUTH_USER.set(dict(user) if isinstance(user, dict) else None)


def reset_current_auth_user(token: contextvars.Token) -> None:
    _CTX_AUTH_USER.reset(token)


def get_current_auth_user() -> Optional[Dict[str, Any]]:
    val = _CTX_AUTH_USER.get(None)
    return dict(val) if isinstance(val, dict) else None


def bind_or_verify_ws_owner(ws_id: Optional[str], tenant_key: str, is_dev: bool = False) -> bool:
    """Vincula cada workspace ao primeiro tenant autenticado e bloqueia acesso cruzado entre clientes."""
    wid = sanitize_ws_id(ws_id)
    if wid == "unlinked_empty":
        return True
    if wid.startswith("sbx_"):
        return bool(is_dev)
    tkey = str(tenant_key or "").strip()
    if not tkey:
        return bool(is_dev)
    with _WS_LOCK:
        owner = _WS_OWNERS.get(wid)
        if not owner:
            _WS_OWNERS[wid] = tkey
            return True
        if owner == tkey or is_dev:
            return True
        return False


def limpar_workspaces_expirados_disco(forcar: bool = False) -> int:
    """Remove diretórios efémeros inativos (>12h) mesmo após reinícios ou sem entidades em RAM."""
    global _LAST_SWEEP_TS
    now = time.time()
    with _WS_LOCK:
        if not forcar and (now - _LAST_SWEEP_TS) < 1800.0:
            return 0
        _LAST_SWEEP_TS = now
        removidos = 0
        if not _TMP_BASE_DIR.exists():
            return 0
        try:
            for item in list(_TMP_BASE_DIR.iterdir()):
                if not item.is_dir():
                    continue
                if item.name != "unlinked_empty" and not item.name.startswith("ws_"):
                    continue
                latest_mtime = 0.0
                try:
                    latest_mtime = item.stat().st_mtime
                    for root, dirs, files in os.walk(item):
                        rel = os.path.relpath(root, item)
                        depth = 0 if rel == "." else rel.count(os.sep) + 1
                        if depth >= 3:
                            dirs[:] = []
                        for fname in files:
                            try:
                                st = os.stat(os.path.join(root, fname))
                                if st.st_mtime > latest_mtime:
                                    latest_mtime = st.st_mtime
                            except Exception:
                                pass
                except Exception:
                    continue
                if (now - latest_mtime) > _TTL_INATIVO_SEG:
                    shutil.rmtree(item, ignore_errors=True)
                    _WORKSPACES_RAM.pop(item.name, None)
                    _WS_OWNERS.pop(item.name, None)
                    removidos += 1
        except Exception:
            pass
        return removidos


def resolve_sandbox_dir(ws_id: Optional[str] = None) -> Optional[Path]:
    raw = str(ws_id if ws_id is not None else get_current_ws_id()).strip()
    if not raw.lower().startswith("sbx_"):
        return None
    sbx_id = re.sub(r"[^A-Za-z0-9-]", "", raw[4:].upper())
    if not re.match(r"^SBX-[A-Z0-9]{6,16}$", sbx_id):
        return None
    sbx_dir = _SANDBOX_BASE_DIR / sbx_id
    meta_path = sbx_dir / "meta.json"
    if not meta_path.is_file():
        return None
    try:
        import json
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if float(meta.get("expires_ts") or 0) <= time.time():
            return None
    except Exception:
        return None
    return sbx_dir


def is_cloud_zero_storage() -> bool:
    """True apenas em ambiente Linux Cloud sem override explicito de pasta fixa."""
    return sys.platform != "win32" and os.environ.get("GEXCEL_DISABLE_ZERO_STORAGE", "") != "1"


def sanitize_ws_id(raw: Optional[str]) -> str:
    s = str(raw or "").strip()
    if s.lower().startswith("sbx_"):
        sbx = re.sub(r"[^A-Za-z0-9-]", "", s[4:].upper())
        if re.match(r"^SBX-[A-Z0-9]{6,16}$", sbx):
            return f"sbx_{sbx}"
    clean = re.sub(r"[^A-Za-z0-9_-]", "", s)
    if len(clean) < 8:
        return "unlinked_empty"
    return clean[:64]


def set_current_ws_id(raw: Optional[str]) -> contextvars.Token:
    wid = sanitize_ws_id(raw)
    return _CTX_WS_ID.set(wid)


def reset_current_ws_id(token: contextvars.Token) -> None:
    _CTX_WS_ID.reset(token)


def get_current_ws_id() -> str:
    raw = _CTX_WS_ID.get("")
    return sanitize_ws_id(raw)


def set_current_raw_ws_id(raw: Optional[str]) -> contextvars.Token:
    wid = sanitize_ws_id(raw)
    return _CTX_RAW_WS_ID.set(wid)


def reset_current_raw_ws_id(token: contextvars.Token) -> None:
    _CTX_RAW_WS_ID.reset(token)


def get_current_raw_ws_id() -> str:
    raw = _CTX_RAW_WS_ID.get("")
    return sanitize_ws_id(raw)


def _limpar_workspaces_expirados_locked(agora: Optional[float] = None) -> None:
    now = agora if agora is not None else time.time()
    expirados = [
        wid
        for wid, entry in list(_WORKSPACES_RAM.items())
        if (now - float(entry.get("updated_at") or 0.0)) > _TTL_INATIVO_SEG
    ]
    for wid in expirados:
        _WORKSPACES_RAM.pop(wid, None)
        _WS_OWNERS.pop(wid, None)
        ws_dir = _TMP_BASE_DIR / wid
        try:
            if ws_dir.exists():
                shutil.rmtree(ws_dir, ignore_errors=True)
        except Exception:
            pass
    limpar_workspaces_expirados_disco(forcar=False)


def wrap_thread_target(fn: Callable[..., Any], ws_id: Optional[str] = None) -> Callable[..., Any]:
    """Propaga o workspace_id, workspace bruto e utilizador autenticado para threads e executors em segundo plano."""
    captured_ws = sanitize_ws_id(ws_id if ws_id is not None else get_current_ws_id())
    captured_raw_ws = get_current_raw_ws_id()
    captured_user = get_current_auth_user()

    @wraps(fn)
    def _runner(*args: Any, **kwargs: Any) -> Any:
        tok_ws = set_current_ws_id(captured_ws)
        tok_raw_ws = set_current_raw_ws_id(captured_raw_ws)
        tok_user = set_current_auth_user(captured_user)
        try:
            return fn(*args, **kwargs)
        finally:
            reset_current_auth_user(tok_user)
            reset_current_raw_ws_id(tok_raw_ws)
            reset_current_ws_id(tok_ws)

    return _runner


def set_entidades_ram(entidades: List[Dict[str, Any]], ws_id: Optional[str] = None) -> int:
    """Guarda entidades exclusivamente na RAM do workspace autenticado."""
    limpar_workspaces_expirados_disco(forcar=False)
    wid = sanitize_ws_id(ws_id if ws_id is not None else get_current_ws_id())
    if wid == "unlinked_empty":
        return 0

    copia = [dict(e) for e in (entidades or [])]
    agora = time.time()
    with _WS_LOCK:
        _limpar_workspaces_expirados_locked(agora)
        _WORKSPACES_RAM[wid] = {
            "updated_at": agora,
            "entidades": copia,
        }
    return len(copia)


def get_entidades_ram(ws_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Devolve as entidades em RAM apenas deste workspace (nunca dados globais)."""
    limpar_workspaces_expirados_disco(forcar=False)
    wid = sanitize_ws_id(ws_id if ws_id is not None else get_current_ws_id())
    if wid == "unlinked_empty":
        return []

    agora = time.time()
    with _WS_LOCK:
        _limpar_workspaces_expirados_locked(agora)
        entry = _WORKSPACES_RAM.get(wid)
        if not entry:
            return []
        entry["updated_at"] = agora
        return [dict(e) for e in (entry.get("entidades") or [])]


def clear_workspace(ws_id: Optional[str] = None, keep_entidades: bool = True) -> None:
    limpar_workspaces_expirados_disco(forcar=False)
    wid = sanitize_ws_id(ws_id if ws_id is not None else get_current_ws_id())
    with _WS_LOCK:
        if not keep_entidades:
            _WORKSPACES_RAM.pop(wid, None)
        v4_dir = _TMP_BASE_DIR / wid / "BdsefaturaV4"
        try:
            if v4_dir.exists():
                shutil.rmtree(v4_dir, ignore_errors=True)
        except Exception:
            pass


def get_ephemeral_root_dir(ws_id: Optional[str] = None) -> str:
    """Retorna pasta efemera isolada para operacao SQLite em buffer do workspace (ou Espelho Temporario Hetzner)."""
    sbx_dir = resolve_sandbox_dir(ws_id)
    if sbx_dir is not None:
        sbx_dir.mkdir(parents=True, exist_ok=True)
        (sbx_dir / "BdsefaturaV4").mkdir(parents=True, exist_ok=True)
        return str(sbx_dir.resolve())
    limpar_workspaces_expirados_disco(forcar=False)
    wid = sanitize_ws_id(ws_id if ws_id is not None else get_current_ws_id())
    root = _TMP_BASE_DIR / wid
    root.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(_TMP_BASE_DIR, 0o700)
        os.chmod(root, 0o700)
    except Exception:
        pass
    return str(root.resolve())
