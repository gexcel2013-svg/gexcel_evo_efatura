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
_WS_LOCK = threading.RLock()
_WORKSPACES_RAM: Dict[str, Dict[str, Any]] = {}
_TTL_INATIVO_SEG = 12 * 3600  # 12 horas
_TMP_BASE_DIR = Path("/tmp/gexcel_evo06_ws") if sys.platform != "win32" else (Path(tempfile.gettempdir()) / "gexcel_evo06_ws")
_SANDBOX_BASE_DIR = Path("/dev/shm/evo_support_sandboxes") if Path("/dev/shm").is_dir() else (Path(tempfile.gettempdir()) / "evo_support_sandboxes")


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


def _limpar_workspaces_expirados_locked(agora: Optional[float] = None) -> None:
    now = agora if agora is not None else time.time()
    expirados = [
        wid
        for wid, entry in list(_WORKSPACES_RAM.items())
        if (now - float(entry.get("updated_at") or 0.0)) > _TTL_INATIVO_SEG
    ]
    for wid in expirados:
        _WORKSPACES_RAM.pop(wid, None)
        ws_dir = _TMP_BASE_DIR / wid
        try:
            if ws_dir.exists():
                shutil.rmtree(ws_dir, ignore_errors=True)
        except Exception:
            pass


def wrap_thread_target(fn: Callable[..., Any], ws_id: Optional[str] = None) -> Callable[..., Any]:
    """Propaga o workspace_id atual para threads e executors em segundo plano."""
    captured_ws = sanitize_ws_id(ws_id if ws_id is not None else get_current_ws_id())

    @wraps(fn)
    def _runner(*args: Any, **kwargs: Any) -> Any:
        tok = set_current_ws_id(captured_ws)
        try:
            return fn(*args, **kwargs)
        finally:
            reset_current_ws_id(tok)

    return _runner


def set_entidades_ram(entidades: List[Dict[str, Any]], ws_id: Optional[str] = None) -> int:
    """Guarda entidades exclusivamente na RAM do workspace autenticado."""
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
    wid = sanitize_ws_id(ws_id if ws_id is not None else get_current_ws_id())
    root = _TMP_BASE_DIR / wid
    root.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(_TMP_BASE_DIR, 0o700)
        os.chmod(root, 0o700)
    except Exception:
        pass
    return str(root.resolve())
