"""Gateway / messaging platforms for the Web UI — status, link hints, and config.yaml editing."""
from __future__ import annotations

import copy
import json
import logging
import os
import re
import threading
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_LOAD_LOCK = threading.Lock()

_GITHUB_PLATFORMS_TREE = (
    "https://github.com/NousResearch/hermes-agent/tree/main/gateway/platforms"
)

# Must match routes.py MCP masking so the client can round-trip unchanged secrets.
_MASKED_PLACEHOLDER = "••••••"

_PLATFORM_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def _adapter_source_url(platform_value: str) -> str:
    if platform_value == "qqbot":
        return f"{_GITHUB_PLATFORMS_TREE}/qqbot"
    return f"{_GITHUB_PLATFORMS_TREE}/{platform_value}.py"


def _api_server_base_url(extra: Dict[str, Any]) -> str:
    host = (extra or {}).get("host") or "127.0.0.1"
    try:
        port = int((extra or {}).get("port", 8642))
    except (TypeError, ValueError):
        port = 8642
    return f"http://{host}:{port}"


def _webhook_base_url(extra: Dict[str, Any]) -> str:
    host = (extra or {}).get("host") or "127.0.0.1"
    if host in ("0.0.0.0", "::", "[::]"):
        host = "127.0.0.1"
    try:
        port = int((extra or {}).get("port", 8644))
    except (TypeError, ValueError):
        port = 8644
    return f"http://{host}:{port}"


def _human_title(platform_value: str) -> str:
    return platform_value.replace("_", " ").title()


def _endpoint_rows(platform_value: str, pcfg) -> List[Dict[str, str]]:
    ex = pcfg.extra or {}
    out: List[Dict[str, str]] = []
    if platform_value == "api_server":
        base = _api_server_base_url(ex)
        out.append({"label": "POST /v1/chat/completions", "url": f"{base}/v1/chat/completions"})
        out.append({"label": "GET /v1/models", "url": f"{base}/v1/models"})
        out.append({"label": "GET /health", "url": f"{base}/health"})
        return out
    if platform_value == "webhook":
        base = _webhook_base_url(ex)
        routes = ex.get("routes") or {}
        if isinstance(routes, dict) and routes:
            for name in sorted(routes.keys()):
                if isinstance(name, str) and name.strip():
                    out.append(
                        {
                            "label": f"POST /webhooks/{name}",
                            "url": f"{base}/webhooks/{name}",
                        }
                    )
        else:
            out.append({"label": "POST /webhooks/<route>", "url": f"{base}/webhooks/<route>"})
        return out
    return out


def _reply_field() -> Dict[str, Any]:
    return {
        "name": "reply_to_mode",
        "type": "enum",
        "path": ["reply_to_mode"],
        "options": ["first", "off", "all"],
    }


def _token_platform() -> List[Dict[str, Any]]:
    return [
        {"name": "enabled", "type": "bool", "path": ["enabled"]},
        {"name": "token", "type": "secret", "path": ["token"]},
        _reply_field(),
    ]


# Per-platform form fields: path is always under platforms.<id> in config.yaml.
_PLATFORM_FORM_FIELDS: Dict[str, List[Dict[str, Any]]] = {
    "telegram": _token_platform(),
    "discord": _token_platform(),
    "slack": _token_platform(),
    "mattermost": [
        {"name": "enabled", "type": "bool", "path": ["enabled"]},
        {"name": "token", "type": "secret", "path": ["token"]},
        {"name": "extra_url", "type": "string", "path": ["extra", "url"]},
        _reply_field(),
    ],
    "matrix": [
        {"name": "enabled", "type": "bool", "path": ["enabled"]},
        {"name": "token", "type": "secret", "path": ["token"]},
        {"name": "homeserver", "type": "string", "path": ["extra", "homeserver"]},
        {"name": "user_id", "type": "string", "path": ["extra", "user_id"]},
        {"name": "password", "type": "secret", "path": ["extra", "password"]},
    ],
    "feishu": [
        {"name": "enabled", "type": "bool", "path": ["enabled"]},
        {"name": "app_id", "type": "string", "path": ["extra", "app_id"]},
        {"name": "app_secret", "type": "secret", "path": ["extra", "app_secret"]},
        {"name": "encrypt_key", "type": "secret", "path": ["extra", "encrypt_key"]},
        {"name": "verification_token", "type": "secret", "path": ["extra", "verification_token"]},
    ],
    "weixin": [
        {
            "name": "weixin_qr_intro",
            "type": "html",
            "i18n_key": "platforms_weixin_web_intro",
        },
        {"name": "enabled", "type": "bool", "path": ["enabled"]},
        {
            "name": "account_id",
            "type": "string",
            "path": ["extra", "account_id"],
            "label_key": "platforms_field_weixin_account_id",
        },
        {
            "name": "token",
            "type": "secret",
            "path": ["token"],
            "label_key": "platforms_field_weixin_token",
            "hint_key": "platforms_field_weixin_token_hint",
        },
        {
            "name": "base_url",
            "type": "string",
            "path": ["extra", "base_url"],
            "label_key": "platforms_field_weixin_base_url",
            "hint_key": "platforms_field_weixin_base_url_hint",
        },
        {
            "name": "cdn_base_url",
            "type": "string",
            "path": ["extra", "cdn_base_url"],
            "label_key": "platforms_field_weixin_cdn_base_url",
            "hint_key": "platforms_field_weixin_cdn_base_url_hint",
        },
    ],
    "wecom": [
        {"name": "enabled", "type": "bool", "path": ["enabled"]},
        {"name": "bot_id", "type": "string", "path": ["extra", "bot_id"]},
        {"name": "secret", "type": "secret", "path": ["extra", "secret"]},
        {"name": "websocket_url", "type": "string", "path": ["extra", "websocket_url"]},
    ],
    "dingtalk": [
        {"name": "enabled", "type": "bool", "path": ["enabled"]},
        {"name": "client_id", "type": "string", "path": ["extra", "client_id"]},
        {"name": "client_secret", "type": "secret", "path": ["extra", "client_secret"]},
        {"name": "robot_code", "type": "string", "path": ["extra", "robot_code"]},
    ],
    "api_server": [
        {"name": "enabled", "type": "bool", "path": ["enabled"]},
        {"name": "host", "type": "string", "path": ["extra", "host"]},
        {"name": "port", "type": "int", "path": ["extra", "port"]},
        {"name": "api_key", "type": "secret", "path": ["extra", "key"]},
        {"name": "model_name", "type": "string", "path": ["extra", "model_name"]},
    ],
    "webhook": [
        {"name": "enabled", "type": "bool", "path": ["enabled"]},
        {"name": "host", "type": "string", "path": ["extra", "host"]},
        {"name": "port", "type": "int", "path": ["extra", "port"]},
        {"name": "secret", "type": "secret", "path": ["extra", "secret"]},
        {"name": "routes_json", "type": "json", "path": ["extra", "routes"]},
    ],
    "signal": [
        {"name": "enabled", "type": "bool", "path": ["enabled"]},
        {"name": "http_url", "type": "string", "path": ["extra", "http_url"]},
    ],
}

_DEFAULT_FORM_FIELDS: List[Dict[str, Any]] = [
    {"name": "enabled", "type": "bool", "path": ["enabled"]},
    {"name": "token", "type": "secret", "path": ["token"]},
    {"name": "api_key", "type": "secret", "path": ["api_key"]},
    _reply_field(),
    {"name": "extra_json", "type": "json", "path": ["extra"]},
]


def _form_fields_for(platform_id: str) -> List[Dict[str, Any]]:
    return _PLATFORM_FORM_FIELDS.get(platform_id, _DEFAULT_FORM_FIELDS)


def _get_nested(cur: Any, path: List[str]) -> Any:
    for p in path:
        if not isinstance(cur, dict) or p not in cur:
            return None
        cur = cur[p]
    return cur


def _set_nested(root: dict, path: List[str], value: Any) -> None:
    cur = root
    for p in path[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[p] = nxt
        cur = nxt
    cur[path[-1]] = value


def _del_nested(root: dict, path: List[str]) -> None:
    cur: Any = root
    for p in path[:-1]:
        if not isinstance(cur, dict) or p not in cur:
            return
        cur = cur[p]
    if isinstance(cur, dict) and path[-1] in cur:
        del cur[path[-1]]


def _merge_extra_preserve_masked(existing: dict, new: dict) -> dict:
    """Shallow+one-level dict merge: placeholder secrets keep existing values."""
    out = copy.deepcopy(existing)
    for k, v in new.items():
        if v == _MASKED_PLACEHOLDER:
            continue
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge_extra_preserve_masked(out[k], v)
        else:
            out[k] = v
    return out


def _is_likely_secret_key(key: str) -> bool:
    n = key.lower()
    if n in ("token", "secret", "password", "api_key", "app_secret", "client_secret", "encrypt_key", "verification_token", "key"):
        return True
    return "secret" in n or n.endswith("_token") or n == "password"


def _redact_extra_for_display(extra: Any) -> Any:
    if not isinstance(extra, dict):
        return {}
    out: Dict[str, Any] = {}
    for k, v in extra.items():
        if isinstance(v, dict):
            out[k] = _redact_extra_for_display(v)
        elif _is_likely_secret_key(str(k)) and v:
            out[k] = _MASKED_PLACEHOLDER
        else:
            out[k] = v
    return out


def _build_form_values(raw_block: dict, pcfg, fields: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Return (values dict, augmented field list; secrets use empty value + is_set)."""
    out: Dict[str, Any] = {}
    if not isinstance(raw_block, dict):
        raw_block = {}
    aug_fields: List[Dict[str, Any]] = []
    for f in fields:
        name = f["name"]
        typ = f["type"]
        path = f.get("path") or []
        fo = dict(f)
        if typ == "html":
            aug_fields.append(fo)
            continue
        if name == "enabled":
            out[name] = bool(pcfg.enabled)
            aug_fields.append(fo)
            continue
        raw_val = _get_nested(raw_block, path)
        if typ == "secret":
            fo["is_set"] = bool(raw_val)
            out[name] = ""
        elif typ == "int":
            out[name] = int(raw_val) if raw_val is not None and str(raw_val).strip() != "" else ""
        elif typ == "enum":
            out[name] = str(raw_val or "first")
        elif typ == "json":
            base = raw_val
            if path == ["extra"] and isinstance(base, dict):
                base = _redact_extra_for_display(copy.deepcopy(base))
            if base in (None, ""):
                out[name] = ""
            else:
                try:
                    out[name] = json.dumps(base, ensure_ascii=False, indent=2)
                except (TypeError, ValueError):
                    out[name] = str(base)
        else:
            out[name] = "" if raw_val is None else str(raw_val)
        aug_fields.append(fo)
    return out, aug_fields


def _load_gateway_cfg_locked():
    prev = os.environ.get("HERMES_HOME")
    try:
        from api.profiles import get_active_hermes_home

        os.environ["HERMES_HOME"] = str(get_active_hermes_home())
        from gateway.config import load_gateway_config

        return load_gateway_config()
    finally:
        if prev is not None:
            os.environ["HERMES_HOME"] = prev
        else:
            os.environ.pop("HERMES_HOME", None)


def get_gateway_platforms_payload() -> Dict[str, Any]:
    """Return merged gateway platform status + editable field schema/values."""
    from api.config import _get_config_path, _load_yaml_config_file
    from api.profiles import get_active_hermes_home

    home = get_active_hermes_home()
    cfg_path = _get_config_path()
    payload: Dict[str, Any] = {
        "hermes_home": str(home),
        "config_yaml": str(cfg_path),
        "platforms": [],
        "error": None,
    }
    full_yaml = _load_yaml_config_file(cfg_path)
    raw_platforms = full_yaml.get("platforms") if isinstance(full_yaml.get("platforms"), dict) else {}

    try:
        with _LOAD_LOCK:
            cfg = _load_gateway_cfg_locked()
    except Exception as e:
        logger.exception("Failed to load gateway config for platforms UI")
        payload["error"] = str(e)
        return payload

    rows: List[Dict[str, Any]] = []
    try:
        from gateway.config import Platform, PlatformConfig

        connected_set = set(cfg.get_connected_platforms())
        ordered = [p for p in Platform if p != Platform.LOCAL]
        ordered.sort(key=lambda p: p.value)
        emitted: set = set()
        for plat in ordered:
            pcfg = cfg.platforms.get(plat) or PlatformConfig()
            pv = plat.value
            has_entry = plat in cfg.platforms
            connected = bool(pcfg.enabled) and plat in connected_set
            raw_block = raw_platforms.get(pv) if isinstance(raw_platforms.get(pv), dict) else {}
            fields = _form_fields_for(pv)
            vals, aug = _build_form_values(raw_block, pcfg, fields)
            row = {
                "id": pv,
                "title": _human_title(pv),
                "enabled": bool(pcfg.enabled),
                "connected": connected,
                "has_entry_in_config": has_entry,
                "adapter_doc_url": _adapter_source_url(pv),
                "config_yaml_key": f"platforms.{pv}",
                "endpoints": _endpoint_rows(pv, pcfg),
                "form_fields": aug,
                "form_values": vals,
            }
            if pv == "weixin":
                row["weixin_bind_ui"] = True
            rows.append(row)
            emitted.add(plat)
        for plat, pcfg in cfg.platforms.items():
            if plat in emitted:
                continue
            pv = plat.value
            raw_block = raw_platforms.get(pv) if isinstance(raw_platforms.get(pv), dict) else {}
            fields = _form_fields_for(pv)
            vals, aug = _build_form_values(raw_block, pcfg, fields)
            row = {
                "id": pv,
                "title": _human_title(pv),
                "enabled": bool(pcfg.enabled),
                "connected": bool(pcfg.enabled) and plat in connected_set,
                "has_entry_in_config": True,
                "adapter_doc_url": _adapter_source_url(pv),
                "config_yaml_key": f"platforms.{pv}",
                "endpoints": _endpoint_rows(pv, pcfg),
                "form_fields": aug,
                "form_values": vals,
            }
            if pv == "weixin":
                row["weixin_bind_ui"] = True
            rows.append(row)
        rows.sort(key=lambda r: r["id"])
    except Exception as e:
        logger.exception("Failed to serialize gateway platforms")
        payload["error"] = str(e)
        return payload

    payload["platforms"] = rows
    return payload


def save_gateway_platform(platform_id: str, body: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Merge posted fields into config.yaml → platforms.<platform_id>. Returns (ok_dict, error)."""
    from api.config import _get_config_path, _load_yaml_config_file, _save_yaml_config_file, reload_config

    pid = (platform_id or "").strip().lower()
    if not _PLATFORM_ID_RE.match(pid):
        return None, "invalid_platform_id"

    fields_in = body.get("fields")
    if not isinstance(fields_in, dict):
        return None, "missing_fields"

    try:
        with _LOAD_LOCK:
            cfg_path = _get_config_path()
            full = copy.deepcopy(_load_yaml_config_file(cfg_path))
            if not isinstance(full, dict):
                full = {}
            platforms = full.get("platforms")
            if not isinstance(platforms, dict):
                platforms = {}
                full["platforms"] = platforms
            cur = platforms.get(pid)
            if not isinstance(cur, dict):
                cur = {}
            cur = copy.deepcopy(cur)
            existing_extra = cur.get("extra") if isinstance(cur.get("extra"), dict) else {}

            form_fields = _form_fields_for(pid)
            merged = copy.deepcopy(fields_in)

            for f in form_fields:
                name = f["name"]
                if name not in merged:
                    continue
                typ = f["type"]
                path = f.get("path") or []
                val = merged[name]

                if typ == "html":
                    continue

                if typ == "bool":
                    _set_nested(cur, path, val in (True, "true", "1", 1, "on", "yes"))
                    continue

                if typ == "secret":
                    if not isinstance(val, str):
                        continue
                    if val.strip() == "" or val == _MASKED_PLACEHOLDER:
                        continue
                    _set_nested(cur, path, val)
                    continue

                if typ == "enum":
                    opts = f.get("options") or []
                    s = str(val or "")
                    if s in opts:
                        _set_nested(cur, path, s)
                    continue

                if typ == "int":
                    if val in ("", None):
                        _del_nested(cur, path)
                        continue
                    try:
                        _set_nested(cur, path, int(val))
                    except (TypeError, ValueError):
                        return None, f"invalid_int:{name}"
                    continue

                if typ == "string":
                    s = str(val or "").strip()
                    if s == "":
                        _del_nested(cur, path)
                        continue
                    _set_nested(cur, path, s)
                    continue

                if typ == "json":
                    if not isinstance(val, str):
                        return None, f"invalid_json:{name}"
                    text = val.strip()
                    if text == "":
                        _del_nested(cur, path)
                        continue
                    try:
                        parsed = json.loads(text)
                    except json.JSONDecodeError:
                        return None, f"invalid_json:{name}"
                    if path == ["extra"]:
                        if not isinstance(parsed, dict):
                            return None, "extra_must_be_object"
                        cur["extra"] = _merge_extra_preserve_masked(existing_extra, parsed)
                    else:
                        if not isinstance(parsed, dict):
                            return None, f"invalid_json:{name}"
                        root = cur.setdefault("extra", {})
                        if not isinstance(root, dict):
                            return None, "extra_corrupt"
                        sub_key = path[1]
                        old_branch = root.get(sub_key) if isinstance(root.get(sub_key), dict) else {}
                        root[sub_key] = _merge_extra_preserve_masked(old_branch, parsed)
                    continue

            platforms[pid] = cur
            full["platforms"] = platforms
            _save_yaml_config_file(cfg_path, full)
            reload_config()
    except Exception as e:
        logger.exception("save_gateway_platform failed")
        return None, str(e)

    out: Dict[str, Any] = {"ok": True, "id": pid}
    if bool(body.get("restart_gateway")):
        try:
            from api.gateway_restart import try_reload_or_start_gateway

            out["gateway_restart"] = try_reload_or_start_gateway()
        except Exception as exc:
            logger.warning("gateway restart after save failed: %s", exc)
            out["gateway_restart"] = {"restarted": False, "reason": "error", "detail": str(exc)}
    return out, None
