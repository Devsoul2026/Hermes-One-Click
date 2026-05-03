"""Tests for self-update diagnostics (api/updates.py)."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import api.updates as updates


def test_run_git_returns_stderr_on_failure(tmp_path):
    """When a git command fails, _run_git should return stderr (not empty string)."""
    with patch('subprocess.run') as mock_run:
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout='',
            stderr="fatal: 'origin/master' does not appear to be a git repository\n",
        )
        out, ok = updates._run_git(['pull', '--ff-only', 'origin/master'], tmp_path)

    assert ok is False
    assert "does not appear to be a git repository" in out


def test_run_git_returns_stdout_when_no_stderr(tmp_path):
    """If stderr is empty on failure, fall back to stdout."""
    with patch('subprocess.run') as mock_run:
        mock_run.return_value = MagicMock(
            returncode=128,
            stdout='Already up to date.',
            stderr='',
        )
        out, ok = updates._run_git(['pull'], tmp_path)

    assert ok is False
    assert 'Already up to date' in out


def test_run_git_returns_exit_code_when_no_output(tmp_path):
    """If both stdout and stderr are empty, report the exit code."""
    with patch('subprocess.run') as mock_run:
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout='',
            stderr='',
        )
        out, ok = updates._run_git(['status'], tmp_path)

    assert ok is False
    assert 'status 1' in out


def test_split_remote_ref_splits_tracking_ref():
    """_split_remote_ref should correctly split origin/branch."""
    assert updates._split_remote_ref('origin/master') == ('origin', 'master')
    assert updates._split_remote_ref('origin/feature/foo') == ('origin', 'feature/foo')
    assert updates._split_remote_ref('master') == (None, 'master')


def test_restart_exec_argv_prefers_orig_argv():
    """Re-exec argv should mirror the real launcher when orig_argv is set (3.10+)."""
    fake = [r"C:\Python311\python.exe", r"D:\repo\hermes-webui\server.py", "--port", "8787"]
    with patch.object(sys, "orig_argv", fake, create=True):
        with patch.object(sys, "argv", ["server.py", "--port", "8787"]):
            assert updates._restart_exec_argv() == fake


def test_restart_exec_argv_strips_duplicate_interpreter(tmp_path, monkeypatch):
    """Avoid ``python.exe python.exe`` when argv[0] duplicated sys.executable."""
    srv = tmp_path / "server.py"
    srv.write_text("# stub\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    fake_exe = tmp_path / "python.exe"
    fake_exe.write_bytes(b"")
    with patch.object(updates, "REPO_ROOT", tmp_path):
        with patch.object(sys, "executable", str(fake_exe), create=False):
            with patch.object(sys, "orig_argv", [], create=True):
                with patch.object(
                    sys,
                    "argv",
                    [str(fake_exe), str(srv), "--port", "9"],
                    create=False,
                ):
                    out = updates._restart_exec_argv()
    assert out[0] == str(fake_exe)
    assert Path(out[1]).resolve() == srv.resolve()
    assert out[2:] == ["--port", "9"]
