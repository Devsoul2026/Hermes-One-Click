"""Windows desktop integration tools for the Hermes visual app."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home
from tools.registry import registry


DESKTOP_APPS_FILE = "desktop_apps.json"

BUILTIN_DESKTOP_APPS: dict[str, dict[str, str]] = {
    "browser": {
        "label": "Default browser",
        "description": "Open web links in the user's default Windows browser.",
    },
    "edge": {
        "label": "Microsoft Edge",
        "description": "Open Microsoft Edge.",
    },
    "chrome": {
        "label": "Google Chrome",
        "description": "Open Google Chrome when installed in a common location.",
    },
    "explorer": {
        "label": "File Explorer",
        "description": "Open File Explorer to a safe known folder.",
    },
    "wechat": {
        "label": "WeChat",
        "description": "Open WeChat when installed in a common location.",
    },
    "notepad": {
        "label": "Notepad",
        "description": "Open Windows Notepad.",
    },
    "calculator": {
        "label": "Calculator",
        "description": "Open Windows Calculator.",
    },
}

SAFE_EXPLORER_TARGETS = {"home", "desktop", "downloads", "documents", "workspace"}


def desktop_apps_path() -> Path:
    return get_hermes_home() / DESKTOP_APPS_FILE


def default_desktop_apps_config() -> dict[str, Any]:
    return {
        "enabled": True,
        "apps": [
            {
                "app_id": app_id,
                "label": info["label"],
                "description": info["description"],
                "enabled": True,
                "source": "builtin",
            }
            for app_id, info in BUILTIN_DESKTOP_APPS.items()
        ],
    }


def load_desktop_apps_config() -> dict[str, Any]:
    defaults = default_desktop_apps_config()
    path = desktop_apps_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except (OSError, json.JSONDecodeError):
        raw = {}
    if not isinstance(raw, dict):
        raw = {}

    by_id = {item["app_id"]: dict(item) for item in defaults["apps"]}
    for item in raw.get("apps", []):
        if not isinstance(item, dict):
            continue
        app_id = str(item.get("app_id") or "").strip().lower()
        if app_id not in BUILTIN_DESKTOP_APPS:
            continue
        by_id[app_id]["enabled"] = bool(item.get("enabled", by_id[app_id]["enabled"]))

    return {
        "enabled": bool(raw.get("enabled", defaults["enabled"])),
        "apps": [by_id[app_id] for app_id in BUILTIN_DESKTOP_APPS],
    }


def save_desktop_apps_config(payload: dict[str, Any]) -> dict[str, Any]:
    current = load_desktop_apps_config()
    enabled = bool(payload.get("enabled", current.get("enabled", True)))
    incoming_apps = payload.get("apps", [])
    enabled_by_id: dict[str, bool] = {}
    if isinstance(incoming_apps, list):
        for item in incoming_apps:
            if not isinstance(item, dict):
                continue
            app_id = str(item.get("app_id") or "").strip().lower()
            if app_id in BUILTIN_DESKTOP_APPS:
                enabled_by_id[app_id] = bool(item.get("enabled", True))

    apps = []
    for item in current["apps"]:
        next_item = dict(item)
        if next_item["app_id"] in enabled_by_id:
            next_item["enabled"] = enabled_by_id[next_item["app_id"]]
        apps.append(next_item)

    saved = {"enabled": enabled, "apps": apps}
    path = desktop_apps_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding="utf-8")
    return saved


def is_desktop_tool_available() -> bool:
    return (
        sys.platform == "win32"
        and os.getenv("HERMES_DESKTOP_MODE") == "1"
        and bool(os.getenv("HERMES_DESKTOP_BRIDGE_URL"))
        and bool(os.getenv("HERMES_DESKTOP_BRIDGE_TOKEN"))
    )


def _json_result(**payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _enabled_app(app_id: str) -> dict[str, Any] | None:
    config = load_desktop_apps_config()
    if not config.get("enabled", True):
        return None
    for app in config.get("apps", []):
        if app.get("app_id") == app_id and app.get("enabled", True):
            return app
    return None


def _bridge_post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    base_url = os.getenv("HERMES_DESKTOP_BRIDGE_URL", "").rstrip("/")
    token = os.getenv("HERMES_DESKTOP_BRIDGE_TOKEN", "")
    if not base_url or not token:
        raise RuntimeError("Hermes desktop bridge is not available.")
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
            message = parsed.get("error") or body
        except json.JSONDecodeError:
            message = body or str(exc)
        raise RuntimeError(message) from exc


def _validate_http_url(raw_url: str) -> str:
    url = str(raw_url or "").strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("url must be a valid http or https URL.")
    try:
        from tools.website_policy import check_website_access

        blocked = check_website_access(url)
        if blocked:
            raise ValueError(blocked.get("message") or "URL blocked by website policy.")
    except ValueError:
        raise
    except Exception:
        pass
    return url


def desktop_open_url(url: str) -> str:
    if not _enabled_app("browser"):
        return _json_result(success=False, error="Desktop browser opening is disabled.")
    try:
        safe_url = _validate_http_url(url)
        _bridge_post("/desktop/open-url", {"url": safe_url})
        return _json_result(
            success=True,
            url=safe_url,
            message="Opened in the user's local browser. Do not call browser_navigate for this request.",
        )
    except Exception as exc:
        return _json_result(success=False, error=str(exc))


def desktop_open_app(app_id: str, target: str | None = None) -> str:
    app = str(app_id or "").strip().lower()
    if app not in BUILTIN_DESKTOP_APPS:
        return _json_result(success=False, error=f"Unsupported desktop app id: {app_id}")
    if not _enabled_app(app):
        return _json_result(success=False, error=f"Desktop app is disabled: {app}")
    clean_target = str(target or "").strip().lower() or None
    if app == "explorer" and clean_target and clean_target not in SAFE_EXPLORER_TARGETS:
        return _json_result(
            success=False,
            error="Explorer target must be one of: home, desktop, downloads, documents, workspace.",
        )
    if app != "explorer" and clean_target:
        return _json_result(success=False, error=f"App {app} does not accept a target.")
    try:
        _bridge_post("/desktop/open-app", {"app_id": app, "target": clean_target})
        return _json_result(success=True, app_id=app, target=clean_target)
    except Exception as exc:
        return _json_result(success=False, error=str(exc))


DESKTOP_OPEN_URL_SCHEMA = {
    "name": "desktop_open_url",
    "description": (
        "Open a http or https URL in the user's local Windows default browser. "
        "Only available in the Hermes Windows visual desktop app. "
        "Use this for user requests like 'open my local browser to ...'. "
        "After this succeeds, do not call browser_navigate; browser_navigate is a separate browser automation tool."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The http or https URL to open locally.",
            },
        },
        "required": ["url"],
    },
}

DESKTOP_OPEN_APP_SCHEMA = {
    "name": "desktop_open_app",
    "description": (
        "Open an enabled local Windows desktop app by app_id. Supported built-in app_id "
        "values are browser, edge, chrome, explorer, wechat, notepad, calculator. "
        "For File Explorer only, target may be home, desktop, downloads, documents, or workspace."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "app_id": {
                "type": "string",
                "description": "The enabled app id to open.",
            },
            "target": {
                "type": "string",
                "description": "Optional safe target. Only supported for explorer.",
            },
        },
        "required": ["app_id"],
    },
}


registry.register(
    name="desktop_open_url",
    toolset="desktop",
    schema=DESKTOP_OPEN_URL_SCHEMA,
    handler=lambda args, **kw: desktop_open_url(args.get("url", "")),
    check_fn=is_desktop_tool_available,
)

registry.register(
    name="desktop_open_app",
    toolset="desktop",
    schema=DESKTOP_OPEN_APP_SCHEMA,
    handler=lambda args, **kw: desktop_open_app(args.get("app_id", ""), args.get("target")),
    check_fn=is_desktop_tool_available,
)
