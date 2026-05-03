"""Weixin iLink QR bind flow for the Web UI (no terminal) — stdlib HTTP + in-memory sessions."""
from __future__ import annotations

import base64
import io
import json
import logging
import re
import ssl
import threading
import time
import uuid
from typing import Any, Dict, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

_ILINK_DEFAULT = "https://ilinkai.weixin.qq.com"
_ILINK_APP_ID = "bot"
_ILINK_APP_CLIENT_VERSION = (2 << 16) | (2 << 8) | 0
_EP_QR = "ilink/bot/get_bot_qrcode"
_EP_STATUS = "ilink/bot/get_qrcode_status"
_SESSION_TTL = 600.0
_LOCK = threading.Lock()
_SESSIONS: Dict[str, Dict[str, Any]] = {}

_SID_RE = re.compile(r"^[a-f0-9]{32}$")


def _ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    try:
        import certifi  # type: ignore

        ctx.load_verify_locations(certifi.where())
    except Exception:
        pass
    return ctx


def _ilink_get(base_url: str, endpoint_query: str, timeout: float = 35.0) -> Dict[str, Any]:
    url = f"{base_url.rstrip('/')}/{endpoint_query.lstrip('/')}"
    req = Request(
        url,
        headers={
            "iLink-App-Id": _ILINK_APP_ID,
            "iLink-App-ClientVersion": str(_ILINK_APP_CLIENT_VERSION),
            "Accept": "application/json",
        },
        method="GET",
    )
    ctx = _ssl_context()
    with urlopen(req, timeout=timeout, context=ctx) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        return json.loads(raw)


def _qr_svg_data_url(scan_data: str) -> Optional[str]:
    try:
        import qrcode  # type: ignore
        from qrcode.image.svg import SvgPathImage  # type: ignore
    except Exception:
        return None
    try:
        buf = io.BytesIO()
        qr = qrcode.QRCode(version=None, image_factory=SvgPathImage, box_size=6, border=2)
        qr.add_data(scan_data)
        qr.make(fit=True)
        img = qr.make_image()
        img.save(buf)
        svg = buf.getvalue().decode("utf-8")
        b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
        return f"data:image/svg+xml;base64,{b64}"
    except Exception as exc:
        logger.warning("weixin qr svg generation failed: %s", exc)
        return None


def _purge_stale_locked() -> None:
    now = time.time()
    dead = [k for k, v in _SESSIONS.items() if now - float(v.get("created", 0)) > _SESSION_TTL]
    for k in dead:
        _SESSIONS.pop(k, None)


def start_weixin_qr_session(*, bot_type: str = "3") -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Fetch a fresh iLink QR and register a server-side session."""
    sid = uuid.uuid4().hex
    try:
        qr_resp = _ilink_get(_ILINK_DEFAULT, f"{_EP_QR}?bot_type={bot_type}")
    except (HTTPError, URLError, OSError, json.JSONDecodeError, ValueError) as exc:
        logger.exception("weixin qr start: iLink get_bot_qrcode failed")
        return None, f"ilink_fetch_failed:{exc}"

    qrcode_value = str(qr_resp.get("qrcode") or "")
    qrcode_url = str(qr_resp.get("qrcode_img_content") or "")
    if not qrcode_value:
        return None, "ilink_missing_qrcode"

    scan_data = qrcode_url if qrcode_url else qrcode_value
    img = _qr_svg_data_url(scan_data)

    with _LOCK:
        _purge_stale_locked()
        _SESSIONS[sid] = {
            "created": time.time(),
            "bot_type": str(bot_type or "3"),
            "base_url": _ILINK_DEFAULT,
            "qrcode": qrcode_value,
            "scan_url": qrcode_url,
            "scan_data": scan_data,
            "refresh_count": 0,
            "credentials": None,
            "last_status": "",
        }

    return (
        {
            "session_id": sid,
            "scan_url": scan_data,
            "qr_image": img,
            "qrcode": qrcode_value,
        },
        None,
    )


def _refresh_qr_locked(st: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    bot_type = st.get("bot_type") or "3"
    try:
        qr_resp = _ilink_get(_ILINK_DEFAULT, f"{_EP_QR}?bot_type={bot_type}")
    except (HTTPError, URLError, OSError, json.JSONDecodeError, ValueError) as exc:
        return False, str(exc)
    qrcode_value = str(qr_resp.get("qrcode") or "")
    qrcode_url = str(qr_resp.get("qrcode_img_content") or "")
    if not qrcode_value:
        return False, "missing_qrcode"
    st["qrcode"] = qrcode_value
    st["scan_url"] = qrcode_url
    st["scan_data"] = qrcode_url if qrcode_url else qrcode_value
    return True, None


def poll_weixin_qr_session(session_id: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Single iLink status poll; updates session (redirect / refresh / credentials)."""
    sid = (session_id or "").strip().lower()
    if not _SID_RE.match(sid):
        return None, "invalid_session_id"

    with _LOCK:
        _purge_stale_locked()
        st = _SESSIONS.get(sid)
    if not st:
        return None, "session_not_found"

    base_url = str(st.get("base_url") or _ILINK_DEFAULT).rstrip("/")
    qrcode_value = str(st.get("qrcode") or "")

    try:
        status_resp = _ilink_get(base_url, f"{_EP_STATUS}?qrcode={quote(qrcode_value, safe='')}")
    except (HTTPError, URLError, OSError, json.JSONDecodeError, ValueError) as exc:
        logger.warning("weixin qr poll error: %s", exc)
        return {"session_id": sid, "status": "error", "message": str(exc)}, None

    status = str(status_resp.get("status") or "wait")

    if status == "scaned_but_redirect":
        redirect_host = str(status_resp.get("redirect_host") or "")
        if redirect_host:
            with _LOCK:
                s2 = _SESSIONS.get(sid)
                if s2:
                    s2["base_url"] = f"https://{redirect_host}".rstrip("/")

    if status == "expired":
        with _LOCK:
            s2 = _SESSIONS.get(sid)
            if not s2:
                return None, "session_not_found"
            s2["refresh_count"] = int(s2.get("refresh_count") or 0) + 1
            rc = s2["refresh_count"]
            if rc > 3:
                _SESSIONS.pop(sid, None)
                return None, "qr_expired_limit"
            ok, err = _refresh_qr_locked(s2)
            if not ok:
                _SESSIONS.pop(sid, None)
                return None, f"qr_refresh_failed:{err}"
            scan_data = s2.get("scan_data") or ""
            img = _qr_svg_data_url(str(scan_data))

        return {
            "session_id": sid,
            "status": "refreshed",
            "scan_url": scan_data,
            "qr_image": img,
            "refresh_count": rc,
        }, None

    if status == "confirmed":
        account_id = str(status_resp.get("ilink_bot_id") or "")
        token = str(status_resp.get("bot_token") or "")
        base_out = str(status_resp.get("baseurl") or _ILINK_DEFAULT).strip().rstrip("/")
        user_id = str(status_resp.get("ilink_user_id") or "")
        if not account_id or not token:
            return None, "confirmed_incomplete"
        cred = {
            "account_id": account_id,
            "token": token,
            "base_url": base_out,
            "user_id": user_id,
        }
        with _LOCK:
            s2 = _SESSIONS.get(sid)
            if s2:
                s2["credentials"] = cred
                s2["last_status"] = "confirmed"
        return {
            "session_id": sid,
            "status": "confirmed",
            "account_id": account_id,
            "base_url": base_out,
        }, None

    with _LOCK:
        s2 = _SESSIONS.get(sid)
        if s2:
            s2["last_status"] = status

    out: Dict[str, Any] = {"session_id": sid, "status": status}
    if status in ("wait", "scaned"):
        out["scan_url"] = st.get("scan_data") or st.get("scan_url") or ""
    return out, None


def apply_weixin_qr_session(session_id: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Persist credentials from a confirmed session, merge platforms.weixin, restart gateway."""
    sid = (session_id or "").strip().lower()
    if not _SID_RE.match(sid):
        return None, "invalid_session_id"

    with _LOCK:
        st = _SESSIONS.get(sid)
        cred = (st or {}).get("credentials") if st else None
    if not isinstance(cred, dict) or not cred.get("account_id") or not cred.get("token"):
        return None, "session_not_confirmed"

    from api.gateway_platforms import save_gateway_platform
    from api.profiles import get_active_hermes_home

    home = get_active_hermes_home()
    prev = os.environ.get("HERMES_HOME")
    try:
        os.environ["HERMES_HOME"] = str(home)
        from gateway.platforms.weixin import save_weixin_account

        save_weixin_account(
            str(home),
            account_id=str(cred["account_id"]),
            token=str(cred["token"]),
            base_url=str(cred.get("base_url") or _ILINK_DEFAULT).rstrip("/"),
            user_id=str(cred.get("user_id") or ""),
        )
    except Exception as exc:
        logger.exception("weixin apply: save_weixin_account failed")
        return None, str(exc)
    finally:
        if prev is not None:
            os.environ["HERMES_HOME"] = prev
        else:
            os.environ.pop("HERMES_HOME", None)

    cdn_default = "https://novac2c.cdn.weixin.qq.com/c2c"
    fields = {
        "enabled": True,
        "account_id": str(cred["account_id"]),
        "token": str(cred["token"]),
        "base_url": str(cred.get("base_url") or "").strip(),
        "cdn_base_url": cdn_default,
    }
    if not fields["base_url"]:
        del fields["base_url"]

    ok, err = save_gateway_platform(
        "weixin",
        {"id": "weixin", "fields": fields, "restart_gateway": True},
    )
    if err:
        return None, err
    if not isinstance(ok, dict):
        return None, "save_failed"

    with _LOCK:
        _SESSIONS.pop(sid, None)

    return {"ok": True, "saved": True, "gateway_restart": ok.get("gateway_restart")}, None
