"""Embedded workspace terminal support for Hermes Web UI.

The terminal is intentionally independent from the agent execution path.  It
starts a shell with an explicit cwd/env per process and never mutates
process-global os.environ, which avoids expanding the session-env race tracked
in the agent execution layer.

Two backends share one public surface so ``api/routes.py`` stays
platform-agnostic:

* **POSIX** — classic ``os.openpty()`` master/slave fds + ``fcntl``/``termios``.
* **Windows** — ConPTY via ``winpty`` (``pywinpty``), pulled in through the
  hermes-agent ``[pty]`` extra.  No WSL dependency.

Both expose: ``workspace``, ``rows``/``cols``, an ``output`` queue, a ``closed``
event, ``is_alive()``, ``exit_code()``, ``put_output()``, plus ``write()`` /
``resize()`` / ``terminate()``.  Module-level ``start_terminal`` /
``get_terminal`` / ``write_terminal`` / ``resize_terminal`` / ``close_terminal``
pick the right backend by platform.
"""

from __future__ import annotations

import codecs
import os
import queue
import shutil
import subprocess
import sys
import threading
from pathlib import Path

IS_WINDOWS = sys.platform == "win32"

if not IS_WINDOWS:
    import errno
    import fcntl
    import select
    import signal
    import struct
    import termios


_TERMINALS: dict[str, "TerminalSession"] = {}
_LOCK = threading.RLock()

# Terminal size clamps shared by both backends.
_ROWS_MIN, _ROWS_MAX = 8, 80
_COLS_MIN, _COLS_MAX = 20, 240


def _clamp_rows(rows: int, fallback: int = 24) -> int:
    return max(_ROWS_MIN, min(int(rows or fallback or 24), _ROWS_MAX))


def _clamp_cols(cols: int, fallback: int = 80) -> int:
    return max(_COLS_MIN, min(int(cols or fallback or 80), _COLS_MAX))


def _decode_terminal_output(decoder, data: bytes) -> str:
    """Decode PTY bytes without stripping terminal control sequences."""
    return decoder.decode(data)


class TerminalSession:
    """Backend-agnostic base. Holds the output queue + lifecycle state."""

    def __init__(self, session_id: str, workspace: str, rows: int = 24, cols: int = 80):
        self.session_id = session_id
        self.workspace = workspace
        self.rows = _clamp_rows(rows)
        self.cols = _clamp_cols(cols)
        self.output: queue.Queue = queue.Queue(maxsize=2000)
        self.closed: threading.Event = threading.Event()
        self.reader: threading.Thread | None = None

    # -- output plumbing --------------------------------------------------
    def put_output(self, event: str, payload: dict) -> None:
        try:
            self.output.put_nowait((event, payload))
        except queue.Full:
            # Keep the terminal responsive by dropping the oldest queued chunk.
            try:
                self.output.get_nowait()
            except queue.Empty:
                pass
            try:
                self.output.put_nowait((event, payload))
            except queue.Full:
                pass

    def start_reader(self) -> None:
        self.reader = threading.Thread(target=self._reader_loop, daemon=True)
        self.reader.start()

    # -- interface implemented by backends --------------------------------
    def is_alive(self) -> bool:  # pragma: no cover - overridden
        raise NotImplementedError

    def exit_code(self):  # pragma: no cover - overridden
        raise NotImplementedError

    def write(self, data: str) -> None:  # pragma: no cover - overridden
        raise NotImplementedError

    def resize(self, rows: int, cols: int) -> None:  # pragma: no cover - overridden
        raise NotImplementedError

    def terminate(self) -> None:  # pragma: no cover - overridden
        raise NotImplementedError

    def _reader_loop(self) -> None:  # pragma: no cover - overridden
        raise NotImplementedError


# ── Shared env hardening ──────────────────────────────────────────────────
# The PTY shell is an interactive UI surface — do not leak server credentials
# (API keys/tokens the agent may have loaded into os.environ). Both backends
# build a clean env from an allowlist rather than copying os.environ wholesale.

_POSIX_SAFE_ENV_KEYS = {
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL",
    "LC_CTYPE", "LC_MESSAGES", "LANGUAGE", "TZ", "TMPDIR", "TEMP",
    "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
}

# Windows shells (PowerShell/cmd) need a broader baseline to function. Keys are
# matched case-insensitively because os.environ preserves OS casing (e.g.
# 'Path', 'SystemRoot'). Secrets are never on this list.
_WIN_SAFE_ENV_KEYS = {
    "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC",
    "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
    "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
    "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "COMMONPROGRAMW6432",
    "TEMP", "TMP", "USERNAME", "USERDOMAIN", "COMPUTERNAME", "OS",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER",
    "PSMODULEPATH", "ALLUSERSPROFILE", "PUBLIC", "DRIVERDATA",
    "LANG", "LC_ALL", "TZ",
}


def _build_safe_env(cwd: str, rows: int, cols: int) -> dict:
    if IS_WINDOWS:
        allow = {k.upper() for k in _WIN_SAFE_ENV_KEYS}
        env = {k: v for k, v in os.environ.items() if k.upper() in allow}
    else:
        env = {k: v for k, v in os.environ.items() if k in _POSIX_SAFE_ENV_KEYS}
    env.update(
        {
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
            "COLUMNS": str(cols),
            "LINES": str(rows),
            "PWD": cwd,
            "HERMES_WEBUI_TERMINAL": "1",
        }
    )
    return env


# ===========================================================================
# POSIX backend
# ===========================================================================

def _posix_shell_path() -> str:
    shell = os.environ.get("SHELL") or ""
    if shell and Path(shell).exists():
        return shell
    return shutil.which("zsh") or shutil.which("bash") or shutil.which("sh") or "/bin/sh"


def _posix_shell_argv(shell: str) -> list[str]:
    name = Path(shell).name
    if name in {"zsh", "bash", "sh"}:
        return [shell, "-i"]
    return [shell]


def _winsize_struct(rows: int, cols: int) -> bytes:
    return struct.pack("HHHH", _clamp_rows(rows), _clamp_cols(cols), 0, 0)


class _PosixTerminal(TerminalSession):
    def __init__(self, session_id, workspace, proc, master_fd, rows=24, cols=80):
        super().__init__(session_id, workspace, rows, cols)
        self.proc = proc
        self.master_fd = master_fd

    def is_alive(self) -> bool:
        return not self.closed.is_set() and self.proc.poll() is None

    def exit_code(self):
        return self.proc.poll()

    def write(self, data: str) -> None:
        os.write(self.master_fd, str(data or "").encode("utf-8", errors="replace"))

    def resize(self, rows: int, cols: int) -> None:
        self.rows = _clamp_rows(rows, self.rows)
        self.cols = _clamp_cols(cols, self.cols)
        try:
            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, _winsize_struct(self.rows, self.cols))
        except OSError:
            pass
        try:
            if self.proc.poll() is None:
                os.killpg(self.proc.pid, signal.SIGWINCH)
        except (OSError, ProcessLookupError):
            pass

    def terminate(self) -> None:
        self.closed.set()
        try:
            if self.proc.poll() is None:
                try:
                    os.killpg(self.proc.pid, signal.SIGHUP)
                except ProcessLookupError:
                    pass
                try:
                    self.proc.wait(timeout=1.5)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(self.proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
        finally:
            try:
                os.close(self.master_fd)
            except OSError:
                pass

    def _reader_loop(self) -> None:
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        try:
            while not self.closed.is_set():
                if self.proc.poll() is not None:
                    break
                try:
                    ready, _, _ = select.select([self.master_fd], [], [], 0.25)
                except (OSError, ValueError):
                    break
                if not ready:
                    continue
                try:
                    data = os.read(self.master_fd, 8192)
                except OSError as exc:
                    if exc.errno in (errno.EIO, errno.EBADF):
                        break
                    raise
                if not data:
                    break
                text = _decode_terminal_output(decoder, data)
                if text:
                    self.put_output("output", {"text": text})
        except Exception as exc:  # noqa: BLE001 - surface to UI, never crash server
            self.put_output("terminal_error", {"error": str(exc)})
        finally:
            self.closed.set()
            self.put_output("terminal_closed", {"exit_code": self.proc.poll()})


def _start_posix(session_id: str, cwd: str, rows: int, cols: int) -> _PosixTerminal:
    master_fd, slave_fd = os.openpty()
    env = _build_safe_env(cwd, rows, cols)
    shell = _posix_shell_path()
    proc = subprocess.Popen(
        _posix_shell_argv(shell),
        cwd=cwd,
        env=env,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        start_new_session=True,
    )
    os.close(slave_fd)
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    term = _PosixTerminal(session_id, cwd, proc, master_fd, rows=rows, cols=cols)
    term.resize(rows, cols)
    term.start_reader()
    return term


# ===========================================================================
# Windows backend (ConPTY via winpty / pywinpty)
# ===========================================================================

def _windows_shell_argv() -> list[str]:
    pwsh = shutil.which("pwsh") or shutil.which("powershell")
    if pwsh:
        return [pwsh, "-NoLogo"]
    return [os.environ.get("COMSPEC", "cmd.exe")]


class _WindowsTerminal(TerminalSession):
    def __init__(self, session_id, workspace, proc, rows=24, cols=80):
        super().__init__(session_id, workspace, rows, cols)
        self.proc = proc  # winpty.PtyProcess

    def is_alive(self) -> bool:
        if self.closed.is_set():
            return False
        try:
            return bool(self.proc.isalive())
        except Exception:  # noqa: BLE001
            return False

    def exit_code(self):
        try:
            if self.proc.isalive():
                return None
        except Exception:  # noqa: BLE001
            pass
        return getattr(self.proc, "exitstatus", None)

    def write(self, data: str) -> None:
        try:
            self.proc.write(str(data or ""))
        except Exception as exc:  # noqa: BLE001
            raise KeyError("terminal not running") from exc

    def resize(self, rows: int, cols: int) -> None:
        self.rows = _clamp_rows(rows, self.rows)
        self.cols = _clamp_cols(cols, self.cols)
        try:
            self.proc.setwinsize(self.rows, self.cols)
        except Exception:  # noqa: BLE001
            pass

    def terminate(self) -> None:
        self.closed.set()
        try:
            if self.proc.isalive():
                self.proc.terminate(force=True)
        except Exception:  # noqa: BLE001
            pass

    def _reader_loop(self) -> None:
        # pywinpty.PtyProcess.read() returns str and raises EOFError at end of
        # output. There is no select() on the ConPTY handle, so we block on
        # read in this dedicated thread and exit when the child closes.
        try:
            while not self.closed.is_set():
                try:
                    text = self.proc.read(8192)
                except EOFError:
                    break
                except Exception as exc:  # noqa: BLE001
                    self.put_output("terminal_error", {"error": str(exc)})
                    break
                if text:
                    self.put_output("output", {"text": text})
                elif not self.is_alive():
                    break
        finally:
            self.closed.set()
            self.put_output("terminal_closed", {"exit_code": self.exit_code()})


def _start_windows(session_id: str, cwd: str, rows: int, cols: int) -> "_WindowsTerminal":
    try:
        import winpty  # type: ignore
    except ImportError as exc:  # pragma: no cover - missing optional dep
        raise RuntimeError(
            "Embedded terminal needs the 'pywinpty' package on Windows. "
            "Install hermes-agent with the [pty] extra (pip install -e '.[web,pty]')."
        ) from exc

    env = _build_safe_env(cwd, rows, cols)
    proc = winpty.PtyProcess.spawn(
        _windows_shell_argv(),
        cwd=cwd,
        env=env,
        dimensions=(_clamp_rows(rows), _clamp_cols(cols)),
    )
    term = _WindowsTerminal(session_id, cwd, proc, rows=rows, cols=cols)
    term.start_reader()
    return term


# ===========================================================================
# Public API (platform-agnostic)
# ===========================================================================

def start_terminal(session_id: str, workspace: Path, rows: int = 24, cols: int = 80, restart: bool = False) -> TerminalSession:
    """Start or return the embedded terminal for a WebUI session."""
    sid = str(session_id or "").strip()
    if not sid:
        raise ValueError("session_id is required")
    cwd = str(Path(workspace).expanduser().resolve())
    if not Path(cwd).is_dir():
        raise ValueError("workspace is not a directory")

    with _LOCK:
        current = _TERMINALS.get(sid)
        if current and current.is_alive() and not restart and current.workspace == cwd:
            current.resize(rows, cols)
            return current
        if current:
            close_terminal(sid)

        if IS_WINDOWS:
            term = _start_windows(sid, cwd, rows, cols)
        else:
            term = _start_posix(sid, cwd, rows, cols)
        _TERMINALS[sid] = term
        return term


def get_terminal(session_id: str) -> TerminalSession | None:
    with _LOCK:
        return _TERMINALS.get(str(session_id or ""))


def write_terminal(session_id: str, data: str) -> None:
    term = get_terminal(session_id)
    if not term or not term.is_alive():
        raise KeyError("terminal not running")
    term.write(data)


def resize_terminal(session_id: str, rows: int, cols: int) -> None:
    term = get_terminal(session_id)
    if not term:
        raise KeyError("terminal not running")
    term.resize(rows, cols)


def close_terminal(session_id: str) -> bool:
    sid = str(session_id or "")
    with _LOCK:
        term = _TERMINALS.pop(sid, None)
    if not term:
        return False
    term.terminate()
    return True
