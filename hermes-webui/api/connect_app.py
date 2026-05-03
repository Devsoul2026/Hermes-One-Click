"""Connect App API — card-style gateway platform config (parity with hermes-UI)."""

from __future__ import annotations

import asyncio
import base64
import copy
import io
import json
import logging
import time
from pathlib import Path
from typing import Any

from api.config import STATE_DIR, _get_config_path, _load_yaml_config_file, _save_yaml_config_file, load_settings, reload_config
from api.gateway_platforms import _LOAD_LOCK
from api.helpers import bad, j

logger = logging.getLogger(__name__)

_CONNECT_APP_STATE_FILE = STATE_DIR / "connect-app-state.json"
_CONNECT_APP_STATUS_NOT_CONFIGURED = "not_configured"
_CONNECT_APP_STATUS_CONFIGURED = "configured"
_CONNECT_APP_STATUS_CONNECTED = "connected"
_CONNECT_APP_STATUS_ERROR = "error"

_CONNECT_APP_PLATFORMS: dict[str, dict[str, Any]] = {
    "telegram": {
        "display_name": "Telegram",
        "group": "top_picks",
        "required": ["token"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_users", "reply_to_mode"],
    },
    "discord": {
        "display_name": "Discord",
        "group": "top_picks",
        "required": ["token"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_users", "reply_to_mode"],
    },
    "slack": {
        "display_name": "Slack",
        "group": "top_picks",
        "required": ["token"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_users", "reply_to_mode"],
    },
    "whatsapp": {
        "display_name": "WhatsApp",
        "group": "international_im",
        "required": ["extra.session"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_users"],
    },
    "signal": {
        "display_name": "Signal",
        "group": "international_im",
        "required": ["extra.phone_number"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_users"],
    },
    "mattermost": {
        "display_name": "Mattermost",
        "group": "international_im",
        "required": ["extra.server_url", "token", "extra.team"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_users"],
    },
    "matrix": {
        "display_name": "Matrix",
        "group": "international_im",
        "required": ["extra.homeserver", "extra.user_id", "token"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_users"],
    },
    "dingtalk": {
        "display_name": "DingTalk",
        "group": "china_workplace_wechat",
        "required": ["extra.app_key", "extra.app_secret"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_users"],
    },
    "feishu": {
        "display_name": "Feishu / Lark",
        "group": "china_workplace_wechat",
        "required": ["extra.app_id", "extra.app_secret"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_users"],
    },
    "wecom": {
        "display_name": "WeCom",
        "group": "china_workplace_wechat",
        "required": ["extra.bot_id", "extra.secret"],
        "optional": ["extra.websocket_url", "home_channel"],
        "advanced": [
            "extra.dm_policy",
            "extra.allow_from",
            "extra.group_policy",
            "extra.group_allow_from",
            "extra.groups",
        ],
    },
    "wecom_callback": {
        "display_name": "WeCom Callback",
        "group": "china_workplace_wechat",
        "required": ["extra.corp_id", "token", "extra.encoding_aes_key"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_users"],
    },
    "weixin": {
        "display_name": "Weixin",
        "subtitle_zh": "微信扫码连接（个人微信）",
        "subtitle_en": "Weixin QR Connect (Personal WeChat)",
        "group": "china_workplace_wechat",
        "required": ["extra.account_id", "token"],
        "optional": ["extra.base_url", "extra.cdn_base_url", "home_channel"],
        "advanced": [
            "extra.dm_policy",
            "extra.allow_from",
            "extra.group_policy",
            "extra.group_allow_from",
        ],
        "connect_ui": {"mode": "weixin_qr", "default_bot_type": "3"},
    },
    "qqbot": {
        "display_name": "QQ Bot",
        "subtitle_zh": "QQ Bot（开放平台）",
        "subtitle_en": "QQ Bot (Open Platform)",
        "group": "china_workplace_wechat",
        "required": ["extra.app_id", "extra.client_secret"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_users"],
    },
    "api_server": {
        "display_name": "API Server",
        "group": "open_interfaces",
        "required": ["enabled"],
        "optional": ["extra.base_url"],
        "advanced": ["extra.auth_mode", "extra.api_keys"],
    },
    "webhook": {
        "display_name": "Webhook",
        "group": "open_interfaces",
        "required": ["extra.endpoint"],
        "optional": ["extra.secret"],
        "advanced": ["extra.signature_verify", "extra.allowed_ips"],
    },
    "email": {
        "display_name": "Email",
        "group": "traditional_channels",
        "required": ["extra.smtp_host", "extra.username", "extra.password"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_senders"],
    },
    "sms": {
        "display_name": "SMS",
        "group": "traditional_channels",
        "required": ["extra.provider_credentials"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_numbers"],
    },
    "homeassistant": {
        "display_name": "Home Assistant",
        "group": "others",
        "required": ["extra.base_url", "token"],
        "optional": ["home_channel"],
        "advanced": ["extra.entity_allowlist"],
    },
    "bluebubbles": {
        "display_name": "BlueBubbles",
        "group": "others",
        "required": ["extra.server_url", "extra.password"],
        "optional": ["home_channel"],
        "advanced": ["extra.allowed_users"],
    },
}

_CONNECT_APP_ORDER = [
    "telegram",
    "discord",
    "slack",
    "whatsapp",
    "signal",
    "mattermost",
    "matrix",
    "dingtalk",
    "feishu",
    "wecom",
    "wecom_callback",
    "weixin",
    "qqbot",
    "api_server",
    "webhook",
    "email",
    "sms",
    "homeassistant",
    "bluebubbles",
]

_SENSITIVE_KEYS = {
    "token",
    "secret",
    "api_key",
    "password",
    "client_secret",
    "app_secret",
    "encoding_aes_key",
}

_CONNECT_FIELD_LABELS: dict[str, dict[str, str]] = {
    "token": {"en": "Bot / API token", "zh": "机器人或 API Token"},
    "home_channel": {"en": "Home channel / chat ID", "zh": "主会话 / 频道 ID"},
    "reply_to_mode": {"en": "Reply threading mode", "zh": "回复引用模式"},
    "enabled": {"en": "Enabled", "zh": "是否启用"},
    "extra.session": {"en": "WhatsApp session string", "zh": "WhatsApp 会话串"},
    "extra.phone_number": {"en": "Signal phone number", "zh": "Signal 手机号"},
    "extra.server_url": {"en": "Server base URL", "zh": "服务器地址"},
    "extra.team": {"en": "Mattermost team slug", "zh": "Mattermost 团队标识"},
    "extra.homeserver": {"en": "Matrix homeserver URL", "zh": "Matrix homeserver 地址"},
    "extra.user_id": {"en": "Matrix user ID", "zh": "Matrix 用户 ID"},
    "extra.app_key": {"en": "DingTalk App Key", "zh": "钉钉 AppKey"},
    "extra.app_secret": {"en": "DingTalk App Secret", "zh": "钉钉 AppSecret"},
    "extra.app_id": {"en": "App ID", "zh": "应用 AppID"},
    "extra.bot_id": {"en": "WeCom bot ID", "zh": "企业微信 Bot ID"},
    "extra.secret": {"en": "WeCom secret", "zh": "企业微信 Secret"},
    "extra.websocket_url": {"en": "Websocket gateway URL", "zh": "Websocket 网关地址"},
    "extra.corp_id": {"en": "WeCom Corp ID", "zh": "企业 CorpID"},
    "extra.encoding_aes_key": {"en": "EncodingAESKey", "zh": "消息加解密密钥"},
    "extra.account_id": {"en": "Weixin account ID", "zh": "微信账号 ID"},
    "extra.base_url": {"en": "API base URL (optional)", "zh": "API 根地址（可选）"},
    "extra.cdn_base_url": {"en": "CDN base URL (optional)", "zh": "CDN 根地址（可选）"},
    "extra.dm_policy": {"en": "Direct message policy", "zh": "私聊策略"},
    "extra.allow_from": {"en": "Allowed user IDs (DM)", "zh": "允许的私聊用户 ID"},
    "extra.group_policy": {"en": "Group chat policy", "zh": "群聊策略"},
    "extra.group_allow_from": {"en": "Allowed group IDs", "zh": "允许的群 ID"},
    "extra.groups": {"en": "Group allowlist (WeCom)", "zh": "群聊白名单"},
    "extra.allowed_users": {"en": "Allowed users / allowlist", "zh": "允许的用户名单"},
    "extra.client_secret": {"en": "Client secret", "zh": "Client Secret"},
    "extra.endpoint": {"en": "Webhook endpoint path/URL", "zh": "Webhook 地址"},
    "extra.signature_verify": {"en": "Verify webhook signature", "zh": "校验 Webhook 签名"},
    "extra.allowed_ips": {"en": "Allowed source IPs", "zh": "允许的来源 IP"},
    "extra.smtp_host": {"en": "SMTP host", "zh": "SMTP 服务器"},
    "extra.username": {"en": "SMTP username", "zh": "SMTP 用户名"},
    "extra.password": {"en": "Password (SMTP / gateway)", "zh": "密码（SMTP 或网关）"},
    "extra.allowed_senders": {"en": "Allowed sender addresses", "zh": "允许的发件人"},
    "extra.provider_credentials": {"en": "SMS provider credentials (JSON)", "zh": "短信服务商凭证（JSON）"},
    "extra.allowed_numbers": {"en": "Allowed phone numbers", "zh": "允许的手机号"},
    "extra.entity_allowlist": {"en": "Home Assistant entity allowlist", "zh": "HA 实体白名单"},
    "extra.auth_mode": {"en": "API auth mode", "zh": "API 鉴权模式"},
    "extra.api_keys": {"en": "API keys (JSON or list)", "zh": "API Keys"},
}


def _connect_app_active_lang() -> str:
    try:
        raw = str(load_settings().get("language") or "en").strip().lower()
        if raw.startswith("zh"):
            return "zh"
    except Exception:
        pass
    return "en"


def _connect_field_label(path: str, lang: str) -> str:
    row = _CONNECT_FIELD_LABELS.get(path)
    if isinstance(row, dict):
        return row.get(lang) or row.get("en") or path
    tail = path.split(".")[-1].replace("_", " ")
    if not tail:
        return path
    return tail[:1].upper() + tail[1:]


def _connect_field_widget(path: str, lang: str) -> dict | None:
    zh = lang == "zh"

    def L(en: str, zhc: str) -> str:
        return zhc if zh else en

    if path == "reply_to_mode":
        return {
            "type": "select",
            "options": [
                {"value": "first", "label": L("First reply only", "仅首次回复引用")},
                {"value": "all", "label": L("All replies", "每次回复都引用")},
                {"value": "off", "label": L("Off", "关闭")},
            ],
        }
    if path in ("extra.dm_policy",):
        return {
            "type": "select",
            "options": [
                {"value": "pairing", "label": L("Pairing (recommended)", "配对确认（推荐）")},
                {"value": "open", "label": L("Open", "开放")},
                {"value": "allowlist", "label": L("Allowlist only", "仅白名单")},
                {"value": "disabled", "label": L("Disabled", "关闭")},
            ],
        }
    if path in ("extra.group_policy",):
        return {
            "type": "select",
            "options": [
                {"value": "disabled", "label": L("Disabled (recommended)", "关闭（推荐）")},
                {"value": "open", "label": L("Open", "开放")},
                {"value": "allowlist", "label": L("Allowlist only", "仅白名单")},
            ],
        }
    if path in ("extra.signature_verify", "enabled"):
        return {
            "type": "select",
            "options": [
                {"value": "true", "label": L("Yes / true", "是")},
                {"value": "false", "label": L("No / false", "否")},
            ],
        }
    return None


def _weixin_qr_svg_data_url(scan_data: str) -> str | None:
    try:
        import qrcode  # type: ignore
        from qrcode.image.svg import SvgPathImage  # type: ignore

        qr = qrcode.QRCode(version=None, image_factory=SvgPathImage, box_size=8, border=2)
        qr.add_data(scan_data)
        qr.make(fit=True)
        img = qr.make_image()
        buf = io.BytesIO()
        img.save(buf)
        svg = buf.getvalue().decode("utf-8")
        b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
        return f"data:image/svg+xml;base64,{b64}"
    except Exception as exc:
        logger.warning("weixin qr svg generation failed: %s", exc)
        return None


async def _weixin_qr_start_async(bot_type: str = "3") -> dict:
    from gateway.platforms import weixin as wx

    if not wx.check_weixin_requirements():
        raise RuntimeError("Weixin needs aiohttp and cryptography (install messaging extras)")
    import aiohttp

    async with aiohttp.ClientSession(
        trust_env=True, connector=wx._make_ssl_connector()
    ) as session:
        qr_resp = await wx._api_get(
            session,
            base_url=wx.ILINK_BASE_URL,
            endpoint=f"{wx.EP_GET_BOT_QR}?bot_type={bot_type}",
            timeout_ms=wx.QR_TIMEOUT_MS,
        )
    qrcode_value = str(qr_resp.get("qrcode") or "")
    qrcode_url = str(qr_resp.get("qrcode_img_content") or "")
    if not qrcode_value:
        raise RuntimeError("iLink did not return a QR token")
    scan_data = qrcode_url if qrcode_url else qrcode_value
    qr_image = _weixin_qr_svg_data_url(scan_data)
    return {
        "qrcode": qrcode_value,
        "qrcode_url": qrcode_url,
        "scan_url": scan_data,
        "poll_base_url": wx.ILINK_BASE_URL,
        "qr_image": qr_image,
        "bot_type": bot_type,
    }


async def _weixin_qr_poll_async(qrcode: str, base_url: str) -> dict:
    from gateway.platforms import weixin as wx
    from hermes_constants import get_hermes_home

    import aiohttp

    bu = (base_url or wx.ILINK_BASE_URL).rstrip("/")
    async with aiohttp.ClientSession(
        trust_env=True, connector=wx._make_ssl_connector()
    ) as session:
        status_resp = await wx._api_get(
            session,
            base_url=bu,
            endpoint=f"{wx.EP_GET_QR_STATUS}?qrcode={qrcode}",
            timeout_ms=wx.QR_TIMEOUT_MS,
        )
    status = str(status_resp.get("status") or "wait")
    out: dict[str, Any] = {"status": status}
    if status == "scaned_but_redirect":
        rh = str(status_resp.get("redirect_host") or "").strip()
        if rh:
            out["poll_base_url"] = f"https://{rh}"
    if status == "confirmed":
        account_id = str(status_resp.get("ilink_bot_id") or "")
        token = str(status_resp.get("bot_token") or "")
        base = str(status_resp.get("baseurl") or wx.ILINK_BASE_URL).rstrip("/")
        user_id = str(status_resp.get("ilink_user_id") or "")
        if not account_id or not token:
            raise RuntimeError("Login confirmed but credentials were incomplete")
        wx.save_weixin_account(
            str(get_hermes_home()),
            account_id=account_id,
            token=token,
            base_url=base,
            user_id=user_id,
        )
        out["credentials"] = {
            "token": token,
            "extra": {"account_id": account_id, "base_url": base},
        }
    return out


def _load_connect_app_state() -> dict:
    if not _CONNECT_APP_STATE_FILE.exists():
        return {}
    try:
        data = json.loads(_CONNECT_APP_STATE_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_connect_app_state(state: dict) -> None:
    _CONNECT_APP_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CONNECT_APP_STATE_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _load_gateway_platforms_config() -> tuple[Path, dict, dict]:
    cfg_path = _get_config_path()
    full = copy.deepcopy(_load_yaml_config_file(cfg_path))
    if not isinstance(full, dict):
        full = {}
    platforms = full.get("platforms")
    if not isinstance(platforms, dict):
        platforms = {}
        full["platforms"] = platforms
    return cfg_path, full, platforms


def _save_gateway_platforms_config(config_path: Path, payload: dict) -> None:
    _save_yaml_config_file(config_path, payload)
    reload_config()


def _get_nested_value(data: dict, path: str):
    cur = data
    parts = path.split(".")
    for idx, part in enumerate(parts):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur.get(part)
        if idx == len(parts) - 1:
            return cur
    return None


def _has_nonempty_value(value) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) > 0
    return str(value).strip() != ""


def _platform_has_config(cfg: dict) -> bool:
    if not isinstance(cfg, dict):
        return False
    if cfg.get("enabled") is True:
        return True
    for key in ("token", "api_key", "home_channel"):
        if _has_nonempty_value(cfg.get(key)):
            return True
    extra = cfg.get("extra")
    return isinstance(extra, dict) and len(extra) > 0


def _mask_sensitive(obj):
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            lower = str(key).lower()
            if lower in _SENSITIVE_KEYS and _has_nonempty_value(value):
                out[key] = "••••••"
            else:
                out[key] = _mask_sensitive(value)
        return out
    if isinstance(obj, list):
        return [_mask_sensitive(item) for item in obj]
    return obj


def _merge_platform_config(existing: dict, incoming: dict) -> dict:
    merged = dict(existing or {})
    for key, value in (incoming or {}).items():
        if isinstance(value, dict):
            merged[key] = _merge_platform_config(
                merged.get(key) if isinstance(merged.get(key), dict) else {},
                value,
            )
            continue
        lower = str(key).lower()
        if lower in _SENSITIVE_KEYS:
            if not _has_nonempty_value(value) or str(value).startswith("••••"):
                continue
        merged[key] = value
    return merged


def _compute_connect_status(platform_key: str, cfg: dict, state_entry: dict) -> str:
    del platform_key  # reserved for future per-platform rules
    if not _platform_has_config(cfg):
        return _CONNECT_APP_STATUS_NOT_CONFIGURED
    if isinstance(state_entry, dict) and state_entry.get("last_error"):
        return _CONNECT_APP_STATUS_ERROR
    if isinstance(state_entry, dict) and state_entry.get("connected") is True:
        return _CONNECT_APP_STATUS_CONNECTED
    return _CONNECT_APP_STATUS_CONFIGURED


def _connect_platform_summary(platform_key: str, cfg: dict, state_entry: dict) -> dict:
    meta = _CONNECT_APP_PLATFORMS[platform_key]
    return {
        "key": platform_key,
        "display_name": meta["display_name"],
        "subtitle_zh": meta.get("subtitle_zh"),
        "subtitle_en": meta.get("subtitle_en"),
        "group": meta["group"],
        "status": _compute_connect_status(platform_key, cfg, state_entry),
        "enabled": bool(cfg.get("enabled", False)),
        "connected": bool(state_entry.get("connected", False)) if isinstance(state_entry, dict) else False,
        "last_test_at": state_entry.get("last_test_at") if isinstance(state_entry, dict) else None,
        "last_error": state_entry.get("last_error") if isinstance(state_entry, dict) else None,
    }


def _build_platform_detail(platform_key: str, cfg: dict) -> dict:
    meta = _CONNECT_APP_PLATFORMS[platform_key]
    lang = _connect_app_active_lang()
    req = list(meta["required"])
    opt = list(meta["optional"])
    adv = list(meta["advanced"])
    field_labels: dict[str, str] = {}
    field_widgets: dict[str, dict] = {}
    for path in req + opt + adv:
        field_labels[path] = _connect_field_label(path, lang)
        w = _connect_field_widget(path, lang)
        if w:
            field_widgets[path] = w
    detail: dict[str, Any] = {
        "key": platform_key,
        "display_name": meta["display_name"],
        "subtitle_zh": meta.get("subtitle_zh"),
        "subtitle_en": meta.get("subtitle_en"),
        "group": meta["group"],
        "config": _mask_sensitive(cfg),
        "schema": {
            "required": req,
            "optional": opt,
            "advanced": adv,
            "field_labels": field_labels,
            "field_widgets": field_widgets,
        },
    }
    if meta.get("connect_ui"):
        detail["connect_ui"] = meta["connect_ui"]
    return detail


def _validate_required_fields(platform_key: str, cfg: dict) -> list[str]:
    meta = _CONNECT_APP_PLATFORMS[platform_key]
    missing = []
    for field_path in meta["required"]:
        value = _get_nested_value(cfg, field_path)
        if not _has_nonempty_value(value):
            missing.append(field_path)
    return missing


def _require_auth(handler) -> bool:
    from api.auth import is_auth_enabled, parse_cookie, verify_session

    if not is_auth_enabled():
        return True
    cv = parse_cookie(handler)
    if cv and verify_session(cv):
        return True
    j(handler, {"error": "Authentication required"}, status=401)
    return False


def handle_connect_app_get(handler, parsed) -> bool:
    if parsed.path.rstrip("/") == "/api/connect-app/platforms":
        _, _, platforms_cfg = _load_gateway_platforms_config()
        state = _load_connect_app_state()
        items = []
        for key in _CONNECT_APP_ORDER:
            cfg = platforms_cfg.get(key, {})
            if not isinstance(cfg, dict):
                cfg = {}
            entry = state.get(key, {}) if isinstance(state, dict) else {}
            items.append(_connect_platform_summary(key, cfg, entry))
        j(handler, {"platforms": items})
        return True

    if parsed.path.startswith("/api/connect-app/platforms/"):
        platform_key = parsed.path[len("/api/connect-app/platforms/") :].strip("/")
        if "/" in platform_key or platform_key not in _CONNECT_APP_PLATFORMS:
            return False
        _, _, platforms_cfg = _load_gateway_platforms_config()
        cfg = platforms_cfg.get(platform_key, {})
        if not isinstance(cfg, dict):
            cfg = {}
        j(handler, _build_platform_detail(platform_key, cfg))
        return True
    return False


def handle_connect_app_post(handler, parsed, body: dict | None) -> bool:
    body = body if isinstance(body, dict) else {}

    if parsed.path == "/api/connect-app/platforms/weixin/qr/start":
        if not _require_auth(handler):
            return True
        try:
            bot_type = str(body.get("bot_type") or "3").strip() or "3"
            out = asyncio.run(_weixin_qr_start_async(bot_type))
            j(handler, out)
        except Exception as e:
            logger.warning("weixin qr start failed: %s", e, exc_info=True)
            return bad(handler, str(e), 502)
        return True

    if parsed.path == "/api/connect-app/platforms/weixin/qr/poll":
        if not _require_auth(handler):
            return True
        qrcode = str(body.get("qrcode") or "").strip()
        if not qrcode:
            return bad(handler, "qrcode is required", 400)
        base_url = str(body.get("base_url") or "").strip()
        try:
            out = asyncio.run(_weixin_qr_poll_async(qrcode, base_url))
            j(handler, out)
        except Exception as e:
            logger.warning("weixin qr poll failed: %s", e, exc_info=True)
            return bad(handler, str(e), 502)
        return True

    if parsed.path.startswith("/api/connect-app/platforms/") and parsed.path.endswith("/test"):
        if not _require_auth(handler):
            return True
        platform_key = parsed.path[len("/api/connect-app/platforms/") : -len("/test")].strip("/")
        if "/" in platform_key or platform_key not in _CONNECT_APP_PLATFORMS:
            return bad(handler, "Unsupported platform", 404)
        _, _, platforms_cfg = _load_gateway_platforms_config()
        cfg = platforms_cfg.get(platform_key, {})
        if not isinstance(cfg, dict):
            cfg = {}
        missing = _validate_required_fields(platform_key, cfg)
        state = _load_connect_app_state()
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        state_entry = state.get(platform_key, {}) if isinstance(state, dict) else {}
        if not isinstance(state_entry, dict):
            state_entry = {}
        if missing:
            message = f"Missing required fields: {', '.join(missing)}"
            state_entry.update(
                {
                    "connected": False,
                    "last_test_at": now_iso,
                    "last_error": message,
                }
            )
            if isinstance(state, dict):
                state[platform_key] = state_entry
                _save_connect_app_state(state)
            j(
                handler,
                {
                    "ok": False,
                    "status": _CONNECT_APP_STATUS_ERROR,
                    "message": message,
                    "error_code": "required_fields_missing",
                    "tested_at": now_iso,
                },
            )
            return True
        state_entry.update(
            {
                "connected": True,
                "last_test_at": now_iso,
                "last_error": None,
            }
        )
        if isinstance(state, dict):
            state[platform_key] = state_entry
            _save_connect_app_state(state)
        j(
            handler,
            {
                "ok": True,
                "status": _CONNECT_APP_STATUS_CONNECTED,
                "message": "Connection test succeeded",
                "tested_at": now_iso,
            },
        )
        return True

    if parsed.path.startswith("/api/connect-app/platforms/") and parsed.path.endswith("/disable"):
        if not _require_auth(handler):
            return True
        platform_key = parsed.path[len("/api/connect-app/platforms/") : -len("/disable")].strip("/")
        if "/" in platform_key or platform_key not in _CONNECT_APP_PLATFORMS:
            return bad(handler, "Unsupported platform", 404)
        with _LOAD_LOCK:
            config_path, payload, platforms_cfg = _load_gateway_platforms_config()
            current = platforms_cfg.get(platform_key, {})
            if not isinstance(current, dict):
                current = {}
            current["enabled"] = False
            platforms_cfg[platform_key] = current
            payload["platforms"] = platforms_cfg
            _save_gateway_platforms_config(config_path, payload)
        state = _load_connect_app_state()
        if isinstance(state, dict):
            entry = state.get(platform_key, {})
            if not isinstance(entry, dict):
                entry = {}
            entry["connected"] = False
            state[platform_key] = entry
            _save_connect_app_state(state)
        j(
            handler,
            {
                "ok": True,
                "enabled": False,
                "status": _CONNECT_APP_STATUS_CONFIGURED
                if _platform_has_config(current)
                else _CONNECT_APP_STATUS_NOT_CONFIGURED,
            },
        )
        return True

    if parsed.path.startswith("/api/connect-app/platforms/"):
        if not _require_auth(handler):
            return True
        platform_key = parsed.path[len("/api/connect-app/platforms/") :].strip("/")
        if "/" in platform_key or platform_key not in _CONNECT_APP_PLATFORMS:
            return bad(handler, "Unsupported platform", 404)
        with _LOAD_LOCK:
            config_path, payload, platforms_cfg = _load_gateway_platforms_config()
            existing = platforms_cfg.get(platform_key, {})
            if not isinstance(existing, dict):
                existing = {}
            incoming_cfg = body.get("config", {})
            if not isinstance(incoming_cfg, dict):
                incoming_cfg = {}
            merged = _merge_platform_config(existing, incoming_cfg)
            if "enabled" in body:
                merged["enabled"] = bool(body.get("enabled"))
            else:
                merged["enabled"] = bool(merged.get("enabled", True))
            platforms_cfg[platform_key] = merged
            payload["platforms"] = platforms_cfg
            _save_gateway_platforms_config(config_path, payload)
        merged_final = merged
        state = _load_connect_app_state()
        if isinstance(state, dict):
            entry = state.get(platform_key, {})
            if not isinstance(entry, dict):
                entry = {}
            entry["last_error"] = None
            if not merged_final.get("enabled", True):
                entry["connected"] = False
            state[platform_key] = entry
            _save_connect_app_state(state)
        restart_out: dict[str, Any] = {}
        try:
            from api.gateway_restart import try_reload_or_start_gateway

            restart_out = try_reload_or_start_gateway()
        except Exception as exc:
            logger.warning("gateway restart after connect-app save failed: %s", exc)
            restart_out = {"restarted": False, "reason": "error", "detail": str(exc)}
        j(
            handler,
            {
                "ok": True,
                "status": _CONNECT_APP_STATUS_CONFIGURED,
                "enabled": bool(merged_final.get("enabled", False)),
                "gateway_restart": restart_out,
            },
        )
        return True

    return False
