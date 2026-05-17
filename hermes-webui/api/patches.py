"""
Hermes One-Click runtime patches.

Injects customizations into hermes-agent at startup WITHOUT modifying
hermes-agent source code. This keeps hermes-agent upgradeable (pull upstream,
no patch conflicts) while letting One-Click add China-specific features.

Call apply_patches() once during server startup, after sys.path has been
configured by api/config.py (i.e. after verify_hermes_imports() passes).

Currently injected:
  - SkillhubChinaSource: uses the local `skillhub` CLI as a skill registry
    source, preferred over overseas sources by default.
  - skills.hub config defaults: installs preferred_remote_source / skillhub_cn
    defaults into hermes_cli.config.DEFAULT_CONFIG so new users get the
    China-local skill hub without manual config.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

logger = logging.getLogger(__name__)

_PATCHES_APPLIED = False


# ---------------------------------------------------------------------------
# SkillhubChinaSource — injected into tools.skills_hub at runtime
# ---------------------------------------------------------------------------

def _make_skillhub_china_source_class():
    """Return the SkillhubChinaSource class, built against the live
    tools.skills_hub module (imported lazily so patches.py itself doesn't
    need hermes-agent on sys.path at import time)."""

    from tools.skills_hub import SkillSource, SkillMeta, SkillBundle  # noqa: PLC0415

    class SkillhubChinaSource(SkillSource):
        """Use the China-local Skillhub CLI as the preferred remote skill source.

        Injected by Hermes One-Click patches — not part of upstream hermes-agent.
        Requires the `skillhub` CLI to be on PATH (bundled in the One-Click
        installer under tools/bin/).
        """

        SOURCE_ID = "skillhub-cn"

        def __init__(self, command: str = "skillhub") -> None:
            self.command = command
            self.command_path = shutil.which(command)
            self.is_available = bool(self.command_path)

        def source_id(self) -> str:
            return self.SOURCE_ID

        def trust_level_for(self, identifier: str) -> str:
            return "trusted"

        def _run(
            self,
            args: List[str],
            *,
            cwd: Optional[Path] = None,
            timeout: int = 60,
        ) -> subprocess.CompletedProcess:
            if not self.command_path:
                raise FileNotFoundError("skillhub CLI not found")
            return subprocess.run(
                [self.command_path, *args],
                cwd=str(cwd) if cwd else None,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
            )

        @staticmethod
        def _normalize_identifier(identifier: str) -> str:
            raw = str(identifier or "").strip()
            for prefix in ("skillhub-cn/", "skillhub/"):
                if raw.startswith(prefix):
                    return raw[len(prefix):].strip()
            return raw

        def _meta_from_mapping(self, item: Dict[str, Any]) -> Optional[SkillMeta]:
            name = str(
                item.get("name")
                or item.get("title")
                or item.get("id")
                or item.get("slug")
                or ""
            ).strip()
            if not name:
                return None
            description = str(
                item.get("description")
                or item.get("summary")
                or item.get("desc")
                or "Skillhub skill"
            ).strip()
            identifier = str(
                item.get("identifier") or item.get("id") or item.get("slug") or name
            ).strip()
            tags = item.get("tags") if isinstance(item.get("tags"), list) else []
            extra = {
                k: v for k, v in item.items()
                if k not in {"name", "title", "description", "summary", "desc", "tags"}
            }
            extra["install_command"] = f"skillhub install {identifier}"
            return SkillMeta(
                name=name,
                description=description,
                source=self.source_id(),
                identifier=f"{self.source_id()}/{identifier}",
                trust_level="trusted",
                tags=[str(t) for t in tags],
                extra=extra,
            )

        def _parse_search_output(
            self, output: str, query: str, limit: int
        ) -> List[SkillMeta]:
            text = (output or "").strip()
            if not text:
                return []
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = None

            if parsed is not None:
                if isinstance(parsed, dict):
                    for key in ("skills", "results", "items", "data"):
                        value = parsed.get(key)
                        if isinstance(value, list):
                            parsed = value
                            break
                if isinstance(parsed, list):
                    metas = [
                        self._meta_from_mapping(item)
                        for item in parsed
                        if isinstance(item, dict)
                    ]
                    return [m for m in metas if m is not None][:limit]

            results: List[SkillMeta] = []
            for raw_line in text.splitlines():
                line = raw_line.strip()
                if not line or line.lower().startswith(("name", "skillhub", "search")):
                    continue
                line = re.sub(r"^[\-\*\d\.\)\s]+", "", line).strip()
                if not line:
                    continue
                parts = re.split(r"\s{2,}|\s+-\s+|\s+—\s+", line, maxsplit=1)
                name = parts[0].strip().split()[0]
                description = parts[1].strip() if len(parts) > 1 else "Skillhub skill"
                if not name or name.lower() in {"name", "skill"}:
                    continue
                results.append(
                    SkillMeta(
                        name=name,
                        description=description,
                        source=self.source_id(),
                        identifier=f"{self.source_id()}/{name}",
                        trust_level="trusted",
                        extra={"install_command": f"skillhub install {name}"},
                    )
                )
                if len(results) >= limit:
                    break
            return results

        def search(self, query: str, limit: int = 10) -> List[SkillMeta]:
            if not self.is_available:
                return []
            try:
                proc = self._run(["search", query or ""], timeout=30)
            except Exception as exc:
                logger.debug("skillhub search failed: %s", exc)
                return []
            if proc.returncode != 0:
                logger.debug(
                    "skillhub search exited %s: %s", proc.returncode, proc.stderr
                )
                return []
            return self._parse_search_output(proc.stdout, query, limit)

        def inspect(self, identifier: str) -> Optional[SkillMeta]:
            name = self._normalize_identifier(identifier)
            if not name or not self.is_available:
                return None
            for meta in self.search(name, limit=20):
                if meta.name.lower() == name.lower() or meta.identifier.lower().endswith(
                    f"/{name.lower()}"
                ):
                    return meta
            return SkillMeta(
                name=name,
                description="Skillhub skill",
                source=self.source_id(),
                identifier=f"{self.source_id()}/{name}",
                trust_level="trusted",
                extra={"install_command": f"skillhub install {name}"},
            )

        def fetch(self, identifier: str) -> Optional[SkillBundle]:
            name = self._normalize_identifier(identifier)
            if not self.is_available or not name:
                return None
            with tempfile.TemporaryDirectory(prefix="hermes-skillhub-cn-") as tmp:
                tmp_path = Path(tmp)
                try:
                    proc = self._run(["install", name], cwd=tmp_path, timeout=120)
                except Exception as exc:
                    logger.debug("skillhub install failed for %s: %s", name, exc)
                    return None
                if proc.returncode != 0:
                    logger.debug(
                        "skillhub install exited %s for %s: %s",
                        proc.returncode,
                        name,
                        proc.stderr,
                    )
                    return None

                skill_files = [
                    p
                    for p in tmp_path.rglob("SKILL.md")
                    if ".git" not in p.parts and ".hub" not in p.parts
                ]
                if not skill_files:
                    logger.debug(
                        "skillhub install produced no SKILL.md for %s", name
                    )
                    return None

                skill_dir = skill_files[0].parent
                files: Dict[str, Union[str, bytes]] = {}
                for fpath in skill_dir.rglob("*"):
                    if not fpath.is_file():
                        continue
                    rel = fpath.relative_to(skill_dir).as_posix()
                    try:
                        files[rel] = fpath.read_text(encoding="utf-8")
                    except UnicodeDecodeError:
                        files[rel] = fpath.read_bytes()

                meta = self.inspect(name)
                bundle_name = (meta.name if meta else name) or skill_dir.name
                return SkillBundle(
                    name=bundle_name,
                    files=files,
                    source=self.source_id(),
                    identifier=f"{self.source_id()}/{name}",
                    trust_level="trusted",
                    metadata={
                        "install_command": f"skillhub install {name}",
                        "stdout": proc.stdout[-2000:] if proc.stdout else "",
                    },
                )

    return SkillhubChinaSource


# ---------------------------------------------------------------------------
# Patch 1: Inject SkillhubChinaSource into tools.skills_hub
# ---------------------------------------------------------------------------

def _patch_skills_hub() -> None:
    """Monkey-patch tools.skills_hub to add SkillhubChinaSource and override
    create_source_router so it respects skillhub_cn config keys."""
    try:
        import tools.skills_hub as _hub  # noqa: PLC0415
    except ImportError:
        logger.debug("patches: tools.skills_hub not importable, skipping")
        return

    if hasattr(_hub, "SkillhubChinaSource"):
        return  # already injected (e.g. future upstream that re-added it)

    SkillhubChinaSource = _make_skillhub_china_source_class()
    _hub.SkillhubChinaSource = SkillhubChinaSource  # type: ignore[attr-defined]

    _original_create_source_router = _hub.create_source_router

    def _patched_create_source_router(auth=None):
        """Replacement for create_source_router that respects One-Click config."""
        if auth is None:
            auth = _hub.GitHubAuth()

        taps_mgr = _hub.TapsManager()
        extra_taps = taps_mgr.list_taps()

        try:
            from hermes_cli.config import cfg_get, load_config  # noqa: PLC0415
            cfg = load_config()
            preferred_remote = cfg_get(
                cfg, "skills", "hub", "preferred_remote_source",
                default="skillhub-cn",
            )
            enable_skillhub_cn = bool(cfg_get(
                cfg, "skills", "hub", "skillhub_cn_enabled",
                default=True,
            ))
            enable_overseas_fallback = bool(cfg_get(
                cfg, "skills", "hub", "enable_overseas_fallback",
                default=True,
            ))
        except Exception:
            preferred_remote = "skillhub-cn"
            enable_skillhub_cn = True
            enable_overseas_fallback = True

        sources = [_hub.OptionalSkillSource()]

        if enable_skillhub_cn and preferred_remote == "skillhub-cn":
            sources.append(SkillhubChinaSource())

        if enable_overseas_fallback or not sources[1:]:
            sources.extend([
                _hub.HermesIndexSource(auth=auth),
                _hub.SkillsShSource(auth=auth),
                _hub.WellKnownSkillSource(),
                _hub.UrlSource(),
                _hub.GitHubSource(auth=auth, extra_taps=extra_taps),
                _hub.ClawHubSource(),
                _hub.ClaudeMarketplaceSource(auth=auth),
                _hub.LobeHubSource(),
            ])
        else:
            sources.append(_hub.UrlSource())

        if enable_skillhub_cn and preferred_remote != "skillhub-cn":
            sources.append(SkillhubChinaSource())

        return sources

    _hub.create_source_router = _patched_create_source_router  # type: ignore[attr-defined]
    logger.info(
        "patches: SkillhubChinaSource injected, create_source_router patched"
    )


# ---------------------------------------------------------------------------
# Patch 2: Inject skills.hub defaults into hermes_cli.config.DEFAULT_CONFIG
# ---------------------------------------------------------------------------

def _patch_config_defaults() -> None:
    """Add skills.hub section to DEFAULT_CONFIG so cfg_get() returns
    China-friendly defaults even if the user has no config file yet."""
    try:
        import hermes_cli.config as _cfg  # noqa: PLC0415
    except ImportError:
        logger.debug("patches: hermes_cli.config not importable, skipping")
        return

    dc = getattr(_cfg, "DEFAULT_CONFIG", None)
    if dc is None:
        return

    skills_section = dc.get("skills")
    if not isinstance(skills_section, dict):
        return

    if "hub" in skills_section:
        return  # already present (future upstream that re-added it)

    skills_section["hub"] = {
        "preferred_remote_source": "skillhub-cn",
        "skillhub_cn_enabled": True,
        "enable_overseas_fallback": True,
    }
    logger.info("patches: skills.hub defaults injected into DEFAULT_CONFIG")


# ---------------------------------------------------------------------------
# Patch 3: Force Git for Windows bash over WSL bash on Windows
# ---------------------------------------------------------------------------

def _patch_windows_bash() -> None:
    """On Windows, ensure HERMES_GIT_BASH_PATH points to Git for Windows bash.exe
    rather than WSL's bash.exe.

    Problem: `shutil.which("bash")` returns WSL's bash
    (`C:\\Users\\...\\WindowsApps\\bash.exe`) when WSL is installed, because
    the WindowsApps directory sits earlier in PATH than Git for Windows.
    hermes-agent's `_find_bash()` respects HERMES_GIT_BASH_PATH first, so we
    set it here to skip the broken WSL lookup.

    Only activates when:
    - Running on Windows
    - HERMES_GIT_BASH_PATH is not already set by the user
    - A Git for Windows bash.exe is found at a standard install location
    """
    import os
    import platform

    if platform.system() != "Windows":
        return

    if os.environ.get("HERMES_GIT_BASH_PATH"):
        return  # user already configured it, respect that

    candidates = []

    # 1. Hermes portable git (dropped by hermes install.ps1)
    local_appdata = os.environ.get("LOCALAPPDATA", "")
    if local_appdata:
        candidates += [
            os.path.join(local_appdata, "hermes", "git", "bin", "bash.exe"),
            os.path.join(local_appdata, "hermes", "git", "usr", "bin", "bash.exe"),
        ]

    # 2. Standard Git for Windows install locations
    prog_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    prog_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    if local_appdata:
        candidates.append(os.path.join(local_appdata, "Programs", "Git", "bin", "bash.exe"))
    candidates += [
        os.path.join(prog_files, "Git", "bin", "bash.exe"),
        os.path.join(prog_files_x86, "Git", "bin", "bash.exe"),
    ]

    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            os.environ["HERMES_GIT_BASH_PATH"] = candidate
            logger.info(
                "patches: HERMES_GIT_BASH_PATH set to %s (bypasses WSL bash)", candidate
            )
            return

    logger.warning(
        "patches: Git for Windows bash.exe not found in standard locations; "
        "terminal may fall back to WSL bash. "
        "Set HERMES_GIT_BASH_PATH manually to fix this."
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Patch 4: Auto-install missing messaging platform SDK packages
# ---------------------------------------------------------------------------

# Mapping: config.yaml platform key → (importable_name, pip_package_spec)
# Versions mirror hermes-agent's pyproject.toml optional extras exactly so
# they are guaranteed compatible with the installed hermes-agent build.
_PLATFORM_DEPS: dict[str, tuple[str, str]] = {
    "feishu":    ("lark_oapi",       "lark-oapi>=1.3.0"),
    "dingtalk":  ("dingtalk_stream", "dingtalk-stream>=0.20"),
    "telegram":  ("telegram",        "python-telegram-bot>=21.0"),
    "discord":   ("discord",         "discord.py>=2.3.0"),
    "slack":     ("slack_sdk",       "slack-sdk>=3.30.0"),
    "matrix":    ("nio",             "matrix-nio[encryption]>=0.24.0"),
}


def _load_config_yaml() -> dict:
    """Return parsed config.yaml for the active hermes home, or {}."""
    import os
    import yaml  # bundled with hermes-agent

    hermes_home = os.environ.get("HERMES_HOME") or os.path.join(
        os.path.expanduser("~"), ".hermes"
    )
    # Respect HERMES_CONFIG_PATH override if set
    cfg_path = os.environ.get("HERMES_CONFIG_PATH") or os.path.join(
        hermes_home, "config.yaml"
    )
    try:
        if os.path.isfile(cfg_path):
            with open(cfg_path, encoding="utf-8") as fh:
                return yaml.safe_load(fh) or {}
    except Exception as exc:
        logger.debug("patches: could not read config.yaml: %s", exc)
    return {}


def _patch_platform_deps() -> None:
    """Auto-install missing messaging platform SDK packages.

    Reads config.yaml to discover which platforms are enabled, then checks
    whether their required Python packages are importable.  Any missing package
    is installed in a background thread so startup is never blocked.

    This lets users who configure e.g. Feishu in the UI get a working gateway
    even though the bundled Python runtime does not pre-install every optional
    platform SDK.  The install runs once per missing package; subsequent starts
    skip it because the package is already importable.
    """
    import importlib
    import sys
    import threading

    cfg = _load_config_yaml()
    platforms_cfg: dict = cfg.get("platforms") or {}

    to_install: list[tuple[str, str]] = []  # (import_name, pip_spec)

    for platform_key, (import_name, pip_spec) in _PLATFORM_DEPS.items():
        platform_entry = platforms_cfg.get(platform_key)
        if not isinstance(platform_entry, dict):
            continue
        if not platform_entry.get("enabled", False):
            continue
        # Check importability
        try:
            importlib.import_module(import_name)
        except ImportError:
            logger.info(
                "patches: platform '%s' enabled but '%s' not importable — "
                "will auto-install '%s'",
                platform_key, import_name, pip_spec,
            )
            to_install.append((platform_key, import_name, pip_spec))

    if not to_install:
        return

    def _install_worker() -> None:
        for platform_key, import_name, pip_spec in to_install:
            logger.info(
                "patches: installing '%s' for platform '%s'…",
                pip_spec, platform_key,
            )
            try:
                result = subprocess.run(
                    [
                        sys.executable, "-m", "pip", "install",
                        "--quiet", "--disable-pip-version-check",
                        pip_spec,
                    ],
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                if result.returncode == 0:
                    logger.info(
                        "patches: '%s' installed successfully for platform '%s'. "
                        "Restart the gateway to activate.",
                        pip_spec, platform_key,
                    )
                else:
                    logger.error(
                        "patches: pip install '%s' failed (rc=%d):\n%s",
                        pip_spec, result.returncode,
                        (result.stderr or result.stdout or "").strip()[:800],
                    )
            except Exception as exc:
                logger.error(
                    "patches: could not install '%s': %s", pip_spec, exc
                )

    t = threading.Thread(target=_install_worker, daemon=True, name="oc-platform-deps")
    t.start()


def apply_patches() -> None:
    """Apply all One-Click runtime patches. Safe to call multiple times."""
    global _PATCHES_APPLIED
    if _PATCHES_APPLIED:
        return
    _PATCHES_APPLIED = True

    _patch_windows_bash()
    _patch_config_defaults()
    _patch_skills_hub()
    _patch_platform_deps()
    logger.info("patches: One-Click runtime patches applied")
