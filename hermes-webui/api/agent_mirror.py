"""
Hermes-agent version against a domestic Git mirror (ghproxy-wrapped GitHub).

Compares the local agent checkout with ``git ls-remote`` + ``git fetch`` from
``HERMES_AGENT_MIRROR_URL`` (default: ghproxy + NousResearch/hermes-agent).
"""
from __future__ import annotations

import logging
import os
import tomllib
from pathlib import Path

from api.config import REPO_ROOT
from api.updates import _AGENT_DIR, _apply_lock, _run_git, _schedule_restart

logger = logging.getLogger(__name__)

# Primary: user-requested ghproxy-style URL. Many Git builds refuse cross-host
# redirects from ghproxy → other CDNs; we fall back to ghfast when that happens.
DEFAULT_MIRROR_PRIMARY = "https://ghproxy.com/https://github.com/NousResearch/hermes-agent.git"
DEFAULT_MIRROR_FALLBACK = "https://ghfast.top/https://github.com/NousResearch/hermes-agent.git"
REF_MIRROR_HEAD = "refs/hermes-cn/mirror-head"

_REDIRECT_FAIL_SUBSTRINGS = (
    "unable to update url base from redirection",
    "could not resolve host",
    "failed to connect",
    "connection timed out",
    "connection refused",
)


def _read_agent_package_version(agent_path: Path) -> str | None:
    """Read ``[project].version`` from the agent checkout's ``pyproject.toml``."""
    toml_path = agent_path / "pyproject.toml"
    if not toml_path.is_file():
        return None
    try:
        with toml_path.open("rb") as fp:
            data = tomllib.load(fp)
        ver = data.get("project", {}).get("version")
        if isinstance(ver, str) and ver.strip():
            return ver.strip()
    except Exception:
        logger.debug("package version parse failed for %s", toml_path, exc_info=True)
    return None


def _git_network(args: list[str], cwd, timeout: float = 90):
    """Run git with HTTP redirect following (needed for ghproxy-style mirrors)."""
    return _run_git(["-c", "http.followRedirects=true"] + list(args), cwd, timeout)


def mirror_url() -> str:
    raw = os.getenv("HERMES_AGENT_MIRROR_URL", DEFAULT_MIRROR_PRIMARY).strip()
    return raw or DEFAULT_MIRROR_PRIMARY


def _mirror_fallback_url() -> str:
    return (
        os.getenv("HERMES_AGENT_MIRROR_FALLBACK", DEFAULT_MIRROR_FALLBACK).strip()
        or DEFAULT_MIRROR_FALLBACK
    )


def _ls_remote_heads(url: str) -> tuple[str, bool]:
    return _git_network(["ls-remote", "--heads", url], REPO_ROOT, timeout=90)


def _parse_ls_remote_heads(text: str) -> dict[str, str]:
    heads: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or "\t" not in line:
            continue
        sha, ref = line.split("\t", 1)
        if ref.startswith("refs/heads/"):
            heads[ref[len("refs/heads/") :]] = sha
    return heads


def _pick_branch(heads: dict[str, str]) -> str | None:
    for name in ("main", "master"):
        if name in heads:
            return name
    return next(iter(heads.keys()), None)


def get_agent_mirror_status() -> dict:
    """Return local agent version and mirror tip; ``behind`` counts when fetch works."""
    primary = mirror_url()
    url = primary
    out, ok = _ls_remote_heads(primary)
    if not ok:
        err_lower = (out or "").lower()
        if any(s in err_lower for s in _REDIRECT_FAIL_SUBSTRINGS) or "redirect" in err_lower:
            fb = _mirror_fallback_url()
            if fb != primary:
                out2, ok2 = _ls_remote_heads(fb)
                if ok2:
                    out, ok = out2, True
                    url = fb
    if not ok:
        return {
            "ok": False,
            "error": out or "ls-remote failed",
            "mirror_url": primary,
        }

    heads = _parse_ls_remote_heads(out)
    branch = _pick_branch(heads)
    if not branch or branch not in heads:
        return {
            "ok": False,
            "error": "Could not resolve default branch on mirror",
            "mirror_url": url,
            "mirror_url_primary": primary,
        }

    mirror_full = heads[branch]
    mirror_short = mirror_full[:7]

    base: dict = {
        "ok": True,
        "mirror_url": url,
        "mirror_branch": branch,
        "mirror_sha": mirror_full,
        "mirror_short": mirror_short,
    }
    if url != primary:
        base["mirror_url_primary"] = primary

    if _AGENT_DIR is None or not (_AGENT_DIR / "run_agent.py").exists():
        return {
            **base,
            "agent_found": False,
        }

    agent_path = _AGENT_DIR.resolve()
    package_version = _read_agent_package_version(agent_path)
    local_desc, _ = _run_git(
        ["describe", "--tags", "--always", "--dirty"],
        agent_path,
        timeout=5,
    )
    local_desc = local_desc or "unknown"

    if not (agent_path / ".git").exists():
        return {
            **base,
            "agent_found": True,
            "git_repo": False,
            "agent_path": str(agent_path),
            "package_version": package_version,
            "local_version": local_desc,
        }

    local_sha, ok_head = _run_git(["rev-parse", "HEAD"], agent_path)
    if not ok_head or not local_sha:
        local_sha = ""
    local_short = local_sha[:7] if local_sha else ""

    fetch_spec = f"+refs/heads/{branch}:{REF_MIRROR_HEAD}"
    fetch_out, fetch_ok = _git_network(
        ["fetch", "--no-tags", url, fetch_spec],
        agent_path,
        timeout=120,
    )

    behind = 0
    fetch_error: str | None = None
    if fetch_ok:
        cnt, ok_cnt = _run_git(
            ["rev-list", "--count", f"HEAD..{REF_MIRROR_HEAD}"],
            agent_path,
        )
        if ok_cnt and cnt.isdigit():
            behind = int(cnt)
    else:
        fetch_error = (fetch_out or "").strip()[:400] or "mirror_fetch_failed"
        logger.debug("mirror fetch failed for %s: %s", agent_path, fetch_error)

    if fetch_ok:
        update_available = behind > 0
    else:
        update_available = bool(local_sha) and local_sha != mirror_full

    return {
        **base,
        "agent_found": True,
        "git_repo": True,
        "agent_path": str(agent_path),
        "package_version": package_version,
        "local_version": local_desc,
        "local_sha": local_short,
        "local_sha_full": local_sha,
        "behind": behind,
        "fetch_ok": fetch_ok,
        "fetch_error": fetch_error,
        "update_available": update_available,
    }


def apply_agent_update_from_mirror() -> dict:
    """Fast-forward local agent to mirror tip; restarts WebUI process on success."""
    if not _apply_lock.acquire(blocking=False):
        return {"ok": False, "message": "Update already in progress"}

    try:
        st = get_agent_mirror_status()
        if not st.get("ok"):
            return {"ok": False, "message": st.get("error") or "Status check failed"}
        if not st.get("agent_found") or not st.get("git_repo"):
            return {"ok": False, "message": "Agent checkout is not a git repo or was not found"}

        agent_path = Path(st["agent_path"])
        branch = st["mirror_branch"]
        url = st["mirror_url"]

        status_out, status_ok = _run_git(
            ["status", "--porcelain", "--untracked-files=no"],
            agent_path,
        )
        if not status_ok:
            return {"ok": False, "message": f"Failed to inspect repo: {status_out[:200]}"}
        if any(
            line[:2] in {"DD", "AU", "UD", "UA", "DU", "AA", "UU"}
            for line in status_out.splitlines()
        ):
            return {
                "ok": False,
                "message": "The agent repo has merge conflicts; resolve them manually.",
            }

        stashed = False
        if status_out:
            _, stash_ok = _run_git(["stash", "push", "-m", "hermes-webui mirror update"], agent_path)
            if not stash_ok:
                return {"ok": False, "message": "Failed to stash local changes"}
            stashed = True

        fetch_spec = f"+refs/heads/{branch}:{REF_MIRROR_HEAD}"
        _, fetch_ok = _git_network(
            ["fetch", "--no-tags", url, fetch_spec],
            agent_path,
            timeout=120,
        )
        if not fetch_ok:
            if stashed:
                _run_git(["stash", "pop"], agent_path)
            return {"ok": False, "message": "Could not fetch from mirror (network or timeout)."}

        merge_out, merge_ok = _run_git(
            ["merge", "--ff-only", REF_MIRROR_HEAD],
            agent_path,
            timeout=90,
        )
        if not merge_ok:
            if stashed:
                _run_git(["stash", "pop"], agent_path)
            detail = (merge_out or "").strip()[:400]
            return {
                "ok": False,
                "message": f"Fast-forward merge failed: {detail or 'unknown error'}",
            }

        if stashed:
            _, pop_ok = _run_git(["stash", "pop"], agent_path)
            if not pop_ok:
                return {
                    "ok": False,
                    "message": "Updated from mirror but stash pop failed — resolve manually.",
                }

        _schedule_restart()
        return {
            "ok": True,
            "message": "hermes-agent updated from mirror; restarting…",
            "restart_scheduled": True,
        }
    finally:
        _apply_lock.release()
