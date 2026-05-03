---
name: ddgr-2.2
description: Use the ddgr 2.2 command-line DuckDuckGo search tool for terminal-based web search when available. Verify the CLI before use and fall back to built-in web tools when it is missing.
version: 1.0.0
author: Hermes One-Click
license: MIT
metadata:
  hermes:
    tags: [search, duckduckgo, ddgr, web-search, china-friendly]
    related_skills: [duckduckgo-search]
    fallback_for_toolsets: [web]
---

# ddgr 2.2 Search

Use this skill when the user needs DuckDuckGo search from the terminal, especially in environments where browser or hosted web-search tools are unavailable.

## Detection

Always verify the CLI before using it:

```bash
ddgr --version
ddgr --help
```

If `ddgr` is missing, do not pretend search succeeded. Tell the user it is unavailable and use built-in web/search tools if they are available.

## Basic Usage

```bash
ddgr "python async programming"
ddgr -n 5 "latest AI news"
ddgr --json -n 5 "FastAPI deployment guide"
```

Prefer JSON output when the result needs to be parsed or summarized:

```bash
ddgr --json -n 5 "Hermes agent skills"
```

## Common Flags

| Flag | Purpose |
|------|---------|
| `-n 5` | Return up to 5 results |
| `--json` | Output machine-readable JSON |
| `--np` | Disable prompt/interactive mode |
| `--reg <region>` | Region-specific search |
| `--time <d/w/m/y>` | Restrict by day, week, month, or year |

## Workflow

1. Run `ddgr --version` to confirm the CLI exists.
2. Search with `ddgr --json --np -n 5 "<query>"`.
3. Use result titles, URLs, and snippets to pick the best source.
4. Fetch the full page with browser, web extraction, or terminal tools if deeper reading is needed.

## Pitfalls

- `ddgr` returns search results and snippets, not full article contents.
- Network conditions and DuckDuckGo throttling can produce empty results.
- Do not assume `ddgr` is installed just because this skill is present.
- If the user explicitly needs China-local stability, prefer the built-in Skillhub China source for skill installation and use `ddgr` only for web search.
