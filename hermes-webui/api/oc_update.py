"""
Hermes One-Click self-update module.

Uses the GitHub Releases API to detect newer versions, then downloads the
installer EXE via ghproxy.com (CN mirror) or direct GitHub URL.

For Chinese users who cannot reach api.github.com, deploy the included
Cloudflare Worker (docs/cloudflare-worker-update-proxy.js) and set:
  HERMES_OC_UPDATE_API_URL=https://hermes-update.yourname.workers.dev
"""
from __future__ import annotations

import logging
import os
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Current installed version
# ---------------------------------------------------------------------------
try:
    from api._oc_version import OC_VERSION  # written by Build-Staging.ps1
except ImportError:
    OC_VERSION = "0.9.0"  # development fallback

# ---------------------------------------------------------------------------
# Remote version source
# Resolution order:
#   1. HERMES_OC_UPDATE_API_URL env var (custom CN proxy, e.g. Cloudflare Worker)
#   2. GitHub Releases API directly
# ---------------------------------------------------------------------------
_RELEASES_API_URL = (
    "https://api.github.com/repos/Devsoul2026/Hermes-One-Click/releases/latest"
)
_CUSTOM_API_URL_ENV = "HERMES_OC_UPDATE_API_URL"

_DOWNLOAD_BASE_GHPROXY = (
    "https://ghproxy.com/https://github.com/Devsoul2026/Hermes-One-Click/releases/download"
)
_DOWNLOAD_BASE_GITHUB = (
    "https://github.com/Devsoul2026/Hermes-One-Click/releases/download"
)

# ---------------------------------------------------------------------------
# Update check cache
# ---------------------------------------------------------------------------
_check_cache: dict = {}
_check_lock = threading.Lock()
_CACHE_TTL = 1800  # 30 minutes

# ---------------------------------------------------------------------------
# Active downloads
# ---------------------------------------------------------------------------
_downloads: dict[str, dict] = {}
_downloads_lock = threading.Lock()


def _fetch_url(url: str, timeout: int = 15) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "HermesOneClick/updater",
            "Accept": "application/vnd.github+json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _parse_version(v: str) -> tuple[int, ...]:
    """Parse 'V0.7.1' or '0.7.1' into (0, 7, 1) for numeric comparison."""
    v = v.lstrip("Vv")
    try:
        return tuple(int(x) for x in v.split("."))
    except ValueError:
        return (0,)


def check_oc_update(force: bool = False) -> dict:
    """Return update check result. Uses a 30-min server-side cache.

    URL resolution order:
      1. HERMES_OC_UPDATE_API_URL env var (Cloudflare Worker CN proxy)
      2. api.github.com directly
    """
    with _check_lock:
        if (
            not force
            and _check_cache
            and time.time() - _check_cache.get("checked_at", 0) < _CACHE_TTL
        ):
            return dict(_check_cache)

    result: dict = {
        "current": OC_VERSION,
        "latest": None,
        "update_available": False,
        "changelog": "",
        "tag": "",
        "filename": "",
        "checked_at": time.time(),
        "error": None,
    }

    # Build ordered list of URLs to try
    candidate_urls: list[str] = []
    custom = os.environ.get(_CUSTOM_API_URL_ENV, "").strip()
    if custom:
        candidate_urls.append(custom)
    candidate_urls.append(_RELEASES_API_URL)

    release = None
    last_exc: Optional[Exception] = None
    for url in candidate_urls:
        try:
            import json as _json
            data = _fetch_url(url, timeout=12)
            parsed = _json.loads(data)
            if isinstance(parsed, dict) and "tag_name" in parsed:
                release = parsed
                break
        except Exception as exc:
            last_exc = exc
            logger.debug("oc_update: API failed (%s): %s", url, exc)

    if release is None:
        result["error"] = (
            "无法连接更新服务器。\n"
            "国内用户可配置 Cloudflare Worker 代理（见文档），"
            "或手动前往下载：https://ghproxy.com/https://github.com/"
            "Devsoul2026/Hermes-One-Click/releases"
        )
    else:
        tag = release.get("tag_name", "")
        latest = tag.lstrip("Vv")
        result["tag"] = tag
        result["latest"] = latest
        result["changelog"] = release.get("body", "").strip()

        for asset in release.get("assets", []):
            name = asset.get("name", "")
            if name.lower().endswith(".exe"):
                result["filename"] = name
                break

        try:
            result["update_available"] = (
                _parse_version(latest) > _parse_version(OC_VERSION)
            )
        except Exception:
            result["update_available"] = False

    with _check_lock:
        _check_cache.clear()
        _check_cache.update(result)

    return result


def _build_download_urls(tag: str, filename: str) -> list[str]:
    # Try direct GitHub first (works for most users); ghproxy as CN fallback.
    return [
        f"{_DOWNLOAD_BASE_GITHUB}/{tag}/{filename}",
        f"{_DOWNLOAD_BASE_GHPROXY}/{tag}/{filename}",
    ]


def _download_worker(download_id: str, tag: str, filename: str) -> None:
    """Background thread: streams the installer EXE to a temp file."""
    urls = _build_download_urls(tag, filename)
    tmp_dir = Path(tempfile.gettempdir()) / "hermes-oc-update"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    dest = tmp_dir / filename

    def _update(
        percent: int,
        done: int,
        total: int,
        status: str,
        error: Optional[str] = None,
    ) -> None:
        with _downloads_lock:
            entry = _downloads.get(download_id)
            if entry:
                entry.update(
                    percent=percent,
                    bytes_done=done,
                    bytes_total=total,
                    status=status,
                    error=error,
                )

    _update(0, 0, 0, "downloading")

    last_exc: Optional[Exception] = None
    for url in urls:
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "HermesOneClick/updater"}
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                # Reject HTML responses — proxies like ghproxy.com sometimes
                # return their own HTML page instead of the binary file.
                ct = resp.headers.get("Content-Type", "")
                if "text/html" in ct:
                    logger.debug(
                        "oc_update: skipping %s — got Content-Type: %s", url, ct
                    )
                    continue

                total = int(resp.headers.get("Content-Length") or 0)
                done = 0
                chunk = 65536
                with open(dest, "wb") as fp:
                    while True:
                        buf = resp.read(chunk)
                        if not buf:
                            break
                        fp.write(buf)
                        done += len(buf)
                        pct = int(done * 100 / total) if total else 0
                        _update(pct, done, total, "downloading")

            # Validate: a real Windows PE starts with the "MZ" magic bytes.
            with open(dest, "rb") as fp:
                magic = fp.read(2)
            if magic != b"MZ":
                logger.debug(
                    "oc_update: %s produced a non-PE file (magic=%r), trying next URL",
                    url, magic,
                )
                try:
                    dest.unlink(missing_ok=True)
                except Exception:
                    pass
                continue

            _update(100, done, total, "ready")
            with _downloads_lock:
                entry = _downloads.get(download_id)
                if entry:
                    entry["path"] = str(dest)
            return
        except Exception as exc:
            last_exc = exc
            logger.debug("oc_update: download failed (%s): %s", url, exc)

    _update(0, 0, 0, "error", str(last_exc) if last_exc else "Download failed from all sources")


def start_download(tag: str, filename: str) -> str:
    """Start a background download. Returns a download_id."""
    import uuid

    download_id = uuid.uuid4().hex
    with _downloads_lock:
        _downloads[download_id] = {
            "percent": 0,
            "bytes_done": 0,
            "bytes_total": 0,
            "status": "starting",
            "path": None,
            "error": None,
            "tag": tag,
            "filename": filename,
        }
    t = threading.Thread(
        target=_download_worker, args=(download_id, tag, filename), daemon=True
    )
    t.start()
    return download_id


def get_download_status(download_id: str) -> Optional[dict]:
    """Return current download progress, or None if not found."""
    with _downloads_lock:
        entry = _downloads.get(download_id)
        return dict(entry) if entry else None


def launch_installer(download_id: str) -> dict:
    """Launch the downloaded installer, then delete it to free disk space."""
    with _downloads_lock:
        entry = _downloads.get(download_id)
    if not entry:
        return {"ok": False, "message": "Unknown download_id"}
    if entry.get("status") != "ready":
        return {
            "ok": False,
            "message": f"Download not ready (status: {entry.get('status')})",
        }
    path = entry.get("path")
    if not path or not Path(path).exists():
        return {"ok": False, "message": "Installer file not found"}

    # Resolve to full long path (avoid 8.3 short-name issues).
    try:
        path = str(Path(path).resolve())
    except Exception:
        pass

    # Unblock the downloaded file (remove Mark-of-the-Web Zone.Identifier ADS).
    try:
        import subprocess as _sp
        _sp.run(
            ["powershell", "-NoProfile", "-Command", f'Unblock-File -Path "{path}"'],
            capture_output=True,
            timeout=10,
        )
    except Exception:
        pass
    try:
        ads = path + ":Zone.Identifier"
        if os.path.exists(ads):
            os.remove(ads)
    except Exception:
        pass

    # Launch the installer as a fully detached child process.
    # subprocess.Popen works reliably from within WebView2-hosted Python
    # (ShellExecuteW runas is often blocked in that security context).
    # The installer's own UAC manifest requests elevation.
    launched = False
    try:
        import subprocess as _sp
        _sp.Popen(
            [path],
            creationflags=(
                _sp.DETACHED_PROCESS | _sp.CREATE_NEW_PROCESS_GROUP
            ),
            close_fds=True,
        )
        launched = True
    except Exception as exc:
        logger.debug("oc_update: Popen launch failed: %s", exc)

    if not launched:
        # Last resort: os.startfile (ShellExecuteW "open").
        try:
            os.startfile(path)
            launched = True
        except Exception as exc:
            logger.exception("oc_update: startfile launch failed")
            return {"ok": False, "message": str(exc)}

    # Schedule deletion of the installer file after a short delay so the
    # installer process has time to start reading it.
    def _delete_later(p: str, delay: float = 30.0) -> None:
        import time as _time
        _time.sleep(delay)
        try:
            Path(p).unlink(missing_ok=True)
            logger.debug("oc_update: deleted installer file %s", p)
        except Exception:
            pass

    threading.Thread(target=_delete_later, args=(path,), daemon=True).start()

    return {
        "ok": True,
        "message": "Installer launched. Please follow the on-screen instructions.",
    }
