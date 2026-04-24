---
name: duckduckgo-search
description: Windows-safe DuckDuckGo-oriented web search workflow. Prefer built-in web_search/web_extract in the visual app; use ddgs/ddgr CLI only as an optional fallback after verifying terminal support.
version: 1.1.0
author: Hermes Agent
license: MIT
platforms: [windows, macos, linux]
metadata:
  hermes:
    tags: [Search, DuckDuckGo, Web, Research, Current Events]
    related_skills: [arxiv, blogwatcher, llm-wiki]
---

# DuckDuckGo Search

Use this skill when the user asks to search the web, find current information, compare sources, discover official documentation, or specifically asks for DuckDuckGo.

## Windows Visual App Workflow

1. Clarify the query only when the request is ambiguous. Otherwise search directly.
2. Prefer the built-in `web_search` tool for search results. It is the safest path in the Windows visual app because it does not depend on browser binaries, PowerShell, Git Bash, `cmd.exe`, or third-party CLI packages.
3. Use `web_extract` only for URLs selected from search results when full page content is needed.
4. Do not use browser tools for normal search. Use browser tools only when the user needs interaction with a live page.
5. Do not use `terminal` as the first path. On Windows packaged builds, terminal availability can vary by shell configuration.
6. Return a concise answer with source links and note uncertainty when sources disagree.

Recommended tool order:

1. `web_search(query="<specific query>", limit=5)`
2. `web_extract(urls=[...])` for the most relevant primary sources
3. `execute_code` only if it can call available Hermes web helpers in the current session
4. Optional local CLI fallback, only after terminal is verified

## Query Patterns

- Official docs: `<product or library> official docs <feature>`
- Recent changes: `<product or library> release notes <version or date>`
- Error lookup: quote the exact error message, then add the package or framework name
- Alternatives: `<tool> alternatives comparison`
- Site scoped: `site:example.com <topic>`
- File type: `filetype:pdf <topic>` or `filetype:md <topic>`

## Windows Fallback Rules

Use these rules when built-in web tools are unavailable and the user specifically wants DuckDuckGo:

- First explain that the DuckDuckGo skill is loaded but the current runtime needs a working web or execution backend to perform live searches.
- If `terminal` has already failed with errors like `[WinError 193]`, empty `exit_code: 1`, or even `echo` failing, do not keep retrying terminal commands.
- If browser tools fail with `[WinError 193] %1 is not a valid Win32 application`, do not use browser search as a fallback. That is a browser binary/driver issue, not a DuckDuckGo skill issue.
- If `execute_code` is available, use Python standard-library HTTP or Hermes web helper stubs rather than shell commands.
- Ask the user to restart/fix the underlying tool runtime only after the web and execute-code options are unavailable.

## Source Quality

Prefer:

- Official documentation and source repositories
- Standards bodies and vendor release notes
- Maintainer comments, issue threads, and changelogs
- Reputable news or research sources for non-code topics

Avoid relying only on:

- SEO aggregation pages
- Unsourced AI-generated snippets
- Stale tutorials for fast-moving APIs
- Mirrors that may not match upstream documentation

## Optional Windows CLI Fallback

Only use a local CLI when terminal execution has already been verified in this session.

PowerShell verification:

```powershell
Get-Command ddgs -ErrorAction SilentlyContinue
Get-Command ddgr -ErrorAction SilentlyContinue
```

Python package install, only with user approval:

```powershell
py -m pip install ddgs
```

CLI examples:

```powershell
ddgs text -k "Hermes Agent skills documentation" -m 5
ddgr "Hermes Agent skills documentation"
```

Unix-style commands such as `command -v`, `which`, `grep`, `sed`, `apt`, `brew`, or shell scripts are not part of the Windows default path for this skill.

## Failure Handling

If the skill loads successfully but search execution fails:

- `readiness_status: available` means the skill guidance is installed and visible.
- Browser or terminal launch failures are separate tool runtime failures.
- Do not report that the skill is missing or broken when `skill_view("duckduckgo-search")` succeeds.
- Switch to `web_search`/`web_extract` if available, or tell the user the runtime tool layer needs repair.
