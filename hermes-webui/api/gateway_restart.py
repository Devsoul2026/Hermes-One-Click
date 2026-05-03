"""Best-effort Hermes gateway reload after config changes (Web UI)."""
from __future__ import annotations

import contextlib
import importlib
import logging
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Iterator

logger = logging.getLogger(__name__)


def _is_path_under(path: str | None, root: Path) -> bool:
    if not path:
        return False
    try:
        Path(path).resolve().relative_to(root.resolve())
        return True
    except (OSError, ValueError):
        return False


def _gateway_status_module():
    """Import gateway.status from the configured hermes-agent checkout."""
    from api.config import _AGENT_DIR

    if _AGENT_DIR is not None:
        agent_root = Path(_AGENT_DIR).resolve()
        root_s = str(agent_root)
        sys.path[:] = [p for p in sys.path if str(Path(p).resolve()) != root_s]
        sys.path.insert(0, root_s)

        loaded = sys.modules.get("gateway.status")
        if loaded is not None and not _is_path_under(getattr(loaded, "__file__", None), agent_root):
            sys.modules.pop("gateway.status", None)
            sys.modules.pop("gateway", None)

    return importlib.import_module("gateway.status")


def _candidate_hermes_homes_for_gateway() -> list[Path]:
    """Possible HERMES_HOME directories for gateway.pid (ordered, de-duplicated).

    When only ``HERMES_CONFIG_PATH`` is set (common on Windows One-Click),
    ``get_active_hermes_home()`` may still resolve to ``~/.hermes`` while the
    live gateway uses the config file's directory as its data root.
    """
    seen: set[str] = set()
    out: list[Path] = []

    raw = os.getenv("HERMES_CONFIG_PATH", "").strip()
    if raw:
        p = Path(raw).expanduser()
        if p.is_dir():
            c = p
        elif p.suffix.lower() in (".yaml", ".yml", ".json"):
            c = p.parent
        else:
            c = None
        if c is not None:
            try:
                key = str(c.resolve())
            except OSError:
                key = str(c)
            if key not in seen:
                seen.add(key)
                out.append(c)

    from api.profiles import get_active_hermes_home

    h = get_active_hermes_home()
    key = str(h.resolve())
    if key not in seen:
        seen.add(key)
        out.append(h)
    return out


def try_restart_gateway() -> Dict[str, Any]:
    """Ask a running gateway for this HERMES_HOME to reload (SIGUSR1 when available).

    Returns a small status dict for the API client. On Windows, graceful reload
    may be unavailable — callers should surface ``reason`` to the user.
    """
    prev = os.environ.get("HERMES_HOME")
    pid = None
    try:
        gateway_status = _gateway_status_module()

        homes_list = _candidate_hermes_homes_for_gateway()
        last_exc: Exception | None = None
        failures = 0
        for home in homes_list:
            try:
                os.environ["HERMES_HOME"] = str(home)
                pid = gateway_status.get_running_pid()
                if pid:
                    break
            except Exception as exc:
                failures += 1
                last_exc = exc
                logger.debug("gateway restart: skip home %s: %s", home, exc)
                continue
        if not pid and homes_list and failures == len(homes_list) and last_exc is not None:
            return {"restarted": False, "reason": "lookup_failed", "detail": str(last_exc)}
    finally:
        if prev is not None:
            os.environ["HERMES_HOME"] = prev
        else:
            os.environ.pop("HERMES_HOME", None)

    if not pid:
        return {"restarted": False, "reason": "not_running"}

    sig = getattr(signal, "SIGUSR1", None)
    if sig is None:
        return {"restarted": False, "reason": "sigusr1_unavailable", "pid": pid}

    try:
        os.kill(pid, sig)
    except ProcessLookupError:
        return {"restarted": False, "reason": "process_gone", "pid": pid}
    except (PermissionError, OSError) as exc:
        logger.warning("gateway restart: kill failed pid=%s: %s", pid, exc)
        return {"restarted": False, "reason": "signal_failed", "pid": pid, "detail": str(exc)}

    # Brief pause so service managers / wrapper scripts can react (best-effort).
    time.sleep(0.35)
    return {"restarted": True, "method": "sigusr1", "pid": pid}


def get_gateway_status_dict() -> Dict[str, Any]:
    """Return whether the Hermes gateway daemon is running for the active profile."""
    prev = os.environ.get("HERMES_HOME")
    pid = None
    try:
        gateway_status = _gateway_status_module()

        homes = _candidate_hermes_homes_for_gateway()
        last_exc: Exception | None = None
        failures = 0
        for home in homes:
            try:
                os.environ["HERMES_HOME"] = str(home)
                pid = gateway_status.get_running_pid()
                if pid:
                    break
            except Exception as exc:
                failures += 1
                last_exc = exc
                logger.debug("gateway status: skip home %s: %s", home, exc)
                continue
        if not pid and homes and failures == len(homes) and last_exc is not None:
            return {
                "running": False,
                "pid": None,
                "reason": "lookup_failed",
                "detail": str(last_exc),
            }
    finally:
        if prev is not None:
            os.environ["HERMES_HOME"] = prev
        else:
            os.environ.pop("HERMES_HOME", None)

    if pid:
        return {"running": True, "pid": int(pid)}
    return {"running": False, "pid": None}


@contextlib.contextmanager
def _with_hermes_home(home: str) -> Iterator[None]:
    prev = os.environ.get("HERMES_HOME")
    try:
        os.environ["HERMES_HOME"] = home
        yield
    finally:
        if prev is not None:
            os.environ["HERMES_HOME"] = prev
        else:
            os.environ.pop("HERMES_HOME", None)


def try_start_gateway() -> Dict[str, Any]:
    """Spawn ``python -m gateway.run`` for the active profile when the agent checkout is known."""
    from api.config import PYTHON_EXE, _AGENT_DIR, _HERMES_FOUND
    from api.workspace import get_last_workspace

    if not _HERMES_FOUND or _AGENT_DIR is None:
        return {"started": False, "reason": "agent_not_found"}

    py = Path(PYTHON_EXE)
    if not py.exists():
        return {"started": False, "reason": "python_missing", "detail": str(PYTHON_EXE)}

    homes = _candidate_hermes_homes_for_gateway()
    prev = os.environ.get("HERMES_HOME")
    try:
        gateway_status = _gateway_status_module()

        for home in homes:
            os.environ["HERMES_HOME"] = str(home)
            if gateway_status.get_running_pid():
                return {"started": False, "reason": "already_running"}
    except Exception as exc:
        logger.warning("gateway start: pid check failed: %s", exc)
        return {"started": False, "reason": "lookup_failed", "detail": str(exc)}
    finally:
        if prev is not None:
            os.environ["HERMES_HOME"] = prev
        else:
            os.environ.pop("HERMES_HOME", None)

    hermes_home = str(homes[0])
    home_path = Path(hermes_home)
    log_dir = home_path / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning("gateway start: could not create log dir: %s", exc)
        log_dir = home_path

    log_path = log_dir / "gateway-webui-spawn.log"

    env = os.environ.copy()
    env["HERMES_HOME"] = hermes_home
    try:
        workspace = Path(get_last_workspace()).expanduser().resolve()
        if workspace.is_dir():
            env["HERMES_WEBUI_WORKSPACE_CWD"] = str(workspace)
            env["TERMINAL_CWD"] = str(workspace)
            env["MESSAGING_CWD"] = str(workspace)
    except Exception as exc:
        logger.debug("gateway start: could not resolve UI workspace for env: %s", exc)
    if not any(
        str(env.get(key) or "").strip()
        for key in (
            "WEIXIN_ALLOWED_USERS",
            "WEIXIN_ALLOW_ALL_USERS",
            "GATEWAY_ALLOWED_USERS",
            "GATEWAY_ALLOW_ALL_USERS",
        )
    ):
        # One-Click QR setup cannot know the sender ID before the first message.
        # Keep explicit allowlists authoritative, but make WebUI-spawned Weixin usable.
        env["WEIXIN_ALLOW_ALL_USERS"] = "true"
    agent_root = str(_AGENT_DIR)
    argv = [str(py), "-u", "-m", "gateway.run"]

    try:
        with open(log_path, "ab", buffering=0) as logf:
            if sys.platform == "win32":
                subprocess.Popen(
                    argv,
                    cwd=agent_root,
                    env=env,
                    stdin=subprocess.DEVNULL,
                    stdout=logf,
                    stderr=subprocess.STDOUT,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            else:
                subprocess.Popen(
                    argv,
                    cwd=agent_root,
                    env=env,
                    stdin=subprocess.DEVNULL,
                    stdout=logf,
                    stderr=subprocess.STDOUT,
                    close_fds=True,
                    start_new_session=True,
                )
    except Exception as exc:
        logger.exception("gateway start: Popen failed")
        return {"started": False, "reason": "spawn_failed", "detail": str(exc)}

    # Short poll only — long waits caused clients to abort the POST (WinError 10053).
    new_pid: int | None = None
    for _ in range(18):
        time.sleep(0.1)
        try:
            with _with_hermes_home(hermes_home):
                gateway_status = _gateway_status_module()

                cand = gateway_status.get_running_pid()
                if cand:
                    new_pid = int(cand)
                    break
        except Exception:
            continue

    if new_pid:
        return {"started": True, "pid": new_pid, "log": str(log_path), "pending": False}
    return {
        "started": True,
        "pending": True,
        "pid": None,
        "log": str(log_path),
    }


def try_full_restart_gateway(pid: int | None = None) -> Dict[str, Any]:
    """Fully restart the gateway when graceful reload is unavailable."""
    homes = _candidate_hermes_homes_for_gateway()
    if not homes:
        return {"restarted": False, "started": False, "reason": "home_not_found"}

    hermes_home = str(homes[0])
    try:
        with _with_hermes_home(hermes_home):
            gateway_status = _gateway_status_module()

            target_pid = int(pid or gateway_status.get_running_pid() or 0)
            if target_pid:
                gateway_status.terminate_pid(target_pid, force=sys.platform == "win32")

            deadline = time.time() + 6
            while time.time() < deadline:
                if not gateway_status.get_running_pid(cleanup_stale=True):
                    break
                time.sleep(0.2)
    except Exception as exc:
        logger.warning("gateway full restart: stop failed: %s", exc)
        return {"restarted": False, "started": False, "reason": "stop_failed", "detail": str(exc)}

    started = try_start_gateway()
    if started.get("started"):
        return {
            "restarted": True,
            "started": True,
            "method": "full_restart",
            "pid": started.get("pid"),
            "pending": bool(started.get("pending")),
            "log": started.get("log"),
        }
    return {
        "restarted": False,
        "started": False,
        "reason": started.get("reason") or "start_failed",
        "detail": started.get("detail"),
        "start_attempt": started,
    }


def try_reload_or_start_gateway() -> Dict[str, Any]:
    """Ask a running gateway to reload (SIGUSR1); if none is running, try spawning one."""
    r = try_restart_gateway()
    if r.get("restarted"):
        return r
    if r.get("reason") == "sigusr1_unavailable":
        return try_full_restart_gateway(r.get("pid"))
    if r.get("reason") != "not_running":
        return r
    s = try_start_gateway()
    if s.get("started"):
        return {
            "restarted": False,
            "started": True,
            "pid": s.get("pid"),
            "log": s.get("log"),
            "pending": bool(s.get("pending")),
        }
    out: Dict[str, Any] = {
        "restarted": False,
        "started": False,
        "reason": "not_running",
        "start_attempt": s,
    }
    if s.get("reason"):
        out["start_reason"] = s["reason"]
    if s.get("detail"):
        out["detail"] = s["detail"]
    elif s.get("log"):
        out["detail"] = str(s["log"])
    return out
