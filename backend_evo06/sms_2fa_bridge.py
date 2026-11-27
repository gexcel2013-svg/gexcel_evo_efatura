"""
Gexcel SafeBridge SMS 2FA Multi-Tenant — Cofre Efêmero Zero-Storage em RAM (Hetzner / EVO-06)
==============================================================================================
Recebe códigos 2FA (Portal das Finanças AT, Recibos Verdes, Bancos) diretamente do telemóvel
via HTTPS POST (MacroDroid Pro Android ou Atalhos Apple iPhone), valida assinatura HMAC por
workspace/tenant, aplica filtro estrito de privacidade contra SMS pessoais, extrai apenas o
código numérico para RAM efêmera (TTL máx. 5 minutos) e destrói o código logo após o consumo.
"""

import os
import re
import hmac
import time
import html
import hashlib
import secrets
import threading
import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

OTP_TTL_SECONDS = 300  # 5 minutos máx. em RAM

ALLOWED_CONTEXT_KEYWORDS = (
    "at", "finanças", "financas", "tributária", "tributaria", "portaldasfinancas",
    "acesso.gov", "código", "codigo", "code", "otp", "pin", "chave", "autoriza",
    "autentica", "verifica", "segurança", "seguranca", "fator", "factor",
    "montepio", "net24", "banco", "3d secure", "segurança social", "seguranca social",
    "login", "sessão", "sessao", "teste", "gexcel", "evogex",
)

_SECRET_LOCK = threading.Lock()
_CACHED_SERVER_SECRET: Optional[bytes] = None
_VAULT_LOCK = threading.Lock()
_RAM_BUCKETS: Dict[str, List[Dict]] = {}


def _get_server_secret() -> bytes:
    """Obtém ou gera o segredo HMAC local do servidor para assinar tokens multi-tenant."""
    global _CACHED_SERVER_SECRET
    if _CACHED_SERVER_SECRET is not None:
        return _CACHED_SERVER_SECRET
    with _SECRET_LOCK:
        if _CACHED_SERVER_SECRET is not None:
            return _CACHED_SERVER_SECRET
        env_secret = (os.getenv("SMS_BRIDGE_SECRET") or "").strip()
        if env_secret:
            _CACHED_SERVER_SECRET = env_secret.encode("utf-8")
            return _CACHED_SERVER_SECRET
        secret_file = Path(__file__).resolve().parent / ".sms_bridge_secret"
        try:
            if secret_file.exists():
                raw = secret_file.read_text(encoding="utf-8", errors="ignore").strip()
                if len(raw) >= 32:
                    _CACHED_SERVER_SECRET = raw.encode("utf-8")
                    return _CACHED_SERVER_SECRET
            generated = secrets.token_hex(32)
            secret_file.write_text(generated, encoding="utf-8")
            try:
                os.chmod(secret_file, 0o600)
            except Exception:
                pass
            _CACHED_SERVER_SECRET = generated.encode("utf-8")
            return _CACHED_SERVER_SECRET
        except Exception:
            fallback = hashlib.sha256(f"evogex-sms-bridge-{os.getpid()}".encode("utf-8")).hexdigest()
            _CACHED_SERVER_SECRET = fallback.encode("utf-8")
            return _CACHED_SERVER_SECRET


def get_tenant_bucket_id(tenant_key: str) -> str:
    """Deriva o identificador determinístico e isolado do balde RAM para um workspace/tenant."""
    clean = str(tenant_key or "default").strip() or "default"
    return hashlib.sha256(f"tenant:{clean}".encode("utf-8")).hexdigest()[:10].upper()


def get_tenant_webhook_token(tenant_key: str) -> str:
    """Gera o token HTTPS HMAC determinístico exclusivo de um workspace/tenant."""
    tid = get_tenant_bucket_id(tenant_key)
    sig = hmac.new(_get_server_secret(), tid.encode("utf-8"), hashlib.sha256).hexdigest()[:12].upper()
    return f"GX2FA-{tid}-{sig}"


def validate_webhook_token(token_provided: str) -> Optional[str]:
    """Valida assinatura HMAC do token recebido do telemóvel e devolve o bucket_id ou None."""
    raw = str(token_provided or "").strip().upper()
    parts = raw.split("-")
    if len(parts) != 3 or parts[0] != "GX2FA":
        return None
    tid, sig_rec = parts[1], parts[2]
    if not re.fullmatch(r"[0-9A-F]{10}", tid) or not re.fullmatch(r"[0-9A-F]{12}", sig_rec):
        return None
    expected_sig = hmac.new(_get_server_secret(), tid.encode("utf-8"), hashlib.sha256).hexdigest()[:12].upper()
    if hmac.compare_digest(sig_rec, expected_sig):
        return tid
    return None


def _purge_expired_locked(bucket_id: str, now_ts: float) -> None:
    items = _RAM_BUCKETS.get(bucket_id, [])
    kept = [
        item for item in items
        if (now_ts - item["timestamp"]) <= OTP_TTL_SECONDS and not item.get("consumed", False)
    ]
    if kept:
        _RAM_BUCKETS[bucket_id] = kept
    else:
        _RAM_BUCKETS.pop(bucket_id, None)


def _mask_sender(sender: str) -> str:
    s = (sender or "").strip()
    if not s:
        return "Desconhecido"
    if len(s) <= 4:
        return s
    return s[:3] + "***" + s[-2:]


def detect_portal_from_sms(sender: str, text: str) -> str:
    combined = f"{sender or ''} {text or ''}".lower()
    if any(k in combined for k in ("finanças", "financas", "tributária", "tributaria", "portaldasfinancas", "acesso.gov", "portal at", " at ", "at:")):
        return "AT"
    if "segurança social" in combined or "seguranca social" in combined or "ssd" in combined:
        return "SSD"
    if "montepio" in combined or "net24" in combined:
        return "MONTEPIO"
    if "teste" in combined:
        return "TESTE"
    if any(k in combined for k in ("banco", "3d secure", "cartão", "extrato")):
        return "BANCO"
    return "GERAL"


def extract_otp_code(text: str) -> Optional[str]:
    """Extrai o código numérico de autenticação (4 a 8 dígitos), priorizando 6 dígitos."""
    if not text:
        return None
    cleaned = re.sub(r"\+?\d{9,15}", " ", text)
    cleaned = re.sub(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b", " ", cleaned)
    cleaned = re.sub(r"\b\d{1,2}:\d{2}(?::\d{2})?\b", " ", cleaned)

    six_digits = re.findall(r"\b(\d{6})\b", cleaned)
    if six_digits:
        return six_digits[-1]

    other_digits = re.findall(r"\b(\d{4,8})\b", cleaned)
    if other_digits:
        return other_digits[-1]

    return None


def receive_sms_webhook(token_provided: str, raw_text: str, sender: str = "") -> Tuple[int, Dict]:
    """
    Valida token HMAC do workspace, aplica filtro de privacidade contra SMS pessoais,
    extrai apenas o código OTP numérico e guarda-o temporariamente em RAM (máx. 5 min).
    """
    bucket_id = validate_webhook_token(token_provided)
    if not bucket_id:
        return 401, {"ok": False, "erro": "Token de autorização inválido."}

    txt = (raw_text or "").strip()
    if not txt:
        return 400, {"ok": False, "erro": "Corpo da mensagem vazio."}

    txt_clean = txt
    for placeholder in ("{sms_message}", "[sms_message]", "{not_text}", "[not_text]"):
        txt_clean = txt_clean.replace(placeholder, " ")
    txt_clean = " ".join(txt_clean.split()).strip()

    combined_lower = f"{sender or ''} {txt_clean}".lower()
    has_keyword = any(kw in combined_lower for kw in ALLOWED_CONTEXT_KEYWORDS)
    otp_code = extract_otp_code(txt_clean)

    if not otp_code:
        if not txt_clean:
            otp_code = "123456"
            portal = "TESTE"
        else:
            return 200, {
                "ok": True,
                "ignorado_privacidade": True,
                "motivo": "Mensagem ignorada (sem código numérico de verificação — privacidade protegida).",
            }
    else:
        if not has_keyword and len(txt) > 30:
            return 200, {
                "ok": True,
                "ignorado_privacidade": True,
                "motivo": "Mensagem pessoal ignorada pelo filtro de privacidade.",
            }
        portal = detect_portal_from_sms(sender, txt)

    now_ts = time.time()
    now_iso = datetime.datetime.now().strftime("%H:%M:%S")
    entry = {
        "codigo": otp_code,
        "portal": portal,
        "remetente": _mask_sender(sender),
        "timestamp": now_ts,
        "hora": now_iso,
        "consumed": False,
    }

    with _VAULT_LOCK:
        _purge_expired_locked(bucket_id, now_ts)
        bucket = _RAM_BUCKETS.setdefault(bucket_id, [])
        updated_existing = False
        for existing in bucket:
            if (
                not existing.get("consumed")
                and existing.get("codigo") == otp_code
                and (now_ts - existing["timestamp"]) <= 60
            ):
                existing["timestamp"] = now_ts
                existing["hora"] = now_iso
                updated_existing = True
                break
        if not updated_existing:
            bucket.append(entry)
        if len(bucket) > 10:
            del bucket[:-10]

    return 200, {
        "ok": True,
        "portal": portal,
        "codigo_mascarado": otp_code[:2] + "****" if len(otp_code) >= 4 else "****",
        "recebido_as": now_iso,
        "ttl_segundos": OTP_TTL_SECONDS,
    }


def _portal_matches(item_portal: str, target_portal: str) -> bool:
    tp = (target_portal or "").upper().strip()
    ip = (item_portal or "").upper().strip()
    if tp in ("", "QUALQUER"):
        return ip != "TESTE"
    if tp == "TESTE":
        return ip in ("TESTE", "GERAL", "AT")
    if tp in ("AT", "EFATURA"):
        return ip in ("AT", "GERAL")
    return ip in (tp, "GERAL")


def get_bridge_status_by_bucket(bucket_id: str) -> Dict:
    now_ts = time.time()
    with _VAULT_LOCK:
        _purge_expired_locked(bucket_id, now_ts)
        items = _RAM_BUCKETS.get(bucket_id, [])
        active = [
            {
                "portal": it["portal"],
                "codigo_mascarado": "123456" if it["portal"] == "TESTE" else (it["codigo"][:2] + "••••"),
                "remetente": it["remetente"],
                "hora": it["hora"],
                "segundos_atras": max(0, int(now_ts - it["timestamp"])),
                "expira_em_seg": max(0, int(OTP_TTL_SECONDS - (now_ts - it["timestamp"]))),
            }
            for it in reversed(items)
        ]
    return {
        "ok": True,
        "online": True,
        "armazenamento": "100% RAM Efêmera (Zero-Storage)",
        "ttl_segundos": OTP_TTL_SECONDS,
        "codigos_ativos": len(active),
        "ultimos": active[:5],
    }


def get_bridge_status_for_tenant(tenant_key: str) -> Dict:
    bucket_id = get_tenant_bucket_id(tenant_key)
    st = get_bridge_status_by_bucket(bucket_id)
    st["token"] = get_tenant_webhook_token(tenant_key)
    return st


def push_simulated_test(tenant_key: str) -> Tuple[int, Dict]:
    token = get_tenant_webhook_token(tenant_key)
    return receive_sms_webhook(token, "Codigo de teste evoGex SMS 2FA: 123456", sender="evoGex-Teste")


def wait_for_sms_otp_for_tenant(
    tenant_key: str,
    portal: str = "AT",
    timeout_sec: int = 90,
    min_timestamp: Optional[float] = None,
) -> Optional[str]:
    """
    Aguarda em tempo real pela chegada de um código SMS na RAM efêmera deste tenant/workspace,
    devolve o código e apaga-o imediatamente da memória.
    """
    bucket_id = get_tenant_bucket_id(tenant_key)
    target_portal = (portal or "AT").upper()
    start_wait = time.time()
    cutoff_ts = min_timestamp if min_timestamp is not None else (start_wait - 15.0)

    while (time.time() - start_wait) < timeout_sec:
        now_ts = time.time()
        with _VAULT_LOCK:
            _purge_expired_locked(bucket_id, now_ts)
            items = _RAM_BUCKETS.get(bucket_id, [])
            for item in reversed(items):
                if item.get("consumed"):
                    continue
                if item["timestamp"] < cutoff_ts:
                    continue
                if _portal_matches(item["portal"], target_portal):
                    code = item["codigo"]
                    for other in items:
                        if other.get("codigo") == code:
                            other["consumed"] = True
                    _purge_expired_locked(bucket_id, now_ts)
                    return code
        time.sleep(0.4)
    return None


def _build_qr_svg_fallback(text: str) -> str:
    """Gerador QR ISO-18004 autónomo em Python puro caso segno não esteja instalado."""
    qr_specs = {
        1: (26, 10, 1, 16, 0, 0, []),
        2: (44, 16, 1, 28, 0, 0, [6, 18]),
        3: (70, 26, 1, 44, 0, 0, [6, 22]),
        4: (100, 18, 2, 32, 0, 0, [6, 26]),
        5: (134, 24, 2, 43, 0, 0, [6, 30]),
        6: (172, 16, 4, 27, 0, 0, [6, 34]),
        7: (196, 18, 4, 31, 0, 0, [6, 22, 38]),
        8: (242, 22, 2, 38, 2, 39, [6, 24, 42]),
        9: (292, 22, 3, 36, 2, 37, [6, 26, 46]),
        10: (346, 26, 4, 43, 1, 44, [6, 28, 50]),
    }
    raw = text.encode("utf-8")
    ver = next(
        (
            v for v in range(1, 11)
            if (4 + (8 if v <= 9 else 16)) + len(raw) * 8
            <= (qr_specs[v][2] * qr_specs[v][3] + qr_specs[v][4] * qr_specs[v][5]) * 8
        ),
        None,
    )
    if ver is None:
        return ""

    gf_exp = [0] * 512
    gf_log = [0] * 256
    x = 1
    for i in range(255):
        gf_exp[i] = x
        gf_log[x] = i
        x = (x << 1) ^ (0x11D if x & 0x80 else 0)
    for i in range(255, 512):
        gf_exp[i] = gf_exp[i - 255]

    def gf_mul(a: int, b: int) -> int:
        return 0 if (a == 0 or b == 0) else gf_exp[gf_log[a] + gf_log[b]]

    def rs_encode(data: List[int], nsym: int) -> List[int]:
        g = [1]
        for i in range(nsym):
            ng = [0] * (len(g) + 1)
            root = gf_exp[i]
            for j, c in enumerate(g):
                ng[j] ^= c
                ng[j + 1] ^= gf_mul(c, root)
            g = ng
        res = list(data) + [0] * nsym
        for i in range(len(data)):
            coef = res[i]
            if coef != 0:
                for j in range(1, len(g)):
                    res[i + j] ^= gf_mul(g[j], coef)
        return res[len(data):]

    _, ecc_cw, b1, d1, b2, d2, align = qr_specs[ver]
    data_cw_total = b1 * d1 + b2 * d2
    bits: List[int] = []

    def push_bits(val: int, n: int) -> None:
        for i in range(n - 1, -1, -1):
            bits.append((val >> i) & 1)

    push_bits(0b0100, 4)
    push_bits(len(raw), 8 if ver <= 9 else 16)
    for b in raw:
        push_bits(b, 8)
    max_bits = data_cw_total * 8
    for _ in range(min(4, max_bits - len(bits))):
        bits.append(0)
    while len(bits) % 8 != 0:
        bits.append(0)
    idx = 0
    while len(bits) < max_bits:
        push_bits(0xEC if idx % 2 == 0 else 0x11, 8)
        idx += 1

    codewords = [sum(bits[i + j] << (7 - j) for j in range(8)) for i in range(0, len(bits), 8)]
    blocks_d, blocks_e, pos = [], [], 0
    for _ in range(b1):
        blk = codewords[pos:pos + d1]
        pos += d1
        blocks_d.append(blk)
        blocks_e.append(rs_encode(blk, ecc_cw))
    for _ in range(b2):
        blk = codewords[pos:pos + d2]
        pos += d2
        blocks_d.append(blk)
        blocks_e.append(rs_encode(blk, ecc_cw))

    final_cw = (
        [blk[i] for i in range(max(d1, d2)) for blk in blocks_d if i < len(blk)]
        + [blk[i] for i in range(ecc_cw) for blk in blocks_e]
    )
    final_bits = [(cw >> i) & 1 for cw in final_cw for i in range(7, -1, -1)]
    final_bits.extend([0] * ({1: 0, 7: 0, 8: 0, 9: 0, 10: 0}.get(ver, 7)))

    size = 17 + 4 * ver
    mat = [[0] * size for _ in range(size)]
    func = [[False] * size for _ in range(size)]

    def set_func(r: int, c: int, val: int) -> None:
        mat[r][c] = 1 if val else 0
        func[r][c] = True

    def place_finder(r0: int, c0: int) -> None:
        for dr in range(-1, 8):
            for dc in range(-1, 8):
                r, c = r0 + dr, c0 + dc
                if 0 <= r < size and 0 <= c < size:
                    in_o = 0 <= dr <= 6 and 0 <= dc <= 6
                    on_b = dr in (0, 6) or dc in (0, 6)
                    in_c = 2 <= dr <= 4 and 2 <= dc <= 4
                    set_func(r, c, 1 if (in_o and (on_b or in_c)) else 0)

    place_finder(0, 0)
    place_finder(0, size - 7)
    place_finder(size - 7, 0)

    for ar in align:
        for ac in align:
            if func[ar][ac]:
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    set_func(ar + dr, ac + dc, 1 if (abs(dr) == 2 or abs(dc) == 2 or (dr == 0 and dc == 0)) else 0)

    for i in range(8, size - 8):
        if not func[6][i]:
            set_func(6, i, 1 if i % 2 == 0 else 0)
        if not func[i][6]:
            set_func(i, 6, 1 if i % 2 == 0 else 0)
    set_func(4 * ver + 9, 8, 1)

    for i in range(9):
        func[8][i] = True
        func[i][8] = True
    for i in range(8):
        func[8][size - 1 - i] = True
    for i in range(7):
        func[size - 1 - i][8] = True

    if ver >= 7:
        v_info = ver << 12
        for i in range(5, -1, -1):
            if (v_info >> (i + 12)) & 1:
                v_info ^= (0x1F25 << i)
        v_bits = (ver << 12) | v_info
        for i in range(18):
            bit = (v_bits >> i) & 1
            r, c = i // 3, size - 11 + (i % 3)
            set_func(r, c, bit)
            set_func(c, r, bit)

    bit_idx, col, up = 0, size - 1, True
    while col > 0:
        if col == 6:
            col -= 1
        for r in (range(size - 1, -1, -1) if up else range(size)):
            for dc in (0, -1):
                c = col + dc
                if not func[r][c]:
                    mat[r][c] = final_bits[bit_idx] if bit_idx < len(final_bits) else 0
                    bit_idx += 1
        up = not up
        col -= 2

    conds = [
        lambda r, c: (r + c) % 2 == 0,
        lambda r, c: r % 2 == 0,
        lambda r, c: c % 3 == 0,
        lambda r, c: (r + c) % 3 == 0,
        lambda r, c: (r // 2 + c // 3) % 2 == 0,
        lambda r, c: ((r * c) % 2 + (r * c) % 3) == 0,
        lambda r, c: (((r * c) % 2 + (r * c) % 3) % 2) == 0,
        lambda r, c: (((r + c) % 2 + (r * c) % 3) % 2) == 0,
    ]
    tl_coords = [(8, 0), (8, 1), (8, 2), (8, 3), (8, 4), (8, 5), (8, 7), (8, 8), (7, 8), (5, 8), (4, 8), (3, 8), (2, 8), (1, 8), (0, 8)]
    br_coords = [
        (size - 1, 8), (size - 2, 8), (size - 3, 8), (size - 4, 8), (size - 5, 8), (size - 6, 8), (size - 7, 8),
        (8, size - 8), (8, size - 7), (8, size - 6), (8, size - 5), (8, size - 4), (8, size - 3), (8, size - 2), (8, size - 1),
    ]

    def apply_mask(mid: int) -> List[List[int]]:
        m = [row[:] for row in mat]
        fn = conds[mid]
        for r in range(size):
            for c in range(size):
                if not func[r][c] and fn(r, c):
                    m[r][c] ^= 1
        fmt_data = (0b00 << 3) | mid
        d = fmt_data << 10
        for i in range(4, -1, -1):
            if (d >> (i + 10)) & 1:
                d ^= (0x537 << i)
        fmt = ((fmt_data << 10) | d) ^ 0x5412
        for k in range(15):
            bit = (fmt >> (14 - k)) & 1
            r1, c1 = tl_coords[k]
            m[r1][c1] = bit
            r2, c2 = br_coords[k]
            m[r2][c2] = bit
        return m

    def penalty(m: List[List[int]]) -> int:
        p = 0
        for r in range(size):
            run = 1
            for c in range(1, size):
                if m[r][c] == m[r][c - 1]:
                    run += 1
                else:
                    if run >= 5:
                        p += 3 + (run - 5)
                    run = 1
            if run >= 5:
                p += 3 + (run - 5)
        for c in range(size):
            run = 1
            for r in range(1, size):
                if m[r][c] == m[r - 1][c]:
                    run += 1
                else:
                    if run >= 5:
                        p += 3 + (run - 5)
                    run = 1
            if run >= 5:
                p += 3 + (run - 5)
        for r in range(size - 1):
            for c in range(size - 1):
                s = m[r][c] + m[r][c + 1] + m[r + 1][c] + m[r + 1][c + 1]
                if s in (0, 4):
                    p += 3
        return p

    best = min((apply_mask(mid) for mid in range(8)), key=penalty)
    pad = 2
    total = size + 2 * pad
    scale = 4
    px = total * scale
    paths = [f"M{c + pad} {r + pad}h1v1h-1z" for r in range(size) for c in range(size) if best[r][c]]
    d_attr = "".join(paths)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}" viewBox="0 0 {total} {total}" '
        f'shape-rendering="crispEdges"><rect width="{total}" height="{total}" fill="#ffffff"/>'
        f'<path d="{d_attr}" fill="#0f172a"/></svg>'
    )


def build_qr_svg(url: str) -> str:
    """Gera QR Code em SVG puro (usa segno se disponível, ou gerador autónomo em Python puro)."""
    try:
        import io
        import segno
        qr = segno.make(url, error="m")
        buf = io.BytesIO()
        qr.save(buf, kind="svg", scale=4, border=2, dark="#0f172a", light="#ffffff", xmldecl=False)
        return buf.getvalue().decode("utf-8")
    except Exception:
        try:
            return _build_qr_svg_fallback(url)
        except Exception:
            return ""


def render_mobile_panel_html(webhook_url: str, status_url: str, token: str) -> str:
    """Gera página móvel responsiva para associar o MacroDroid / Atalhos Apple em 1 minuto."""
    wh_esc = html.escape(webhook_url, quote=True)
    st_esc = html.escape(status_url, quote=True)
    tk_esc = html.escape(token, quote=True)
    return f"""<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>evoGex.com · Ponte SMS 2FA</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#07121c; color:#e2e8f0; margin:0; padding:18px; }}
  .wrap {{ max-width:560px; margin:0 auto; display:flex; flex-direction:column; gap:14px; }}
  .card {{ background:#0c1520; border:1px solid #222f3e; border-radius:8px; padding:16px; }}
  .title {{ font-size:18px; font-weight:600; color:#38bdf8; margin:0 0 6px; }}
  .sub {{ font-size:13px; color:#94a3b8; margin:0; line-height:1.45; }}
  .urlbox {{ background:#07121c; border:1px solid #1e3a5f; border-radius:6px; padding:10px; font-family:ui-monospace, monospace; font-size:12px; word-break:break-all; color:#7dd3fc; margin:10px 0; }}
  .btn {{ background:#0284c7; color:#ffffff; border:none; border-radius:6px; padding:11px 16px; font-weight:600; font-size:14px; cursor:pointer; width:100%; }}
  .btn-ok {{ background:#059669; }}
  .badge {{ display:inline-block; padding:5px 10px; border-radius:999px; font-size:12px; font-weight:600; background:#091e1a; color:#34d399; border:1px solid #065f46; }}
  ol {{ margin:8px 0 0 18px; padding:0; font-size:13px; line-height:1.55; color:#cbd5e1; }}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1 class="title">evoGex.com · Ponte SMS 2FA</h1>
    <p class="sub">100% RAM Zero-Storage (TTL 5 min · destruição imediata após uso · filtro anti-SMS pessoais).</p>
    <div style="margin-top:10px;" id="stBadge"><span class="badge">A verificar ligação...</span></div>
  </div>
  <div class="card">
    <div style="font-size:13px;font-weight:600;color:#f8fafc;">Endereço de Envio (Webhook)</div>
    <div class="urlbox" id="whUrl">{wh_esc}</div>
    <button class="btn" id="copyBtn" onclick="copyUrl()">Copiar Endereço</button>
    <div style="margin-top:8px;font-size:11px;color:#94a3b8;font-family:monospace;">Token: {tk_esc}</div>
  </div>
  <div class="card">
    <div style="font-size:13px;font-weight:600;color:#38bdf8;">Android (MacroDroid Pro · Google Play)</div>
    <ol>
      <li>Gatilhos: <strong>SMS Recebido (Qualquer)</strong> + <strong>Notificação Recebida (Mensagens)</strong>.</li>
      <li>Ação: <strong>Pedido HTTP</strong> → Método <strong>POST</strong>, Tipo <strong>text/plain</strong>, colar endereço acima e corpo com o texto do SMS/notificação.</li>
      <li>Bateria do MacroDroid: definir como <strong>Sem restrições</strong>.</li>
    </ol>
  </div>
  <div class="card">
    <div style="font-size:13px;font-weight:600;color:#38bdf8;">iPhone / iOS (Atalhos Nativos Apple)</div>
    <ol>
      <li>App <strong>Atalhos</strong> → separador <strong>Automação</strong> → Nova Automação por <strong>Mensagem</strong> (contém <code>AT</code> ou <code>código</code>).</li>
      <li>Definir <strong>Executar Imediatamente</strong>.</li>
      <li>Ação <strong>Obter conteúdo do URL</strong> → Método <strong>POST</strong>, corpo Texto com a mensagem recebida.</li>
    </ol>
  </div>
</div>
<script>
function copyUrl() {{
  const txt = document.getElementById('whUrl').innerText.trim();
  navigator.clipboard.writeText(txt).then(() => {{
    const b = document.getElementById('copyBtn');
    b.innerText = 'Endereço Copiado';
    b.classList.add('btn-ok');
    setTimeout(() => {{ b.innerText = 'Copiar Endereço'; b.classList.remove('btn-ok'); }}, 2500);
  }});
}}
async function pollStatus() {{
  try {{
    const r = await fetch('{st_esc}');
    const d = await r.json();
    const el = document.getElementById('stBadge');
    if (d && d.ok) {{
      if (d.codigos_ativos > 0) {{
        el.innerHTML = '<span class="badge">Ligação Confirmada · ' + d.codigos_ativos + ' código em RAM</span>';
      }} else {{
        el.innerHTML = '<span class="badge">Ponte Online · A aguardar SMS 2FA</span>';
      }}
    }}
  }} catch (e) {{}}
}}
pollStatus();
setInterval(pollStatus, 4000);
</script>
</body>
</html>"""
