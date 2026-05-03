"""
Full local factory reset: Hermes user home + WebUI state directory + in-memory caches.

Destructive — requires explicit confirmation phrase and (when auth is enabled)
the access password.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import stat
import sys
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_CONFIRM_PHRASE = "RESET_ALL_USER_DATA"


class FactoryResetPasswordError(Exception):
    """Raised when auth is enabled but the supplied password is wrong or missing."""


def _is_under(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def _win_clear_file_attrs(path: str) -> None:
    """Clear READONLY/HIDDEN/SYSTEM so DeleteFile can succeed (Windows)."""
    if os.name != "nt":
        return
    try:
        import ctypes

        # FILE_ATTRIBUTE_NORMAL — drop read-only and other restrictive bits
        ctypes.windll.kernel32.SetFileAttributesW(os.fsdecode(path), 0x80)
    except Exception:
        pass


def _chmod_writable_recursive(root: Path) -> None:
    """Best-effort: make every file and directory user-writable (Git pack files are often read-only on Windows)."""
    if not root.exists():
        return
    root = root.resolve()
    try:
        for dirpath, dirnames, filenames in os.walk(root, topdown=False):
            for name in filenames:
                fp = os.path.join(dirpath, name)
                _win_clear_file_attrs(fp)
                try:
                    mode = os.stat(fp).st_mode
                    os.chmod(fp, mode | stat.S_IWRITE)
                except OSError:
                    pass
            for name in dirnames:
                dp = os.path.join(dirpath, name)
                _win_clear_file_attrs(dp)
                try:
                    mode = os.stat(dp).st_mode
                    os.chmod(dp, mode | stat.S_IWRITE)
                except OSError:
                    pass
            _win_clear_file_attrs(dirpath)
            try:
                mode = os.stat(dirpath).st_mode
                os.chmod(dirpath, mode | stat.S_IWRITE)
            except OSError:
                pass
        _win_clear_file_attrs(str(root))
        try:
            mode = os.stat(root).st_mode
            os.chmod(root, mode | stat.S_IWRITE)
        except OSError:
            pass
    except OSError as e:
        logger.debug("chmod tree %s: %s", root, e)


def _remove_git_index_locks(root: Path) -> None:
    try:
        for p in root.rglob("index.lock"):
            if ".git" not in p.parts:
                continue
            try:
                p.unlink(missing_ok=True)
            except TypeError:
                if p.exists():
                    p.unlink()
            except OSError:
                pass
    except OSError:
        pass


def _is_windows_file_in_use(exc: OSError) -> bool:
    return os.name == "nt" and getattr(exc, "winerror", None) == 32


def _is_ignorable_locked_log(path: Path, root: Path) -> bool:
    try:
        rel = path.resolve().relative_to(root.resolve())
    except (OSError, ValueError):
        return False
    parts = [p.lower() for p in rel.parts]
    return len(parts) >= 2 and parts[0] == "logs" and path.suffix.lower() == ".log"


def _remove_tree_allowing_locked_logs(root: Path) -> bool:
    """Delete a tree on Windows while tolerating live log files held by another process."""
    if os.name != "nt" or not root.exists():
        return False
    locked_logs: list[Path] = []
    try:
        for dirpath, dirnames, filenames in os.walk(root, topdown=False):
            current = Path(dirpath)
            for name in filenames:
                fp = current / name
                try:
                    _win_clear_file_attrs(str(fp))
                    fp.unlink()
                except OSError as exc:
                    if _is_windows_file_in_use(exc) and _is_ignorable_locked_log(fp, root):
                        locked_logs.append(fp)
                        continue
                    return False
            for name in dirnames:
                dp = current / name
                try:
                    dp.rmdir()
                except OSError:
                    pass
            try:
                current.rmdir()
            except OSError:
                pass
    except OSError:
        return False

    remaining_files = [p for p in root.rglob("*") if p.is_file()]
    if not remaining_files:
        try:
            root.rmdir()
        except OSError:
            pass
        return True
    return bool(locked_logs) and all(_is_ignorable_locked_log(p, root) for p in remaining_files)


def _rmtree_with_retries(path: Path, label: str) -> None:
    if not path.exists():
        return
    last: OSError | None = None
    for attempt in range(4):
        try:
            _chmod_writable_recursive(path)
            _remove_git_index_locks(path)
            if sys.version_info >= (3, 12):

                def onexc(func, p: str, exc: BaseException) -> None:
                    if isinstance(exc, PermissionError) and os.path.exists(p):
                        _win_clear_file_attrs(p)
                        try:
                            mode = os.stat(p).st_mode
                            os.chmod(p, mode | stat.S_IWRITE)
                        except OSError:
                            pass
                        func(p)
                        return
                    raise exc

                shutil.rmtree(path, onexc=onexc)
            else:

                def onerror(func, p: str, exc_info):  # type: ignore[misc]
                    _e = exc_info[1]
                    if isinstance(_e, PermissionError) and os.path.exists(p):
                        _win_clear_file_attrs(p)
                        try:
                            mode = os.stat(p).st_mode
                            os.chmod(p, mode | stat.S_IWRITE)
                        except OSError:
                            pass
                        func(p)
                        return
                    raise _e

                shutil.rmtree(path, onerror=onerror)
            return
        except OSError as e:
            last = e
            logger.warning("rmtree %s attempt %s (%s): %s", label, attempt, path, e)
            time.sleep(0.2 * (attempt + 1))
    assert last is not None
    if _is_windows_file_in_use(last) and _remove_tree_allowing_locked_logs(path):
        logger.warning(
            "Factory reset left locked log file(s) under %s because another process still holds them.",
            path,
        )
        return
    raise RuntimeError(
        f"Could not remove {label} at {path}: {last}. "
        "Close Git GUI, IDE, or terminals using this repo, then retry."
    ) from last


def perform_factory_reset(handler: BaseHTTPRequestHandler, body: dict[str, Any]) -> dict[str, Any]:
    from api.auth import clear_session_cookies_memory, is_auth_enabled, verify_password
    from api.config import (
        AGENT_INSTANCES,
        CANCEL_FLAGS,
        LOCK,
        SESSION_AGENT_CACHE,
        SESSION_AGENT_CACHE_LOCK,
        SESSION_AGENT_LOCKS,
        SESSION_AGENT_LOCKS_LOCK,
        SESSION_DIR,
        SESSIONS,
        SETTINGS_FILE,
        STATE_DIR,
        STREAM_LIVE_TOOL_CALLS,
        STREAM_PARTIAL_TEXT,
        STREAM_REASONING_TEXT,
        STREAMS,
        STREAMS_LOCK,
        _SETTINGS_DEFAULTS,
        reload_config,
        resolve_default_workspace,
    )
    from api import config as cfg
    from api.metering import meter
    from api.profiles import _resolve_base_hermes_home, init_profile_state
    from api.streaming import (
        cancel_stream,
        close_all_agent_session_db_handles,
        wait_for_streaming_workers_idle,
    )

    if (body.get("confirm") or "").strip() != _CONFIRM_PHRASE:
        raise ValueError(
            f"Invalid confirmation. Send JSON {{\"confirm\": \"{_CONFIRM_PHRASE}\"}}."
        )

    if is_auth_enabled():
        pw = body.get("password")
        if not pw or not isinstance(pw, str) or not verify_password(pw):
            raise FactoryResetPasswordError(
                "password required and must match your access password"
            )

    base_home = _resolve_base_hermes_home().resolve()
    state_dir = Path(STATE_DIR).resolve()

    # ── Cancel streams (best-effort) ───────────────────────────────────────
    with STREAMS_LOCK:
        stream_ids = list(STREAMS.keys())
    for sid in stream_ids:
        try:
            cancel_stream(sid)
        except Exception:
            logger.debug("cancel_stream failed for %s", sid, exc_info=True)

    if not wait_for_streaming_workers_idle(30.0):
        logger.warning(
            "Factory reset: streaming workers still running after timeout — "
            "state.db delete may fail on Windows if a stream is stuck."
        )
    close_all_agent_session_db_handles()

    with STREAMS_LOCK:
        STREAMS.clear()
        CANCEL_FLAGS.clear()
        AGENT_INSTANCES.clear()
        STREAM_PARTIAL_TEXT.clear()
        STREAM_REASONING_TEXT.clear()
        STREAM_LIVE_TOOL_CALLS.clear()

    try:
        from api.gateway_watcher import stop_watcher

        stop_watcher()
    except Exception:
        logger.debug("stop_watcher failed", exc_info=True)

    # ── In-memory WebUI state ───────────────────────────────────────────────
    with LOCK:
        SESSIONS.clear()
    with SESSION_AGENT_CACHE_LOCK:
        SESSION_AGENT_CACHE.clear()
    with SESSION_AGENT_LOCKS_LOCK:
        SESSION_AGENT_LOCKS.clear()

    try:
        meter().reset_all()
    except Exception:
        logger.debug("meter reset failed", exc_info=True)

    clear_session_cookies_memory()

    # ── Disk: WebUI state (if outside Hermes home, delete first) ───────────
    if not _is_under(state_dir, base_home) and state_dir != base_home:
        _rmtree_with_retries(state_dir, "WebUI state (custom path)")

    _rmtree_with_retries(base_home, "Hermes home")

    # ── Recreate directories ─────────────────────────────────────────────────
    base_home.mkdir(parents=True, exist_ok=True)
    if not _is_under(state_dir, base_home):
        state_dir.mkdir(parents=True, exist_ok=True)
    else:
        # Default layout: ~/.hermes/webui under ~/.hermes — recreated with base
        state_dir.mkdir(parents=True, exist_ok=True)
    SESSION_DIR.mkdir(parents=True, exist_ok=True)

    persisted = {k: v for k, v in _SETTINGS_DEFAULTS.items() if k != "default_model"}
    SETTINGS_FILE.write_text(
        json.dumps(persisted, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Point default workspace at a fresh resolved path (may create ~/workspace)
    cfg.DEFAULT_WORKSPACE = resolve_default_workspace(
        persisted.get("default_workspace")
    )

    try:
        init_profile_state()
    except Exception:
        logger.debug("init_profile_state after reset failed", exc_info=True)

    reload_config()

    try:
        from api.gateway_watcher import start_watcher

        start_watcher()
    except Exception:
        logger.debug("start_watcher after reset failed", exc_info=True)

    logger.warning(
        "Factory reset completed by client=%s",
        getattr(handler, "client_address", ("?",))[0],
    )
    return {"ok": True, "message": "All local Hermes and WebUI data were erased."}
