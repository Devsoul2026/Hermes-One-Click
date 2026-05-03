"""Regression test for #1386: CLI session import must not crash when the
session is missing from `get_cli_sessions()` metadata at the time of import.

Before the fix, `_handle_session_import_cli` only assigned `model` inside
the `for cs in get_cli_sessions(): if cs["session_id"] == sid` loop. If
the session existed in the messages store but had no metadata row (or had
been pruned after `get_cli_session_messages()` was called), `model` was
unbound and `import_cli_session(sid, title, msgs, model, ...)` raised
`UnboundLocalError`.

The fix initializes `model = "unknown"` before the loop so the import
proceeds with a sensible default rather than crashing.
"""

from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ROUTES_PY = (REPO / "api" / "routes.py").read_text(encoding="utf-8")


def _extract_handler(name: str) -> str:
    """Return the source of the handler function `name` from api/routes.py."""
    marker = f"def {name}("
    idx = ROUTES_PY.find(marker)
    assert idx != -1, f"{name} not found in api/routes.py"
    # Walk forward until a top-level `def ` (col 0) appears.
    next_def = ROUTES_PY.find("\ndef ", idx + len(marker))
    return ROUTES_PY[idx : next_def if next_def != -1 else len(ROUTES_PY)]


def test_import_cli_initializes_model_before_metadata_loop():
    """The fallback `model = 'unknown'` must be set BEFORE the
    `for cs in get_cli_sessions()` loop so that a metadata-less session
    cannot leave `model` unbound."""
    handler = _extract_handler("_handle_session_import_cli")
    init_idx = handler.find('model = "unknown"')
    if init_idx == -1:
        # Allow single quotes too.
        init_idx = handler.find("model = 'unknown'")
    assert init_idx != -1, (
        "Expected `model = \"unknown\"` initialization in "
        "_handle_session_import_cli before the metadata loop. Without it, "
        "import crashes when the session has messages but no metadata row."
    )
    loop_idx = handler.find("for cs in get_cli_sessions()")
    assert loop_idx != -1, "Expected `for cs in get_cli_sessions()` loop"
    assert init_idx < loop_idx, (
        "`model` must be initialized BEFORE the `for cs in get_cli_sessions()` "
        "loop, otherwise a session without a metadata row leaves `model` "
        "unbound and `import_cli_session(..., model, ...)` raises "
        "UnboundLocalError."
    )


def test_import_cli_passes_model_to_import_helper():
    """Sanity: the handler still passes the resolved model down to
    `import_cli_session` — the regression test would not catch a refactor
    that drops the argument entirely."""
    handler = _extract_handler("_handle_session_import_cli")
    assert "import_cli_session(" in handler
    # The model variable should appear as a positional or keyword arg in
    # the import_cli_session call.
    call_idx = handler.find("import_cli_session(")
    call_block = handler[call_idx : call_idx + 400]
    assert "model" in call_block, (
        "import_cli_session() call should still receive the `model` argument."
    )
