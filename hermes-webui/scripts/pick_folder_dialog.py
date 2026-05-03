"""Standalone helper: open a native folder dialog, print JSON to stdout.

Invoked as a subprocess by api.native_folder_picker so the HTTP worker thread
never touches Tk directly.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> None:
    initial = (sys.argv[1] if len(sys.argv) > 1 else "").strip() or None
    if initial:
        try:
            p = Path(initial).expanduser()
            if not p.is_dir():
                initial = None
        except OSError:
            initial = None

    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        return

    root = tk.Tk()
    root.withdraw()
    try:
        try:
            root.attributes("-topmost", True)
        except Exception:
            pass
        kw: dict = {"mustexist": True, "parent": root, "title": "Select workspace folder"}
        if initial:
            kw["initialdir"] = initial
        path = filedialog.askdirectory(**kw)
    finally:
        root.destroy()

    path = (path or "").strip()
    if not path:
        print(json.dumps({"status": "cancel"}))
        return
    print(json.dumps({"status": "ok", "path": str(Path(path).resolve())}))


if __name__ == "__main__":
    main()
