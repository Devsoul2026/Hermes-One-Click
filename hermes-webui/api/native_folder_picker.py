"""Native OS folder picker for desktop-packaged WebUI (subprocess + Tk)."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

_PICK_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "pick_folder_dialog.py"


def native_folder_picker_enabled() -> bool:
    """Allow POST /api/system/pick-folder to spawn a blocking folder dialog.

    Default ON on Windows (One-Click / installer target). Set
    HERMES_WEBUI_NATIVE_FOLDER_PICKER=0 to disable. Set to 1 to force enable on
    other platforms for local dev.
    """
    v = os.environ.get("HERMES_WEBUI_NATIVE_FOLDER_PICKER", "").strip().lower()
    if v in ("0", "false", "no", "off"):
        return False
    if v in ("1", "true", "yes", "on"):
        return True
    return sys.platform == "win32"


def run_native_folder_picker(initial_dir: str | None) -> dict:
    """Run picker in a subprocess. Returns dict with status ok|cancel|error."""
    if not _PICK_SCRIPT.is_file():
        return {"status": "error", "message": f"Missing script: {_PICK_SCRIPT}"}

    initial = (initial_dir or "").strip()
    cmd = [sys.executable, str(_PICK_SCRIPT), initial]
    creationflags = 0
    if sys.platform == "win32":
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,
            creationflags=creationflags,
        )
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "Folder dialog timed out"}
    except OSError as e:
        logger.debug("pick_folder subprocess failed: %s", e, exc_info=True)
        return {"status": "error", "message": str(e)}

    raw = (proc.stdout or "").strip()
    if not raw and proc.stderr:
        return {"status": "error", "message": (proc.stderr or "").strip() or "picker failed"}
    try:
        return json.loads(raw.splitlines()[-1])
    except json.JSONDecodeError:
        logger.debug("pick_folder bad stdout: %r stderr=%r", raw, proc.stderr)
        return {"status": "error", "message": "Invalid picker output"}
