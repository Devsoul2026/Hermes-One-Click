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
# Public entry point
# ---------------------------------------------------------------------------

def apply_patches() -> None:
    """Apply all One-Click runtime patches. Safe to call multiple times."""
    global _PATCHES_APPLIED
    if _PATCHES_APPLIED:
        return
    _PATCHES_APPLIED = True

    _patch_config_defaults()
    _patch_skills_hub()
    logger.info("patches: One-Click runtime patches applied")
