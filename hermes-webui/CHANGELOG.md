# Hermes Web UI -- Changelog

## [v0.50.266] — 2026-05-02

### Fixed (i18n parity)
- **Server-side `_LOGIN_LOCALE` missing ja/pt/ko** (#1442) — the password/login page is rendered server-side BEFORE the JS i18n bundle loads, so its strings come from `_LOGIN_LOCALE` in `api/routes.py`, not `static/i18n.js`. The dict only contained 6 entries (`en/es/de/ru/zh/zh-Hant`), so users with `language=ja|pt|ko` set saw the English login page even after their UI language preference was saved. v0.50.264 added Japanese as the 8th built-in locale, making the gap newly visible. **Fix:** added `ja`, `pt`, `ko` entries with the same 7 sub-keys (`lang/title/subtitle/placeholder/btn/invalid_pw/conn_failed`) that the existing locales carry, mirroring the corresponding `login_*` strings from `static/i18n.js`. **20 regression tests** in `tests/test_login_locale_parity.py` pin two invariants: every locale registered in `LOCALES` (i18n.js) must have a matching `_LOGIN_LOCALE` entry, and every locale's user-facing login-flow keys (13 of them) must NOT equal the English value. Adding a new locale to `i18n.js` without updating `routes.py` now trips a test. (`api/routes.py`, `tests/test_login_locale_parity.py`)
- **English-leaking login-flow keys in i18n.js** (#1442 audit) — while auditing the login-flow surface, found 13 keys still in English across `ko` (10: `login_placeholder`, `login_btn`, `login_invalid_pw`, `login_conn_failed`, `sign_out_failed`, `password_placeholder`, `settings_saved_pw`, `settings_saved_pw_updated`, `auth_disabled`, `disable_auth_confirm_title`), `es` (3: `sign_out_failed`, `auth_disabled`, `disable_auth_confirm_title`), and `pt` (3 missing entirely: `sign_out_failed`, `auth_disabled`, `disable_auth_confirm_title`). All 13 now use natural translations matching the existing locale's terminology. The wider English-leak gap across non-login translation entries is a much larger problem requiring native-speaker review and is tracked separately. (`static/i18n.js`)

### Fixed (Safari IME composition — broader coverage)
- **`_isImeEnter` helper not used in 6 other Safari-affected Enter guards** (#1443) — PR #1441 (v0.50.264) widened the chat composer (`#msg`) Enter guard from `e.isComposing` to a 3-guard `_isImeEnter(e)` helper that combines `e.isComposing || e.keyCode === 229 || _imeComposing` for Safari's race where the committing keydown fires AFTER `compositionend` with `isComposing=false`. Six other Enter-input handlers were left on the original narrow guard: session rename, project create, project rename, app dialog (confirm/prompt), message edit, and workspace rename. Japanese/Chinese/Korean users on Safari composing into any of those would still get their IME-confirming Enter committed prematurely. **Fix:** exposed `_isImeEnter` as `window._isImeEnter` from `static/boot.js`, then replaced `e.isComposing` with `window._isImeEnter && window._isImeEnter(e)` at all 6 sites. The state-free part of the helper (`isComposing || keyCode === 229`) handles Safari's race for any focused input without needing per-input composition listeners or a per-input `_imeComposing` flag. The defensive `&& window._isImeEnter` short-circuits if the helper isn't loaded yet (boot.js loads after sessions.js/ui.js with `defer`, but the keydown handlers fire on user interaction which happens after all scripts execute). **9 regression tests** in `tests/test_issue1443_ime_helper_promotion.py` pin each of the 6 sites + verify `e.isComposing` Enter-guards no longer remain in `sessions.js`/`ui.js`. The existing `tests/test_ime_composition.py` alternation regex was extended to accept the windowed form alongside `e.isComposing` and bare `_isImeEnter(e)` — codifies the v0.50.264 reflection note about loosening pattern-shape tests when changing the shape of a guarded check. (`static/boot.js`, `static/sessions.js`, `static/ui.js`, `tests/test_ime_composition.py`, `tests/test_issue1443_ime_helper_promotion.py`)

### Fixed (assistant-output readability)
- **Glued-bold-heading lift in renderMd** (#1446) — LLMs in thinking/reasoning mode frequently emit "section headers" glued to the end of the previous paragraph with no whitespace: `Para 1 text.**Heading to Para 2**\n\nPara 2 text.**Heading to Para 3**`. CommonMark renders that correctly as paragraph-end inline `<strong>`, but visually it looks like trailing emphasis on the body text rather than a section break. Reported by **Cygnus** (Discord, May 1 2026, "Markdown feedback 2 of 3", relayed by @AvidFuturist). **Fix:** added a single regex pre-pass in `renderMd()` that lifts the glued bold into its own paragraph: `s.replace(/([.!?])\*\*([^*\n]{1,80})\*\*\n\n/g, '$1\n\n**$2**\n\n')`. Constraints chosen to avoid false positives: trigger only on `[.!?]` IMMEDIATELY before `**` (no space — almost always an LLM-glued heading, not intentional emphasis); inner text ≤80 chars; no `*` or newline in the inner text (single-line bold only); trailing `\n\n` required (preserves `this is **important** to know.` mid-paragraph emphasis untouched). Position: between `rawPreStash` restore and `fence_stash` restore, so fenced code blocks (still `\x00P` / `\x00F` placeholders at lift-time) are protected. Mirrored in `tests/test_sprint16.py` `render_md()` so the Python mirror stays in sync with the JS. **17 regression tests** in `tests/test_issue1446_glued_heading_lift.py` cover all 3 trigger forms (`.!?`), 5 preserve-emphasis cases, chain rendering, source-level position pin, regex shape pin, and 5 node-driver tests against the actual `static/ui.js` for fenced/inline code protection. (`static/ui.js`, `tests/test_sprint16.py`, `tests/test_issue1446_glued_heading_lift.py`)
- **Markdown headings visually indistinguishable from body text** (#1447) — pre-fix `.msg-body` heading sizes were 18/16/14/13/12/11px against a 14px body, making h3 the same size as body and h4–h6 actually SMALLER than body. Reported by **Cygnus** (Discord, May 1 2026, "Markdown feedback 3 of 3", relayed by @AvidFuturist): "Headings seem to be missing across the board in Hermes. They're there, but all plaintext. They get lost so easily in all the plaintext." **Fix:** new sizes 24/20/17/15/14/13px with `font-weight:700` (was 600), `color:var(--strong, var(--text))`, and `line-height:1.3` (vs body's 1.75 for tighter heading rhythm); h1 and h2 carry a `border-bottom:1px solid var(--border)` for "section title" affordance (mirrors GitHub/Notion convention); h5 and h6 use `text-transform:uppercase` + `letter-spacing:0.04em` for "label-style" affordance instead of being smaller-than-body. Added `margin-top:0` for the first heading of a message so opening with a heading doesn't push down with extra top margin. **Companion fixes:** synced `.preview-md h1-h6` to match `.msg-body` exactly (file preview pane previously had only h1-h3 rules at 18/15/13px); updated `data-font-size="small"` and `data-font-size="large"` h1-h6 overrides to scale proportionally with the new defaults so the hierarchy is preserved at all three font-size settings. **9 regression tests** in `tests/test_issue1447_heading_hierarchy.py` pin the size hierarchy, the bottom borders on h1/h2, the uppercase affordance on h5/h6, the `.preview-md` sync, and the small/large override scaling. (`static/style.css`, `tests/test_issue1447_heading_hierarchy.py`)

## [v0.50.265] — 2026-05-02

### Added
- **Opt-in WebUI extension hooks** (#1445) — adds a deliberately-small, self-hosted extension surface for administrators who want to inject local CSS/JS into the WebUI shell without forking the core repo. Disabled by default; activates only when `HERMES_WEBUI_EXTENSION_DIR` points to an existing directory. Three env vars expose the surface: `HERMES_WEBUI_EXTENSION_DIR` (filesystem root for served assets), `HERMES_WEBUI_EXTENSION_SCRIPT_URLS` (comma-separated same-origin script URLs to inject before `</body>`), `HERMES_WEBUI_EXTENSION_STYLESHEET_URLS` (same-origin stylesheet URLs to inject before `</head>`). New `/extensions/...` static route is auth-gated (NOT in `PUBLIC_PATHS`, unlike `/static/...`) so administrator-supplied code only runs for authenticated sessions. URL validation rejects external schemes, protocol-relative URLs, fragments, traversal (raw + percent-encoded + double-encoded), control characters, quotes, and angle brackets. Filesystem serving sandboxes paths under the configured root via `Path.resolve()` + `relative_to()`, rejects dotfiles, dot-directories, encoded backslashes, and symlink escapes. CSP unchanged — extensions live at same origin so existing `'self'` directive covers them. 7 regression tests in `tests/test_extension_hooks.py` pin the disabled-by-default contract, URL validation against external/protocol-relative/javascript:/data:/API/encoded-traversal, HTML escaping during injection, the auth-gate vs public-static distinction, sandboxed static serving, fail-closed when disabled or unreadable, and symlink-escape rejection. Documentation in `docs/EXTENSIONS.md` (204 lines) covers extension authoring guidance for SPA-style additions, including avoiding destructive DOM mutations like replacing `main.innerHTML`. **Trust model**: extensions are intentionally administrator-controlled — JS injected this way runs in the WebUI origin and can call any authenticated API the logged-in browser session can. The PR explicitly does NOT introduce remote extension loading, a plugin marketplace, Python plugin execution, manifests, a browser-facing config endpoint, or new dependencies. (`api/extensions.py`, `api/routes.py`, `docs/EXTENSIONS.md`, `tests/test_extension_hooks.py`, `README.md`) @ryansombraio — PR #1445

### Fixed (Opus pre-release advisor)
- **`_fully_unquote_path` iteration cap raised from 3 to 10** — Opus advisor noted that quadruple-encoded `..` (`%2525252e%2525252e`) collapsed to `%2e%2e` after 3 iterations and slipped through the URL-injection validator. Not exploitable in practice (downstream `Path` doesn't decode `%2e` either, so the literal directory `%2e%2e` won't exist) but the validator's documented contract is "URLs must point to `/extensions/` or `/static/`," and a malformed URL that's neither cleanly that nor cleanly rejected violates the contract. Iteration cap is now 10 (URL strings stabilize in <5 iterations in practice; the cap is defensive). (`api/extensions.py`)
- **Trust-model callout at top of `docs/EXTENSIONS.md`** — moved the strongest trust-model warning ("extensions execute with full WebUI session authority") from the middle of the doc to a blockquote callout at the top, right after the lead paragraph. A casual operator skimming for "should I enable this?" now sees the hard truth before the friendly intro. Also adds explicit "do not point `HERMES_WEBUI_EXTENSION_DIR` at a user-writable directory" guidance. (`docs/EXTENSIONS.md`)
- **URL list cap (32 entries) + reject-URL logging** — caps configured URL lists at 32 entries to avoid pathological page rendering when a misconfigured env var ships thousands of URLs. Also logs a one-shot warning per process for each rejected URL (e.g. when an admin typos `https://...` and the validator drops it as external) so the silent-failure mode of "extension just doesn't load" produces a log signal an admin can find. (`api/extensions.py`)
- **MIME map expansion** — adds `ttf` (`font/ttf`), `otf` (`font/otf`), and `wasm` (`application/wasm`) to the served-MIME table. `.wasm` specifically would fail to instantiate in Chrome served as `text/plain`; the others are ergonomic for older font formats. (`api/extensions.py`)
- **5 regression tests** in `tests/test_pr1445_opus_followups.py` pin the new invariants: quadruple-encoded `..` collapses correctly, the same URL is now rejected by the validator, URL list caps at the configured max with a warning log, rejected URLs log exactly once per process, and the expanded MIME map serves `.ttf`/`.otf`/`.wasm` with the correct Content-Type without charset suffixes for binary types. (`tests/test_pr1445_opus_followups.py`)


## [v0.50.264] — 2026-05-02

### Added
- **Japanese (`ja`) locale** (#1439) — adds `ja` as the 8th built-in UI locale, slotted between `en` and `ru` in `static/i18n.js`. 825 keys translated to natural, concise Japanese (kanji + hiragana + katakana mix; technical terms in their commonly-used Japanese form: `Cronジョブ`, `MCPサーバー`, `APIキー`, `トークン`). Translation style prefers terse 体言止め over polite forms (`保存`, `キャンセル`, `削除`) to match the brevity of the English originals. All `${var}` and `{0}`-style placeholders preserved verbatim, all 26 arrow-function values mirrored with parameter names intact. Settings → Language now lists 日本語; the existing `Object.entries(LOCALES)` discovery path picks it up automatically. The fallback chain (`_locale[key] ?? LOCALES.en[key]`) means any future English-only string still renders cleanly. **8 regression tests** in `tests/test_japanese_locale.py` pin block existence, representative translations, full key-set parity with English (zero missing, zero extra), the 8 known en-duplicates mirrored exactly, placeholder preservation, arrow-function value mirroring, and `_label: '日本語'` using actual Japanese script. (`static/i18n.js`, `tests/test_japanese_locale.py`) @snuffxxx — PR #1439

### Fixed (Opus pre-release advisor)
- **IME composition flag could get stuck if compositionend never fires** — Opus advisor caught a recoverable footgun in PR #1441's manual `_imeComposing` flag: if the user loses focus mid-composition (window blur / IME implementation quirk on older Safari WebKit), `compositionend` may never fire, leaving `_imeComposing=true` until the next composition starts AND ends. Result: Enter-to-send is silently broken until page reload. Added a `blur` listener on `#msg` that also resets the flag — cheap belt-and-suspenders against the unrecoverable stuck state. (`static/boot.js`, `tests/test_pr1441_ime_safari_guard.py`)

### Fixed
- **IME composition Enter sent message prematurely on Safari** (#1441) — the `#msg` keydown handler had an `e.isComposing` guard that swallows IME-confirming Enter on Chrome and Firefox (where the committing keydown fires before `compositionend`), but failed on Safari (where the committing keydown fires AFTER `compositionend` with `isComposing=false`). Result: Japanese/Chinese/Korean users on macOS Safari + Hermes had to copy/paste from another app because every IME-confirming Enter sent the message instead of just accepting the conversion. **Fix:** widened guard from `e.isComposing` to a `_isImeEnter(e)` helper that also checks `e.keyCode === 229` (IME virtual key on broader browser/IME combos) AND a manual `_imeComposing` flag set on `compositionstart` and reset in a `setTimeout(…, 0)` after `compositionend` (so the trailing keydown still sees `_imeComposing=true`). Helper is used in both the autocomplete-dropdown Enter path and the send-Enter path. The composition-listener IIFE null-guards `$('msg')` so login/onboarding pages without a composer don't throw. **No behavior change for non-IME users** — all three guards return falsy for normal Enter. **6 regression tests** in `tests/test_pr1441_ime_safari_guard.py` pin: helper definition + all 3 guards, compositionstart sets the flag, compositionend defers reset to next tick, blur resets to recover from missed compositionend (Opus follow-up), IIFE null-guards `$('msg')`, both Enter paths use the helper. Existing `test_ime_composition.py::test_boot_chat_enter_send_respects_ime_composition` was loosened to accept either `e.isComposing` OR `_isImeEnter(e)`. (`static/boot.js`, `tests/test_ime_composition.py`, `tests/test_pr1441_ime_safari_guard.py`) @ryan-remeo — PR #1441
- **Markdown renderer: triple backticks mid-line corrupted downstream rendering** (#1438) —
  The fence regex `/```([\s\S]*?)```/g` had no line anchoring. A literal triple backtick
  appearing inside a code block's content (e.g. a regex pattern with ``` in a lookbehind,
  a script that documents fences, embedded markdown-in-markdown) terminated the outer
  fence at the wrong place. The leaked tail then went through bold/italic/inline-code
  passes, eating `*` characters as italic markers and producing literal `</strong>` tags
  in the rendered output. Reported by **Cygnus** (Discord, May 1 2026), relayed by
  @AvidFuturist.

  **Fix:** anchor all 3 fence regexes per CommonMark §4.5 — opening fence must start a
  line (with up to 3 spaces of indent), closing fence must also start a line. Pattern:
  `(^|\n)[ ]{0,3}\`\`\`(?:([\s\S]*?)\n)?[ ]{0,3}\`\`\`(?=\n|$)`. The `(?:...\n)?` group
  keeps empty fences (`` ```\n``` ``) working. Patched sites:

  - `static/ui.js:1559` — `renderMd()` fenced-block stash (the assistant-message renderer)
  - `static/ui.js:66` — `_renderUserFencedBlocks()` (user-message renderer)
  - `static/ui.js:2599` — `_stripForTTS()` (TTS speech pre-strip)

  Plus the Python mirror in `tests/test_sprint16.py`. Triple backticks in the middle of
  a line are now treated as literal text (CommonMark-conformant) and no longer break out
  of code blocks. 20 regression tests in `tests/test_issue1438_fence_anchoring.py` cover
  Cygnus's exact repro, inline `` ``` `` in paragraphs, partial/streaming fences, empty
  fences, indented fences (3-space ✓, 4-space ✗), language tags, two adjacent blocks,
  and source-level guards on all 3 patched sites.

## [v0.50.263] — 2026-05-02

### Fixed
- **Context-window indicator broken on older sessions ("100" / "890% used")** (#1436, fixes #1436) — `#1356` (closed Apr 30) fixed the same symptom on the **live SSE path** but didn't cover the **GET /api/session load path**, so any session that pre-dates `#1318` (when `context_length` was added to `Session`) returned `context_length=0` from `/api/session`. Combined with two cascading frontend fallbacks (`promptTok = last_prompt_tokens || input_tokens`, `ctxWindow = context_length || 128*1024`), the ring rendered "100" capped from 800-4000% and the tooltip showed "890% used (context exceeded), 1.2M / 131.1k tokens used" — a misleading prompt to compress that the user couldn't address. Empirically: 23 of 75 sessions on the dev server were broken before this fix. **Two-layer fix**: (1) backend `api/routes.py` now resolves `context_length` via `agent.model_metadata.get_model_context_length()` when the persisted value is 0, mirroring the SSE-path fallback in `api/streaming.py:2333-2342`. (2) frontend `static/ui.js:1269` no longer falls back to cumulative `input_tokens` when `last_prompt_tokens` is missing — that fallback divides cumulative input by the context window, producing nonsense percentages. Older sessions without last-prompt data now render "·" + "tokens used" (honest no-data) on the ring instead of a misleading >100% percentage. **10 regression tests** in `tests/test_issue1436_context_indicator_load_path.py` pin: persisted-value pass-through, zero-value fallback, fallback-receives-correct-model, empty-model-skips-fallback (avoids 256K default-for-unknown trap), exception-swallowed-on-import-failure, frontend-no-input_tokens-fallback, frontend-uses-last_prompt_tokens-only, no-data-branch-renders-dot, load-path-imports-the-helper, fix-comment-references-issue-number. Reported by @AvidFuturist. (`api/routes.py`, `static/ui.js`, `tests/test_issue1436_context_indicator_load_path.py`)

## [v0.50.262] — 2026-05-02

### Fixed
- **New-chat button (`+`) and Cmd/Ctrl+K were no-ops while the first message was streaming** (#1432, closes #1432) — the empty-session guard from #1171 (`message_count===0` → focus composer instead of creating a new session) didn't account for in-flight streams, where the user's message hasn't been merged into `s.messages` server-side yet. Clicking `+` during the first response of a brand-new session was silently dropped, so users couldn't actually start a parallel conversation. The guard now also requires `!S.busy && !S.session.active_stream_id && !S.session.pending_user_message` — the same in-flight signal already used by `_restoreSettledSession()` in `messages.js:1081`. Reported by @Olyno. (`static/boot.js`)
- **Profile-name field auto-capitalized typed values despite the "lowercase only" hint** (#1423, closes #1423) — the input had `autocomplete="off"` but was missing `autocapitalize="none"`, `autocorrect="off"`, and `spellcheck="false"`, so mobile keyboards (iOS Safari/WKWebView, Android Chrome) silently capitalized the first letter and desktop spellcheck could rewrite the value on blur. The form lowercases on submit, so stored data was always correct — the bug was a misleading display during typing. Same attributes added to the Base URL field for the same reason (URLs are not natural-language text). The API key field is `type="password"` and already has correct browser behavior. (`static/panels.js`)

## [v0.50.261] — 2026-05-02

### Changed
- **Composer footer: session-toolsets chip is now responsive** — the per-session toolsets restriction chip (introduced in #493) was crowding the composer footer on standard widths once it shared space with model, reasoning, profile, workspace, context-ring, and send. The PR #1433 fix hid it unconditionally via JS; this release replaces that with a responsive CSS rule so the chip is visible only when the composer-footer container is at least 1100px wide (i.e. wide desktops with the workspace panel closed). At narrower widths the chip is hidden by the base CSS rule, and the existing `@container composer-footer (max-width: 520px)` and `@media (max-width: 640px)` rules continue to enforce hidden on tablets and phones. JS no longer sets `display:none` directly — visibility is controlled entirely by CSS so the responsive cascade is the single source of truth. The underlying state and `/api/session/toolsets` endpoint continue to work for cron and scripted callers regardless of UI visibility. Inline `style="display:none"` removed from `index.html` so the CSS base rule is the only source of the default-hidden state. Refs #1431, #1433. @nesquena-hermes (`static/ui.js`, `static/style.css`, `static/index.html`)

### Fixed (Opus pre-release advisor)
- **Toolsets dropdown stays open after resize crosses 1100px threshold** — Opus advisor caught a latent bug promoted by the new responsive cascade. The `composerToolsetsDropdown` is a DOM sibling of `composerToolsetsWrap`, not a child, so CSS hiding the wrap does NOT cascade-hide an open dropdown. If a user opened the dropdown at composer-footer ≥ 1100px and then opened the workspace panel (or resized the window), the dropdown would stay open without a visible anchor and the resize handler would re-anchor it to the footer's left edge with no chip in sight. The bug existed pre-stage-261 at the 520/640 thresholds but those fire rarely; the new 1100px threshold is reachable with a single workspace-panel toggle. **Three fixes**: (1) resize listener now closes the dropdown (instead of repositioning it) when `chip.offsetParent === null`. (2) `_positionToolsetsDropdown()` now early-returns + closes when chip is hidden — defense-in-depth. (3) `toggleToolsetsDropdown()` early-returns when chip is hidden — currently latent (only the chip's own onclick invokes it) but defensive against future #1431 redesign code. (`static/ui.js`)
- **`display:flex` → `display:block` on the wrap** — Opus advisor noted that sibling wraps (`.composer-profile-wrap`, `.composer-model-wrap`, `.composer-reasoning-wrap`) all use the natural block display, while `display:flex` would blockify the chip's `inline-flex` layout. Changed for consistency. (`static/style.css`)
- **13 regression tests** in `tests/test_issue1431_toolsets_chip_responsive.py` pin: the base hide rule, the wide-container reveal rule (block or flex), the narrow-container hide rule (520px container), the mobile viewport hide rule (640px @media), the JS-doesn't-force-display-none invariant, the JS-clears-inline-style invariant, the state-tracking-still-works invariant, the no-inline-display-none-in-html invariant, the /api/session/toolsets endpoint preservation, the dropdown-machinery preservation (`toggleToolsetsDropdown`, `_populateToolsetsDropdown`), AND the three Opus-found resize-guard invariants (resize handler closes dropdown when chip hidden, `_positionToolsetsDropdown` defense-in-depth, `toggleToolsetsDropdown` defense-in-depth). (`tests/test_issue1431_toolsets_chip_responsive.py`)

## [v0.50.260] — 2026-05-01

### Fixed
- **Docker compose UID/GID alignment** (#1428, fixes #1399) — the two- and three-container compose files had a UID mismatch between containers sharing the `hermes-home` volume: `hermes-agent` and `hermes-dashboard` ran as UID 10000 (image default) while `hermes-webui` ran as UID 1000 (`WANTED_UID` default), causing `Permission denied` errors on every shared file. All services now read from `${UID:-1000}` and `${GID:-1000}` so they align by construction. Empirically tested on both two- and three-container setups by the contributor. (`docker-compose.two-container.yml`, `docker-compose.three-container.yml`) @sunnysktsang — PR #1428

### Changed
- **Docker UX overhaul** — Docker reliability has been a recurring pain point. This release ships a coordinated set of doc/config improvements:
  - **All 3 compose files** now document the `HERMES_SKIP_CHMOD` and `HERMES_HOME_MODE` escape hatches inline (the v0.50.254 fix for #1389 wasn't surfaced for Docker users).
  - **New `.env.docker.example`** template specifically for Docker users, covering UID/GID, paths, password, and permission-handling escape hatches with explicit `UID=1000`/`GID=1000` placeholders so macOS users don't skim past the warning.
  - **New `docs/docker.md`** — comprehensive guide covering all 3 compose files, common failure modes (with one-line fixes), bind-mount migration recipe, multi-container architecture diagram, macOS Docker Desktop file-sharing implementation note, and pointer to the [community all-in-one image](https://github.com/sunnysktsang/hermes-suite) for Podman 3.4 / multi-arch users.
  - **README Docker section rewritten** — clearer 5-minute quickstart pointing at the single-container setup; failure-mode table with one-line fixes; pointer to `docs/docker.md` for the deep dive; **stale `/root/.hermes` reference removed** (the agent images use `/home/hermes/.hermes`).
  - **12 regression tests** in `tests/test_v050260_docker_invariants.py` — UID/GID alignment positive + negative-pattern guards, escape-hatch documentation, `.env.docker.example` shape, `docs/docker.md` failure-mode coverage, README link integrity, and YAML validity for all 3 compose files. (`docker-compose.yml`, `docker-compose.two-container.yml`, `docker-compose.three-container.yml`, `.env.docker.example`, `docs/docker.md`, `README.md`, `tests/test_v050260_docker_invariants.py`)

### Changed (Opus pre-release advisor)
- **`HERMES_HOME_MODE` semantic asymmetry warning** — Opus advisor caught a footgun in my initial draft: `HERMES_HOME_MODE` means **different things** in the WebUI vs. the agent image. WebUI's `HERMES_HOME_MODE` is a credential-FILE mode threshold (e.g. `0640` allows group bits on `.env`), but the agent's `HERMES_HOME_MODE` is the HERMES_HOME *directory* mode (default `0700`). `0640` on a directory has no owner-execute bit, so the agent can't traverse its own home directory and bricks. My initial draft recommended `HERMES_HOME_MODE=0640` as the example value in agent service blocks — corrected to `0750` (group-traversable) for multi-container setups. All three surfaces now match: compose files (per-service comments), `.env.docker.example` (multi-container warning section), `docs/docker.md` (failure mode #2 callout). 3 new regression tests pin the asymmetry: `test_agent_service_does_not_recommend_invalid_home_mode`, `test_compose_files_warn_about_home_mode_asymmetry`, `test_env_docker_example_warns_about_home_mode_asymmetry`. (`docker-compose.two-container.yml`, `docker-compose.three-container.yml`, `.env.docker.example`, `docs/docker.md`, `tests/test_v050260_docker_invariants.py`)


## [v0.50.259] — 2026-05-01

### Fixed
- **SessionDB WAL handle leak — close before replacing on cached agent** — `_run_agent_streaming` created a new `SessionDB` instance per request and replaced the cached agent's `_session_db` reference without closing the old one. Each `SessionDB.__init__` opens a SQLite connection that holds 3 file descriptors once WAL kicks in (`state.db`, `state.db-wal`, `state.db-shm`). After ~73 messages on a long-lived agent (the empirically-confirmed crash count from the bug report), leaked FDs exhausted the 256 default limit causing `EMFILE` crashes. Fix wraps the swap with an explicit `agent._session_db.close()` (idempotent + thread-safe via SessionDB's internal `_lock` + `if self._conn:` guard). (`api/streaming.py`) @wali-reheman — PR #1421

### Changed (Opus pre-release advisor)
- **Same FD-leak fix applied to LRU eviction path** — `SESSION_AGENT_CACHE.popitem(last=False)` was dropping the evicted agent on the floor with `evicted_sid, _ = ...`. The agent's `_session_db` would only release its FDs when GC eventually finalized the agent — which on a long-running server may be never. Now captures the evicted entry, calls `_evicted_agent._session_db.close()` explicitly. Same shape as #1421's fix on the cached-agent reuse path. 5 regression tests in `test_v050259_sessiondb_fd_leak.py` cover both paths plus `SessionDB.close()` idempotency. (`api/streaming.py`, `tests/test_v050259_sessiondb_fd_leak.py`)


## [v0.50.258] — 2026-05-01

### Fixed
- **Login stability: 30-day session TTL, redirect-back, connectivity probe** — three independent fixes for users on flaky networks (VPN, Tailscale). (1) `SESSION_TTL` extended from 24 hours to 30 days in `api/auth.py` so users no longer get kicked out daily. (2) When a session expires and the user is redirected to `/login`, the server now passes `?next=<original-path>` so `_safeNextPath()` in `static/login.js` redirects them back after a successful login instead of dumping them on the login screen. (3) Login page now probes `/health` on load (a public endpoint) and distinguishes "session expired / wrong password" from "can't reach server" — when the server is unreachable, shows a clear "Cannot reach server — check your VPN / Tailscale connection." message, disables the form, retries every 3 seconds, and auto-reloads the page once the server becomes reachable again. (`api/auth.py`, `static/login.js`) @bsgdigital — PR #1419

### Changed (Opus pre-release advisor)
- **Login redirect URL encoding fix — multi-param queries no longer truncated** — the original PR #1419 implementation built the outer `?next=` parameter via `quote(path, safe='/:@!$&\'()*+,;=')` which kept `?` and `&` literal. Two problems: (a) paths with multi-param queries (e.g. `/api/sessions?limit=50&offset=0`) round-tripped as `/api/sessions?limit=50` because the inner `&` terminated the outer `next` value, (b) attacker-controlled paths with embedded `&next=...` injected a second top-level `next` parameter (browsers parse first-match, Python parse_qs parses last-match — parser-divergence footgun even though `_safeNextPath()` rejects the actual exploit). Fix encodes the entire `path?query` blob with `safe='/'` so `?`, `&`, `=` all percent-encode. The outer `next` then holds exactly one path-with-query string. 6 regression tests in `test_v050258_opus_followups.py` pin the round-trip behavior across simple paths, single-query paths, multi-param queries, and attacker-injection neutralization. (`api/auth.py`, `tests/test_v050258_opus_followups.py`)


## [v0.50.257] — 2026-05-01

### Added
- **Cron run history + full-output viewer** (#468) — new `GET /api/crons/history?job_id=X&offset=N&limit=M` endpoint lists all output files for a job (filename + size + mtime) without loading content. New `GET /api/crons/run?job_id=X&filename=Y` returns full content + a snippet extracted from the `## Response` section. Tasks panel renders a per-job run history with click-to-expand. (`api/routes.py`, `static/panels.js`, `static/i18n.js`) @bergeouss — PR #1402, fixes #468

- **Per-session toolset overrides** (#493) — new `Session.enabled_toolsets: list[str] | None` field threaded through `_run_agent_streaming`. New `POST /api/session/toolsets` endpoint validates input shape (non-empty list of non-empty strings, or null to clear). Settings panel adds a per-session toolset chip with global/custom modes. Honors the override at the streaming hot path via `_resolve_cli_toolsets`. (`api/models.py`, `api/routes.py`, `api/streaming.py`, `static/panels.js`, `static/i18n.js`, `static/index.html`, `static/style.css`, `static/ui.js`) @bergeouss — PR #1402, fixes #493

- **Codex OAuth in-app device-code flow** — new `api/oauth.py` (stdlib only — no external HTTP libs). Two endpoints: `GET /api/oauth/codex/start` (initiates Codex device-code flow, returns `user_code` + `verification_uri`) and `GET /api/oauth/codex/poll?device_code=X` (SSE for polling token endpoint). Successful poll writes credentials to `~/.hermes/auth.json` under `credential_pool.openai-codex`. Onboarding wizard adds a "Sign in with ChatGPT" path. Idempotent: existing OAuth credential entries are updated in place; new ones use `uuid.uuid4().hex[:8]` with retry-on-collision (3 attempts). (`api/oauth.py`, `api/routes.py`, `static/onboarding.js`, `static/i18n.js`, `static/index.html`, `static/style.css`) @bergeouss — PR #1402

### Fixed
- **Named custom provider routing in model picker — `@custom:NAME:model` form preserved** (#557 follow-up to #1390) — when the model picker iterated `custom_providers` entries with a `name` field (e.g. `[{name: "sub2api", base_url, models: [...]}]`), the option IDs were stored as bare model strings. On chat start, the backend resolved those bare strings through the active/default provider, silently routing the request to the wrong endpoint (e.g. DeepSeek instead of the user's selected `sub2api` proxy). Now the picker prefixes IDs with `@<slug>:<model>` whenever the active provider differs from the named slug, so `_resolve_compatible_session_model_state` (added by #1390) routes through the correct named provider. The frontend `_findModelInDropdown` already strips `@provider:` prefixes during normalization, so legacy `localStorage["hermes-webui-model"]` values with bare IDs continue to resolve. 5 new tests across `test_issue1106_custom_providers_models.py`, `test_provider_mismatch.py`, `test_security_redaction.py`. (`api/config.py`) @Thanatos-Z — PR #1415

### Changed (Opus pre-release advisor)
- **`api/oauth.py::_write_auth_json` chmod 0600 BEFORE rename** — `tmp.replace()` preserves the temp file's umask-derived mode (commonly 0644 or 0664). `auth.json` contains OAuth access/refresh tokens; on shared systems those tokens landed world-readable through the temp-file→rename window. Fix sets `tmp.chmod(0o600)` before the atomic rename, with a `try/except OSError` that logs but doesn't abort if chmod fails on filesystems that don't support POSIX modes. The `api.startup::fix_credential_permissions` sweep also catches this on next process start as belt-and-suspenders. (`api/oauth.py`, `tests/test_v050257_opus_followups.py`)

- **`_handle_cron_history` and `_handle_cron_run_detail` regex-validate `job_id`** — the `_checkpoint_root() / ws_hash / checkpoint` path-traversal vector caught in v0.50.255 (#1405) had a sibling here: `CRON_OUT / job_id / *.md`. `Path() / "../escape"` does NOT normalize. While `_handle_cron_run_detail` had a downstream `is_relative_to(CRON_OUT.resolve())` check, `_handle_cron_history` didn't. New regex `^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$` with explicit `.`/`..` rejection at the parameter boundary. Mirrors the rollback fix shape. (`api/routes.py`, `tests/test_v050257_opus_followups.py`)

- **`_handle_cron_history` clamps `offset` and `limit`** — raw `int(qs.get("offset", ["0"])[0])` raised `ValueError` on `?offset=foo` and surfaced as a generic 500. No upper bound on `limit` either. Now wrapped in `try/except (ValueError, TypeError)` returning a 400 on bad input, and `limit` clamped to `[1, 500]`. (`api/routes.py`)

- **CRITICAL: per-session toolset override (#493) was non-functional** — `_run_agent_streaming` called `_session_meta.get('enabled_toolsets')` on the result of `Session.load_metadata_only()`, which returns a Session **instance** (not a dict). The `AttributeError` was swallowed by the surrounding `except Exception:` block, so the user's toolset chip silently no-op'd every time and the agent always ran with the global toolsets. Caught by Opus pre-release advisor on the empirical streaming path (CI green, contributor tests green — would have shipped non-functional). Fix uses `getattr(_session_meta, 'enabled_toolsets', None)`. Source-level negative-pattern test prevents the dict-access shape from returning. (`api/streaming.py`, `tests/test_v050257_opus_followups.py`)


## [v0.50.256] — 2026-05-01

### Fixed
- **TTS speaker icon and four other Lucide icons rendered invisibly** (#1413, closes #1413) — `static/icons.js::LI_PATHS` was missing five icon names that `static/*.js` calls `li('NAME', ...)` with. The `li()` helper logs `console.warn('li(): unknown icon NAME')` and returns an empty string when the name isn't registered, so the host element renders with `display:flex` and a click handler but no glyph. Five missing entries added: (1) `volume-2` — TTS speaker button on every assistant message (`ui.js:3376`); regression from #499, surfaced after #1411 (v0.50.255) fixed the CSS specificity collision and made the empty button visible-but-empty. Reported by @AvidFuturist via Telegram. (2) `chevron-up` — queue pill chevron (`ui.js:2178`); had a `▲` ASCII fallback but only when `li` itself was undefined, not when it returned `''`. (3) `hash`, (4) `cpu`, (5) `dollar-sign` — Insights panel stat cards (`panels.js:883-885`); fresh regression from #1405 (v0.50.255). New regression test `test_issue1413_li_path_coverage.py` walks every `li('NAME', ...)` call across `static/*.js` and asserts each `NAME` is registered in `LI_PATHS` — guards the entire class of bug, not just the five fixed here. (`static/icons.js`, `tests/test_issue1413_li_path_coverage.py`) — fixes #1413, reported by @AvidFuturist via Telegram

## [v0.50.255] — 2026-05-01

### Added
- **Insights panel — usage analytics dashboard** (#464) — new `GET /api/insights?days=N` endpoint walks `_index.json` (no full session loads) and aggregates session/message/token counts, model breakdown, and activity-by-day-of-week + activity-by-hour. New nav rail entry between Todos and Settings; the panel renders stats cards, a token breakdown row, and ASCII-style horizontal-bar charts. Period filter (7/30/90 days). (`api/routes.py`, `static/panels.js`, `static/index.html`, `static/i18n.js`, `static/style.css`) @bergeouss — PR #1405, fixes #464

- **Rollback UI — restore from agent checkpoints** (#466) — new `api/rollback.py` exposes 3 endpoints (`GET /api/rollback/list`, `GET /api/rollback/diff`, `POST /api/rollback/restore`) over the agent's `CheckpointManager` shadow git repos at `{hermes_home}/checkpoints/<sha256-of-canonical-workspace>/<commit_hash>/.git`. Workspace is allowlisted via `load_workspaces()` (added during contributor security pass `d9f3a69`). `_validate_checkpoint_id()` regex-guards the checkpoint parameter against path-traversal (Opus pre-release advisor finding — `Path()` does NOT normalize `..`). Restore copies files via `shutil.copy2` and never deletes; diff uses `difflib.unified_diff`. (`api/rollback.py`, `api/routes.py`) @bergeouss — PR #1405, fixes #466

- **Turn-based voice mode — STT + TTS chained flow** — new voice-mode button in the composer; activating it puts the agent in a listen → send → think → speak → listen loop. Uses the browser's Web Speech API (gated on both `SpeechRecognition` AND `speechSynthesis` support). Auto-send on 1.8s silence after a final transcript. Honors saved voice preferences (`hermes-tts-voice`, `hermes-tts-rate`, `hermes-tts-pitch`). Bails out on `not-allowed` / `service-not-allowed` / `audio-capture` errors. **Pre-release fix:** the patched `autoReadLastAssistant` fired globally — if the user navigated to a different session between send and stream completion, TTS would speak the wrong session's reply. Now captures `S.session.session_id` at thinking-time and bails to listening if the active session changed. (Opus pre-release advisor.) (`static/boot.js`, `static/i18n.js`, `static/index.html`, `static/style.css`) @bergeouss — PR #1405

- **API redact toggle — opt out of response-layer redaction** — adds `api_redact_enabled` setting (defaults to `True` so existing users see no behavioral change). When disabled, `redact_session_data()` returns payloads as-is. Useful for users who pipe the WebUI API into automation that needs the original strings. (`api/helpers.py`, `api/config.py`, `static/panels.js`, `static/i18n.js`) @bergeouss — PR #1405

- **Subagent tree visualization** — UI affordance for sessions that spawn subagents. (`static/panels.js`, `static/sessions.js`, `static/style.css`, `static/i18n.js`) @bergeouss — PR #1405

### Fixed
- **Session provider context preserved across model picker → runtime resolution** (#1240) — the WebUI model picker can show multiple providers exposing the same bare model id (e.g. `gpt-5.5` from OpenAI Codex, OpenRouter, Copilot). Previously sessions persisted only the bare model, so a session selected as "gpt-5.5 from OpenAI Codex" silently rerouted through whatever provider became default after a config change. New `model_provider: str | None` field on `Session` is persisted in metadata, threaded through every chat path (`/api/session/new`, `/api/session/update`, `/api/chat/start`, `/api/chat/sync`, `/btw`, `/background`, `_run_agent_streaming`), and is gated in `compact()` to emit only when truthy (matches v0.50.251 lineage end_reason gating). New `model_with_provider_context(model_id, model_provider)` in `api/config.py` builds the `@provider:model` form when provider differs from configured default, then passes through `resolve_model_provider()`. New `_should_attach_codex_provider_context()` narrow exception detects bare GPT-* models under active OpenAI Codex (because Codex/OpenRouter/Copilot expose overlapping GPT names). New `_resolve_compatible_session_model_state()` returns `(effective_model, effective_provider, model_was_normalized)`. Frontend adds `MODEL_STATE_KEY='hermes-webui-model-state'` localStorage with structured persistence and migrates from the legacy `hermes-webui-model` key. 13 new tests in `test_provider_mismatch.py`, 2 in `test_model_picker_badges.py`. (`api/config.py`, `api/models.py`, `api/routes.py`, `api/streaming.py`, `static/boot.js`, `static/messages.js`, `static/panels.js`, `static/sessions.js`, `static/ui.js`) @starship-s — PR #1390, refs #1240

- **TTS toggle: speaker icon never appeared when "Text-to-Speech for responses" was ticked** (#1409, closes #1409) — `_applyTtsEnabled()` set `btn.style.display=enabled?'':'none'` on every `.msg-tts-btn`. The `''` branch removes the inline override, after which the `.msg-tts-btn{display:none;}` rule from `style.css` re-hides the button. Both the "enabled" and "disabled" branches left the icon hidden, so the toggle had no visible effect since the feature shipped in #499. Fixed by switching to a body-class toggle (`body.tts-enabled`) plus a compound CSS selector (`body.tts-enabled .msg-tts-btn{display:inline-flex;}`). The new shape bypasses the `.msg-action-btn` / `.msg-tts-btn` cascade collision and survives subsequent `renderMd()` re-renders without re-querying every button. (`static/panels.js`, `static/style.css`, `tests/test_499_tts_playback.py`) — PR #1411, fixes #1409, reported by @AvidFuturist via Discord

- **Ollama (local) no longer falsely reports "API key configured" when only Ollama Cloud key is set** (#1410, closes #1410) — both providers were mapped to the same `OLLAMA_API_KEY` env var in `_PROVIDER_ENV_VAR`, so configuring Ollama Cloud lit up the local Ollama card too. The runtime in `hermes_cli/runtime_provider.py` only consumes `OLLAMA_API_KEY` when the base URL hostname is `ollama.com` — local Ollama is keyless by design — so the WebUI was reporting "configured" for a key local Ollama doesn't even read. Dropped the bare `"ollama": "OLLAMA_API_KEY"` mapping; local Ollama users who genuinely need a key can still set `providers.ollama.api_key` in `config.yaml`, and `_provider_has_key()` continues to honor that path. (`api/providers.py`, `tests/test_provider_management.py`) — PR #1411, fixes #1410, reported by @AvidFuturist via Discord

### Changed

- **`api/rollback.py` — checkpoint id regex validation (defense-in-depth)** — Opus pre-release follow-up. The `checkpoint` parameter on `/api/rollback/diff` and `/api/rollback/restore` was joined into the path via `_checkpoint_root() / ws_hash / checkpoint`. `Path("/a/b") / "../escape"` does NOT normalize, so an authenticated caller could pass `../<other-ws-hash>/<sha>` and read or restore from another allowlisted workspace's checkpoint store. New `_validate_checkpoint_id()` regex-guards with `^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$` and rejects literal `.` / `..`. (`api/rollback.py`)

- **`redact_session_data()` reads `api_redact_enabled` once per response, not per string** — Opus pre-release follow-up. The new `_redact_text` per-string `load_settings()` call (added by #1405's redact-toggle feature) caused hundreds of disk reads + JSON parses per `/api/session?session_id=X` response on a 50-message session — every nested string in `messages[]` and `tool_calls[]` recursed back into `_redact_value` → `_redact_text` → `load_settings`. Now read once at the top of `redact_session_data()` and threaded through via a private `_enabled` keyword. Fast path when disabled: still walks but returns immediately. (`api/helpers.py`, `tests/test_v050255_opus_followups.py`)

- **Voice mode pins active session id at thinking-time** — Opus pre-release follow-up. The patched `autoReadLastAssistant` fires globally; if the user navigated to a different session between sending a turn and stream completion, TTS would speak the wrong session's last assistant message. New `_voiceModeThinkingSid` closure variable captures `S.session.session_id` in `_voiceModeSend`; `_speakResponse` bails to `_startListening()` if the current sid no longer matches. (`static/boot.js`, `tests/test_v050255_opus_followups.py`)

- **`api/rollback.py::_inspect_checkpoint` drops bare `Exception` from except tuple** — Opus pre-release follow-up. The previous `except (subprocess.TimeoutExpired, OSError, Exception)` made the specific catches redundant and swallowed everything. Now `(subprocess.TimeoutExpired, OSError)` only. (`api/rollback.py`, `tests/test_v050255_opus_followups.py`)

## [v0.50.254] — 2026-05-01

### Fixed
- **API 500 regression on /api/sessions, /api/memory: `_combined_redact` TypeError** (#1394, closes #1394) — PR #1387 follow-up `fc88981` started passing `force=True` to `redact_sensitive_text()`, but older hermes-agent builds don't accept the `force` kwarg. Every redaction call on the hot path crashed with `TypeError`, degrading the entire API to 500 errors. `_combined_redact` now wraps the call in `try/except TypeError` and falls back to the no-kwarg call. The local fallback (ghp_/sk-/hf_/AKIA) still runs unconditionally, so coverage doesn't regress. (`api/helpers.py`) @bergeouss — PR #1400, fixes #1394

- **Code block tree-view: newlines stripped from data-raw, jsyaml retry loop missing** (#1397, closes #1397) — Two bugs in the JSON/YAML tree-view renderer. (1) Browsers normalize newlines to spaces inside HTML attribute values (HTML spec); the `data-raw` attribute on `.code-tree-wrap` lost every newline, so multi-line YAML/JSON came out as single-line tree views. Fixed by encoding `\n` as `&#10;` before writing the attribute. (2) When jsyaml hadn't loaded yet, `initTreeViews()` set `data-tree-init=1` immediately and bailed — the lazy-load callback never re-invoked init, leaving the block in raw view forever. Fixed by removing `data-tree-init` and calling `_loadJsyamlThen(initTreeViews)` to retry after load. (`static/ui.js`) @bergeouss — PR #1400, fixes #1397

- **Credential permission fixer respects HERMES_HOME_MODE and HERMES_SKIP_CHMOD** (#1389, closes #1389) — `fix_credential_permissions()` was unconditionally forcing 0600 on every credential file in `HERMES_HOME` at startup. Docker setups that intentionally use group bits (e.g. `HERMES_HOME_MODE=0640` for shared volumes) had their declared mode silently overridden. Now `HERMES_SKIP_CHMOD=1` bypasses the fixer entirely; when `HERMES_HOME_MODE` is set, the fixer only strips world bits (0o007) and preserves operator-declared group access. (`api/startup.py`) @bergeouss — PR #1400, fixes #1389

- **Sidebar session click is now instant on mouse, drag-aware on touch** (#1398) — clicking a chat in the sidebar previously had a 300ms delay on every device to disambiguate single-tap from double-tap-rename. Mouse users perceived this as lag. Now the delay is 0 for `pointerType==='mouse'` and stays 300ms for touch (where it's needed for tap-vs-drag disambiguation). Adds pointermove drag detection: movement >5px from pointerdown marks the gesture as a drag, cancels the pending tap timer, suppresses hover highlighting via a `.dragging` class, and clears 50ms after release so the row doesn't flash hover mid-scroll. (`static/sessions.js`, `static/style.css`) @JKJameson — PR #1398

- **Per-tab session URL anchors via `/session/<id>`** (#1392) — replaces the cross-tab `localStorage['hermes-webui-session']` active-session bus with per-tab URL ownership. Each tab anchors its active conversation in the path (`/session/<id>`), so two tabs viewing different sessions can no longer yank each other around when localStorage changes. The `<base href>` script in `static/index.html` stops at the `/session/` marker so subpath mounts (`/myapp/session/<id>`) still resolve assets correctly; all `new URL('api/...', location.href)` calls migrated to `document.baseURI||location.href` for the same reason. New helpers `_sessionIdFromLocation()`, `_sessionUrlForSid()`, `_setActiveSessionUrl()` in `sessions.js`. Lineage-aware active highlighting (`_sessionLineageContainsSession`) keeps a forked session highlighted even when collapsed inside a parent lineage row. The `popstate` handler navigates between sessions via browser back/forward but refuses to switch mid-stream (`S.busy` guard, mirroring the cross-tab storage handler). The cross-tab storage handler was deliberately defanged so it only re-renders the sidebar — it no longer force-loads the new sid into the current tab. (`api/routes.py`, `static/boot.js`, `static/commands.js`, `static/index.html`, `static/messages.js`, `static/sessions.js`, `static/terminal.js`, `static/ui.js`, `static/workspace.js`, `tests/test_session_cross_tab_sync.py`, `tests/test_session_lineage_collapse.py`) @dso2ng — PR #1392

### Changed
- **Settings toggle: "Show CLI sessions" → "Show non-WebUI sessions"** (#1407) — the old label was misleading: the feature surfaces conversations from CLI, Telegram, Discord, Slack, WeChat, and other non-WebUI channels — not just CLI. The new label captures the actual scope. Pure rename across all 8 locales (en, zh, zh-Hant, ru, es, de, pt, ko); underlying logic untouched. Reordered channel examples by global adoption (Telegram, Discord, Slack first; WeChat de-emphasized). (`static/i18n.js`, `static/index.html`, `tests/test_korean_locale.py`) @franksong2702 — PR #1407

- **`popstate` handler refuses to switch sessions mid-stream** — Opus pre-release follow-up. Mirrors the same `S.busy` guard the cross-tab storage handler had. A user mid-stream who absent-mindedly hits browser Back used to lose their active turn (PR #1392 introduced the popstate listener without the guard). Now shows a toast and stays on the current session. 1 regression test in `test_v050254_opus_followups.py`. (`static/sessions.js`)


## [v0.50.253] — 2026-05-01

### Added
- **`/branch` slash command — fork a conversation from any message** (#1342, closes #465) — adds a `/branch [name]` slash command and a "Fork from here" hover action on every message. Forking deep-copies the conversation up to a given message index into a brand-new session that inherits the source's `workspace`, `model`, `profile`, and the title (with "(fork)" appended). Fresh state for `session_id`, timestamps, tokens, cost, `active_stream_id`, `pending_user_message`, `pending_attachments`. The new `parent_session_id` field on `Session` is gated in `compact()` to emit only when truthy — sessions without a fork link don't leak `parent_session_id: None` into `/api/sessions` payloads, preserving the v0.50.251 lineage end_reason gating in `agent_sessions.py`. Endpoint validates `session_id` is a string and `keep_count >= 0` before slicing. 21 regression tests in `test_465_session_branching.py`. (`api/routes.py`, `api/models.py`, `static/commands.js`, `static/i18n.js`, `static/icons.js`, `static/sessions.js`, `static/ui.js`, `tests/test_465_session_branching.py`) @bergeouss — PR #1342, fixes #465

### Fixed
- **Local model setup no longer fails mid-conversation with `LOCAL_API_KEY` error** (#1388, closes #1384) — when `model.base_url` pointed at an OpenAI-compatible loopback endpoint that didn't match the `ollama`/`localhost`/`lmstudio` keyword classifier (e.g. `http://192.168.1.10:8080/v1`, llama.cpp on `127.0.0.1:8080`, vLLM, TabbyAPI, custom proxies), `_build_available_models_uncached` auto-detected the provider as `"local"` and persisted that into `config.yaml`. Inference worked initially because the main agent has its own direct path that uses the explicit `base_url + api_key`, but once the conversation grew enough to trip auto-compression — or when vision / web extraction / skills-hub fired — the agent's auxiliary client routed through `resolve_provider_client("local", …)`, fell through every branch (since `"local"` is not in `hermes_cli.auth.PROVIDER_REGISTRY`), and raised `Provider 'local' is set in config.yaml but no API key was found`. Three-layer fix: (1) the auto-detect block now writes `provider: "custom"` instead of `"local"` for unknown loopback hosts — `custom` is the canonical OpenAI-compat fall-through; (2) `resolve_model_provider()` rewrites legacy `"local"` to `"custom"` at read time so existing broken configs heal automatically; (3) `set_hermes_default_model()` refuses to persist `"local"` going forward, with a `_PROVIDER_ALIASES["local"] = "custom"` entry. 9 regression tests in `test_issue1384_local_provider.py`. (`api/config.py`, `tests/test_issue1384_local_provider.py`) — PR #1388

- **Mobile composer layout: progressive-disclosure config panel + scoped titlebar safe-area** (#1381) — the mobile composer had two separate pressure points: normal browser/webview shells could end up with extra titlebar spacing from top safe-area padding, and the composer had more always-visible controls than narrow phone widths can comfortably support. The titlebar fix: top safe-area padding now applies only in `(display-mode: standalone), (display-mode: fullscreen)` — installed/PWA mode — via `--app-titlebar-safe-top`. The composer fix: a phone-only config button collapses workspace/model/reasoning/context controls into a panel above the composer, keeping the primary inline row at attach + voice + profile + workspace files + config + send. Compact context badge on the config button. **Pre-release fixes:** (1) base `.composer-mobile-config-btn{display:none}` rule had equal specificity with `.icon-btn{display:flex}` and lost the cascade (later in source wins) — bumped to `.icon-btn.composer-mobile-config-btn{display:none}` so the button stays hidden at desktop widths. (2) Uppercase WORKSPACE/MODEL/REASONING kicker labels at 700-weight overflowed the 60px copy column on iPhone 14 — hidden inside the open panel via `.composer-mobile-config-action:not(.composer-mobile-context-action) .composer-mobile-config-kicker{display:none}` so the icon + value gives a clean two-row layout. Context row keeps its kicker since it stretches to full panel width. Plus a follow-up commit from the contributor tightening composer spacing on 320px legacy phones (`@media (max-width: 340px)` block). 47 mobile-layout regression tests pass. (`static/i18n.js`, `static/index.html`, `static/panels.js`, `static/style.css`, `static/ui.js`, `tests/test_mobile_layout.py`) @starship-s — PR #1381

### Changed
- **`/branch` endpoint validates input types and ranges** — Opus pre-release follow-up. Reject non-string `session_id` with a clear 400 (was raising TypeError → confusing 500 from `get_session()`). Reject negative `keep_count` with a clear 400 (Python slice semantics on negative produces "all but last N", which is confusing fork behavior). 2 regression tests in `test_v050253_opus_followups.py`. (`api/routes.py`)

- **Strip 9 orphan `wiki_*` i18n keys** — Opus pre-release follow-up. Commit `52bfcea` (#1342) leaked `wiki_panel_title`, `wiki_panel_desc`, `wiki_status_label`, `wiki_entry_count`, `wiki_last_modified`, `wiki_not_available`, `wiki_enabled`, `wiki_disabled`, `wiki_toggle_failed` across all 8 locales (72 lines total) from a different branch — zero references outside `i18n.js`. Stripped, with regression test pinning that they don't return. (`static/i18n.js`, `tests/test_v050253_opus_followups.py`)


## [v0.50.252] — 2026-05-01

### Fixed
- **CLI session import no longer crashes when metadata row is missing** — `_handle_session_import_cli` only assigned `model` inside the `for cs in get_cli_sessions(): if cs["session_id"] == sid` loop. Sessions that existed in the messages store but were missing from the metadata index (post-pruning, race during cron job export, etc.) reached the downstream `import_cli_session(sid, title, msgs, model, ...)` call with `model` unbound and crashed with `UnboundLocalError`. The fix initializes `model = "unknown"` before the loop so the import proceeds with a sensible default. Added a regression test that asserts the init lives before the loop. (`api/routes.py`, `tests/test_session_import_cli_fallback_model.py`) @trucuit — PR #1386
- **Streaming scroll no longer yanks the viewport when tool/queue cards insert** (#1360) — three independent paths could re-pin a user mid-read while the agent streamed: (a) browser scroll-anchoring on `#messages` shifted the scroller when card heights changed, (b) the queue-card render `setTimeout` called unconditional `scrollToBottom()` regardless of stream state, and (c) the queue-pill click handler did the same. Now `#messages` has `overflow-anchor:none`, the near-bottom re-pin dead zone widens from 150px to 250px (small macOS-app windows + trackpad momentum no longer re-pin too eagerly), and both queue-card paths respect `S.activeStreamId` — using `scrollIfPinned()` mid-stream and falling back to `scrollToBottom()` only after the stream ends. 4 regression tests pin all four invariants. (`static/style.css`, `static/ui.js`, `tests/test_issue1360_streaming_scroll_hardening.py`) @NocGeek — PR #1377, fixes #1360
- **API credential redaction no longer regresses for `ghp_*` / `sk-*` / `hf_*` / `AKIA*` tokens** — `_build_redact_fn()` previously returned the agent's `redact_sensitive_text` directly whenever `agent.redact` imported. The agent redactor missed several common credential prefixes that the WebUI's local fallback already knew how to mask, so session/search/memory API responses could leak plaintext credentials. Now both run in series — agent first (handles broader patterns when `HERMES_REDACT_SECRETS` is enabled), local fallback second (always-on, catches the common token shapes). The chained order is safe: agent masking shortens tokens to a `prefix...suffix` form that the fallback regex's character class no longer matches, so no double-redaction. The agent-broader patterns (Stripe `sk_live_`, Google `AIza…`, JWT `eyJ…`) still depend on the env var; opening a follow-up to switch the WebUI call to `force=True`. (`api/helpers.py`) @NocGeek — PR #1379
- **`/status` slash command shows the resolved Hermes home directory** (refs #463) — the WebUI `/status` card already showed model, profile, workspace, timestamps, and token counts but was missing the profile-aware Hermes home path that the CLI's `hermes status` displays. `session_status()` now returns `profile` and `hermes_home` keys (resolved via `get_hermes_home_for_profile()` so named profiles resolve to their dedicated dirs), and `commands.js cmdStatus` renders the new `Hermes home:` line. New `status_hermes_home` i18n key added across all 8 locales (en/ru/es/de/zh/zh-Hant/pt/ko). (`api/session_ops.py`, `static/commands.js`, `static/i18n.js`, `tests/test_session_ops.py`) @NocGeek — PR #1380, refs #463

### Added
- **`/api/models/live` now caches results for 60 seconds** — repeated model-list refreshes (every panel open, every workspace switch) hit upstream provider APIs every time. The new in-memory TTL cache keyed by `(active_profile, provider)` returns deep copies so callers can't mutate the cache, expires after 60s, and is guarded by `threading.RLock` for thread-safety. The cache lives next to `_handle_live_models` and is cleared via `_clear_live_models_cache()` in tests. 4 regression tests cover hit-within-TTL, expiry, profile-scoping (default vs research stay separate), and mutation isolation. (`api/routes.py`, `tests/test_live_models_ttl_cache.py`) @NocGeek — PR #1378
- **WebUI explains CLI-only slash commands instead of forwarding them to the model** — typing `/browser connect` or any other Hermes CLI-only command in the WebUI used to fall through as plain text, so the model would explain the command instead of the app. The frontend now lazy-fetches `/api/commands` metadata, matches by name and aliases, and intercepts any command flagged `cli_only` with a local assistant message that explains the command is CLI-only. Special note for `/browser` about how WebUI's browser tools must be configured server-side (CLI-only `/browser` itself does not work in the WebUI). Built on the existing `cli_only` field that `/api/commands` already exposed; no agent-side changes. (`static/commands.js`, `static/messages.js`, `tests/test_cli_only_slash_commands.py`) @NocGeek — PR #1382

### Changed
- **API credential redaction now uses `force=True`** — `_combined_redact` (introduced by #1379) now passes `force=True` to `redact_sensitive_text` so the agent's broader patterns (Stripe `sk_live_`, Google `AIza…`, JWT `eyJ…`, DB connection strings, Telegram bot tokens) run regardless of the user's `HERMES_REDACT_SECRETS` opt-in. The local fallback then handles the short-prefix shapes the agent omits (`ghp_`, `sk-`, `hf_`, `AKIA`). WebUI API responses are a hard safety boundary — no opt-in should be required. (`api/helpers.py`) — Opus pre-release follow-up
- **`_active_profile_for_live_models_cache` logs the fallback path** — when `get_active_profile_name()` raises (transient state, mid-switch, etc.) the live-models cache (#1378) falls back to `"default"`, mis-scoping the cache for up to 60s. Now logs at debug so we can detect this in production logs without changing the blast radius (TTL still caps the bad-cache window). (`api/routes.py`) — Opus pre-release follow-up
## [v0.50.251] — 2026-04-30

### Fixed
- **Sidebar lineage collapse now works for WebUI JSON sessions, not just imported gateway rows** — PR #1358 (v0.50.249) added the client-side lineage-collapse helper but `/api/sessions` only included `_lineage_root_id` for gateway-imported rows. WebUI JSON sessions (the common case) had no grouping key, so cross-surface continuation chains (CLI-close → WebUI continuation, or compression chains within WebUI) still rendered as separate sidebar rows. Now `/api/sessions` reads `parent_session_id` and `end_reason` from `state.db.sessions` for every WebUI session id in the sidebar payload, walks the parent chain when `end_reason in {'compression', 'cli_close'}`, and exposes `_lineage_root_id` + `_compression_segment_count`. Cycle-detected via a `seen` set; depth-bounded to 20 hops to cap pathological data. **Pre-release fix:** swapped the original full-table-scan for a parameterized `WHERE id IN (...)` query that hits PRIMARY KEY + `idx_sessions_parent` — ~50× faster at 1000 rows, scales linearly. **Pre-release fix:** chunked IN clause to 500 vars to stay under SQLITE_MAX_VARIABLE_NUMBER on older sqlite (Python 3.9 ships sqlite 3.31 with default limit 999) — without this a power user with 2000+ sessions in the sidebar would hit `OperationalError: too many SQL variables`, the silent except-wrapper would swallow it, and lineage collapse would never work for them. **Pre-release fix:** tightened `parent_session_id` exposure — only emitted when the parent's `end_reason` is `compression` or `cli_close` (not for `user_stop`/etc), since the frontend's `_sessionLineageKey` falls through to `parent_session_id` and would incorrectly collapse two children of a non-continuation parent into a single row. (`api/agent_sessions.py`, `api/models.py`, `tests/test_session_lineage_metadata_api.py`, `tests/test_pr1370_lineage_metadata_perf_and_orphan.py`, `tests/test_gateway_sync.py`) @dso2ng — PR #1370
- **Manual cron runs persist output and metadata like scheduled runs** — manual WebUI cron runs called `cron.scheduler.run_job(job)` and then only cleared the in-memory running flag. The job's output was dropped (never written via `save_job_output`) and `last_run_at` / `last_status` were never updated. Now the manual-run wrapper (`_run_cron_tracked`) matches the scheduled-cron path at `cron/scheduler.py:1334-1364` exactly: saves output, marks the job complete, treats empty `final_response` as a soft failure (with the same error string), and records failures via `mark_job_run(False, str(e))`. (`api/routes.py`, `tests/test_cron_manual_run_persistence.py`) @NocGeek — PR #1372 (split out from the held #1352 per pre-release feedback)
- **Reasoning trace, tool calls, and partial output preserved on Stop/Cancel** — three distinct data-loss paths fixed: §A reasoning text accumulated in a thread-local `_reasoning_text` was invisible to `cancel_stream()` because it went out of scope when the thread was interrupted; §B live tool calls in thread-local `_live_tool_calls` were similarly lost; §C reasoning-only streams (no visible tokens) produced no partial assistant message because the thinking-block regex strip returned empty string and the `if _stripped:` guard skipped the append. The fix mirrors the existing `STREAM_PARTIAL_TEXT` pattern (#893) by adding two new shared dicts (`STREAM_REASONING_TEXT`, `STREAM_LIVE_TOOL_CALLS`) populated during streaming and read by `cancel_stream()`. The cancel path now appends the partial assistant message when content text, reasoning trace, OR tool calls exist (not just text). Eliminates "paid tokens disappeared" reports on Stop. 8 regression tests covering all three sections plus tools+text combinations. (`api/config.py`, `api/streaming.py`, `tests/test_issue1361_cancel_data_loss.py`) @bergeouss — PR #1375, fixes #1361
- **New profiles route sessions to the profile dir on first use, not back to default** — `get_hermes_home_for_profile()` had a `if profile_dir.is_dir(): return profile_dir; return _DEFAULT_HERMES_HOME` fallback. New profiles (no session yet, so no dir) routed every session back to default until the directory existed on disk — making profile switching silently broken for the first session of every new profile. Removed the `is_dir()` guard; the profile path is now returned unconditionally and the directory is created on first use by the agent/session layer. Path traversal is still blocked by the `_PROFILE_ID_RE` regex (`^[a-z0-9][a-z0-9_-]{0,63}$`); R19j tests were updated to pin that the regex is now the sole defense. R19c was tightened to assert the new behavior. 5 regression tests in `test_issue1195_session_profile_routing.py` covering existing-profile, non-existent-profile (the core fix), None, empty-string, and 'default' return paths. (`api/profiles.py`, `tests/test_issue798.py`, `tests/test_issue1195_session_profile_routing.py`) @bergeouss — PR #1373, fixes #1195


## [v0.50.250] — 2026-04-30

### Fixed
- **Cross-tab thinking-card cleanup no longer touches the wrong session's DOM** — switching browser tabs while a stream is running could leave `finalizeThinkingCard()` operating on a stale `liveAssistantTurn` node — the thinking card belonged to the stream that started it, not the session currently displayed in the active tab. The guard early-returns when the live turn's `dataset.sessionId` does not match `S.session.session_id`. Per-site stamps were also added: every place that creates `liveAssistantTurn` (3 sites in `static/ui.js`) now writes the current session id onto `dataset.sessionId` so the guard has the data it needs to compare. Without the stamps the guard would always early-return (because `undefined !== "<sid>"` is always true), breaking the streaming UI completely — caught during pre-release review of #1366. Plus a regression test that fails any future `liveAssistantTurn` creation site that forgets the stamp. (`static/ui.js`, `tests/test_pr1366_finalize_thinking_card_guard.py`) @JKJameson — PR #1366
- **Clarify SSE health timer is now an actual stale-detector, not an unconditional 60s force-reconnect** — the timer at `static/messages.js:1715` shipped in v0.50.249 / PR #1355 closed and re-opened the EventSource every 60s regardless of activity, with a comment that wrongly claimed it was a "no event in 60s" detector. Effects on healthy connections: one TCP/SSE setup+teardown per minute per active session, plus a `clarify._lock` round-trip and fresh `initial` snapshot push from the server. Now tracks `lastEventAt` on `initial`/`clarify` event arrivals; only reconnects when the gap exceeds 60s. On a session with steady clarify traffic the timer never reconnects; on a long-idle session it still reconnects roughly every 60-120s (the residual idle reconnect could be eliminated with a server-side `ping` event or a longer threshold — tracked as a follow-up). Originally pulled out of the v0.50.249 batch as out-of-scope; brought back per the rule that small correctness-improving fixes ship even when flagged out-of-scope. (`static/messages.js`) — PR #1367 (Opus pre-release review of v0.50.249, SHOULD-FIX #2)
- **Preferences panel autosaves all fields (Phase 2 of #1003)** — extends the autosave pattern from the Appearance panel to the Preferences panel so 13 preference fields (send_key, language, show_token_usage, simplified_tool_calling, show_cli_sessions, sync_to_insights, check_for_updates, sound_enabled, notifications_enabled, sidebar_density, auto_title_refresh_every, busy_input_mode, bot_name) save automatically without requiring a manual "Save Settings" click. 350ms debounce on field changes (additional 500ms wrapper on the bot_name text input). Inline status feedback (saving / saved / failed + retry). Password field still requires explicit save (security — never autosave passwords). Model selector still requires explicit save (different code path). Reuses the i18n keys (`settings_autosave_saving`/`saved`/`failed`/`retry`) already present in all 8 locales from Phase 1. (`static/index.html`, `static/panels.js`) @fecolinhares — PR #1369

## [v0.50.249] — 2026-04-30

### Added
- **Real-time clarify notifications via SSE long-connection** — replaces the 1.5s HTTP polling loop for clarify (`/api/clarify/pending`) with a Server-Sent Events endpoint at `/api/clarify/stream?session_id=` that pushes clarify events to the browser the instant they fire. Mirrors the approval-SSE pattern shipped in v0.50.248 (#1350) including all the correctness lessons learned during that release: atomic subscribe + initial snapshot inside a single `with clarify._lock:` block (no snapshot/subscribe race), `_clarify_sse_notify` invoked from inside `_lock` in both `submit_pending` and `resolve_clarify` (no notify-ordering race), payload built from `q[0].data` head-of-queue (not the just-appended entry), and `resolve_clarify` re-emits the new head (or `None`/`0` when empty) so trailing clarify prompts never get stuck. Frontend uses `EventSource` with automatic 3s HTTP polling fallback on `onerror`, plus a 60s reconnect timer to recover from silently-broken connections. Bounded `queue.Queue(maxsize=16)` per subscriber with silent drop on full prevents memory leaks from slow tabs. 29 new static-analysis + unit + concurrency tests. (`api/clarify.py`, `api/routes.py`, `static/messages.js`, `tests/test_clarify_sse.py`) @fxd-jason — PR #1355

### Fixed
- **Context window indicator no longer shows misleading "100% used (0% left)" when context_length is missing from the live SSE payload** — the v0.50.247 / PR #1348 fallback to `agent.model_metadata.get_model_context_length()` was applied to the session-save path but NOT to the live SSE `usage` event. For sessions on large-context models (e.g. claude-sonnet-4.6 via OpenRouter, 1M tokens) where the agent didn't have a compressor configured, `usage.context_length` was omitted from the SSE payload, the JS frontend defaulted to 128K, and cumulative `input_tokens` over multiple turns overflowed against the 128K default — clamping the ring to 100% with a tooltip claiming the context was "0% left." The fix mirrors the session-save fallback exactly: when `usage.context_length` is missing, resolve via `get_model_context_length(model, base_url)` and write it onto the `usage` dict before serialization. Symmetric fallback added for `last_prompt_tokens` (uses `s.last_prompt_tokens` instead of the cumulative `input_tokens` counter). Frontend now tracks `rawPct` separately from the clamped `pct`; when `rawPct > 100` the tooltip shows `${rawPct}% used (context exceeded)` instead of misleading users. (`api/streaming.py`, `static/ui.js`) — PR #1356
- **"Uploading…" composer status persists for the entire stream duration after a file upload** — `setComposerStatus('Uploading…')` was set before `uploadPendingFiles()` but never cleared after the upload completed; only `setBusy(false)` at the end of the agent stream eventually wiped it. Users saw "Uploading…" displayed during the agent response, which is misleading. The fix clears the status unconditionally after the upload await completes. UX defect, no behavior change to upload correctness or message text. (`static/messages.js`) — PR #1356
- **Imported CLI/gateway session metadata survives compact() round-trip** — `Session.load_metadata_only().compact()` was dropping `is_cli_session`, `source_tag`, `session_source`, and `source_label`, so imported agent/Telegram/messaging sessions in the sidebar lost their provenance after the metadata-only fast path. Adds these four fields to `Session.__init__`, the `METADATA_FIELDS` save round-trip, and `compact()` output. Without this, sidebar payloads couldn't distinguish imported sessions from native WebUI ones. (`api/models.py`, `tests/test_gateway_sync.py`) @dso2ng — PR #1357
- **Sidebar collapses compression-lineage segments instead of showing every segment as a separate row** — when an agent session has a compression lineage (`_lineage_root_id` populated by the gateway-import path in `api/agent_sessions.py:169`), the sidebar previously listed each segment as its own top-level conversation, cluttering the list with what the user perceives as a single conversation. Adds a pure client-side helper `_collapseSessionLineageForSidebar()` that groups by `_lineage_root_id`/`lineage_root_id`/`parent_session_id`, keeps only the most recently active tip per group, and stores `_lineage_collapsed_count` on the visible row for future UI affordances. Non-destructive — no session JSON or messages are merged, deleted, or rewritten. Only collapses rows when lineage metadata is present. (`static/sessions.js`, `tests/test_session_lineage_collapse.py`) @dso2ng — PR #1358
- **Active session synchronizes across multiple browser tabs** — multiple WebUI tabs sharing the same `localStorage` would diverge from each other when one tab switched sessions, leaving idle tabs with stale in-memory active-session state until their next user action wrote into the wrong session. Adds a `storage` event listener on the `hermes-webui-session` localStorage key. Idle tabs auto-load the new active session and re-render the sidebar cache. Busy tabs (currently mid-turn) do not auto-switch — they show a brief toast instead, so the user notices but the active turn isn't interrupted. (`static/sessions.js`, `tests/test_session_cross_tab_sync.py`) @dso2ng — PR #1359

## [v0.50.248] — 2026-04-30

### Added
- **Real-time approval notifications via SSE long-connection** — replaces the 1.5s HTTP polling loop with a Server-Sent Events endpoint at `/api/approval/stream?session_id=` that pushes approval events to the browser the instant they fire. Cuts approval latency from up to 1.5s down to near-instant and eliminates the "always polling" network noise users observed. Backend uses a thread-safe subscriber registry (`_approval_sse_subscribers` dict, bounded `queue.Queue(maxsize=16)` per subscriber, silent drop on full to prevent leaks from slow tabs). 30s keepalive comments prevent proxy/CDN timeouts; `_CLIENT_DISCONNECT_ERRORS` + `finally` block guarantee subscriber cleanup on any exit path. **Subscribe and snapshot are taken atomically under a single `_lock` acquisition** so a `submit_pending()` arriving in the gap can't be lost. **Notify runs inside the queue-mutation lock** in both `submit_pending` and `_handle_approval_respond` so two parallel callers can't deliver out-of-order with stale `pending_count`. **SSE payload always reflects head-of-queue, never tail**, matching `/api/approval/pending`'s contract — with parallel tool-call approvals (#527), the just-appended entry is at the tail but the UI must show the head. **`_handle_approval_respond` now re-emits the new head after popping** so a trailing approval queued behind the one being responded to is surfaced immediately instead of getting stuck until the next event. Frontend uses `EventSource` with automatic 1.5s HTTP polling fallback on `onerror` (preserves degraded-mode parity with v0.50.247). 50 tests cover wiring, lifecycle, multi-subscriber, cross-session isolation, queue overflow, concurrent subscribe/notify stress, atomic-lock invariants, head-fidelity, trailing-approval re-emission, and notify-order monotonicity. (`api/routes.py`, `static/messages.js`, `tests/test_approval_sse.py`, `tests/test_pr1350_sse_atomic_subscribe.py`, `tests/test_pr1350_sse_notify_correctness.py`) @fxd-jason — PR #1350

### Fixed
- **Context indicator percentage shows even without explicit `context_length`** — frontend companion to the v0.50.246 backend fix. The context ring used to display `·` (no data) whenever `context_length` was 0 or missing — fresh agents, interrupted streams, or models without compressor state. Now defaults to **128K** when `usage.context_length` is falsy and labels the indicator with `(est. 128K)` so users can tell apparent vs. measured. Falls back to `input_tokens` for `last_prompt_tokens` so the ring lights up immediately on the first user message. (`static/ui.js`) @fxd-jason — PR #1349

## [v0.50.247] — 2026-04-30

### Added
- **Cron job sessions auto-assigned to a dedicated "Cron Jobs" project** — sessions originating from the cron scheduler now appear in their own project group in the sidebar instead of mixed in with regular chat sessions. Detection runs against either the session's `source_tag == 'cron'` or a `cron_` ID prefix, both for live `get_cli_sessions()` calls and on `_handle_session_import_cli` import. The project is created idempotently on first cron session via `ensure_cron_project()` (thread-safe, returns the same `project_id` on every subsequent call). Locale parity across all 8 supported languages (en, es, de, zh, zh-Hant, ru, pt, ko) for the new `cron_jobs_project` key. (`api/models.py`, `api/routes.py`, `static/i18n.js`, `tests/test_1079_cron_session_project.py`) @bergeouss — PR #1345, closes #1079

## [v0.50.246] — 2026-04-30

### Added
- **Render fenced code blocks in user messages** — typing a triple-backtick fenced code block in the composer now renders with proper code styling, syntax-aware diff/patch coloring, and the same `<pre><code>` pipeline used for assistant responses. Plain user text outside fences stays escaped (no markdown bold/italic/links interpreted in user bubbles); only fenced blocks are upgraded. Includes specialized colored-line rendering for `diff` / `patch` languages. (`static/ui.js`, `tests/test_1325_user_fenced_code.py`) @bergeouss — PR #1335, fixes #1325

### Fixed
- **Stop/Cancel during streaming no longer wipes the user's typed message (data-loss bug)** — When a user clicked Stop while the agent was streaming, `cancel_stream()` cleared `pending_user_message` before the streaming thread had merged the user turn into `s.messages`, persisting a session with neither the pending field nor a corresponding message. The user's typed text was permanently lost from the session JSON, not just the in-memory client copy. Now `cancel_stream()` synthesizes a user turn into `s.messages` from `pending_user_message` (with attachments preserved) when the most recent user message isn't already that turn — guards against double-append by content-matching against the last user message. (`api/streaming.py`, `tests/test_issue1298_cancel_and_activity.py`) — fixes #1298 (issue 2)
- **Activity panel no longer auto-collapses when new tool/thinking events arrive** — Both `ensureActivityGroup()` (which re-creates the group with `tool-call-group-collapsed` on every destroy/recreate) and `finalizeThinkingCard()` (which force-adds the collapsed class on every tool boundary) ignored the user's manual expand. Tracks the user's last explicit toggle on the live activity group in a per-turn singleton (`_liveActivityUserExpanded`), restored on re-create and respected by the finalize path. Cleared between turns by `clearLiveToolCards()`. (`static/ui.js`, `tests/test_issue1298_cancel_and_activity.py`) — fixes #1298 (issue 1)
- **Stale Mermaid render errors no longer leak into every chat** — Mermaid's render-failure path leaves a temporary `<div id="d<id>">` body-level node containing a "Syntax error in text" SVG. The previous code never removed it, so once any Mermaid block failed (or got mis-detected as Mermaid), every subsequent tab kept the syntax-error SVG visible regardless of content. Also tightens Mermaid detection so line-numbered tool output (`123|line`) and code blocks that don't start with a recognized Mermaid keyword are no longer mis-parsed as Mermaid; failed blocks are marked so a later render pass can't retry them. (`static/ui.js`, `tests/test_issue347.py`) @dso2ng — PR #1337
- **Static asset cache busts automatically on every release** — `<script src="static/ui.js">` and friends were cached indefinitely by browsers and the service worker, so a new release with bug fixes could be invisible to a user until they hard-refreshed. Now `index.html` and `sw.js` registration both inject the current `WEBUI_VERSION` git tag as a `?v=` query string, URL-encoded server-side so unusual git tag formats can't break the JS. The service worker also no longer intercepts requests for itself, ensuring the browser always fetches the freshly-versioned `sw.js` directly from the network. (`api/routes.py`, `static/index.html`, `static/sw.js`, `tests/test_pwa_manifest_sw.py`) @dso2ng — PR #1337
- **Context window indicator persists across page reloads (#1318 — fully fixed)** — `Session.__init__` now accepts `context_length`, `threshold_tokens`, and `last_prompt_tokens`; `save()` persists them via the `METADATA_FIELDS` round-trip and `compact()` exposes them on the GET `/api/session` response. **Critically**, `api/streaming.py` now writes the values from `agent.context_compressor` onto the session inside the post-merge per-turn save block, so the values land on disk and survive a page reload. Without that writer, the model fields would have been pure scaffolding — present but never populated. The frontend context-ring indicator was previously losing its percentage on every session load because nothing was writing these fields to disk; that data flow is now end-to-end. (`api/models.py`, `api/routes.py`, `api/streaming.py`, `tests/test_pr1341_context_window_persistence.py`) @fxd-jason — PR #1341 (focused split from the held PR #1318) + writer added during pre-release review
- **`fallback_providers` list config no longer crashes streaming** — `api/streaming.py:1701` previously read `_cfg.get('fallback_model')` and called `.get('model', '')` on the result. When users had `fallback_providers: [{...}, {...}]` in their config (the chained-fallback form documented in CHANGELOG since v0.50.151), the streaming path crashed with `AttributeError: 'list' object has no attribute 'get'`. Now consults both `fallback_model` (single dict, legacy) and `fallback_providers` (list, new), picks the first valid entry from the list, and defends both paths with `isinstance` checks. (`api/streaming.py`, `tests/test_pr1339_fallback_providers_list.py`) @jimdawdy-hub — PR #1339

### Changed
- **CI test stability** — `test_checkpoint_fires_on_activity_counter_increment` was rewritten to use deterministic `threading.Event` synchronization instead of `time.sleep` windows. The old version polled at 0.1s intervals and slept 0.15s/0.25s/0.25s between activity increments, which intermittently failed under CI scheduling jitter (one save instead of two). The new version waits up to 3.0s for the checkpoint thread to actually advance after each increment, with no sensitivity to scheduler timing. (`tests/test_issue765_streaming_persistence.py`)

### Documentation
- **`CONTRIBUTORS.md`** — new file with stack-ranked credit roll for all 66 contributors, generated from `git log` + `gh api` + CHANGELOG attribution lines. Top contributors table at top of `README.md`.
- **README, ROADMAP, ARCHITECTURE, SPRINTS, TESTING** — refreshed to v0.50.246 / 3309 tests; removed stale `v0.50.36-local.1` header from ARCHITECTURE.md; updated SPRINTS.md "Where we are now" to reflect ~95% Claude parity. (PR #1340 — already merged, brought forward in this release.)

## [v0.50.245] — 2026-04-30

### Fixed
- **Cron `Run Now` no longer crashes with `NameError: run_job is not defined`** — `_run_cron_tracked()` runs in a worker thread but referenced `run_job` only via a local import inside `_handle_cron_run()` (a different scope). Manual cron execution now imports `run_job` inside the worker function itself, and the redundant import is removed from the route handler. Adds AST-based regression tests so future refactors can't silently re-break the worker-thread scope. (`api/routes.py`, `tests/test_cron_run_job_import.py`) @fxd-jason — PR #1317, fixes #1310 (also addressed by #1312/#1329, closed as duplicates)
- **Context auto-compressed banner no longer repeats every turn after first compression** — the fallback compression detector compared cumulative `compression_count > 0`, which stays true forever after the first compression event, so the banner re-fired on every subsequent turn. Now snapshots `compression_count` before `run_conversation()` and compares against the snapshot, so the banner only fires when compression actually happens during the current turn. (`api/streaming.py`) @qxxaa — PR #1316
- **Mobile workspace panel sliver and composer footer overlap (#1300)** — saved desktop workspace-panel widths leaked into compact/mobile layouts, leaving a thin right-edge workspace sliver and a stale shadow on closed panels. Composer footer controls also showed icon/text overlap at intermediate widths when sidebars constrained the chat column. The fix clears/reapplies the rightpanel inline width only when the viewport is outside the compact/mobile breakpoint, hides the closed off-canvas shadow, and adds staged composer-footer container queries so workspace/model labels collapse before they overlap. (`static/boot.js`, `static/style.css`, `tests/test_mobile_layout.py`) @franksong2702 — PR #1328, fixes #1300
- **Streaming sessions stay visible in the sidebar during their first turn** — the `Untitled + 0-messages` filter (#1171) hid sessions during the initial streaming turn because PR #1184 deferred the first `save()` until the first message landed. Navigating away during a long first turn made the active conversation disappear from the sidebar (looked like data loss to users). The filter now exempts sessions with `active_stream_id` (index path) or with `active_stream_id` plus `pending_user_message` (full-scan path), so in-progress conversations remain visible while truly empty scratch sessions are still hidden. 7 new regression tests cover both filter paths and edge cases. (`api/models.py`, `tests/test_streaming_session_sidebar.py`) @franksong2702 — PR #1330, fixes #1327
- **Default model rehydration when providers share slash-qualified IDs (#1313)** — `_deduplicate_model_ids()` only de-duplicated bare IDs and skipped slash-qualified IDs entirely, so when two providers exposed the same `vendor/model` (e.g. two custom providers both listing `google/gemma-4-27b`), the dropdown contained duplicate `<option value>` entries and reopening Preferences could snap the saved default model back to the first provider that shared the ID. The dedupe now covers slash IDs as well, the configured-model badge lookup respects the matching provider, and the frontend matcher prefers the configured `active_provider` when rehydrating a saved default model. (`api/config.py`, `static/panels.js`, `static/ui.js`, `tests/test_issue1228_model_picker_duplicate_ids.py`, `tests/test_model_picker_badges.py`) @hacker2005 — PR #1326, fixes #1313
- **Configured fallback models always appear in the dropdown** — the model picker only rendered configured models that already existed in the loaded `<select>` options, so when `/api/models` exposed a fallback chain in `configured_model_badges` but the underlying provider's catalog (especially `local-ollama`) was empty or partial, the **Configured** section showed an incomplete chain. The dropdown now synthesizes entries from `configured_model_badges` for any configured model missing from the catalog, sorts them as primary → fallback 1 → fallback N, and renders them under a single "Configured" header above the per-provider groups. (`static/ui.js`, `tests/test_model_picker_badges.py`) @renatomott — PR #1322
- **Duplicate header copy buttons on language-fenced code blocks** — for code blocks with a language header, the copy button is appended to the sibling `.pre-header`, not inside `<pre>`, but the existing duplicate guard only checked inside `<pre>`. Repeated post-render passes (cache replays, streaming updates) could append duplicate copy buttons in the header. The guard now also checks the header before creating a new button. (`static/ui.js`, `tests/test_issue1096_copy_buttons.py`) @dso2ng — PR #1324, fixes #1096
- **zh-Hant locale labels — restore Traditional Chinese in tree/raw view and MCP server settings** — a recent locale-merge accidentally left Russian strings in the zh-Hant block for tree-toggle labels, the parse-failed note, and Settings → System → MCP Servers. zh-TW users saw mixed Russian/Chinese UI text in those areas. The labels are now restored to Traditional Chinese, plus a regression test that asserts no Cyrillic characters can slip back into the zh-Hant block. (`static/i18n.js`, `tests/test_chinese_locale.py`) @dso2ng — PR #1323
- **Docker `HEALTHCHECK` instruction added** — the Dockerfile was missing a `HEALTHCHECK`, so `docker ps` couldn't show health, Docker Compose `depends_on: condition: service_healthy` didn't work, and orchestration tools (K8s, Swarm) couldn't use native health probes. Added a 30s-interval HEALTHCHECK that hits the existing `/health` endpoint. (`Dockerfile`) @zichen0116 — PR #1332
- **`.env.example` state-dir default aligned with `bootstrap.py`** — `HERMES_WEBUI_STATE_DIR` in `.env.example` referenced the obsolete `~/.hermes/webui-mvp` path while `bootstrap.py` and `docker-compose.yml` already use `~/.hermes/webui`. Updated the example file so users following it land in the same state dir as the rest of the codebase. (`.env.example`) @zichen0116 — PR #1331

## [v0.50.244] — 2026-04-30

### Added
- **Text-to-Speech playback for agent responses** — Web Speech API powers a per-message 🔊 speaker button on every assistant message, plus an optional auto-read toggle that speaks each response when streaming finishes. Voice / rate / pitch controls are exposed in Settings → Preferences. All TTS preferences are stored in `localStorage` (no server round-trip). Strips markdown, code blocks, and `MEDIA:` paths before speaking; pauses synthesis when the composer is focused. Opt-in — TTS is hidden by default until enabled in Settings. Locale coverage for en, ru, es, de, zh, zh-Hant, pt, ko. (`static/ui.js`, `static/panels.js`, `static/messages.js`, `static/boot.js`, `static/style.css`, `static/index.html`, `static/i18n.js`) @fecolinhares — PR #1303, closes #499
- **Sienna skin (warm clay & sand earth palette)** — opt-in alongside the existing default/Ares/Mono/Slate/Poseidon/Sisyphus/Charizard set. Full palette rewrite (light + dark variants) with clay accent (`#D97757`) on a soft sand background; neutral tool-card chrome, accent-tinted active session indicator. No forced migration, default skin stays `default` (gold); users opt in via Settings → Skin. (`static/style.css`, `static/boot.js`, `static/index.html`, `tests/test_sienna_skin.py`) — PR #1307 (salvaged from #1084)

### Fixed
- **Cmd/Ctrl+K new chat works while a conversation is busy** — drops the `!S.busy` guard so users can start a new conversation mid-stream. The in-flight stream keeps running on its own session; the user just gets a fresh blank one. (`static/boot.js`, `tests/test_mobile_layout.py`) — PR #1306 (salvaged from #1084)
- **Stale saved session 404 cleanup + structured `api()` errors** — when a saved session ID returns 404, `loadSession()` now clears `localStorage.hermes-webui-session` and rethrows so boot can fall through to the empty state instead of sticking on "Session not available in web UI." across reloads. The cleanup is gated on `!currentSid` so click-into-404 doesn't wipe state. The global `api()` helper now attaches `.status` / `.statusText` / `.body` to thrown errors, so callers can branch on HTTP status without re-parsing the message string. (`static/sessions.js`, `static/workspace.js`, `tests/test_stale_empty_session_restore.py`, `tests/test_1038_pwa_auth_redirect.py`) — PR #1304 (salvaged from #1084)

## [v0.50.243] — 2026-04-30

### Fixed
- **Chip composer model badge — removed the `PRIMARY` projection** — The chip-projected configured-model badge added in #1287 was eating ≈30% of chip width (235px → 164px) without adding signal, since the model name is already right next to it. The dropdown rows still show `Primary` / `Fallback N` badges where they actually help distinguish picker entries. Backend `_build_configured_model_badges()` and the `configured_model_badges` payload on `/api/models` are preserved for the dropdown to consume. (`static/index.html`, `static/ui.js`, `static/style.css`, `tests/test_model_picker_badges.py`) — PR #1301
- **Claude Opus 4.7 label rendering** — Adds explicit label entries for `anthropic/claude-opus-4.7`, `claude-opus-4.7`, and `claude-opus-4-7` so the picker no longer renders "Claude Opus 4 **7**" (missing dot) when the dashed-form model ID falls through to the generic dash-replace formatter. (`api/config.py`) — PR #1301
- **Cron output snippet preserves the `## Response` section** — `/api/crons/output` returned `txt[:8000]` which could drop the useful response section when a large skill dump appeared in the prompt context. Now: if `## Response` exists, preserves a short header plus the response section; if no marker exists, returns the file tail rather than the head. (`api/routes.py`, `tests/test_sprint10.py`) @franksong2702 — PR #1297, fixes #1295

## [v0.50.242] — 2026-04-30

### Reverted
- **Assistant message serif font (Georgia)** — Reverted the global `.assistant-turn .msg-body { font-family: var(--font-assistant) }` rule introduced in v0.50.240 (PR #1282). Assistant responses now render in the same system sans-serif stack as the rest of the UI, matching pre-v0.50.240 behavior. The `--font-assistant` CSS token has been removed. (`static/style.css`)
- **Calm Console theme** — Removed the `data-theme="calm"` palette and its associated picker entry, theme-apply branch, and server-side enum value. The theme was the only consumer of the assistant serif rule and was not pulling its weight as a third theme option. Users who selected `calm` will fall back to the default theme on next page load (the server settings validator now rejects `calm` and resets to `dark`). (`static/style.css`, `static/boot.js`, `static/index.html`, `api/config.py`, `tests/test_ui_tool_call_cleanup.py`)

## [v0.50.241] — 2026-04-30

### Added
- **Inline audio/video media editor with playback speed controls** — MEDIA: tokens and file attachments for audio/video now render as a full media editor card with 0.5×–2× speed buttons, rate stored in `localStorage`, and a `MutationObserver` that auto-applies the saved rate to any newly rendered player. Composer tray shows compact inline players for attached audio/video files. (`static/ui.js`, `static/boot.js`, `static/style.css`, `static/workspace.js`) @nickgiulioni1 — PR #1290 (rebased #1232)
- **HTTP byte-range streaming for audio/video** — `/api/media?inline=1` now handles `Range:` request headers and returns HTTP 206 Partial Content, enabling seekable playback of large audio and video files. Path access is guarded by the existing `within_allowed` check before `_serve_file_bytes` is called. (`api/routes.py`) @nickgiulioni1 — PR #1290
- **PDF and media previews in workspace file browser** — PDF, audio, and video files in the workspace panel now render inline instead of forcing download. (`static/workspace.js`) @nickgiulioni1 — PR #1290
- **Configured model badges** — models that appear in `config.yaml` as primary or fallback are now labeled with `Primary` / `Fallback N` badges in the model picker, and the badge is carried through to the selected-model chip in the composer header. Badge data persists through the on-disk model cache so it survives server restarts. (`api/config.py`, `static/ui.js`, `static/index.html`, `static/style.css`) @renatomott — PR #1287
- **Appearance autosave** — Theme, skin, and font-size pickers in Settings › Appearance now save immediately with inline `Saving…` / `Saved` / `Failed — Retry` status. These controls no longer set the global unsaved-changes dirty state, so closing Settings after tweaking appearance never prompts to discard. Font size is also now persisted to `config.yaml` and restored on page load. (`static/boot.js`, `static/panels.js`, `api/config.py`, `static/i18n.js`) @franksong2702 — PR #1289, refs #1003
- **Agent session source normalization** — Imported Hermes Agent sessions now expose `raw_source`, `session_source`, and `source_label` metadata through both `/api/sessions` and gateway watcher SSE snapshots. Existing `source_tag` / `is_cli_session` compatibility fields remain unchanged so sidebar display is preserved; this lays the groundwork for source-aware sidebar policies. (`api/agent_sessions.py`, `api/gateway_watcher.py`, `api/models.py`) @franksong2702 — PR #1294, refs #1013

## [v0.50.240] — 2026-04-30

### Added
- **Compact tool activity mode (`simplified_tool_calling`)** — new setting (default on) groups tool calls and thinking traces into a single collapsed "Activity" disclosure card per assistant turn instead of showing every step as a separate visible row. Keeps long agent runs readable while keeping full transparency a click away. Also adds a **Calm Console** theme (`calm`) with earth/slate palette and serif assistant prose. (`api/config.py`, `static/ui.js`, `static/panels.js`, `static/boot.js`, `static/style.css`, `DESIGN.md`) @Michaelyklam — PR #1282
- **PDF first-page preview** — `MEDIA:` links to `.pdf` files now lazy-load a canvas preview of page 1 via PDF.js CDN (4 MB cap, download fallback). **HTML sandbox iframe** — `.html`/`.htm` files render inline in a sandboxed `<iframe srcdoc>` with `allow-scripts` only (256 KB cap). 10 new i18n keys × 7 locales. (`static/ui.js`, `static/style.css`, `static/i18n.js`) @bergeouss — PR #1280, closes #480 #482
- **Inline Excalidraw diagram preview** — `.excalidraw` files render as a pure-SVG diagram inline (no external deps; supports rectangles, ellipses, diamonds, text, lines, arrows, freehand; 512 KB cap). (`static/ui.js`, `static/i18n.js`) @bergeouss — PR #1279, closes #479
- **Inline CSV table rendering** — fenced `csv` blocks and `MEDIA:` CSV files render as scrollable HTML tables with auto-separator detection (comma/semicolon/tab) and quote stripping. (`static/ui.js`, `static/i18n.js`) @bergeouss — PR #1277, closes #485
- **Inline SVG, audio, and video rendering** — SVG files render as `<img>`, audio files as `<audio controls>`, video files as `<video controls>`. File attachment previews in the composer also get inline display. (`static/ui.js`, `static/i18n.js`) @bergeouss — PR #1276, closes #481
- **Batch session select mode** — a new select-mode toggle in the session list lets users choose multiple sessions and perform bulk Archive, Delete, or Move to Project actions. 11 new i18n keys × 7 locales. (`static/sessions.js`, `static/i18n.js`) @bergeouss — PR #1275, closes #568
- **Collapsible skill category headers** — clicking a category header in the Skills panel collapses or expands its contents without a full re-render; collapsed state persists across filter cycles. (`static/panels.js`, `static/style.css`) @bergeouss — PR #1281
- **`providers.only_configured` setting** — opt-in config flag that restricts the model picker to providers explicitly configured in `config.yaml`. Default false (existing behavior unchanged). (`api/config.py`) @KingBoyAndGirl — PR #1268
- **OpenCode Go model catalog updated** — adds 7 new models: Kimi K2.6, DeepSeek V4 Pro/Flash, MiMo V2.5/Pro, Qwen3.6/3.5 Plus. (`api/config.py`) @nesquena-hermes — PR #1284, closes #1269

### Fixed
- **Profile `TERMINAL_CWD` no longer causes TypeError** — `_build_agent_thread_env()` merges all thread-local env keys into one dict before passing to `_set_thread_env()`, so a `terminal.cwd` entry in `config.yaml` can no longer conflict with the per-session workspace path. (`api/streaming.py`) @hi-friday — PR #1266
- **Service worker no longer caches subpath API routes** — the SW cache-bypass regex now matches `/api/*` under any mount prefix (e.g. `/hermes/api/*`), fixing stale session lists when running behind a subpath reverse proxy. (`static/sw.js`) @Michaelyklam — PR #1278
- **SSE client disconnect leaks resolved** — `TimeoutError` and `OSError` are now treated as normal disconnects; `QuietHTTPServer` suppresses them silently. Server backlog raised to 64 and handler threads daemonized. Session list renders before saved-session restore so a client-side boot error can no longer leave the sidebar empty. (`api/routes.py`, `server.py`, `static/boot.js`, `static/sessions.js`) @KayZz69 — PR #1267
- **i18n: Korean and Chinese MCP keys corrected, missing locale keys added** — 23 Korean MCP strings that had English text replaced with correct Korean; 23 Chinese (zh) strings that had Spanish text replaced with Chinese; 41 missing keys added to zh-Hant; 229 missing keys added to de. (`static/i18n.js`) @bergeouss — PR #1274, closes #1273

## [v0.50.239] — 2026-04-29

### Fixed
- **h4–h6 markdown headings now render correctly** — `renderMd()` heading replacers are now applied longest-first (`######` before `#####` before `####` before `###`…), fixing the regression where h4–h6 headings were emitted as literal `#` text. CSS adds correct font sizes and `color:var(--muted)` for h6. (`static/ui.js`, `static/style.css`) @the-own-lab — Closes #1258

## [v0.50.238] — 2026-04-29

### Added
- **Portuguese (pt-BR) locale** — full i18n coverage for `pt` locale across all UI panels (chat, sessions, commands, settings, cron, workspace, profiles, skills). (`static/i18n.js`) @fecolinhares — Closes #1242

### Fixed
- **Compaction preserves visible prompts** — WebUI now keeps model-facing compacted context separately from the visible transcript, so automatic context compaction no longer replaces earlier user prompts in the scrollback. (`api/models.py`, `api/streaming.py`, `api/routes.py`) @franksong2702 — Closes #1217
- **MiniMax China provider visible in model picker** — `MINIMAX_CN_API_KEY` now maps to the `minimax-cn` provider instead of being collapsed into global `minimax`; WebUI includes a static MiniMax (China) model catalog/display label so `providers.minimax-cn: {}` can render a populated picker group. (`api/config.py`, `api/providers.py`) @franksong2702 — Closes #1236
- **Terminal resize and collapse controls restored** — restores the collapse/expand dock markup and controlled height CSS variable lost during the v0.50.237 batch integration, and reinstates regression coverage for terminal resizing and collapsed-state behavior. (`static/index.html`, `static/style.css`, `static/terminal.js`, `tests/test_embedded_workspace_terminal.py`) @franksong2702
- **GET `/api/mcp/servers` returned 404** — the route was placed after `handle_get()`'s `return False` sentinel; moved inside the function before the 404 return. (`api/routes.py`) @KingBoyAndGirl — Closes #1251
- **MCP Servers UI showed Korean labels in English locale** — 26 i18n keys in the English locale block (`en`) were accidentally set to Korean translations from PR #538; replaced with correct English text. (`static/i18n.js`) @bergeouss — Closes #1254
- **Live model fetch for custom providers** — when `provider=custom`, the live-model endpoint now reads `model.base_url` from config and fetches `/v1/models` from the user's custom OpenAI-compat endpoint. (`api/routes.py`) @KingBoyAndGirl — Closes #1247
- **Profile terminal env applied in WebUI sessions** — `api/terminal.py` now loads the active profile's env overlay before spawning the PTY shell. (`api/terminal.py`) @dso2ng — Closes #1245
- **SSRF: custom provider `base_url` trusted** — `_is_ssrf_blocked()` now whitelists user-configured custom provider base URLs, preventing false SSRF blocks for legitimate private-network endpoints. (`api/routes.py`) @KingBoyAndGirl — Closes #1244
- **SESSION_AGENT_CACHE LRU limit** — unbounded dict replaced with `functools.lru_cache` (cap 256); prevents memory growth in long-running servers with many sessions. (`api/config.py`) @happy5318 — Closes #1250
- **Native image uploads as multimodal inputs** — image attachments uploaded to the workspace are now forwarded to vision-capable models as OpenAI-style `image_url` data-URL parts instead of text paths. Magic-byte validation rejects non-image files; workspace path validation uses `.resolve()` + `.relative_to()` (symlink-safe); 20 MiB per-image cap. (`api/streaming.py`, `api/routes.py`, `api/upload.py`, `static/ui.js`) @yzp12138 — Closes #1229
- **`@provider:model` hint preserved when hint matches active provider** — `_resolve_compatible_session_model()` was stripping the `@provider:` prefix when the hint matched the active provider, causing duplicate model IDs from different providers to snap back to the wrong provider on the next render. The hint is now returned unchanged so `resolve_model_provider()` can route correctly. (`api/routes.py`) @nesquena-hermes — Closes #1253

## [v0.50.237] — 2026-04-29

### Added
- **Embedded workspace terminal** — `/terminal` slash command opens a compact PTY-backed terminal card anchored above the composer. Supports collapse/expand/dock, resize, restart, clear, copy output, and per-session workspace binding. Env vars are allowlisted so server credentials are not exposed in the shell. (`api/terminal.py`, `static/terminal.js`, `static/commands.js`, `static/i18n.js`) @franksong2702 — Closes #1099
- **Collapsible JSON/YAML tree viewer** — fenced `json`/`yaml` code blocks get a Tree/Raw toggle. Tree view renders collapsible, type-colored nodes (keys blue, strings green, numbers blue, booleans amber, nulls muted); auto-collapsed beyond depth 2. Default is Tree for blocks with 10+ lines. YAML parsing uses js-yaml loaded lazily via CDN with SRI. (`static/ui.js`, `static/style.css`, `static/i18n.js`) @bergeouss — Closes #484
- **Inline diff/patch viewer** — fenced `diff`/`patch` blocks render with colored `+`/`-`/`@@` lines. `MEDIA:` links to `.patch`/`.diff` files fetch and render inline with a 50 KB cap. (`static/ui.js`, `static/style.css`, `static/i18n.js`) @bergeouss — Closes #483
- **MCP server management UI** — Settings › System panel now lists MCP servers with transport badges, and provides add/edit/delete forms. Backend: `GET/PUT/DELETE /api/mcp/servers` with masked secrets (round-trip safe). i18n coverage across 7 locales. (`api/routes.py`, `static/panels.js`, `static/i18n.js`) @bergeouss — Closes #538
- **Cron run status tracking and watch mode** — after "Run Now", the cron detail view shows a live spinner, running label, and elapsed timer (polls every 3 s). Auto-starts watch when opening an already-running job. `GET /api/crons/status` endpoint. Double-run guard prevents concurrent execution of the same job. (`api/routes.py`, `static/panels.js`, `static/style.css`, `static/i18n.js`) @bergeouss — Closes #526
- **Duplicate cron job** — Duplicate button in cron detail header pre-fills the create form with the existing job settings, appends "(copy)" to the name (auto-increments on collision), and saves as paused. (`static/panels.js`, `static/i18n.js`) @bergeouss — Closes #528
- **Upload and extract zip/tar archives into workspace** — zip, tar.gz, tgz, tar.bz2, tar.xz files are auto-extracted into a named subfolder. Zip-slip/tar-slip protection via `is_relative_to()`; zip-bomb protection via 200 MB cumulative extraction limit on actual bytes. (`api/upload.py`, `api/routes.py`, `static/ui.js`, `static/i18n.js`) @bergeouss — Closes #525
- **Workspace directory CRUD** — right-click context menu on workspace file/dir rows adds Rename and Delete for directories. `shutil.rmtree()` guarded by `safe_resolve()` path validation. Expanded-dir cache updated on rename/delete. (`api/routes.py`, `static/ui.js`, `static/i18n.js`) @bergeouss — Closes #1104
- **Workspace drag-to-reorder** — drag handles on workspace rows; `PUT /api/workspaces/reorder` persists new order. Reorder is confirmed (not optimistic); unmentioned workspaces are appended. (`api/routes.py`, `static/panels.js`, `static/i18n.js`) @bergeouss — Closes #492
- **Compress affordance in context ring** — context usage tooltip shows a pre-fill button for `/compress` at ≥50% usage (hint style) and ≥75% (urgent red style). No auto-fire. (`static/ui.js`, `static/index.html`, `static/style.css`, `static/i18n.js`) @bergeouss — Closes #524
- **DeepSeek V4, Z.AI/GLM provider, model tags** — adds `deepseek-v4-flash` and `deepseek-v4-pro`; keeps V3/R1 as `(legacy)` until 2026-07-24. Adds Z.AI/GLM provider (`glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`, `glm-4.5`, `glm-4.5-flash`). Provider cards show model names; custom providers from `config.yaml` are scanned. (`api/config.py`, `api/onboarding.py`, `static/panels.js`) @jasonjcwu — Closes #1213
- **NVIDIA NIM provider** — adds `nvidia` to the provider catalog with display name, aliases, model list, API key mapping, OpenAI-compat endpoint (`https://integrate.api.nvidia.com/v1`), and onboarding entry. (`api/config.py`, `api/providers.py`, `api/routes.py`, `api/onboarding.py`) @JinYue-GitHub — Closes #1220

### Fixed
- **Background session unread dots** — sidebar unread dots no longer depend solely on `message_count` delta. Explicit completion markers, polling fallback, INFLIGHT/S.busy sidebar spinner tracking, localStorage-persisted observed-running state, and auto-compression session-id rotation all handled. (`static/sessions.js`, `static/messages.js`) @franksong2702 — Closes #856
- **Clarify draft preserved on timeout** — unsent clarify text is moved to the main composer when the clarify card expires or is dismissed. Countdown indicator shows remaining time; urgent styling for final seconds. (`api/clarify.py`, `static/messages.js`, `static/style.css`, `static/index.html`) @sixianli — Closes #1216
- **Mobile busy-input composer button** — unified send/stop/queue/interrupt/steer action button so mobile users (tap-only) can queue, interrupt, or steer while the agent is busy. Dynamic icon/label/color. Removes separate cancel button path. (`static/ui.js`, `static/messages.js`, `static/sessions.js`, `static/boot.js`, `static/i18n.js`) @starship-s — Closes #1215
- **Session sidecar repair hardened** — centralized `_apply_core_sync_or_error_marker()` helper; non-blocking lock acquire to avoid deadlock in cache-miss repair path; streaming-finally and cache-miss repair paths share logic. (`api/models.py`, `api/streaming.py`) @starship-s — Closes #1230
- **Scroll position preserved when loading older messages** — `_loadOlderMessages` now uses `#messages` (the actual scrollable container) instead of `#msgInner`; resets `_scrollPinned` after restoring position so `scrollToBottom` does not re-fire. (`static/sessions.js`) @jasonjcwu — Closes #1219
- **Model picker duplicate IDs across providers** — `_deduplicate_model_ids()` detects bare model IDs appearing in 2+ groups and prefixes collisions with `@provider_id:` (deterministic alphabetical tie-break). Frontend `norm()` regex strips `@provider:` prefixes for fuzzy matching. (`api/config.py`, `static/ui.js`) @bergeouss — Closes #1228
- **`/api/models` cache metadata preserved** — disk and TTL cache now include `active_provider` and `default_model` alongside `groups`. Legacy `groups`-only cache files are rejected and rebuilt. (`api/config.py`) @franksong2702 — Closes #1239
- **Clarify model scope copy** — composer model-selector dropdown shows "Applies to this conversation from your next message." sticky note; preferences Default Model shows "Used for new conversations." helper text. (`static/ui.js`, `static/boot.js`, `static/i18n.js`) @franksong2702 — Closes #1241
- **Workspace panel stale after profile switch** — `loadDir('.')` called in `switchToProfile()` Case B so the file tree refreshes to the new profile. (`static/panels.js`) @bergeouss — Closes #1214
- **OAuth providers show as unconfigured** — expanded `_OAUTH_PROVIDERS` set; live `get_auth_status()` fallback for unknown OAuth providers (gated by pid regex validation and closed `key_source` allowlist). (`api/providers.py`) @bergeouss — Closes #1212
- **MCP delete button XSS** — replaced `onclick="...esc(s.name)..."` inline handler with `data-mcp-name` attribute + event delegation (absorb fix). (`static/panels.js`)
- **Zip/tar-slip path traversal** — replaced `startswith` prefix check with `is_relative_to()`; zip-bomb check now tracks actual extracted bytes instead of trusting `member.file_size` (absorb fix). (`api/upload.py`)
- **Terminal PTY env secret leak** — terminal shell env uses a safe allowlist instead of `os.environ.copy()`, preventing API keys from being visible inside the terminal (absorb fix). (`api/terminal.py`)
- **Terminal resize handle wired** — `terminalResizeHandle` element added to `index.html`; `_terminalEls()` returns `handle` (absorb fix). (`static/index.html`, `static/terminal.js`)

## [v0.50.235] — 2026-04-28

### Fixed
- **Profile switch shows correct workspace, model, and chip label immediately** — Three separate
  bugs caused profile switching to appear broken: (1) `switch_profile(process_wide=False)` returned
  the old profile's workspace because `get_last_workspace()` routed through thread-local profile
  context (still pointing at the old profile during the switch); (2) the model dropdown showed stale
  results because the in-memory models cache wasn't invalidated; (3) the profile chip stayed on the
  old name because `syncTopbar()` returned early without updating it when no session was active.
  (`api/profiles.py`, `api/routes.py`, `static/ui.js`,
  `tests/test_profile_switch_1200.py`) (PR #1203)
- **Flaky test stabilisation** — `test_server_now_ms_compensates_positive_skew` used exact-ms
  equality across two `Date.now()` calls; fixed with midpoint averaging and ±5 ms tolerance.
  (`tests/test_issue1144_session_time_sync.py`)
## [v0.50.234] — 2026-04-28

### Fixed
- **XSS hardening in markdown renderer** — HTML tags in LLM output were filtered by
  tag name only, allowing event handlers like `onerror` and `onclick` to pass through
  on `<img>` and other elements. The sanitizer now strips all attributes except a
  per-tag allowlist and blocks `javascript:`, `data:`, and `vbscript:` URL schemes.
  Incomplete raw tags (`<img src=x onerror=...//` with no closing `>`) are escaped
  before paragraph wrapping so they cannot be completed by the renderer's own output.
  (`static/ui.js`)
- **Delegated image lightbox** — inline `onclick` handlers on `<img class="msg-media-img">`
  replaced with a single delegated `document.addEventListener('click')`, eliminating the
  last source of inline event handler HTML in rendered output. (`static/ui.js`)
- **Workspace trust for macOS symlink paths** — `/etc` on macOS resolves to `/private/etc`
  which previously bypassed the blocked-roots check. The new `_is_blocked_workspace_path`
  helper compares both the raw and resolved path. Also adds `/System` and `/Library` to
  the blocked roots. (`api/workspace.py`)
- **Legacy `/api/chat` workspace validation** — the synchronous chat fallback endpoint
  was not routing through `resolve_trusted_workspace()`, allowing arbitrary paths to be
  set as workspace. (`api/routes.py`)
- **`linked_files` type guard** — skill view responses with a `null` or non-dict
  `linked_files` field no longer crash the skills API. (`api/routes.py`)
  (by @bschmidy10, PR #1201)
## [v0.50.233] — 2026-04-28

### Fixed
- **Workspace trust for /var/home paths** — workspaces under `/var/home` (used by
  systemd-homed on Fedora/RHEL) were incorrectly blocked because `_is_blocked_system_path`
  flagged `/var` as a system root. The home-directory trust check in both
  `resolve_trusted_workspace` and `validate_workspace_to_add` now correctly trusts any
  path under `Path.home()` regardless of where the home directory lives on disk.
  (`api/workspace.py`) (by @frap129, PR #1199)
## v0.50.236 — 2026-04-28

### Bug fixes
- **fix(providers): OAuth provider cards now show "Configured" badge when token is via config.yaml** — `get_providers()` was unconditionally overwriting `has_key=True` (from `_provider_has_key()`) with `has_key=False` when `get_auth_status()` returned `logged_in=False`, discarding valid working tokens in `config.yaml`. Also: the Settings panel was filtering out all OAuth providers entirely (`filter(p=>p.configurable)` — OAuth providers always have `configurable=False`). Fixes surfaced the actionable auth error string (e.g. "refresh token consumed by Codex CLI") in the provider card body. (#1202)

### Improvements
- **ux(profiles): profile chip shows spinner and name immediately when switching** — The profile chip now gives instant visual feedback on click: the new profile name appears immediately (optimistic update), a small spinner appears on the icon, and the button is disabled to prevent double-clicks. All are cleaned up in a `finally` block so the UI never gets stuck in a loading state. On error, the chip reverts to the previous name. Additionally, the model dropdown fetch and workspace list fetch are now parallelized (`Promise.all`) instead of sequential, cutting switch time roughly in half.

### Features
- **feat: YOLO mode toggle** — `/yolo` slash command and "Skip all this session" button on approval cards. Enables session-scoped approval bypass. ⚡ amber pill in composer footer shows YOLO is active. (by @bergeouss, PR #1152, closes #467)
## v0.50.225 — 2026-04-27

### Added
- **Cron job attention state** — recurring jobs that land in a broken state (`enabled=false`, `state=completed`, `next_run_at=null`) now show an amber "needs attention" badge instead of the misleading "off" badge. Detail panel shows a warning banner with Resume & recalculate, Run once, and Copy diagnostics actions. Korean locale translated. (`static/panels.js`, `static/style.css`, `static/i18n.js`) [#1133 @franksong2702]

### Fixed
- **Image attachments: composer tray thumbnails** — pasted/dragged images now show as 56×56 thumbnail chips in the composer instead of paperclip pills. Blob URL revoked on remove. (`static/ui.js`, `static/style.css`) [#1135]
- **Image attachments: chat history inline** — uploaded images in sent messages now load correctly via `api/file/raw?session_id=SID&path=FILENAME` instead of the broken `api/media?path=FILENAME` path. Click any image to open a lightbox overlay (dark backdrop, 90vw/90vh, × or Escape to close). (`static/ui.js`, `static/style.css`) [#1135] Closes #1095
- **pytest state isolation** — `conftest.py` now uses direct assignment for `HERMES_WEBUI_STATE_DIR` / `HERMES_HOME` / `HERMES_WEBUI_DEFAULT_WORKSPACE` so tests importing `api.config` in the pytest process cannot inherit the real `~/.hermes/webui` state tree. (`tests/conftest.py`) [#1136 @franksong2702]

## v0.50.223 — 2026-04-26

### Added
- **Drag & drop workspace files into composer** — files and folders in the workspace file tree are now draggable; dropping them into the chat composer inserts an `@path` reference at the cursor with smart spacing. OS file drag-and-drop (attach files) still works as before. (`static/ui.js`, `static/panels.js`) [#1123 @bergeouss] Closes #1097
- **Composer placeholder reflects active profile** — when a named profile is active (not `default`), the composer placeholder and title bar show the profile name (capitalised) instead of the global `bot_name`; falls back to `bot_name`/Hermes for the default profile. (`static/boot.js`, `static/panels.js`) [#1122 @bergeouss] Closes #1116

### Fixed
- **Copy buttons — clipboard-write Permissions-Policy** — added `clipboard-write=(self)` to the `Permissions-Policy` header so Firefox allows `navigator.clipboard.writeText()`. Extracted `_fallbackCopy()` with explicit `focus()` before `select()` and correct visible-but-hidden positioning (no more `-9999px` offscreen failure). (`api/helpers.py`, `static/ui.js`) [#1125 @bergeouss] Closes #1096
- **Model picker shows all configured providers** — `XAI_API_KEY` and `MISTRAL_API_KEY` env vars now map to `x-ai` and `mistralai` respectively. Providers configured in `config.yaml` under `providers:` are also detected and shown in the model picker. (`api/config.py`) [#1126 @bergeouss] Partially closes #604
- **api() retries on stale keep-alive after idle** — after a long idle period, `fetch()` throws a `TypeError` when the TCP connection has been dropped by a NAT or proxy timeout. `api()` in `workspace.js` now retries up to 3 times on `TypeError` only; 4xx/5xx HTTP errors and 401 redirects are not retried. (`static/workspace.js`) [#1121 @bergeouss] Closes #1118
- **Google Fonts allowed in CSP** — Mermaid themes inject `@import url(fonts.googleapis.com)` at render time; the CSP `style-src` and `font-src` directives now include `fonts.googleapis.com` and `fonts.gstatic.com`. (`api/helpers.py`) [#1121 @bergeouss] Closes #1112

## v0.50.221 — 2026-04-26

### Fixed
- **Custom providers model dropdown** — models dict keys in `custom_providers[].models` now all appear in the dropdown; previously only the singular `model` field was read. (`api/config.py`) [#1111 @bergeouss] Closes #1106
- **Custom providers SSRF false positive** — hostnames from user-configured `custom_providers[].base_url` are now trusted through the SSRF check; local inference servers (llama.cpp, vLLM, TabbyAPI) no longer blocked. (`api/config.py`) [#1113 @bergeouss] Closes #1105
- **Mobile/iPad session navigation** — tap no longer fails on first touch; replaced hover-triggered layout-shift pattern with `onpointerup` + right/middle-click filter + `touch-action:manipulation`. Desktop hover padding restored via `@media (hover:hover)` so mouse users are unaffected. (`static/sessions.js`, `static/style.css`) [#1110 @sheng-di]
- **Pasted/dragged images render inline** — image attachments now show as `<img>` with click-to-fullscreen instead of a paperclip badge. Hoisted `_IMAGE_EXTS` to module scope (was causing `ReferenceError` in `renderMessages`); added `avif` support. (`static/ui.js`) [#1109 @bergeouss] Closes #1095
- **Copy buttons on HTTP** — `_copyText()` helper checks `isSecureContext` and falls back to `execCommand('copy')` for plain-HTTP self-hosted installs. Silent failure in `addCopyButtons` fixed with error feedback. All 6 locales get `copy_failed` key. (`static/ui.js`, `static/i18n.js`) [#1107 @bergeouss] Closes #1096


## v0.50.220 — 2026-04-26

### Fixed
- **Workspace panel collapse priority** — as the right panel narrows, the git badge now disappears first (below 220px), the "Workspace" label second (below 160px), and the icon buttons survive the longest. Previously `.panel-header` used `justify-content:space-between` with no flex-shrink ratios, compressing all three children simultaneously. Fix: declare `.rightpanel` as a `container-type:inline-size` container, replace `space-between` with `gap:6px` + `flex-shrink` ladder (icons=0, label=2, badge=3), and add `@container rightpanel` queries. (`static/style.css`) [#1089]
- **Project color dot truncated/invisible on long titles** — the colored project marker on session items was appended inside `.session-title` (`overflow:hidden;text-overflow:ellipsis`), so long titles clipped the dot off entirely. Fix: move dot to a flex sibling in `.session-title-row` between title and timestamp; move `.session-time` from `position:absolute` to `margin-left:auto` in flex flow; reduce desktop rest padding-right from 86px to 8px (no longer reserving space for an absolute timestamp); mobile rest padding-right from 86px to 40px (same fix). (`static/sessions.js`, `static/style.css`) [#1089]
## v0.50.219 — 2026-04-26

### Fixed
- **Project context menu transparent background** — the right-click menu on project chips no longer bleeds the session list through it. `_showProjectContextMenu` was using `background: var(--panel)`, but `--panel` is not defined in this codebase — CSS fell back to `transparent`. Fix: use `var(--surface)` (same opaque variable used by `.session-action-menu` and other floating popovers). (`static/sessions.js`) [#1086]
- **Project rename / create input auto-sizing** — the rename and new-project input is no longer fixed at 100px. CSS changed to `min-width:40px; max-width:180px; width:auto`. New `_resizeProjectInput()` helper measures the current value via a hidden span (font properties read from `getComputedStyle`) and updates the pixel width as the user types. Wired into both `_startProjectRename` and `_startProjectCreate`. (`static/sessions.js`, `static/style.css`) [#1086]
## v0.50.218 — 2026-04-26

### Fixed
- **Long URL / unbreakable string overflow** — chat bubble boundaries no longer overflow when a message contains very long URLs, file paths, or base64 data. `overflow-wrap: anywhere` added to `.msg-body` and the user-bubble variant so continuous non-whitespace text wraps at the column edge instead of bleeding into adjacent layout areas. (`static/style.css`) Closes #1080 [#1081]
- **Project chip rename now works** — double-clicking a project chip now reliably triggers the rename input. Root cause: `onclick` was calling `renderSessionListFromCache()` which destroyed the chip DOM node before `ondblclick` could fire. Fixed with a 220ms `_clickTimer` delay on `onclick` (same pattern used by session items), so a double-click cancels the single-click and invokes rename instead. (`static/sessions.js`) Closes #1078 [#1082]
- **Block-level constructs inside blockquotes** — fenced code blocks, headings, horizontal rules, and ordered lists inside blockquotes now render correctly; `&gt;`-entity-encoded blockquotes from LLM output also render correctly (entity decode moved before the blockquote pre-pass). New pre-pass walks lines fence-aware, strips `>` prefix, recursively renders stripped content with the full pipeline, stashes rendered HTML with `\x00Q` token. (`static/ui.js`, `static/style.css`) [#1083]

### Added
- **Project color picker** — right-clicking a project chip now shows a context menu with Rename, a row of color swatches, and Delete. Selecting a swatch updates the project color via `/api/projects/rename`. (`static/sessions.js`) Closes #1078 [#1082]
## v0.50.217 — 2026-04-26

### Fixed
- **`/queue`, `/interrupt`, `/steer` send normally when agent is idle** — typing any of these commands while nothing is running now sends the message as a normal turn instead of showing an error toast. Matches CLI behaviour: commands are mode-sensitive (queue/interrupt/steer when busy, plain send when idle). `/stop` when idle still shows the error — stopping nothing is always an error. (`static/commands.js`) [#1076]

## v0.50.216 — 2026-04-26

### Added
- **Compression chain collapse** — `get_importable_agent_sessions()` now merges linear compression continuation chains into a single sidebar entry, showing the chain tip's activity time and model. The chain root's title and start time are preserved for display; the latest importable segment is used for import. Non-compression parent/child pairs are unchanged. (`api/agent_sessions.py`, `tests/test_gateway_sync.py`) Closes #1012 [#1012 @franksong2702]
- **Comprehensive markdown renderer improvements** — blockquote grouping, strikethrough, task lists, CRLF normalisation, nested blockquotes, lists inside blockquotes. See details below. (`static/ui.js`) [#1073]

### Fixed
- **Blockquote rendering** — consecutive `> lines` now group into one `<blockquote>`, blank `>` continuation lines become `<br>`, bare `>` (no space) handled, `>>` nested blockquotes recurse correctly, lists inside blockquotes render `<ul>`, inline markdown (bold/italic/code) works inside quotes. (`static/ui.js`) [#1073]
- **Strikethrough** — `~~text~~` now renders as `<del>text</del>` in all contexts (paragraphs, blockquotes, list items). (`static/ui.js`) [#1073]
- **Task lists** — `- [x]` renders as ✅, `- [ ]` renders as ☐ in all unordered list contexts including inside blockquotes. (`static/ui.js`) [#1073]
- **CRLF line endings** — Windows `\r\n` line endings are normalised at the start of `renderMd()` so `\r` never appears in rendered text. (`static/ui.js`) [#1073]
- **HTML/HTM preview in workspace** — `.html` and `.htm` files now render correctly in the workspace preview iframe. Root cause: `MIME_MAP` was missing these extensions; the fallback `application/octet-stream` caused browsers to refuse to render in the iframe. (`api/config.py`) [#1070]
- **Approval card obscured by queue flyout** — the approval card's "Allow once / Allow session / Always allow / Deny" buttons are no longer hidden behind the queue flyout when both are visible simultaneously. (`static/style.css` — one line: `z-index:3` on `.approval-card.visible`) [#1071]
- **`/steer`, `/interrupt`, `/queue` not working while agent is busy** — typing these commands while the agent is running now executes them immediately instead of queuing the raw text. Root cause: `send()` returned early inside the busy block before reaching the slash-command dispatcher. Fix: intercept the three control commands at the top of the busy block. (`static/messages.js`) [#1072]
- **Reasoning chip always visible** — the composer reasoning chip is now shown for all effort states. When effort is unset/default it shows a muted "Default" label; when explicitly set to `none` it shows "None". Previously both states hid the chip entirely, removing the affordance to inspect or change it. (`static/ui.js`, `static/style.css`) Closes #1068 [#1074 @franksong2702]
- **Steer settings copy updated** — removed "falls back to interrupt" / "interrupt + send" language across all 6 locales; steer mode now correctly described as "mid-turn correction without interrupting". (`static/i18n.js`, `static/index.html`) [#1072]

## v0.50.215 — 2026-04-26

### Added
- **Real `/steer` command** — wires `/steer <text>` through the agent's thread-safe `agent.steer()` method rather than falling back to interrupt. Steer text is stashed in `_pending_steer` and injected into the next tool-result boundary without interrupting the current run, giving the agent a mid-turn course correction. New `/api/chat/steer` POST endpoint with five graceful fallback reasons (`no_cached_agent`, `agent_lacks_steer`, `session_not_found`, `not_running`, `stream_dead`) — any fallback transparently falls back to the existing interrupt+queue mechanism. (`api/routes.py`, `api/streaming.py`, `static/commands.js`, `static/messages.js`, `static/i18n.js`) Closes #720 follow-up [#1066 @nesquena]
- **Steer leftover delivery** — if the agent finishes its turn before hitting a tool boundary, the stashed steer text is drained and emitted as a `pending_steer_leftover` SSE event; the frontend queues it as a next-turn message, mirroring the CLI's existing leftover path. (`api/streaming.py`, `static/messages.js`) [#1066]

### Fixed
- **Pending files preserved on steer→interrupt fallback** — the busy-mode steer path in `send()` now defers `S.pendingFiles=[]` until after `_trySteer()` returns, so staged file attachments are not lost when the steer endpoint falls back to interrupt+queue. (`static/messages.js`)

## v0.50.214 — 2026-04-26

### Added
- **Busy input mode setting** — new `Settings → Preferences → Busy input mode` dropdown with three options: `Queue` (default, preserves existing behavior), `Interrupt` (cancel the current stream and re-send immediately), `Steer` (placeholder for future mid-stream injection, currently falls back to Interrupt with a toast). (`api/config.py`, `static/messages.js`, `static/boot.js`, `static/panels.js`, `static/index.html`, `static/i18n.js`) Closes #720 [#1062 @bergeouss]
- **`/queue`, `/interrupt`, `/steer` slash commands** — per-message overrides for the busy mode regardless of the current setting. `/queue <msg>` enqueues explicitly; `/interrupt <msg>` cancels the current turn and re-sends; `/steer <msg>` same today with a future-upgrade toast. (`static/commands.js`) [#1062 @bergeouss]

### Fixed
- **`/queue` command double-bubble** — missing `noEcho:true` caused the raw slash text to be echoed as a user bubble, then the drained message appeared again as a second bubble. (`static/commands.js`)
- **Staged-file duplication via slash commands** — `cmdQueue`, `cmdInterrupt`, and `cmdSteer` captured `S.pendingFiles` but never cleared the tray, so staged files were re-attached on the next send. Added `S.pendingFiles=[];renderTray()` after enqueue in all three handlers. (`static/commands.js`)

## v0.50.213 — 2026-04-26

### Fixed
- **Models disk cache now isolated per server instance** — moved from `/dev/shm/hermes_webui_models_cache.json` (shared across all processes) to `STATE_DIR/models_cache.json`. Each server instance (port 8787 production, port 8789 QA, test runs) has its own cache file, so test/staging environments can no longer overwrite the production model list on the next restart. Also fixes macOS/Windows where `/dev/shm` doesn't exist. (`api/config.py`) [#1064]

## v0.50.212 — 2026-04-26

### Performance
- **Model list ~1ms on restart** — `get_available_models()` now writes to a disk cache at `/dev/shm` on every cold rebuild and reads it back on restart, eliminating the ~30s Z.AI endpoint-probe delay on every server start. TTL raised from 60s to 24h. (`api/config.py`) [#1060 @JKJameson]
- **Thundering-herd prevention** — RLock + `_cache_build_in_progress` flag ensures only one thread runs the cold rebuild while others wait on a Condition variable instead of triggering duplicate 10s provider calls. (`api/config.py`) [#1060 @JKJameson]
- **Credential pool cache** — `load_pool()` results cached per provider (24h TTL) to avoid repeated expensive auth-store reads on every model list refresh. (`api/config.py`) [#1060 @JKJameson]

### Fixed
- **Stale SSE blocking** — switching sessions now discards in-flight SSE tokens from the previous session before attaching the new one; no cross-session token bleed. (`static/sessions.js`) [#1060 @JKJameson]
- **Pending files cleared after send** — ghost attachments no longer appear in the composer tray after sending. (`static/sessions.js`) [#1060 @JKJameson]
- **Textarea focus on session switch** — message input automatically focused after switching sessions. (`static/sessions.js`) [#1060 @JKJameson]
- **Instant click for inactive sessions** — no loading spinner blocking fast repeated session switches. (`static/sessions.js`) [#1060 @JKJameson]
- **Double-click titlebar to rename** — session title can be renamed by double-clicking the active session in the sidebar. (`static/sessions.js`) [#1060 @JKJameson]
- **Draft persistence across switches** — composer draft saved/restored when switching sessions. (`static/panels.js`) [#1060 @JKJameson]
- **user-select:none on session titles** — prevents accidental text selection on double-click. (`static/style.css`) [#1060 @JKJameson]
- **Cache disk-delete in invalidate_models_cache()** — `invalidate_models_cache()` now also removes the on-disk snapshot so test isolation is preserved and stale cached data is never served after invalidation. (`api/config.py`)
- **_cache_build_in_progress reset on exception** — rebuild exceptions no longer leave the flag stuck, which would block waiting threads for 60s. (`api/config.py`)

## v0.50.211 — 2026-04-25

### Changed
- **Compact sidebar timestamps** — session timestamps in the left sidebar now show short labels (`1m`, `6m`, `1h`, `1d`, `1w`) instead of verbose strings like "6 minutes ago". Keeps all existing i18n paths; bucket headers (Today, Yesterday, This week) unchanged. (`static/sessions.js`, `static/i18n.js`) [#1057 @pavolbiely]

### Added
- **Adaptive session title refresh** — new opt-in setting (`Settings → Preferences → Adaptive title refresh`) re-generates the session title from the latest exchange every N turns (5, 10, or 20). Off by default. Runs in a daemon thread after stream end, never blocks the stream. Manual title renames are preserved (double-checked before and after LLM call). (`api/streaming.py`, `api/config.py`, `static/panels.js`, `static/i18n.js`, `static/index.html`) [#1058 @bergeouss]

### Fixed
- **Settings picker active state** — theme, skin, and font-size picker cards in Settings → Appearance now correctly highlight the selected option. Root cause: the base CSS rule used `!important` on `border-color`, overriding the inline style set by `_syncThemePicker()` and siblings. Fix moves to an `.active` class with its own `!important` rule. (`static/style.css`, `static/boot.js`) [#1059]

## v0.50.210 — 2026-04-25

### Added
- **gpt-5.5 and gpt-5.5-mini in model picker** — available for openai, openai-codex, and copilot providers. (`api/config.py`) [#1052 @aliceisjustplaying]
- **Login redirects back to original URL after re-login** — the iOS PWA auth redirect now passes `?next=` with the current path; `login.js` honors it via a `_safeNextPath()` helper that guards against open-redirect (rejects `//`, backslash, and non-path-absolute inputs). (`static/login.js`, `static/ui.js`, `static/workspace.js`) [#1053]

### Fixed
- **Non-standard provider first-run experience** — agent dir discovery now searches XDG_DATA_HOME, `/opt`, `/usr/local` paths; onboarding wizard auto-completes for non-wizard providers (ollama-cloud, deepseek, xai, kimi-k2.6) with `provider_configured=True`; wizard model field no longer hardcodes `gpt-5.4-mini` literal; session model resolver correctly handles unlisted active providers. (`api/config.py`, `api/onboarding.py`, `api/routes.py`) Closes #1019–#1023 [#1049]
- **Cron session titles in sidebar** — cron-launched sessions now display the human-friendly job name (from `~/.hermes/cron/jobs.json`) instead of a generic "Cron Session" label. (`api/models.py`, `api/routes.py`) [#1050 @waldmanz]
- **AIAgent reused per session — fixes Honcho first-turn injection** — `AIAgent` is now cached per `session_id` so the agent's turn counter increments correctly across messages. Cache is evicted on session delete/clear. (`api/config.py`, `api/routes.py`, `api/streaming.py`) Closes #1039 [#1051 @qxxaa]
- **Mermaid Google Fonts CSP violation suppressed** — `fontFamily:'inherit'` in Mermaid themeVariables prevents `@import url('fonts.googleapis.com')` from being injected into diagram SVGs. (`static/ui.js`) Closes #1044 [#1054]
- **bfcache layout and dropdown restore** — `pageshow+event.persisted` handler re-syncs topbar, workspace panel, session list, and gateway SSE; also closes open composer dropdowns frozen by bfcache. `_initResizePanels()` removed from pageshow (bfcache preserves listeners). (`static/boot.js`) Closes #1045 [#1055]

## v0.50.209 — 2026-04-25

### Added
- **Codex-style message queue flyout** — messages typed while a stream is running now appear as a flyout card above the composer (same pattern as approval/clarify cards). Supports drag-to-reorder, inline edit, per-item model badge, Combine/Clear actions, and a collapsed pill outside the composer. Per-session DOM isolation via `_queueRenderKeys[sid]`/`_queueCollapsed[sid]` prevents cross-session bleed. Titlebar `#appTitlebarSub` chip shows live queue count. (`static/ui.js`, `static/messages.js`, `static/style.css`, `static/i18n.js`, `static/index.html`) Closes #965 [#1040 @24601]
- **Inline HTML preview in workspace panel** — `.html` and `.htm` files now render as live sandboxed iframes (`sandbox="allow-scripts"`, no `allow-same-origin`) in the workspace file browser. A `?inline=1` parameter on `/api/file/raw` bypasses the usual attachment disposition; the server adds `Content-Security-Policy: sandbox allow-scripts` on inline HTML responses to prevent XSS when the URL is opened directly in a browser tab. (`static/workspace.js`, `api/routes.py`, `static/index.html`) Closes #779 [#1035 @bergeouss]
- **Provider categories in setup wizard** — the onboarding provider dropdown groups 10 providers into Easy Start / Open & Self-hosted / Specialized with `<optgroup>` sections. Includes Google Gemini, DeepSeek, Mistral, and xAI/Grok with correct current model defaults. (`api/onboarding.py`, `static/onboarding.js`) Closes #603 [#1036 @bergeouss]

### Fixed
- **Manual "Check for Updates" button in System settings** — users can now trigger an update check immediately instead of waiting for the periodic background fetch. Error messages are sanitized before display. (`static/panels.js`, `static/index.html`, `static/style.css`) Closes #785 [#1033 @bergeouss]
- **"Keep workspace panel open" toggle in Appearance settings** — adds a persistent preference so the workspace panel opens automatically on each session if preferred. The toolbar X no longer clears the preference. (`static/panels.js`, `static/boot.js`) Closes #999 [#1034 @bergeouss]

### Changed
- **CSP allowlist for Cloudflare Access deployments** — `default-src` and `manifest-src` now include `https://*.cloudflareaccess.com`, and `script-src` now includes `https://static.cloudflareinsights.com`. This unblocks Agent37-style deployments running behind Cloudflare Access without affecting vanilla self-hosters (the new origins are unreachable in non-Cloudflare environments). (`api/helpers.py`) [#1040 follow-up]

## v0.50.207 — 2026-04-25

### Added
- **Live TPS stat in header** — a monospace chip in the titlebar shows tokens per second during streaming, with HIGH watermark from the past hour. Emitted via SSE at 1 Hz during active streams; hidden when idle. (`api/metering.py`, `api/streaming.py`, `static/messages.js`, `static/style.css`) [#1005 @JKJameson]

### Fixed
- **Stale SSE events no longer pollute the new session's DOM on session switch** — `appendThinking()` and `appendLiveToolCard()` now guard against events from a prior session's stream arriving after the user has switched sessions. Thinking card also auto-scrolls to top on completion so the response is immediately visible. (`static/ui.js`) [#1006 @JKJameson]
- **Show agent sessions no longer shows empty/unimportable rows** — `state.db` can contain agent session rows before any messages are written. The sidebar now filters those out consistently across both the regular `/api/sessions` path and the gateway SSE watcher. (`api/agent_sessions.py`, `api/gateway_watcher.py`, `api/models.py`) [#1009 @franksong2702]
- **Three orphaned i18n keys removed from language dropdown** — `cmd_status`, `memory_saved`, and `profile_delete_title` were placed outside any locale block in `static/i18n.js`, causing them to appear as invalid language options. (`static/i18n.js`) [#1010 @bergeouss]
- **Cron panel UX polish** — Resume button SVG now uses a ▶| icon to distinguish it from Run; toast overlap fixed with `z-index` on the header; running-state badge with spinner shows during active jobs; `_cronRunningPoll` clears correctly on panel close. (`static/panels.js`, `static/index.html`, `static/style.css`, `static/i18n.js`) [#1011 @bergeouss]
- **Create Folder and Add as Space from the browser** — users can now create directories and immediately register them as workspace spaces without SSH access; server validates paths against blocked roots before `mkdir`. (`api/routes.py`, `static/ui.js`, `static/panels.js`, `static/i18n.js`) [#1018 @bergeouss]
- **Model-not-found errors now show a helpful message** — when a provider returns a 404 (e.g. Qwen model not available), the error is classified and a user-friendly hint appears instead of a raw HTML page. All 6 locales covered. (`api/streaming.py`, `static/messages.js`, `static/i18n.js`) [#1022 @bergeouss]
- **Session attention indicators moved to right-side actions slot** — streaming spinners and unread dots no longer sit before the session title, avoiding title shifts. Running/unread rows hide the timestamp; idle/read rows keep right-aligned timestamps. Date group carets now point down/right correctly. Pinned group no longer repeats the star icon per row. (`static/sessions.js`, `static/style.css`) [#1024 @franksong2702]
- **Session sidebar dates now use the last real message time** — sorting, grouping, and relative timestamps prefer `last_message_at` derived from the last non-tool message instead of metadata-only `updated_at`, so changing session settings doesn't move old conversations to Today. (`api/models.py`, `api/routes.py`) [#1024 @franksong2702]
- **Running indicators appear immediately after send** — the sidebar now treats the active local busy session and local in-flight sessions as streaming while `/api/sessions` catches up. (`static/messages.js`, `static/sessions.js`) [#1024 @franksong2702]
- **Large session switching and reload no longer block on cold model-catalog resolution** — `GET /api/session?messages=0` now parses only the JSON metadata prefix; metadata-only loads skip the full-session LRU cache; the frontend lazy fetch passes `resolve_model=0`; hard reload no longer waits for `populateModelDropdown()`. (`api/models.py`, `api/routes.py`, `static/boot.js`, `static/sessions.js`, `static/ui.js`) [#1025 @franksong2702]
- **Auto title generation hardened for reasoning models** — title generation now uses a 512-token reasoning-safe budget, retries once with 1024 tokens on empty content or `finish_reason: length`, and preserves the underlying failure reason in `title_status` when falling back to a local summary. (`api/streaming.py`) [#1026 @franksong2702]

## v0.50.206 — 2026-04-25

### Fixed
- **Uploaded files now resolve to their full workspace path in agent context** — drag-and-drop and paperclip file uploads were correctly saved to the workspace, but the agent received only the bare filename (e.g. `photo.jpg`) in the message context rather than an absolute path. The agent could not call `read_file` or `vision_analyze` without a full path. `uploadPendingFiles()` now returns `{name, path}` objects from the `/api/upload` response (`data.path` was always returned but never threaded through). The agent message uses the full path; all display surfaces (badges, session history, INFLIGHT state, POST body) continue showing only the bare filename. (`static/ui.js`, `static/messages.js`) Closes #996. [#997]

## v0.50.205 — 2026-04-24

### Fixed
- **Workspace add: allow external paths not under home directory** — adding a workspace path such as `/mnt/d/Projects` (WSL) or any directory outside `$HOME` was blocked by a circular dependency: `resolve_trusted_workspace()` required the path to already be in the saved workspace list, but saving it required passing the same check. A new `validate_workspace_to_add()` function is now used by `/api/workspaces/add` — it only rejects non-existent paths, non-directories, and known system roots. The stricter `resolve_trusted_workspace()` continues to gate actual file read/write operations within a workspace. (`api/workspace.py`, `api/routes.py`) Closes #953. [#991]

## v0.50.204 — 2026-04-24

### Fixed
- **Docker: HERMES_HOME corrected from `/root/.hermes` to `/home/hermes/.hermes`** — `docker-compose.two-container.yml` and `docker-compose.three-container.yml` both set `HERMES_HOME=/root/.hermes` and mounted the shared `hermes-home` volume to `/root/.hermes`. The `nousresearch/hermes-agent` image drops privileges to a `hermes` user (uid=10000) via `gosu`, after which `/root` is mode `700` and inaccessible — causing `mkdir: cannot create directory '/root': Permission denied` on every startup. Fixed to use `/home/hermes/.hermes` throughout. (`docker-compose.two-container.yml`, `docker-compose.three-container.yml`) Closes #967. [#989]

## v0.50.203 — 2026-04-24

### Fixed
- **Queue drain race condition — drain the correct session after cross-session stream completion** — `setBusy(false)` was draining `S.session.session_id` (the *currently viewed* session) rather than the session that just finished streaming. When the user switched sessions mid-stream, queued follow-up messages for the original session were silently dropped. A new `_queueDrainSid` variable is set to `activeSid` just before calling `setBusy(false)` in all stream terminal handlers; `setBusy()` reads it once and clears it. (`static/messages.js`, `static/ui.js`, `tests/test_regressions.py`) By @24601. [#964]

## v0.50.202 — 2026-04-24

### Fixed
- **Throttle inflight localStorage persist to prevent GC crash** — `saveInflightState()` was called on every token, doing `JSON.parse` + mutate + `JSON.stringify` + `localStorage.setItem` on the full inflight state map. At 60 tok/s with a 10KB messages array this produced ~36MB of JSON churn per second, the primary GC pressure source causing Chrome renderer crashes (error codes 4/5). A `_throttledPersist()` wrapper now batches writes to at most once per 2 seconds. State transitions (done/apperror/cancel/error) still flush synchronously so no more than 2s of progress is lost on a crash. (`static/messages.js`) By @24601. [#972]

## v0.50.201 — 2026-04-24

### Fixed
- **Streaming render cleanup: call `clearTimeout` at all `_pendingRafHandle` sites** — PR #966's render-throttling logic uses `setTimeout(→rAF)` when within the 66ms budget window, so `_pendingRafHandle` can hold a `setTimeout` ID rather than a `requestAnimationFrame` ID. All four cleanup sites only called `cancelAnimationFrame()`, which is a no-op for `setTimeout` handles, leaving stale callbacks that could fire after stream finalization. Fixed to call both `clearTimeout()` and `cancelAnimationFrame()` (each is a no-op on the other's handle type). (`static/messages.js`) [#985]

## v0.50.200 — 2026-04-24

### Changed
- **Session render cache — skip O(n) rebuild on back-navigation** — `renderMessages()` now caches rendered HTML per session (keyed by `session_id` + message count). Switching back to a previously-rendered session serves the cached DOM instantly instead of running a full markdown parse, Prism highlight, and KaTeX pass over every message. Cache is limited to 8 sessions and 300KB of rendered HTML per entry. Active streaming sessions always bypass the cache. (`static/ui.js`) By @24601. [#963]

## v0.50.199 — 2026-04-24

### Fixed
- **Streaming renderer crash under GC pressure** — `_scheduleRender()` previously used `requestAnimationFrame` (up to 60fps), but each DOM update takes 50–150ms on large sessions. During GC pauses, rAF callbacks accumulated and then fired sequentially, blocking the main thread for seconds and crashing the renderer (Chrome error codes 4/5, ERR_CONNECTION_RESET). The render rate is now capped at ~15fps (66ms min interval) via a `setTimeout` → `requestAnimationFrame` chain. Stream cleanup now calls both `clearTimeout()` and `cancelAnimationFrame()` so the handle is correctly cancelled regardless of which path scheduled it. (`static/messages.js`) By @24601. [#966]

## v0.50.198 — 2026-04-24

### Fixed
- **`_accepts_gzip()` hardened for test harness** — `handler.headers.get()` now uses `getattr(handler, 'headers', None)` so any synthetic handler without a `headers` attribute (including the `_FakeHandler` used in session-compress tests) no longer throws `AttributeError`. (`api/helpers.py`)
- **Stale test assertions updated post-#959** — two static-analysis assertions in `test_issue401.py` and `test_regressions.py` referenced minified JS string patterns that PR #959 reformatted; updated to accept either form. (`tests/test_issue401.py`, `tests/test_regressions.py`) [#981]

## v0.50.197 — 2026-04-24

### Changed
- **Complete Traditional Chinese (zh-Hant) translations** — adds full zh-Hant locale coverage (300+ translation entries) across all UI sections. Fixes mixed Simplified/Traditional character inconsistency in the existing zh translations. Also adds English-fallback entries to zh/ru/es/de for newly-added session management and settings keys (session_archive, session_pin, session_duplicate, settings_dropdown_*, etc.). (`static/i18n.js`) By @ruxme. [#954]

## v0.50.196 — 2026-04-24

### Fixed
- **Fast conversation switching with metadata-first session load** — switching between conversations in the sidebar now does a two-phase load: phase 1 fetches only metadata (title, model, timestamps) instantly, then phase 2 lazily loads the full message history. Backend `Session.save()` reorders JSON fields so metadata appears before the messages array, enabling a 1KB prefix-read path for small sessions. JSON responses over 1KB are gzip-compressed (4x smaller for large histories). Includes `try/catch` in `_ensureMessagesLoaded` so network errors show "Failed to load" rather than a stuck "Loading conversation…" state. (`api/models.py`, `api/helpers.py`, `api/routes.py`, `static/sessions.js`) By @JKJameson. [#959]

## v0.50.195 — 2026-04-24

### Fixed
- **Auth sessions now persist across server restarts** — previously `_sessions` was an in-memory dict, so every process restart (launchd, systemd, container recycle) invalidated all browser sessions and forced users to log in again. Sessions are now atomically persisted to `STATE_DIR/.sessions.json` (0600 permissions) via a temp-file + `os.replace()` write pattern. Expired sessions are pruned on load. Corrupt or missing session files start fresh without crashing. (`api/auth.py`, `tests/test_auth_session_persistence.py`) By @24601. [#962]

## v0.50.194 — 2026-04-24

### Fixed
- **Prevent dropped characters in incremental streaming-markdown path** — detects parser/text prefix desync in `_smdWrite()` (which can occur after stream sanitization strips content mid-stream) and rebuilds the parser from the full current display text rather than continuing to slice from a stale offset. Adds `_smdWrittenText` tracking variable for accurate prefix-alignment checks. (`static/messages.js`) By @bsgdigital. [#960]

## v0.50.193 — 2026-04-24

### Fixed
- **Strip malformed DSML `function_calls` tags from DeepSeek/Bedrock responses** — extends the existing XML tool-call stripping logic to handle DeepSeek's DSML-prefixed variants (`<｜DSML｜function_calls>`, `<｜DSML |function_calls`, and fragmented `<｜DSML |` tokens) in backend (`api/streaming.py`), live streaming (`static/messages.js`), and settled render (`static/ui.js`). Prevents raw function-call XML from leaking into message content. (`api/streaming.py`, `static/messages.js`, `static/ui.js`) By @bsgdigital. [#958]

## v0.50.192 — 2026-04-24

### Changed
- **`defer` attribute added to all local script tags** — scripts already sit at the end of `<body>` so this is largely a belt-and-suspenders improvement, but `defer` makes the intent explicit and allows browsers to start parsing before the DOM is fully ready without blocking. Execution order preserved (defer is order-preserving per spec). (`static/index.html`) By @ruxme. [#951]

## v0.50.191 — 2026-04-24

### Fixed
- **WebUI sessions now pass `platform='webui'` to Hermes Agent** — previously all browser-originated sessions passed `platform='cli'`, causing the agent to inject CLI-specific guidance ("avoid markdown, use plain text") that degraded WebUI output quality. Changed to `platform='webui'` in all three AIAgent call sites (`api/streaming.py`, `api/routes.py`). `'webui'` has no entry in `PLATFORM_HINTS` so no conflicting platform guidance is injected. Includes regression tests. (`api/streaming.py`, `api/routes.py`, `tests/test_webui_platform_hint.py`) By @starship-s. [#948]

## v0.50.190 — 2026-04-24

### Fixed
- **`.venv` discovery in `_discover_python()`** — adds `.venv/bin/python` (Linux/macOS) and `.venv/Scripts/python.exe` (Windows) alongside the existing `venv/` paths, fixing issue #938 where setups using a `.venv` directory failed silently to locate the Hermes agent interpreter. (`api/config.py`) By @xingyue52077. Closes #938. [#949]

## v0.50.189 — 2026-04-24

### Fixed
- **CSP: explicit `manifest-src 'self'` directive** — adds `manifest-src 'self'` to the `Content-Security-Policy` header. Browsers fall back to `default-src` when `manifest-src` is absent (functionally correct), but being explicit satisfies strict CSP audits and avoids browser-specific deviations. Includes regression test. (`api/helpers.py`, `tests/test_pwa_manifest_csp.py`) By @24601. [#961]

## v0.50.189 — 2026-04-24

### Fixed
- **CSP: explicit `manifest-src 'self'` directive** — adds `manifest-src 'self'` to the `Content-Security-Policy` header. Browsers fall back to `default-src` when `manifest-src` is absent (functionally correct), but the explicit directive satisfies strict CSP audits and avoids any browser-specific deviation. Includes regression test. (`api/helpers.py`, `tests/test_pwa_manifest_csp.py`) By @24601. [#961]

## v0.50.188 — 2026-04-24

### Fixed
- **`/btw` command: corrected SSE endpoint** — `attachBtwStream()` was connecting to `/api/stream` (which has never existed), causing every `/btw` invocation to get a 404 and produce no answer. Fixed to `/api/chat/stream`. Also aligned the `EventSource` constructor to use `URL()` + `withCredentials:true` for consistency with the rest of `static/messages.js`. (`static/messages.js`) By @bergeouss. Closes #945. [#950]

## v0.50.187 — 2026-04-24

### Fixed
- **Rail/hamburger breakpoint gap closed** — at 641–767px the rail was hidden (required ≥768px) and the hamburger was also hidden (only ≤640px), leaving an awkward in-between zone. Rail breakpoint moved to ≥641px so the rail appears alongside the persistent sidebar at medium widths. Mobile slide-in behavior (hamburger toggle, overlay scrim) is unchanged at ≤640px. (`static/style.css`) [#956]

## v0.50.186 — 2026-04-24

### Changed
- **Three-column layout with left rail + main-view migration** — unifies the shell into a rail (48px, desktop-only) + sidebar + main-view canvas matching the hermes-desktop reference. Every per-item detail/edit surface (skills, tasks, workspaces, profiles, memory) now lives in a dedicated `#mainX` container with consistent headers, empty states, and action buttons. Settings moves out of a modal overlay into a full main-view page (ESC closes it). YAML frontmatter renders in a collapsible `<details>` block in skill detail. Toasts repositioned to top-right with theme-aware success/error/warning/info variants. Composer workspace chip split into files-icon + label buttons. `.settings-menu` → `.side-menu` / `.side-menu-item` (shared by memory and settings panels). Mobile: hamburger in titlebar, slide-in sidebar. New i18n keys across en/ru/es/de/zh/zh-Hant for all new form labels. 9 new regression tests. (`static/index.html`, `static/style.css`, `static/panels.js`, `static/boot.js`, `static/sessions.js`, `static/ui.js`, `static/i18n.js`, `tests/test_settings_navigation_and_detail_refresh.py`) By @aronprins. [#899]

## v0.50.185 — 2026-04-24

### Fixed
- **`/btw` stream handler hardened** — `_streamDone=true` now set *before* `src.close()` in `done` and `apperror` handlers (defensive ordering); `_ensureBtwRow()` in `done` gated on session match (`S.session.session_id === parentSid`) to prevent btw bubble leaking into a different session if the user switches mid-stream; `stream_end` handler also sets `_streamDone=true` for defense-in-depth. 14 new regression tests added. (`static/messages.js`, `tests/test_reasoning_chip_btw_fixes.py`) [#935]
- **`/reasoning` toast aligned with BRAIN prefix** — success toast now reads `🧠 Reasoning effort: <level>` consistent with the command's other toasts. (`static/commands.js`) [#939]
- **Bootstrap Python discovery finds `.venv/` layout** — `discover_launcher_python` now checks both `venv/` and `.venv/` inside the agent directory, covering installations that use a leading-dot venv layout. (`bootstrap.py`) [#941]

## v0.50.184 — 2026-04-24

### Fixed
- **Reasoning chip dropdown now opens correctly** — the dropdown was placed inside `.composer-left` which has `overflow-y: hidden`, clipping the upward-opening menu entirely. Moved `#composerReasoningDropdown` outside to sit alongside the model/profile/workspace dropdowns and added `_positionReasoningDropdown()` for consistent chip-aligned positioning. Z-index raised to 200 to match other composer dropdowns. (`static/index.html`, `static/style.css`, `static/ui.js`)
- **Reasoning chip icon is now a monochrome SVG** — replaced the `🧠` emoji in the label with a `stroke="currentColor"` brain-outline SVG matching the style of all other composer chips. (`static/index.html`, `static/ui.js`)
- **`/reasoning <level>` now immediately updates the chip** — previously called `syncReasoningChip()` which re-applied the stale cached value. Now calls `_applyReasoningChip(eff)` directly with the server-confirmed effort level. (`static/commands.js`)
- **`/btw` answer no longer vanishes after rendering** — `onerror` was firing when the server cleanly closed the SSE connection after `stream_end`, removing the just-rendered answer bubble. A `_streamDone` flag now prevents `onerror` from wiping the row after a successful stream. Also added `_ensureBtwRow()` call in `done` handler so the bubble renders even if no `token` events arrived. (`static/messages.js`) Closes #933.

### Added
- **Session attention indicators in the sidebar** — the session list now shows a
  spinning indicator while a session is actively streaming (even in the
  background), an unread dot when a session has new messages the user hasn't
  seen, and a right-aligned relative timestamp ("2m ago", "Yesterday") next to
  every session title. Streaming state is computed server-side from the live
  `STREAMS` registry so it's accurate across tabs and after server restart.
  The unread count is tracked client-side in `localStorage` and cleared
  automatically when the active session's stream settles. Pinned-star indicator
  moved into the title row with a fixed 10×10 box for consistent alignment.
  Includes a 5 s polling loop that activates only while sessions are streaming,
  and a 60 s timer to keep relative timestamps fresh. (`api/models.py`,
  `static/sessions.js`, `static/messages.js`, `static/style.css`) Closes #856.
  Co-authored by @franksong2702.

### Fixed
- **Nous static models now use explicit `@nous:` prefix** — the four hardcoded "(via Nous)" models (`Claude Opus 4.6`, `Claude Sonnet 4.6`, `GPT-5.4 Mini`, `Gemini 3.1 Pro Preview`) now carry `@nous:` prefix IDs, matching the format of live-fetched Nous models. Previously they used slash-only IDs that relied on the portal provider guard; the explicit prefix routes them through the same bulletproof `@provider:model` branch and eliminates 404 errors on those entries. (`api/config.py`, `tests/test_nous_portal_routing.py`)

### Added
- **Workspace path autocomplete in Spaces** — the "Add workspace path" field in
  the Spaces panel now suggests trusted directories as you type, supports
  keyboard navigation plus `Tab` completion, and keeps hidden directories out of
  the list unless the current path segment starts with `.`. Suggestions are
  limited to trusted roots (home, saved workspaces, and the boot default
  workspace subtree) and never enumerate blocked system roots. (`api/routes.py`,
  `api/workspace.py`, `static/panels.js`, `static/style.css`) (partial for #616)

## [v0.50.232] — 2026-04-28

### Fixed
- **Model chip fuzzy-match false positive** — `_findModelInDropdown()` step-3 fuzzy fallback
  was stripping the trailing version segment and matching via `startsWith(base) || includes(base)`,
  causing `gpt-5.5` to resolve to `@nous:openai/gpt-5.4-mini` (both start with `gpt.5`). The fix
  uses the full normalized target as the prefix when `base.length > 4 && base !== target`, only
  falling back to the stripped base for bare roots (≤4 chars) where the strip was a no-op.
  (`static/ui.js`) (#1188)
- **openai-codex not detected in model picker** — `OPENAI_API_KEY` now also registers the
  `openai-codex` provider group in the env-var fallback path, so users who have Codex OAuth set up
  no longer need a manual `config.yaml` edit to see the picker entries. Note: OAuth-authenticated
  users are already detected via `hermes_cli.auth`; this fixes the env-var-only fallback path.
  (`api/config.py`) (#1189)
- **Workspace files blank after second empty-session reload** — the ephemeral-session guard in
  `boot.js` was calling `localStorage.removeItem('hermes-webui-session')`, which caused the second
  reload to fall into the no-saved-session path that never calls `loadDir()`. Removing that line
  keeps the session key so every reload follows the same `loadSession → loadDir` path.
  (`static/boot.js`) (#1196)
- **Session timestamps wrong when client and server clocks differ** — the session list's relative
  time labels and message-footer timestamps now use a server-clock approximation (`_serverNowMs()`)
  derived from the `server_time` field returned by `/api/sessions`. Fractional-hour timezone offsets
  (India `+0530`, Nepal `+0545`, etc.) are handled correctly via offset-minutes arithmetic.
  (`api/routes.py`, `static/sessions.js`) (#1144, @bergeouss)

## [v0.50.231] — 2026-04-28

### Fixed
- **macOS `/etc` symlink bypass in workspace blocked-roots** — on macOS, `/etc`, `/var`, and
  `/tmp` are symlinks to `/private/etc` etc. `_workspace_blocked_roots()` now materialises both
  the literal and `Path.resolve()` forms of every blocked root, and a new `_is_blocked_system_path()`
  helper applies the check with `/var/folders` and `/var/tmp` carve-outs so pytest `tmp_path_factory`
  paths and other legitimate per-user tmp dirs remain registerable as workspaces.
  (`api/workspace.py`, `api/routes.py`) (#1186)
- **Workspace panel stuck closed after empty-session reload** — a regression from #1182: when a
  user had the workspace panel open and reloaded the page on an empty/new session, the panel was
  force-closed and the toggle disabled. `syncWorkspacePanelState()` now only force-closes in
  `'preview'` mode (which requires a session); `'browse'` mode renders the panel chrome with a
  no-workspace placeholder. Both boot paths restore the user's localStorage panel preference before
  the sync call. (`static/boot.js`) (#1187)
- **Fenced code content leaking into markdown passes** — large tool outputs with diff/patch/log
  content (lines starting with `-`, `+`, `*`, `#` inside code blocks) were having `<ul>/<li>/<h>` tags
  injected by the list/heading regexes, breaking `</pre>` closure and corrupting subsequent message
  rendering. The fix keeps fenced blocks stashed as `\x00P<n>\x00` tokens through ALL markdown
  passes and restores them AFTER lists/headings/tables, so those regexes never see the rendered HTML.
  (`static/ui.js`) (#1154, @bergeouss)

## [v0.50.230] — 2026-04-27

### Fixed
- **No disk write for empty sessions** — `new_session()` no longer eagerly writes an empty
  JSON file to disk. The session lives in the in-memory `SESSIONS` dict only; the first disk
  write happens at the natural "this is now a real session" moment (first user message via
  `/api/chat/start`, or explicit `s.save()` in the btw/background-agent paths). Eliminates
  orphan `sessions/*.json` files that accumulated on every page reload, New Conversation click,
  or onboarding pass without sending a message. Crash-safety: if the process exits between
  create and first message, the session is lost — since it had no messages, there is nothing
  to lose. (`api/models.py`) (#1171 follow-up, #1184)

## [v0.50.229] — 2026-04-27

### Performance
- **Session switch parallelization** — directory pre-fetches use `Promise.all()` (N×RTT → 1×RTT);
  git status/ahead/behind run in parallel via `ThreadPoolExecutor(max_workers=3)`;
  `loadDir()` and `highlightCode()` overlap on the idle path.
  (`api/workspace.py`, `static/sessions.js`, `static/workspace.js`) (#1158, @jasonjcwu)

### Fixed
- **Message pagination for long conversations** — sessions with more than 30 messages load the
  most-recent 30 on switch; older messages load on scroll-to-top or the "↑ load older" indicator.
  Stale-response race in `_loadOlderMessages` closed; all undo/retry/compress/done paths reset
  pagination state. (`api/routes.py`, `static/sessions.js`, `static/ui.js`, `static/commands.js`,
  `static/i18n.js`) (#1158, @jasonjcwu)
- **Ephemeral untitled sessions never appear in sidebar** — empty Untitled sessions are now
  suppressed immediately rather than surfacing for 60 seconds. Both the index-path and full-scan
  fallback filters are consistent; boot path skips restoring a zero-message session from storage.
  (`api/models.py`, `static/boot.js`, `static/sessions.js`) (#1182)
- **iOS Safari auto-zoom on input focus** — inputs, textareas, and selects on touch devices now
  have a minimum `font-size: max(16px, 1em)` via `@media (hover:none) and (pointer:coarse)`,
  preventing iOS from zooming in on focus. Accessibility-safe: user's OS font preference is
  respected when it exceeds 16px. (`static/style.css`) (#1167, #1180)

## [v0.50.229] — 2026-04-27

### Performance
- **Session switch parallelization** — directory pre-fetches now use `Promise.all()` (N×RTT → 1×RTT);
  git status/ahead/behind subprocesses run in parallel via `ThreadPoolExecutor(max_workers=3)`;
  `loadDir()` and `highlightCode()` run concurrently on idle path. Session switches with expanded
  workspace dirs are measurably faster on high-latency connections.
  (`api/workspace.py`, `static/sessions.js`, `static/workspace.js`) (#1158, @jasonjcwu)

### Added
- **Message pagination for long conversations** — sessions with more than 30 messages now load
  the most-recent 30 on switch; older messages load on scroll-to-top or via the "↑ load older"
  indicator at the top of the message list. All undo/retry/compression paths reset pagination
  state correctly. (`api/routes.py`, `static/sessions.js`, `static/ui.js`, `static/commands.js`)
  (#1158, @jasonjcwu)

## [v0.50.228] — 2026-04-27

### Fixed
- **Raw `<pre>` blocks preserved in markdown renderer** — the inline `<code>` rewrite
  pass in `renderMd()` no longer processes content inside raw `<pre>` blocks, preventing
  multiline HTML code blocks from being degraded to backtick strings.
  (`static/ui.js`) (#1150, @bsgdigital)
- **Live model race silently overwrites session model** — `syncTopbar()` now skips
  the destructive fallback-to-first-model path while a live model fetch is in flight
  for the active provider; `_addLiveModelsToSelect()` re-applies the session model
  once the fetch completes, so models only present in the live catalog (e.g. Kimi K2)
  are never silently replaced. (`static/ui.js`) (#1169)
- **Tool card output truncated at 220 chars and unscrollable** — JS truncation threshold
  raised to 800 chars; CSS `overflow:auto` added to `.tool-card.open .tool-card-detail`
  so the inner `<pre>` scroll works correctly; `<pre>` max-height raised to 360 px.
  (`static/ui.js`, `static/style.css`) (#1170)
- **New Conversation creates empty session when already on empty session** — clicking
  the New Conversation button or pressing Cmd/Ctrl+K when the current session has zero
  messages now focuses the composer instead of creating another empty Untitled session.
  (`static/boot.js`) (#1171)
- **`.env` file corruption from concurrent WebUI and CLI/Telegram writes** — removes
  the unlocked duplicate `_write_env_file()` in `api/onboarding.py` that bypassed
  `_ENV_LOCK`; rewrites the shared version to preserve comments, blank lines, and
  original key order rather than rebuilding from a sorted dict.
  (`api/onboarding.py`, `api/providers.py`) (#1164, @bergeouss)

## [v0.50.227] — 2026-04-27

### Fixed
- **Korean locale label and missing Settings descriptions** — `ko._label` normalized to
  `'한국어'`; ten Settings pane description keys that were falling back to English are
  now fully translated. (`static/i18n.js`) (#1138)
- **Workspace trust: alternative home roots** — `resolve_trusted_workspace()` now checks
  the home-directory allowance before the blocked-roots loop, letting symlinked home paths
  (e.g. `/var/home/user`) pass through correctly. (`api/workspace.py`) (#1165)
- **Custom config-file provider models** — the provider-discovery loop now includes entries
  defined under `providers:` in `config.yaml`, so custom providers no longer silently skip
  the model list. Shared `_PROVIDER_MODELS` list is deep-copied before mutation to prevent
  cross-session bleed. (`api/config.py`) (#1161)
- **Save Settings button missing from System pane** — the System settings pane now has a
  Save Settings button so password changes and other system fields can actually be
  submitted. (`static/index.html`) (#1146)
- **Per-job cron completion dot** — the Tasks panel now shows a pulsing green dot on each
  cron job that has a new unread completion; the dot clears only when that specific job's
  detail view is opened, not on any panel-level navigation. (`static/panels.js`,
  `static/style.css`) (#1145)
- **Hide cron agent sessions from sidebar by default** — sessions created by the cron
  scheduler (source `cron` or session_id prefix `cron_`) are now filtered out of the
  default session list in both the index path and the full-scan path; imported gateway
  cron sessions are also hidden via `read_importable_agent_session_rows()`.
  (`api/models.py`, `api/agent_sessions.py`) (#1143)
- **Symlink cycle detection in workspace file browser** — intentional symlinks within the
  workspace root are now allowed; only self-referencing or ancestor-pointing symlinks are
  blocked. Symlink entries render with type, target, and `is_dir`. (`api/workspace.py`)
  (#1149)
- **`/status` command enriched** — output now includes session id, profile, model+provider,
  workspace, personality, start time, per-turn token counts, estimated cost, and agent
  running state. i18n keys added for all locales. (`api/session_ops.py`,
  `static/commands.js`, `static/i18n.js`) (#1156)
- **Per-turn cost display on assistant bubbles** — each assistant message footer now shows
  the token delta and estimated cost for that turn, computed from the cumulative `done` SSE
  usage minus the previous turn's total. (`static/messages.js`, `static/ui.js`) (#1159)
- **Auto-title: skip generic fallback** — when auxiliary title generation fails and the
  local fallback would only produce `"Conversation topic"`, the existing provisional title
  is kept instead of persisting the generic placeholder. (`api/streaming.py`) (#1157)
- **Sidebar session rename first-Enter revert** — double-click inline rename now keeps the
  new title after the first Enter keypress; `finish()` is idempotent via a guard flag and
  `_renamingSid` stays locked until the full async path (success, failure, or cancel)
  completes. (`static/sessions.js`) (#1162)
- **Auto-compression renders as transient card** — automatic context compression now
  renders as a collapsible compression card instead of injecting a fake `*[Context was
  auto-compressed]*` assistant message; preserved task-list user messages also render as
  sub-cards. (`static/messages.js`, `static/ui.js`, `static/i18n.js`) (#1142)

## [v0.50.226] — 2026-04-27

### Fixed
- **App titlebar restored to rail-era centered layout** — removes the TPS metering chip
  from the top bar, centers the title and subtitle, and restores the message count in the
  subtitle slot. Queue state no longer overrides the titlebar subtitle slot.
  (`static/index.html`, `static/panels.js`, `static/style.css`, `static/ui.js`,
  `tests/test_app_titlebar_restore.py`)

## [v0.50.183] — 2026-04-24

### Added
- **`/btw` slash command** — ask an ephemeral side question using current session context without adding to history. Creates a hidden session, streams the answer in a visually distinct bubble, then discards the session. Includes `attachBtwStream()` SSE consumer and `POST /api/btw` route. (`api/routes.py`, `api/background.py`, `static/commands.js`, `static/messages.js`, `static/style.css`)
- **`/background` slash command** — run a prompt in a parallel background agent without blocking the active conversation. Frontend polls `GET /api/background/status` for results and displays completed answers inline. Includes badge indicator in composer footer. (`api/routes.py`, `api/background.py`, `static/commands.js`, `static/messages.js`, `static/index.html`)
- **Undo button on last assistant message** — surfaced as an ↩ icon on the last assistant message, calling the existing `/undo` command for discoverability. (`static/ui.js`)
- **Reasoning effort chip in composer** — visual chip to set reasoning effort level from the composer footer without typing a command. (`static/ui.js`, `static/index.html`, `static/style.css`)

### Fixed
- **Background task completion hook wired** — `complete_background()` was never called after a background agent finished, so tasks stayed in `status="running"` forever and polling always returned `[]`. Fixed by wrapping `_run_agent_streaming` in `_run_bg_and_notify` which extracts the last assistant message and signals the tracker. Also fixed `get_results()` to retain in-flight tasks during polls so concurrent tasks are not dropped. (`api/background.py`, `api/routes.py`, `tests/test_background_tasks.py`)
- **Ephemeral sessions correctly skip persistence** — added `return` after the ephemeral `done` event in `_run_agent_streaming()`, preventing ephemeral session state from being written to disk after stream completion. (`api/streaming.py`)

Co-authored by @bergeouss.

## [v0.50.181] — 2026-04-24

### Changed
- **Vendor streaming-markdown@0.2.15** — self-hosts the incremental markdown parser instead of loading it from jsDelivr CDN. The library (12.6 KB) is committed to `static/vendor/smd.min.js` so the app works fully offline / air-gapped, and the exact bytes are pinned in version control. SHA-384 hash preserved in an HTML comment for manual audit. (`static/vendor/smd.min.js`, `static/index.html`) Co-authored by @bsgdigital.

## [v0.50.180] — 2026-04-23

### Added
- **Incremental streaming markdown via `streaming-markdown`** — replaces the per-animation-frame full `innerHTML` re-render with an incremental DOM-building parser. During streaming, only new character deltas are fed to the parser per frame (`_smdWrite()`), eliminating DOM thrashing and improving rendering smoothness. Prism.js / KaTeX state no longer gets reset mid-stream. Falls back to the existing `renderMd()` path when the library is unavailable. (`static/messages.js`, `static/index.html`) Co-authored by @bsgdigital.

## [v0.50.179] — 2026-04-23

### Fixed
- **Onboarding wizard clobbering CLI users' config after server restart** — CLI-configured users (who set up via `hermes model` / `hermes auth`) had no `onboarding_completed` flag in `settings.json`. After a git branch switch or server restart, `verify_hermes_imports()` could momentarily return `imports_ok=False`, making `chat_ready=False` and causing the wizard to reappear with a destructive dropdown default (openrouter). Fixed by writing `onboarding_completed: True` to `settings.json` the first time `config_auto_completed` evaluates to `True`, so the flag survives future transient import failures. (`api/onboarding.py`) Co-authored by @bsgdigital.

## [v0.50.177] — 2026-04-23

### Fixed
- **Settings dialog and message controls unusable on mobile** — three mobile usability fixes: (1) settings tab strip replaced by a native `<select>` dropdown on narrow viewports, panel goes full-width; (2) provider card Save/Remove buttons become icon-only on mobile so the API key input fills the available width; (3) message timestamps, copy, and edit buttons are always visible on touch screens (no hover state on mobile). (`static/index.html`, `static/panels.js`, `static/style.css`) Co-authored by @bsgdigital.
## [v0.50.178] — 2026-04-23

### Added
- **PWA support — installable as a standalone app** — adds a Web App Manifest (`manifest.json`) and a minimal service worker (`sw.js`) with cache-first strategy for app shell assets and network-bypass for all `/api/*` and `/stream` endpoints. Cache name auto-busts on every deploy via git-derived version injection. Enables "Add to Home Screen" on Android, iOS, and desktop Chrome without any offline API response caching (live backend always required). (`static/manifest.json`, `static/sw.js`, `static/index.html`, `api/routes.py`) Closes #685. Co-authored by @bsgdigital.

## [v0.50.176] — 2026-04-23

### Fixed
- **Duplicate model dropdown entries when CLI default matches live-fetched model** — `_addLiveModelsToSelect()` now normalises IDs before the dedup check (strips `@provider:` prefix using `indexOf`+`substring` to preserve multi-colon Ollama tag suffixes like `qwen3-vl:235b-instruct`, strips namespace prefix, unifies separators). (`static/ui.js`) Closes #907.
- **New Chat uses stale default model after saving Preferences without reload** — `window._defaultModel` is now updated in `_applySavedSettingsUi()` so `newSession()` picks up the newly saved default immediately. (`static/panels.js`) Closes #908.
- **Injected CLI default model shows raw lowercase label** — new `_get_label_for_model()` helper looks up the model's formatted label from existing catalog groups before falling back to title-casing the bare ID. (`api/config.py`) Closes #909.

## [v0.50.175] — 2026-04-23

### Fixed
- **Session persistence hardened against concurrent write races** — all session-mutation paths (streaming success/error/cancel, periodic checkpoint, HTTP endpoints for title/personality/workspace/clear/pin/archive/project) now hold a per-session `_agent_lock` during in-memory mutation and `Session.save()`. The checkpoint thread is stopped and joined before the final save, preventing stale object clobbers. `Session.save()` uses fsync + atomic rename with a pid+thread_id tmp suffix. `_write_session_index()` gets a dedicated `_INDEX_WRITE_LOCK` so disk I/O runs outside the global `LOCK`, reducing head-of-line blocking. Context compression now runs the LLM call outside the lock with a stale-edit check (409) on write-back. (`api/streaming.py`, `api/models.py`, `api/routes.py`, `api/session_ops.py`, `api/config.py`) Closes #765. Co-authored by @starship-s.

## [v0.50.174] — 2026-04-23

### Fixed
- **Interleaved streaming order (Text → Thinking → Tool → Text)** — after a tool call completes, new text tokens now create a new DOM segment below the tool card instead of updating the old segment above it. Adds `segmentStart`/`_freshSegment` flags to track segment boundaries; scopes the streaming cursor to the last live assistant segment only; adds a 3-dot waiting indicator below each tool card; fixes `appendLiveToolCard`/`appendThinking` anchor logic for multi-tool sequences. (`static/messages.js`, `static/ui.js`, `static/style.css`) Co-authored by @bsgdigital.

## [v0.50.173] — 2026-04-23

### Fixed
- **Ordered list items always showed "1." regardless of position** — when LLMs
  output numbered lists with blank lines between items, the paragraph-splitter
  in `renderMd()` placed each item in its own `<ol>` container, causing every
  `<ol>` to restart at 1. Fixed by emitting `value="N"` on each `<li>` so the
  correct ordinal is preserved even when items are split across multiple `<ol>`
  wrappers. (`static/ui.js`) Closes #886. Co-authored by @bsgdigital.

## [v0.50.172] — 2026-04-23

### Fixed
- **Stop Generation preserves partial streamed content** — clicking Stop Generation previously discarded all text the agent had produced, showing only "*Task cancelled.*". The server now accumulates streamed tokens in a per-stream buffer and persists any partial assistant content to the session when a cancel fires. Thinking/reasoning blocks (`<think>...</think>`, including unclosed tags — the common cancel-mid-reasoning case) are stripped before saving. The partial content is flagged `_partial: true` and kept in conversation history so the model can continue from it on the next user message. (`api/config.py`, `api/streaming.py`) Closes #893.

## [v0.50.171] — 2026-04-23

### Fixed
- **Nous default model picker shows correct selection and saves no longer freeze** — two bugs for Nous/portal provider users: (1) Settings → Preferences → Default Model picker showed blank after saving because `set_hermes_default_model()` wrote a bare resolved form that didn't match the `@nous:...` option values in the dropdown; fixed by using `_applyModelToDropdown()`'s smart normalising matcher to find the right option without requiring an exact string match. (2) Every Settings save triggered a blocking live-fetch from the provider API (~5 s freeze) because `set_hermes_default_model()` called `get_available_models()` before returning; the function now returns a lightweight `{ok, model}` ack and invalidates the TTL cache instead. Config.yaml always stores the CLI-compatible bare/slash form (e.g. `anthropic/claude-opus-4.6`) so CLI users on the same install are unaffected. (`api/config.py`, `static/panels.js`) Closes #895.
- **Cross-namespace models (minimax/, qwen/) no longer 404 for Nous users** — `resolve_model_provider()` checked the `config_base_url` branch before the portal-provider guard. Nous always has a `base_url` in config, so known cross-namespace prefixes were stripped before reaching the portal check. Portal providers are now checked first so all slash-prefixed model IDs reach Nous intact. (`api/config.py`) Closes #894.

## [v0.50.170] — 2026-04-23

### Fixed
- **Settings default model picker shows live-fetched models** — the Settings → Preferences → Default Model dropdown previously only showed static models from `_PROVIDER_MODELS`. It now calls `_fetchLiveModels()` via the new `_addLiveModelsToSelect()` helper, consistent with the chat-header dropdown. New sessions also respect the saved default model (`window._defaultModel`) instead of always reading the chat-header value, which reflected the previous session's model. (`static/ui.js`, `static/sessions.js`, `static/panels.js`) Closes #872. Co-authored by @bergeouss.

## [v0.50.163] — 2026-04-23

### Fixed
- **Message ordering after task cancellation** — cancelling a stream while the
  agent is responding no longer causes subsequent responses to appear above the
  "Task cancelled." marker. The cancel handler now fetches the authoritative
  message list from the server (same as the done event), and the server persists
  the cancel message to the session so both paths stay in sync. Falls back to
  the previous local-push behaviour if the API call fails. (`api/streaming.py`,
  `static/messages.js`) (@mittyok, #882)

## [v0.50.161] — 2026-04-23

### Fixed
- **CI: `test_set_key_writes_to_env_file` no longer flaky in full-suite ordering** — two test files (`test_profile_env_isolation.py`, `test_profile_path_security.py`) were calling `sys.modules.pop("api.profiles")` without restoring the module reference, permanently removing `api.profiles` from the module cache and corrupting state for subsequent tests. Replaced with `monkeypatch.delitem(sys.modules, ...)` so the module reference is restored automatically after each test. (`tests/test_profile_env_isolation.py`, `tests/test_profile_path_security.py`)
- **`api/providers.py` `_write_env_file()` lock and mode fixes** — moved file I/O (mkdir + write) inside the `_ENV_LOCK` block to prevent TOCTOU race between concurrent key-save requests; replaced `write_text()` with `os.open(..., O_CREAT, 0o600)` so new `.env` files are created owner-read/write-only from the first byte. (`api/providers.py`)

## [v0.50.160] — 2026-04-23

### Fixed
- **CI: provider panel i18n keys now present in all 6 locales** — `es`, `de`, `zh`, `ru`, `zh-Hant` were missing the 19 provider panel keys added in v0.50.159, causing locale parity test failures on CI after every push to master. (`static/i18n.js`)

## [v0.50.159] — 2026-04-23

### Added
- **Provider key management in Settings** — new "Providers" tab lets users add, update, or remove API keys for direct-API providers without editing `.env` files. Covers Anthropic, OpenAI, Google, DeepSeek, xAI, Mistral, MiniMax, Z.AI, Kimi, Ollama, Ollama Cloud, OpenCode Zen/Go. OAuth providers shown as read-only. Keys stored in `~/.hermes/.env`, take effect immediately. Fully localised (6 locales). (`api/providers.py`, `api/routes.py`, `static/panels.js`, `static/i18n.js`) (PR #867 by @bergeouss, closes #586)

### Security
- Provider write endpoints require auth or local/private-network client (matching onboarding endpoint gate)
- `.env` created at 0600 from first byte via `os.open`; pre-existing files tightened to 0600 on every write
- Full `_ENV_LOCK` coverage across load/modify/write — prevents TOCTOU race between concurrent POSTs

## [v0.50.158] — 2026-04-23

### Fixed
- **Post-update page reload no longer races against server restart** — `applyUpdates()` and `forceUpdate()` now poll `/health` every 500ms (up to 15 seconds) instead of firing a blind 2500ms `setTimeout`. The existing reconnect banner shows "⏳ Restarting… please wait" during the poll window, giving users a visible status and a manual Reload button. If the server is still down after 15s, the banner message changes to prompt a manual reload. Fixes 502 errors seen when the server restart outpaces the fixed delay, especially behind reverse proxies. (`static/ui.js`) (closes #874)

## [v0.50.157] — 2026-04-22

### Fixed
- **Nous portal models now route and format correctly** — two bugs fixed: (1) `_PROVIDER_MODELS["nous"]` updated from bare IDs (`claude-opus-4.6`) to slash-prefixed format (`anthropic/claude-opus-4.6`) that the Nous portal API expects. (2) `resolve_model_provider()` now routes cross-namespace models through portal providers (Nous, OpenCode Zen, OpenCode Go) directly instead of mis-routing to OpenRouter. Portal guard returns the full slash-preserved model ID so Nous receives the correct format. 10 regression tests. (`api/config.py`) (closes #854)

## [v0.50.156] — 2026-04-22

### Security
- **⚠️ Breaking change — auto-install of agent dependencies is now opt-in** — users previously relying on auto-install must now set `HERMES_WEBUI_AUTO_INSTALL=1` to restore the previous behaviour. A new `_trusted_agent_dir()` check validates ownership and permission bits before allowing pip to run. (`api/startup.py`, `README.md`) (addresses #842 by @tomaioo)

## [v0.50.155] — 2026-04-22

### Fixed
- **Honcho per-session memory uses stable session ID across WebUI turns** — `api/streaming.py` now passes `gateway_session_key=session_id` to `AIAgent` (defensive, same pattern as `api_mode`/`credential_pool`). Without this, Honcho's `per-session` strategy created a new Honcho session on each streaming request. (`api/streaming.py`) (closes #855)

## [v0.50.154] — 2026-04-22

### Fixed
- **Thinking card no longer mirrors main response** — removed early return in `_streamDisplay()` that bypassed think-block stripping when `reasoningText` was populated. (`static/messages.js`) (closes #852)

## [v0.50.153] — 2026-04-22

### Fixed
- **Live-fetched portal models route through configured provider** — `_fetchLiveModels()` applies `@provider:` prefix. (closes #854)

## [v0.50.152] — 2026-04-22

### Fixed
- **Image generation renders inline** — `MEDIA:` token restore renders all `https://` URLs as `<img>`. (closes #853)
- **Auto-title strips thinking preambles** — `_strip_thinking_markup()` strips Qwen3-style plain-text reasoning preambles. (closes #857)

## [v0.50.151] — 2026-04-22

### Added
- **Ollama Cloud support** — added `ollama-cloud` display name + dynamic model-list
  handler backed by `hermes_cli.models.provider_model_ids()`. Live-models endpoint
  routes `ollama-cloud` through the same formatter. Server-side `_format_ollama_label()`
  and matching client-side `_fmtOllamaLabel()` turn Ollama tag IDs into readable
  labels (e.g. `qwen3-vl:235b-instruct` → `Qwen3 VL (235B Instruct)`). (#820 by @starship-s, #860)

### Fixed
- **`credential_pool` providers now visible in the model dropdown** —
  `get_available_models()` previously only read `active_provider` from the auth
  store. Providers added via `credential_pool` (e.g. an Ollama Cloud key stored by
  the auth layer without a matching shell env var) were silently invisible. The
  fix loads `credential_pool` entries and adds any provider with at least one
  non-ambient credential to `detected_providers`. Ambient gh-cli tokens (source
  `gh_cli` / label `gh auth token`) are explicitly excluded so Copilot doesn't
  appear merely because `gh` is installed. Two-tier detection: primary via
  `agent.credential_pool.load_pool()`, fallback via raw field inspection when
  the upstream module isn't importable. (#820 by @starship-s, #860)
- **`_apply_provider_prefix()` helper extracted** — removes ~15 lines of
  duplicated inline `@provider:` prefixing logic for non-active providers.
  Semantics unchanged; one fewer place for drift. (#860)
- **Model chip shows friendly labels for bare Ollama IDs** —
  `static/ui.js:getModelLabel()` now routes Ollama tag-format IDs (e.g.
  `kimi-k2.6` or `@ollama-cloud:glm5.1`) through `_fmtOllamaLabel()`. Custom
  `<option>` text uses the same helper. `looksLikeBareOllamaId` narrowed to
  `@ollama*` or colon-tag patterns — does not reformat generic IDs like
  `gpt-5.4-mini`. `syncModelChip()` is now called after localStorage restore
  so the chip reflects the saved selection on first paint. (#860)

## [v0.50.150] — 2026-04-22

### Fixed
- **Profile switching: three related state fixes** — (1) `hermes_profile=default`
  cookie is now persisted instead of being cleared with `max-age=0`, which had
  caused the browser to fall back to the process-global profile on the next
  request. (2) The `sessionInProgress` branch of `switchToProfile()` now calls
  `syncTopbar()` instead of the undefined `updateWorkspaceChip()`. (3) Sidebar
  and dropdown active-profile rendering now prefer `S.activeProfile` client
  state when available, with a safe fallback. (#849 by @migueltavares)

## [v0.50.149] — 2026-04-22

### Fixed
- **`GET /api/session` is now side-effect free for stale-model sessions** —
  the read path previously called `_normalize_session_model_in_place()`,
  which could write back to disk and update the session index while handling
  a plain read. Replaced with a read-only
  `_resolve_effective_session_model_for_display()` that returns the effective
  display model without any write-back. Closes #845. (#848 by @franksong2702)

## [v0.50.148] — 2026-04-22

### Fixed
- **Prune stale `_index.json` ghost rows after session-id rotation** — index
  entries whose backing session file no longer exists (e.g. after context
  compression rotates the session id) are now pruned on both incremental
  index writes and `all_sessions()` reads. Fixes duplicate session entries
  in the sidebar. Also pre-snapshots `in_memory_ids` under a single `LOCK`
  acquisition in `all_sessions()` rather than one per row — small but
  measurable contention reduction. Closes #846. (#847 by @franksong2702)

## [v0.50.147] — 2026-04-22

### Fixed
- **Font size setting now visibly changes UI text** — selecting Small or Large
  in Appearance settings previously had no visible effect because the CSS override
  only changed `:root{font-size}`, but the stylesheet uses 230+ hardcoded `px`
  values that are unaffected by root font-size. Added explicit per-element overrides
  for the key UI surfaces: chat message body, sidebar session list, composer
  textarea, and workspace file tree. Closes #843. (#844)

## [v0.50.146] — 2026-04-22

### Fixed
- **Slash command input now shown as user message in chat** — commands like `/help`,
  `/skills`, `/status` previously produced a response with no visible user input above
  it, making the conversation appear to start from nowhere. Added a `noEcho` flag to
  action-only commands (`/clear`, `/new`, `/stop`, etc.) and echo the user's input as
  a message bubble for commands that produce a chat response. User message is pushed
  BEFORE the handler runs to ensure correct ordering in `S.messages`. Closes #840. (#841)

## [v0.50.145] — 2026-04-22

### Fixed
- **Slash command dropdown scrolls to keep highlighted item visible** — pressing ↓/↑
  to navigate the autocomplete list no longer lets the selected item move out of the
  visible dropdown area. Added `scrollIntoView({block:'nearest'})` after updating the
  selected class in `navigateCmdDropdown()`. Closes #838. (#839)

## [v0.50.141] — 2026-04-22

### Fixed
- **Session list appears empty after browser reload / version update** — Chrome's
  bfcache was restoring a prior search query into `#sessionSearch` on page restore,
  causing `renderSessionListFromCache()` to silently filter out all sessions (including
  newly created ones). Added `autocomplete="off"` to the search input and an explicit
  value-clear at boot before the first render. Closes #822. (#830)


## [v0.50.140] — 2026-04-22

### Fixed
- **Gateway SSE sync failures now surface to the user** — when the gateway watcher
  thread is not running, the browser now shows a toast notification and automatically
  falls back to 30-second polling for session sync. Previously this failed silently
  with no feedback. (#828, absorbs PR #826 by @cloudyun888, fixes #635)
- `_gateway_sse_probe_payload` now checks `watcher._thread.is_alive()` rather than
  just `watcher is not None`, so a watcher instance with a dead poll thread correctly
  reports unavailable and triggers the polling fallback.
- Probe fetch network errors now also activate the polling fallback as a safe default
  rather than silently swallowing the failure.

## [v0.50.139] — 2026-04-22

### Fixed
- **Default workspace persists after session delete** — the blank new-chat page now shows the configured default workspace even after creating and deleting sessions. Root cause: `newSession()` consumed `S._profileDefaultWorkspace` for a one-shot profile-switch semantic, leaving it null on all subsequent returns to blank state. Fix: introduced `S._profileSwitchWorkspace` as a dedicated one-shot flag for profile switches; `S._profileDefaultWorkspace` is now persistent from boot throughout the session lifecycle. Workspace chip, `promptNewFile`, `promptNewFolder`, and `switchToWorkspace` all continue to work correctly. Closes #823. (#824)

## [v0.50.138] — 2026-04-22

### Fixed
- **Streaming: response no longer renders twice or leaves thinking block below the answer** — two race conditions in `attachLiveStream` fixed. (A) A trailing `token`/`reasoning` event could queue a `requestAnimationFrame` that fired after `done` had already called `renderMessages()`, inserting a duplicate live-turn wrapper below the settled response. Fixed via `_streamFinalized` flag + `cancelAnimationFrame` in all terminal handlers (`done`, `apperror`, `cancel`, `_handleStreamError`). (B) A proposed accumulator-reset on SSE reconnect was reverted — the server uses a one-shot queue and does not replay events; the reset would have wiped pre-drop response content. Bug A's fix alone resolves all three reported symptoms (double render, thinking card below answer, stuck cursor). (#821, closes #631)
- **Blank new-chat page now shows default workspace and allows workspace actions** — `syncWorkspaceDisplays()` uses `S._profileDefaultWorkspace` as fallback when no session is active; the workspace chip is now enabled on the blank page; `promptNewFile`, `promptNewFolder`, `switchToWorkspace`, and `promptWorkspacePath` all auto-create a session bound to the default workspace when called on the blank page, rather than silently returning. Boot.js hydrates `S._profileDefaultWorkspace` from `/api/settings.default_workspace` before any session is created. (#821, closes #804)

## [v0.50.135] — 2026-04-22

### Fixed
- **BYOK/custom provider models now appear in the WebUI model dropdown** — three root causes fixed. (1) Provider aliases like `z.ai`, `x.ai`, `google`, `grok`, `claude`, `aws-bedrock`, `dashscope`, and ~25 others were not normalized to their internal catalog slugs, causing the provider to miss `_PROVIDER_MODELS` lookup and show an empty dropdown while the TUI worked. (2) The fix works even without `hermes-agent` on `sys.path` (CI, minimal installs) via an inlined `_PROVIDER_ALIASES` table in `api/config.py` — the previous `try/except ImportError` was silently swallowing the failure. (3) `custom_providers` entries now appear in the live model enrichment path. `provider_id` on every group makes optgroup matching deterministic. Closes #815. (#817)

## [v0.50.134] — 2026-04-21

### Fixed
- **Update banner: conflict/diverged recovery path + server self-restart after update** — three failure modes resolved. (1) `Update failed (agent): Repository has unresolved merge conflicts` was a dead-end with no recovery path; the error now includes an actionable `git checkout . && git pull --ff-only` command, a persistent inline display (not a fleeting toast), and a **Force update** button that executes the reset via the new `POST /api/updates/force` endpoint. (2) After a successful update, the server now self-restarts via `os.execv` (2 s delay), eliminating the stale-`sys.modules` bug that broke custom provider chat on the next request. (3) When both webui and agent updates are pending, the restart now correctly waits for the second update to complete before re-executing (`_apply_lock` coordination), preventing the mid-pull kill race. Closes #813, #814. (#816)

## [v0.50.133] — 2026-04-21

### Added
- **`/reasoning show` and `/reasoning hide` slash commands** — toggle thinking/reasoning block visibility directly from the chat composer, matching the Hermes CLI/TUI parity. `/reasoning show` reveals all thinking cards (live and historical) and persists the preference; `/reasoning hide` collapses them. `/reasoning` with no args shows current state. The `show|hide` options now appear in autocomplete alongside the existing `low|medium|high` effort levels. The `show_thinking` setting is persisted via `/api/settings` so the preference survives page reloads. Closes #461 (partial — effort level routing to agent is a follow-up). (#812)

## [v0.50.132] — 2026-04-21

### Fixed
- **Periodic session checkpoint during long-running agent tasks** — messages accumulated during multi-step research or coding tasks were silently lost if the server restarted mid-run. The root cause: `Session.save()` was only called after `agent.run_conversation()` completed. The fix adds a daemon thread that saves the session every 15 seconds whenever the `on_tool` callback signals a completed tool call — the first reliable mid-run signal that real progress has been made (the agent works on an internal copy of `s.messages`, so watching message-count would never trigger). `Session.save()` gains a `skip_index=True` flag so checkpoints skip the expensive index rebuild; the final `s.save()` at task completion still rebuilds it. On a server restart the user's message and turn bookkeeping remain on disk — worst case: up to 15 seconds of tool-call progress lost rather than the entire conversation turn. Closes #765. Absorbed and corrected from PR #809 by @bergeouss. (#810)

## [v0.50.131] — 2026-04-21

### Fixed
- **Workspace pane now respects the app theme** — seven hardcoded dark-mode `rgba(255,255,255,...)` colors in the workspace panel CSS have been replaced with theme-aware CSS variables (`--hover-bg`, `--border2`, `--code-inline-bg`). The file list hover, panel icon buttons, preview table rows, and the preview edit textarea now all update correctly when switching between light and dark themes. Reported in #786. (#807)

## [v0.50.130] — 2026-04-21

### Fixed
- **New sessions now appear immediately in the sidebar** — the zero-message Untitled filter now exempts sessions younger than 60 seconds, so clicking New Chat shows the session right away instead of waiting for the first message. Sessions older than 60 seconds that are still Untitled with 0 messages continue to be suppressed (ghost sessions from test runs / accidental page reloads). Addresses Bug A only of #789; Bug B (SSE refetch resetting sidebar mid-interaction) is a separate fix. (#806)

## [v0.50.129] — 2026-04-21

### Fixed
- **Profile isolation: complete fix via cookie + thread-local context** — PR #800 (v0.50.127) only fixed `POST /api/session/new`. `GET /api/profile/active` still read the process-level `_active_profile` global, so a page refresh while another client had a different profile active would corrupt `S.activeProfile` in JS, defeating the session-creation fix on the next new chat. This release completes the isolation: profile switches now set a `hermes_profile` cookie (HttpOnly, SameSite=Lax) and never mutate the process global. Every request handler reads the cookie into a thread-local; all server functions (`get_active_profile_name()`, `get_active_hermes_home()`, `list_profiles_api()`, memory endpoints, model loading) automatically see the per-client profile. `switch_profile()` gains a `process_wide` kwarg — the HTTP route passes `False`, keeping the global clean; CLI callers default to `True` (unchanged behaviour). Absorbed from PR #803 by @bergeouss with correctness fixes reviewed by Opus. (#805)

## [v0.50.128] — 2026-04-21

### Fixed
- **`"` no longer mangles to `&amp;quot;` inside code blocks** — the autolink pass in `renderMd()` was operating inside `<pre><code>` blocks because they weren't stashed before the pass ran. When a code block contained a URL adjacent to `&quot;` (the HTML-escaped form of `"`), the autolink regex captured the entity suffix and `esc()` double-encoded it, producing `&amp;quot;` in the rendered HTML and copy buffer. Fixed by adding `<pre>` blocks to `_al_stash` so the autolink regex never touches code-block content. Reported and fixed by @starship-s. (#801)

## [v0.50.127] — 2026-04-21

### Fixed
- **Profile isolation: switching profiles in one browser client no longer affects concurrent clients** — `api/profiles.py` stored `_active_profile` as a process-level global; `switch_profile()` mutated it for the whole server, so a second user switching profiles would clobber new-session creation for all other active tabs. The fix: (1) `get_hermes_home_for_profile(name)` — a pure path resolver that reads only the filesystem, validates the profile name against the existing `_PROFILE_ID_RE` pattern (rejects path traversal), and never mutates `os.environ` or module state; (2) `new_session()` now accepts an explicit `profile` param passed from the client's `S.activeProfile` in the POST body, short-circuiting the process global; (3) the streaming handler resolves `HERMES_HOME` from the per-session `s.profile` instead of the shared global. Reported in #798. (#800)

## [v0.50.126] — 2026-04-21

### Fixed
- **Onboarding now recognizes `credential_pool` OAuth auth for openai-codex** — the readiness check in `api/onboarding.py` only looked at the legacy `providers[provider]` key in `auth.json`. Hermes runtime resolves OAuth tokens from `credential_pool[provider]` (device-code / OAuth flows), so WebUI could report "not ready" while the runtime chatted successfully. The check now covers both storage locations with a fail-closed helper. Adds three regression tests. Reported in #796, fixed by @davidsben. (#797)

## [v0.50.125] — 2026-04-21

### Fixed
- **`python3 bootstrap.py` now honours `.env` settings** — running bootstrap.py directly (the primary documented entry point) previously ignored `HERMES_WEBUI_HOST`, `HERMES_WEBUI_PORT`, and other repo `.env` settings because `start.sh`'s `source .env` step was skipped. bootstrap.py now loads `REPO_ROOT/.env` itself before reading any env-var defaults, making the two launch paths identical. Reported in #730 by @leap233. (#791)

## [v0.50.124] — 2026-04-21

### Fixed
- **Settings version badge now shows the real running version** — the badge in the Settings → System panel was hardcoded to `v0.50.87` (36 releases behind) and the HTTP `Server:` header said `HermesWebUI/0.50.38` (85 behind). Both are now resolved dynamically at server startup from `git describe --tags --always --dirty`. Docker images (where `.git` is excluded) receive the correct tag via a build-time `ARG HERMES_VERSION` written to `api/_version.py`. `COPY` now uses `--chown=hermeswebuitoo:hermeswebuitoo` so the write succeeds under the unprivileged container user. No manual "update the badge" step is needed going forward — tagging is sufficient. Version file parsing uses regex instead of `exec()` for supply-chain safety. (#790, #793)

## [v0.50.123] — 2026-04-21

### Fixed
- **Default model change surfaced stale value after model-list TTL cache landed** — `set_hermes_default_model()` now explicitly invalidates `_available_models_cache` after `reload_config()`. The 60s TTL cache introduced in v0.50.121 (#780) only invalidates on config-file mtime change, but `reload_config()` resyncs `_cfg_mtime` before `get_available_models()` runs — so the mtime check never fires and the POST response (plus downstream reads within the TTL window) returned the previous model until the cache expired. Root cause of the `test_default_model_updates_hermes_config` CI flake as well. (#788)
- **Test teardown restores conftest default deterministically** — `test_default_model_updates_hermes_config` now restores to the conftest-injected `TEST_DEFAULT_MODEL` (via `tests/_pytest_port.py`) instead of reading the pre-test value from `/api/models`, so teardown is stable regardless of ordering. Also updates `TESTING.md` automated-test count to 1578. (#788)

## [v0.50.122] — 2026-04-21

### Fixed
- **Duplicate X button in workspace panel header on mobile** — at viewport widths ≤900px the desktop close-preview button (`.close-preview` / `btnClearPreview`) is now hidden via CSS, leaving only the mobile close button (`.mobile-close-btn`) visible. Previously both buttons appeared side-by-side when the window was resized below the 900px breakpoint. (#781)

## [v0.50.121] — 2026-04-20

### Performance
- **Model list no longer re-scans on every session load** — `get_available_models()` now caches its result for 60 seconds (configurable via `_AVAILABLE_MODELS_CACHE_TTL`). Config file changes (mtime) invalidate the cache immediately. This eliminates the ~4s AWS IMDS timeout that blocked the model dropdown on every page load for users on EC2 without an IAM role. Thread-safe via a dedicated lock; callers receive a `copy.deepcopy()` so mutations don't pollute the cache. (credit: @starship-s)
- **Session saves no longer trigger a full O(n) index rebuild** — `_write_session_index()` now does an incremental read-patch-write of the existing index JSON when called from `Session.save()`, rather than re-scanning every session file on disk. Falls back to a full rebuild when the index is missing or corrupt. Atomic write via `.tmp` + `os.replace()`. At 100+ sessions this is a meaningful speedup. (credit: @starship-s)

## [v0.50.120] — 2026-04-20

### Fixed
- **Cancelled sessions no longer get stuck** — `cancel_stream()` now eagerly pops stream state (`STREAMS`, `CANCEL_FLAGS`, `AGENT_INSTANCES`) and clears `session.active_stream_id` immediately after signalling cancel. Previously, the 409 "session already has an active stream" guard would block all new chat requests until the agent thread's `finally` block ran — which never happens when the thread is blocked in a C-level syscall on a bad tool call. Session cleanup runs outside `STREAMS_LOCK` to preserve lock ordering and avoid deadlock. (Fixes #653, credit: @bergeouss)

## [v0.50.119] — 2026-04-20

### Fixed
- **Older hermes-agent builds no longer crash on startup** — the WebUI now checks which params `AIAgent.__init__` actually accepts (via `inspect.signature`) before constructing the agent. The four params added in newer builds (`api_mode`, `acp_command`, `acp_args`, `credential_pool`) are passed only when present, so older installs degrade gracefully instead of throwing `TypeError`. (#772)

## [v0.50.118] — 2026-04-20

### Fixed
- **CLI sessions: silent failure now logged** — `get_cli_sessions()` no longer swallows DB errors silently. If `state.db` is missing the `source` column (older hermes-agent) or has any other schema/lock issue, a warning is now logged with the DB path and a hint to upgrade hermes-agent. This makes "Show CLI sessions in sidebar has no effect" diagnosable from the server log instead of requiring code archaeology. (#634)

## [v0.50.117] — 2026-04-20

### Fixed
- **Queued messages survive page refresh** — when a follow-up message is submitted while the agent is busy, the queue is now persisted to `sessionStorage`. On reload, if the agent is still running the queue is silently restored and will drain normally. If the agent has finished, the first queued message is restored into the composer as a draft with a toast notification ("Queued message restored — review and send when ready"), preventing accidental auto-send. Stale entries (created before the last assistant response) are automatically discarded. (#660)

## [v0.50.116] — 2026-04-20

### Fixed
- **Session errors survive page reload** — provider quota exhaustion, rate limit, auth, and agent errors are now persisted to the session file as a special error message. Reloading the page after an error no longer shows a blank conversation. Error messages are excluded from the next API call's conversation history so the LLM never sees its own error as prior context. (#739)
- **Quota/credit exhaustion shows a distinct error** — "Out of credits" now appears instead of the generic "No response received" message when a Codex or other provider account runs out of credits. Both the silent-failure path and the exception path now classify `insufficient_credits` / `quota_exceeded` separately from rate limits, with a targeted hint to top up the balance or switch providers. (#739)
- **Context compaction no longer hangs the session** — when `run_conversation()` rotates the session_id during context compaction, `stream_end` now uses the original session_id (captured before the run), matching what the client captured in `activeSid`. Previously the mismatch caused the EventSource to stay open, trigger a reconnect loop, and show "Connection lost." The same fix also corrects the `title` SSE event. (#652, #653)

## [v0.50.115] — 2026-04-20

### Removed
- **Chat bubble layout setting removed** — the opt-in `bubble_layout` toggle (issue #336) is removed end-to-end: the Settings checkbox, all related CSS (`.bubble-layout` selectors), the config.py default/bool-key entries, the boot.js/panels.js class toggles, and all locale strings across 6 languages. Stale `bubble_layout` values in existing `settings.json` files are silently dropped on load via the legacy-drop-keys migration path. (Fixes #760, credit: @aronprins)

## [v0.50.114] — 2026-04-20

### Fixed
- **Default model now reads from Hermes config.yaml** — removes the split-brain state where WebUI Settings and the Hermes runtime/CLI/gateway could have different default models. `default_model` is no longer persisted in `settings.json`; it is read from and written to `config.yaml` via a new `POST /api/default-model` endpoint. Existing saved `default_model` values in `settings.json` are silently migrated away on first load. Saving Settings now calls `/api/default-model` when the model changed, with error handling so a config.yaml write failure doesn't leave the UI in a broken state. (#761, credit: @aronprins)

## [v0.50.113] — 2026-04-20

### Fixed
- **Slash autocomplete now keeps command completion flowing into sub-arguments** — sub-argument-only commands like `/reasoning` now appear in the first suggestion list, the current dropdown selection is visibly highlighted while navigating with arrow keys, and accepting a top-level command like `/reasoning` immediately opens the second-level suggestions instead of requiring an extra space press. (Fixes #632, credit: @franksong2702)

## [v0.50.112] — 2026-04-20

### Added
- **Sidebar density mode for the session list** — new Settings option toggles the left session list between a compact default and a detailed view that shows message count and model. Profile names only appear in detailed mode when "Show active profile only" is disabled. (#673)

## [v0.50.111] — 2026-04-20

### Fixed
- **Dark-mode user bubbles no longer use a glaring bright accent fill** — `:root.dark` now overrides `--user-bubble-bg`/`--user-bubble-border` to `var(--accent-bg-strong)` (a 15% tint), keeping the bubble visually subdued in dark skins. The 6 per-skin `--user-bubble-text` hacks are removed; text color falls back to `var(--text)`. Edit-area box-shadow now uses the shared `--focus-ring` token. (credit: @aronprins)
- **Thinking card header is now collapsible** — the main `_thinkingMarkup()` function now includes `onclick` toggle and the chevron affordance, matching the compression reference card pattern. The header has `display:flex` for proper icon/label/chevron alignment.

## [v0.50.110] — 2026-04-20

### Fixed
- **Message footer metadata is now consistent across user and assistant turns** — timestamps are available on both sides, but footer chrome stays hidden until hover instead of being always visible on assistant messages. The last assistant turn keeps cumulative `in/out/cost` usage visible, then reveals timestamp and actions inline on hover. Existing timestamps for unchanged historical messages are also preserved during transcript rebuilds, so older turns no longer get re-stamped to the newest reply time. (Fixes #680, credit: @franksong2702)

## [v0.50.109] — 2026-04-20

### Fixed
- **Named custom provider test isolation** — `_models_with_cfg()` in `tests/test_custom_provider_display_name.py` now pins `_cfg_mtime` before calling `get_available_models()`, preventing the mtime-guard inside that function from firing `reload_config()` and silently discarding the patched `config.cfg`. This fixes an ordering-dependent test failure where any test that wrote `config.yaml` before this test ran would cause `get_available_models()` to return the real OpenRouter model list instead of the patched Agent37 group. (Fixes #754)

## [v0.50.108] — 2026-04-20

### Fixed
- **Kimi K2.5 added to Kimi/Moonshot provider model list** — `kimi-k2.5` was present in `hermes_cli` but missing from the WebUI's `api/config.py` kimi-coding provider, making it unavailable in the model selector. (Fixes #740)

## [v0.50.107] — 2026-04-20

### Added
- **Three-container UID/GID alignment guide in README** — new subsection explains why UIDs must match across containers sharing a bind-mounted volume, documents the variable name asymmetry (`HERMES_UID`/`HERMES_GID` for the agent image vs `WANTED_UID`/`WANTED_GID` for the WebUI image), gives the recommended `.env` setup for standard Linux and NAS/Unraid deployments, provides the one-time `chown` fix for existing installs, and notes that the dashboard volume must be read-write. (Fixes #645)

### Fixed
- **`HERMES_UID`/`HERMES_GID` forwarded to agent and dashboard containers** — `docker-compose.three-container.yml` now declares `HERMES_UID=${HERMES_UID:-10000}` and `HERMES_GID=${HERMES_GID:-10000}` in the environment blocks for `hermes-agent` and `hermes-dashboard`, making the documented `.env` recipe functional.

## [v0.50.106] — 2026-04-20

### Fixed
- **`PermissionError` in auth signing key no longer crashes every HTTP request** — `key_file.exists()` in `api/auth.py`'s `_signing_key()` was called outside the try/except block. In three-container bind-mount setups where the agent container initialises the state directory under a different UID, `pathlib.Path.exists()` raises `PermissionError`, which escaped up through `is_auth_enabled()` → `check_auth()` and crashed every HTTP request with HTTP 500. The `exists()` call is now inside the try block so `PermissionError` is caught and falls back to an in-memory key. (PR #625)

## [v0.50.105] — 2026-04-20

### Fixed
- **Profile deletion warning now leads with destructive impact** — the confirmation dialog now reads: "All sessions, config, skills, and memory for this profile will be permanently deleted. This cannot be undone." Updated across all 6 supported locales. (Fixes #637)

## [v0.50.104] — 2026-04-20

### Fixed
- **Agent image URLs rewritten to actual server base** — when an agent emits a `MEDIA:http://localhost:8787/...` URL, the WebUI now rewrites the `localhost`/`127.0.0.1` host to the page's `document.baseURI` before inserting it as an `<img src>`. Fixes broken images for remote users (VPN, Docker, deployed servers) and preserves subpath mounts (e.g. `/hermes/`). (Fixes #642)

## [v0.50.103] — 2026-04-20

### Fixed
- **Windows `.env` encoding fix** — `write_text()` calls in `api/profiles.py` were missing `encoding='utf-8'`, causing failures on Windows systems with non-UTF-8 locale encodings. All file I/O in `api/` now explicitly specifies `encoding='utf-8'`. (Fixes #741)

## [v0.50.102] — 2026-04-20

### Fixed
- **Code blocks no longer lose newlines when not preceded by a blank line** — `renderMd()` now stashes `<pre>` blocks (including language-labelled wrappers), mermaid diagrams, and katex blocks before the paragraph-splitting pass, then restores them. Previously, if a fenced code block was not separated from surrounding text by a blank line, all `\n` inside it were replaced with `<br>`, collapsing the entire block to one line. (Fixes #745)

## [v0.50.101] — 2026-04-20

### Fixed
- **Session model normalization: null/empty model no longer triggers index rebuild** — sessions with no stored model (`model: null` or missing) now return the provider default without writing to disk. Previously a spurious `session.save()` (and full session index rebuild) could fire for any such session. (#751 follow-up)

## [v0.50.100] — 2026-04-20

### Fixed
- **Session model normalization: unknown provider prefixes now pass through** — custom/unlisted model prefixes (e.g. `custom-provider/my-model`) are no longer incorrectly stripped when switching providers. Only well-known provider prefixes (`gpt-`, `claude-`, `gemini-`, etc.) are normalized. Regression introduced in v0.50.99. (#751)

## [v0.50.99] — 2026-04-20

### Fixed
- **Stale session models normalized after provider switch** — sessions that still reference a model from a previous provider (e.g. a `gemini-*` model after switching to OpenAI Codex) are silently corrected to the current provider's default on load, preventing startup failures. (Closes #748, credit: @likawa3b)

## [v0.50.98] — 2026-04-20

### Fixed
- **Slash command autocomplete constrained to composer width** — the `/` command dropdown is now positioned inside the composer box, so suggestions stay visually anchored to the input area rather than expanding across the full chat panel. (Closes #633, credit: @franksong2702)

## [v0.50.97] — 2026-04-20

### Fixed
- **Only the latest user message can be edited** — older user turns no longer show the pencil/edit affordance. This avoids implying that historical turns can be lightly edited when the actual action truncates the session and restarts the conversation from that point. (Closes #744)
- **Message footer metadata is now consistent across user and assistant turns** — timestamps are available on both sides using the existing `_ts` / `timestamp` fields, but footer chrome now stays hidden until hover instead of being always visible on assistant messages. The last assistant turn keeps cumulative `in/out/cost` usage visible, then reveals timestamp and actions inline on hover so the footer does not grow an extra row. Existing timestamps for unchanged historical messages are also preserved during transcript rebuilds, so older turns no longer get re-stamped to the newest reply time.

## [v0.50.96] — 2026-04-19

### Added
- **Three-container Docker Compose reference config** — new `docker-compose.three-container.yml` adds an agent + dashboard + WebUI configuration on a shared `hermes-net` bridge, with memory/CPU limits and localhost-only port bindings by default.

### Fixed
- **Two-container compose: gateway port now exposed** — `127.0.0.1:8642:8642` added so the gateway is reachable from the host for debugging. Explicit `command: gateway run` replaces entrypoint defaults.
- **Workspace path expansion** — `${HERMES_WORKSPACE:-~/workspace}` uses tilde in the default value, which Docker Compose correctly expands. `docker-compose.yml` also fixed to use `${HERMES_WORKSPACE:-${HOME}/workspace}` instead of nesting workspace inside the hermes home dir.
- **`HERMES_WEBUI_STATE_DIR` default corrected** — `webui-mvp` → `webui`, matching the current default in `config.py`. Prevents silent state directory split for new deployments.
(PR #708)

## [v0.50.95] — 2026-04-19

### Added
- **Full Russian (ru-RU) localization** — 389/389 English keys covered, Slavic plural forms correctly implemented, native Cyrillic characters throughout. Login page Russian added. Russian locale now leads all non-English locales on key coverage. (PR #713, credit: @DrMaks22 and @renheqiang)

## [v0.50.92] — 2026-04-19

### Fixed
- **XML tool-call syntax no longer leaks into chat bubbles** — `<function_calls>` blocks stripped server-side in the streaming pipeline and client-side in both the live stream and history render. Fixes the default DeepSeek profile showing raw XML on starter prompts. (#702)
- **Workspace file panel shows an empty-state message** instead of a blank pane when no workspace is configured or the directory is empty. (#703)
- **Notification settings description uses "app" instead of "tab"** — more accurate for native Mac app users. (#704)
(PR #712)
## [v0.50.95] — 2026-04-19

### Fixed
- **Assistant messages now show footer timestamps, and older messages show a fuller date+time** — assistant response segments now render the same footer timestamp affordance as user messages, using the existing message `_ts` / `timestamp` fields already stamped by the WebUI. Messages from today still show a compact time-only label, while older messages now show a fuller date+time string directly in the footer for better readability when reviewing past sessions.

## [v0.50.94] — 2026-04-19

### Fixed
- **Mic toggle is now race-safe and works over Tailscale** — rapid click/toggle no longer leaves recording in inconsistent state (`_isRecording` flag with proper reset in all paths). `recognition.start()` is now correctly called (was previously only present in a comment string, so SpeechRecognition never started and the Tailscale fallback never fired). Falls back to `MediaRecorder` when `speech.googleapis.com` is unreachable. Browser capability preference persisted in `localStorage` across reloads. (PR #683 by @MatzAgent)

## [v0.50.93] — 2026-04-19

### Fixed
- **Gateway message sync no longer corrupts the active session on slow networks** — the `sessions_changed` SSE handler now captures the active session ID before the async `import_cli` fetch and validates it in `.then()`, preventing session-switch races from overwriting the wrong conversation. Added `is_cli_session` guard so the handler only fires for CLI-originated sessions. The backend import path now also verifies that existing messages are a strict prefix of the fresh CLI messages before overwriting, preventing silent data loss on hybrid WebUI+CLI sessions. (PR #676 by @yunyunyunyun-yun)

## [v0.50.91] — 2026-04-19

### Added
- **Slash command parity with hermes-agent** — `/retry`, `/undo`, `/stop`, `/title`, `/status`, `/voice` commands now work in the Web UI, matching gateway behaviour. New `GET /api/commands` endpoint and `api/session_ops.py` backend. (PR #618 by @renheqiang)
- **Skills appear in `/` autocomplete** — the composer slash-command dropdown now surfaces Hermes skills from `/api/skills`. Skill entries show a `Skill` badge and are ranked below built-ins on collisions. (PR #701 by @franksong2702)

## [v0.50.87] — 2026-04-18

### Fixed
- **Streaming scroll override (#677)** — auto-scroll no longer hijacks your position while the AI is responding. `renderMessages()` and `appendThinking()` now call `scrollIfPinned()` during an active stream instead of `scrollToBottom()`, so scrolling up to read earlier content works correctly. Scroll re-pin threshold widened from 80px to 150px to avoid hair-trigger re-pinning on fast mouse wheels. A floating **↓ button** appears at the bottom-right of the message area when you scroll up, giving a one-click way to jump back to live output.
- **Gemini 3.x model IDs updated (#669)** — all provider model lists (`gemini`, `google`, OpenRouter fallback, GitHub Copilot, OpenCode Zen, Nous) now include the correct Gemini 3.1 Pro Preview, Gemini 3 Flash Preview, and Gemini 3.1 Flash Lite Preview model IDs alongside stable Gemini 2.5 models. The missing `gemini-3.1-flash-lite-preview` (which caused `API_KEY_INVALID` errors) is now present. `GEMINI_API_KEY` env var now also triggers native gemini provider detection.
- **Read-only workspace mount no longer crashes Docker startup (#670)** — `docker_init.bash` now checks `[ -w "$HERMES_WEBUI_DEFAULT_WORKSPACE" ]` before attempting `chown` or write-test on the workspace directory. `:ro` bind-mounts are silently accepted with a log message instead of calling `error_exit`.
- **UID/GID auto-detection now works in two-container setups (#668)** — `docker_init.bash` now probes `/home/hermeswebui/.hermes` and `$HERMES_HOME` (shared hermes-home volume) before falling back to `/workspace`. In Zeabur and Docker Compose two-container deployments where the hermes-agent container initializes the shared volume first, the WebUI now correctly inherits its UID/GID without manual `WANTED_UID` configuration.

## [v0.50.86] — 2026-04-18

### Added
- **Searchable model picker** — the model dropdown now has a live search input at the top. Type any part of a model name or ID to filter the list instantly; provider group headers (Anthropic, OpenAI, OpenRouter, etc.) remain visible in filtered results. Includes a clear button, Escape-to-close support, and a "No models found" empty state. i18n strings added for English, Spanish, and zh-CN. (PR #659 by @mmartial)

## [v0.50.90] — 2026-04-19

### Fixed
- **`/compress` reference card now shows full handoff immediately after compression** — the context compaction card no longer shows only the short 3-line API summary right after `/compress` completes. The UI now prefers the persisted compaction message (full handoff) over the raw API response, matching what is shown after a page reload. (PR #699 by @franksong2702)

## [v0.50.89] — 2026-04-19

### Fixed
- **Explicit UTF-8 encoding on all config/profile reads** — `Path.read_text()` calls in `api/config.py` and `api/profiles.py` now always specify `encoding="utf-8"`. On Windows systems with a non-UTF-8 default locale (e.g. GBK on Chinese Windows, Shift_JIS on Japanese Windows), omitting the encoding argument caused silent config loading failures. (PR #700 by @woaijiadanoo)

## [v0.50.88] — 2026-04-19

### Fixed
- **System Preferences model dropdown no longer misattributes the default model to unrelated providers** — the `/api/models` builder no longer injects the global `default_model` into unknown provider groups such as `Alibaba` or `Minimax-Cn`. When a provider has no real model catalog of its own, it is now omitted from the dropdown instead of showing a misleading placeholder like `gpt-5.4-mini`. If the active provider still needs a default fallback, it is shown in a separate `Default` group rather than being mixed into another provider's models.

## [v0.50.85] — 2026-04-18

### Fixed
- **`_provider_oauth_authenticated()` now respects the `hermes_home` parameter** — the function had a CLI fast path (`hermes_cli.auth.get_auth_status()`) that ignored the caller-supplied `hermes_home` and read from the real system home. On machines where `openai-codex` (or another OAuth provider) was genuinely authenticated, this caused three test assertions to return `True` instead of `False`, regardless of the isolated `tmp_path` the test passed in. Removed the CLI fast path; the function now reads exclusively from `hermes_home/auth.json`, which is both the correct scoped behavior and what the docstring described. No functional change for production (the auth.json path was already the complete fallback). (Fixes pre-existing test_sprint34 failures)

## [v0.50.84] — 2026-04-18

### Fixed
- **MiniMax M2.7 now appears in the model dropdown for OpenRouter users** — `MiniMax-M2.7` and `MiniMax-M2.7-highspeed` were present in `_PROVIDER_MODELS['minimax']` but absent from `_FALLBACK_MODELS`, so OpenRouter users (who see the fallback list) never saw them. Both models added to the fallback list under the `MiniMax` provider label.
- **`MINIMAX_API_KEY` env var now triggers MiniMax detection** — the env scan tuple in `get_available_models()` was missing `MINIMAX_API_KEY` and `MINIMAX_CN_API_KEY`, so users who set those vars directly in `os.environ` (rather than in `~/.hermes/.env`) did not see the MiniMax provider in the dropdown. Both keys now scanned. (PR #650 by @octo-patch)

## [v0.50.83] — 2026-04-18

### Fixed
- **Provider models from `config.yaml` now appear in the model dropdown** — users who configured custom providers in `config.yaml` with an explicit `models:` list saw the hardcoded `_PROVIDER_MODELS` fallback instead of their configured models. The fix extends the model-list builder to check `cfg.providers[pid].models` and use it when present, supporting both dict format (`models: {model-id: {context_length: ...}}`) and list format (`models: [model-id, ...]`). Providers only in `config.yaml` (not in `_PROVIDER_MODELS`) are now included in the dropdown instead of being silently skipped. (PR #644 by @ccqqlo)

## [v0.50.82] — 2026-04-18

### Added
- **`/compress` command with optional focus topic** — manual session compression runs as a real API call via `POST /api/session/compress`, replacing the old agent-message-based `/compact`. Accepts an optional focus topic (`/compress summarize code changes`) that guides what the compression preserves. The compression flow is shown as three transcript-inline cards: a command card (gold), a running card (blue with animated dots), and a collapsible green success card showing the message-count delta and token savings. A reference card renders the full context compaction summary. `/compact` continues to work as an alias. `focus_topic` capped at 500 chars for defense-in-depth. Fallback token estimation uses word-count approximation when model metadata helpers are unavailable — intentional for resilience. (Closes #469, PR #619 by @franksong2702)

## [v0.50.81] — 2026-04-18

### Fixed
- **Auto-title extraction improved for tool-heavy first turns** — sessions where the agent's first response involved tool calls (e.g. memory lookups, file reads) were generating poor titles because the title extractor skipped all assistant messages with `tool_calls`, even when those messages contained substantive visible text. The extractor now picks the first pure (non-tool-call) assistant reply as the title source, using `_looks_invalid_generated_title()` to distinguish meta-reasoning preambles from real agentic replies. Also fixes `_is_provisional_title()` to normalize whitespace before comparing, so CJK text truncated at 64 characters correctly re-triggers title updates. (Closes #639, PR #640 by @franksong2702)


## [v0.50.80] — 2026-04-18

### Fixed
- **Clicking a skill no longer silently loads content into a hidden panel** — `openSkill()` now calls `ensureWorkspacePreviewVisible()` so the workspace panel auto-opens when you click a skill in the Skills tab. (Closes #643)
- **Long thinking/reasoning traces now scroll instead of being clipped** — the thinking card body now uses `overflow-y: auto` when open, so long traces are fully readable. (Closes #638)
- **Sidebar nav icon hit targets are now correctly aligned** — added `display:flex; align-items:center; justify-content:center` to `.nav-tab` so clicking the icon itself (not below it) activates the tab. (Closes #636)
- **Safari iOS input auto-zoom fixed** — bumped `textarea#msg` base font-size from 14px to 16px, which prevents Safari from zooming the viewport on input focus (Safari zooms when font-size < 16px). Visual difference is negligible. (Closes #630)

## [v0.50.79] — 2026-04-17

### Fixed
- **Default model no longer shows as "(unavailable)" for non-OpenAI users** — changed the hardcoded fallback `DEFAULT_MODEL` from `openai/gpt-5.4-mini` to `""` (empty). When no default model is configured, the WebUI now defers to the active provider's own default instead of pre-selecting an OpenAI model that most providers don't have. Users who want a specific default can still set `HERMES_WEBUI_DEFAULT_MODEL` env var or pick a model in Preferences. (Closes #646)

## [v0.50.78] — 2026-04-17

### Fixed
- **Gemma 4 thinking tokens no longer shown raw in chat** — added `<|turn|>thinking\n...<turn|>` to the streaming think-token parser in `static/messages.js` and `_strip_thinking_markup()` in `api/streaming.py`. Previously Gemma 4's reasoning output appeared as raw text prepended to the answer. (Closes #607)
## [v0.50.77] — 2026-04-17

### Changed
- **Color scheme system replaced with theme + skin axes** — the old monolithic theme list (`dark`, `slate`, `solarized`, `monokai`, `nord`, `oled`, `light`) is split into two orthogonal axes: **theme** (`light` / `dark` / `system`) and **skin** (accent palette: Default gold, Ares red, Mono gray, Slate blue-gray, Poseidon ocean blue, Sisyphus purple, Charizard orange). Users can now mix any theme with any skin via the new **Appearance** settings tab. Internally, `.dark` class on `<html>` replaces `data-theme`; skin uses `data-skin` attribute and overrides only 5 accent CSS vars per skin, eliminating ~200 lines of duplicated palette overrides. (PR #627 by @aronprins)

### Migration notes
- **Legacy theme names are silently migrated on first load** to the closest theme + skin pair: `slate → dark+slate`, `solarized → dark+poseidon`, `monokai → dark+sisyphus`, `nord → dark+slate`, `oled → dark+default`. Both backend (`api/config.py::_normalize_appearance`) and frontend (`static/boot.js::_normalizeAppearance`) apply the same mapping.
- **Custom themes set via `data-theme` CSS overrides will reset** to `dark + default` on first load. The pre-PR `theme` setting was open-ended ("no enum gate -- allows custom themes"); the new system enumerates valid values. Users who maintained custom CSS will need to re-apply via a skin choice or by overriding skin variables (`--accent`, `--accent-hover`, `--accent-bg`, `--accent-bg-strong`, `--accent-text`).

### Fixed
- **Send button stays active after clearing composer text** — input listener now correctly toggles disabled state. (PR #627)
- **Composer workspace/model label flash on page load** — chips now wait for `_bootReady` before populating, eliminating the placeholder-then-real-value flicker. (PR #627)
- **Topbar border invisible in light mode** — added `:root:not(.dark)` border override. (PR #627)
- **User message bubble text contrast** — accent-colored bubbles now use skin-aware text colors meeting WCAG AA (Poseidon dark improved from 2.8 → 6.5 ratio). (PR #627)
- **Settings skin persistence race condition** — save now waits for server confirmation before applying. (PR #627)
## [v0.50.76] — 2026-04-17

### Fixed
- **CSP blocked external images in chat** — `img-src` in the Content Security Policy was restricted to `'self'` and `data:`, causing the browser to block any external image URLs (e.g. from Wikipedia, GitHub, or other HTTPS sources) that the agent rendered in a response. Expanded to `img-src 'self' data: https: blob:` so external images load correctly. (Closes #608)

## [v0.50.75] — 2026-04-17

### Fixed
- **Test isolation: `pytest tests/` was overwriting `~/.hermes/.env` with test placeholder keys** — two unit tests in `test_onboarding_existing_config.py` called `apply_onboarding_setup()` in-process without mocking `_get_active_hermes_home`, so every test run wrote `OPENROUTER_API_KEY=test-key-fresh` (or `test-key-confirm`) to the production `.env`. Also added `HERMES_BASE_HOME` to the test server subprocess env (hard-locks profile resolution inside the server to the isolated temp state dir) and stripped real provider keys from the inherited subprocess environment. (PR #620)

## [v0.50.71] — 2026-04-16

### Fixed
- **Docker: `HERMES_WEBUI_DEFAULT_WORKSPACE` was silently overridden by `settings.json`** — the startup block in `api/config.py` unconditionally restored the persisted `default_workspace`, so any container that had previously written `settings.json` would shadow the env var on the next start. The env var now wins when explicitly set, matching the documented priority order. (Closes #609, PR #610)
- **Docker: workspace trust validation rejected subdirectories of `DEFAULT_WORKSPACE`** — `resolve_trusted_workspace()` only trusted paths under `Path.home()` or in the saved list; subpaths of a Docker volume mount like `/data/workspace/myproject` failed with "outside the user home directory". Added a third trust condition for paths under the boot-time `DEFAULT_WORKSPACE`, which was already validated at startup. (Closes #609, PR #610)

## [v0.50.70] — 2026-04-16

### Changed
- **Chat transcript redesigned** — unified `--msg-rail`/`--msg-max` CSS variables align all message elements on one column. User turns render as per-theme tinted cards. Thinking cards are bordered panels with gold rule. Inline code inherits `--strong`. Action toolbar fades in on hover. Error-prefixed assistant rows get `[data-error="1"]` red-accent card treatment. Day-change `.msg-date-sep` separators added. Transcript fades to transparent behind composer. (PR #587 by @aronprins)
- **Approval and clarify cards as composer flyouts** — cards slide up from behind the composer top edge rather than floating as disconnected banners. `overflow:hidden` outer + `translateY` inner animation clips travel. `focus({preventScroll:true})` prevents autoscrolling. (PR #587 by @aronprins)

### Fixed
- **Streaming lifecycle stabilised** — DOM order stays `user → thinking → tool cards → response` with no mid-stream jump. Live tool cards inserted inline before the live assistant row. Ghost empty assistant header suppressed on pure-tool turns. (PR #587 by @aronprins)
- **Session reload persistence hardened** — last-turn reasoning attached before `s.save()`, so hard-refresh right after a response preserves the thinking trace. `role=tool` rows preserved in `S.messages`. CLI-session tool-result fallback parses output envelopes and attaches snippets to matching cards. (PR #587 by @aronprins)
- **Workspace panel first-paint flash fixed** — `[data-workspace-panel]` attribute set at document parse time via inline script. (PR #587 by @aronprins)

### Added
- `docs/ui-ux/index.html` — static inventory of every message-area element loading live `static/style.css`. (PR #587 by @aronprins)
- `docs/ui-ux/two-stage-proposal.html` — proposal page for the two-stage plan/execute flow (#536). (PR #587 by @aronprins)

## [v0.50.69] — 2026-04-16

### Fixed
- **Docker: workspace file browser no longer appears empty on macOS** — `docker_init.bash` now auto-detects the correct `WANTED_UID` and `WANTED_GID` from the mounted `/workspace` directory at startup. On macOS, host UIDs start at 501 (not 1000), so the default value of 1024 caused the container user to run as a different UID than the files, making the workspace appear empty. The auto-detect reads `stat -c '%u'` on `/workspace` and uses it when no explicit `WANTED_UID` is set — falling back to 1024 if the path doesn't exist or returns 0 (root). Setting `WANTED_UID` explicitly in a `.env` file still takes full precedence. (Closes #569)
- **Session message count inconsistency resolved** — the topbar already correctly shows only visible messages (excluding `role='tool'` tool-call entries). The sidebar previously showed raw `message_count` which included tool messages, but PR #584 removed that display entirely — there is no longer any count displayed in the sidebar. No code change needed; documenting with regression tests. (Closes #579)

## [v0.50.68] — 2026-04-16

### Fixed
- **Light theme: add/rename folder dialogs now use correct light colors** — `.app-dialog`, `.app-dialog-input`, `.app-dialog-btn`, `.app-dialog-close`, and `.file-rename-input` had hardcoded dark-mode backgrounds with no light-theme overrides. Dialog backgrounds, borders, and inputs now adapt correctly to the light theme. (Closes #594)
- **Workspace panel no longer snaps open then immediately closed** — on page load, `boot.js` was restoring the panel open/closed state from `localStorage` before knowing whether the loaded session has a workspace. `syncWorkspacePanelState()` then snapped it closed, causing a visible jank. The restore is now deferred until after `loadSession()` and only applied when the session actually has a workspace. (Closes #576)
- **Model dropdown reflects CLI model changes without server restart** — `/api/models` was returning a startup-cached snapshot of `config.yaml`. The fix adds a mtime-based reload check: if `config.yaml` has changed on disk since last read, the cache is refreshed before building the model list. Page refresh now picks up CLI model changes immediately. (Closes #585)
- **Docker Compose: macOS users guided on UID/GID setup** — the `docker-compose.yml` comment for `WANTED_UID`/`WANTED_GID` now explicitly notes that macOS UIDs start at 501 (not 1000) and tells users to run `id -u`/`id -g`. Also clarifies that the default `${HOME}/.hermes` volume mount works on both macOS and Linux. (Closes #567)
- **Voice transcription already shows "Transcribing…" spinner** — issue #590 noted that no feedback was shown between pressing stop and text appearing. This was already implemented (`setComposerStatus('Transcribing…')` fires before the fetch in `_transcribeBlob`). Confirmed and documented; closing as already fixed.

## [v0.50.67] — 2026-04-16

### Added
- **Subpath mount support** — Hermes WebUI can now be served behind a reverse proxy at any subpath (e.g. `/hermes-webui/` via Tailscale Serve, nginx, or Caddy). A dynamic `<base href>` is injected as the first script in `<head>`, and all client-side URL references are converted from absolute to relative. The server-side route handlers are unchanged. No configuration needed — works transparently for both root (`/`) and subpath deployments. (PR #588 by @vcavichini)

## [v0.50.66] — 2026-04-16

### Fixed
- **WebUI agent now receives full runtime route from provider resolver** — previously `api_mode`, `acp_command`, `acp_args`, and `credential_pool` were not forwarded into `AIAgent.__init__()` in the WebUI streaming path. Users switching between Codex accounts or using credential pools found the switch worked in the CLI but not the WebUI. The fix passes all four fields from the resolved runtime into the agent constructor. (PR #582 by @suinia)

## [v0.50.65] — 2026-04-16

### Fixed
- **`HERMES_WEBUI_SKIP_ONBOARDING=1` now works unconditionally** — previously the env var was gated on `chat_ready=True`, so hosting providers (e.g. Agent37) that set it but hadn't yet wired up a provider key would still see the wizard on every page load. The var is now honoured as a hard operator override regardless of `chat_ready`. If you set it, the wizard is gone. (Fixes skip-onboarding regression)
- **Onboarding wizard can no longer overwrite config or env files when `SKIP_ONBOARDING` is set** — `apply_onboarding_setup` now checks the env var first and refuses to touch `config.yaml` or `.env` if it is set. This is a belt-and-suspenders guard: even if a stale JS bundle somehow triggers the setup endpoint while `SKIP_ONBOARDING` is active, no files are written.


## [v0.50.64] — 2026-04-16

### Changed
- **Sidebar session items decluttered** — the meta row under every session title (message count, model slug, and source-tag badge) has been removed. Each session now renders as a single line: title + relative-time bucket headers. The visible session count at a typical viewport height roughly doubles. The `source_tag` field is still populated on the session object and available for a future tooltip or filter facet. `[SYSTEM:]`-prefixed gateway titles fall back to `"Session"` rather than leaking system-prompt content. Removes `_formatSourceTag()`, `.session-meta`, `cli-session`, `[data-source=…]`, `_SOURCE_DISPLAY`, and the associated CSS badge rules. (PR #584 by @aronprins)

## [v0.50.63] — 2026-04-16

### Fixed
- **Onboarding wizard no longer fires for non-standard providers** — providers outside the quick-setup list (`minimax-cn`, `deepseek`, `xai`, `gemini`, etc.) were always evaluated as `chat_ready=False` because `_provider_api_key_present()` only knew the four built-in env-var names. Those users saw the wizard on every page load and risked `config.yaml` being silently overwritten if the provider dropdown defaulted. The fix adds a `hermes_cli.auth.get_auth_status()` fallback covering every API-key provider in the full registry, and tightens the frontend guard so an unchanged unsupported-provider form never POSTs. (Fixes #572, PR #575)
- **MCP server toolsets now included in WebUI agent sessions** — previously the WebUI read `platform_toolsets.cli` directly from `config.yaml`, which only carries built-in toolset names. MCP server names (`tidb`, `kyuubi`, etc.) were silently dropped, so MCP tools configured via `~/.hermes/config.yaml` were unavailable in chat. The fix delegates to `hermes_cli.tools_config._get_platform_tools()` — the same code the CLI uses — which merges all enabled MCP servers automatically. Falls back gracefully when `hermes_cli` is unavailable. (PR #574 by @renheqiang)

## [v0.50.62] — 2026-04-16

### Fixed
- **Docker startup no longer hard-exits when hermes-agent source is not mounted** — previously `docker_init.bash` would call `error_exit` if the agent source directory was missing, preventing the container from starting at all. Users running a minimal `docker run` without the two-container compose setup hit this immediately. Now the script checks for the directory and `pyproject.toml` first, prints a clear warning explaining reduced functionality, and continues startup. The WebUI already has `try/except` fallbacks throughout for when hermes-agent is unavailable. (Fixes #570, PR #573)

## [v0.50.61] — 2026-04-16

### Added
- **Office file attachments** — `.xls`, `.xlsx`, `.doc`, and `.docx` files can now be selected via the attach button. The file picker's `accept` attribute is extended to include Office MIME types, and the backend MIME map is updated so these files are served with correct content-type headers when accessed through the workspace file browser. Files are saved as binary to the workspace; the AI can reference them by name the same way it does PDFs. (PR #566 by @renheqiang)

## [v0.50.60] — 2026-04-16

### Changed
- **Test robustness** — two onboarding setup tests (`test_setup_allowed_with_confirm_overwrite`, `test_setup_allowed_when_no_config_exists`) now skip gracefully when PyYAML is not installed in the test environment, matching the pattern already used in `test_onboarding_mvp.py`. No production code changed. (PR #564)

## [v0.50.59] — 2026-04-16

### Fixed
- **False "Connection lost" message after settled stream** — the UI no longer injects a fake `**Error:** Connection lost` assistant message when an SSE connection drops after the stream already completed normally. The fix tracks terminal stream states (`done`, `stream_end`, `cancel`, `apperror`) and, on a disconnect, fetches `/api/session` to confirm the session is settled before silently restoring it instead of calling the error path. Real failures still go through the error path as before. (Fixes #561, PR #562 by @halmisen)

## [v0.50.58] — 2026-04-16

### Fixed
- **Custom provider name in model dropdown** — when a `custom_providers` entry in `config.yaml` has a `name` field (e.g. `Agent37`), the model picker now shows that name as the group header instead of the generic `Custom` label. Multiple named providers each get their own group. Unnamed entries still fall back to `Custom`. Brings the web UI into parity with the terminal's provider display. (Fixes #557)

## [v0.50.57] — 2026-04-15

### Added
- **Auto-generated session titles** — after the first exchange, a background thread generates a concise title from the first user message and assistant reply, replacing the default first-message substring. Updates live in the UI via a new `title` SSE event. Manual renames are preserved; generation only runs once per session. Includes MiniMax token budget handling and a local heuristic fallback. (Fixes #495, PR #535 by @franksong2702)

### Changed
- **SSE stream termination** — streams now end with `stream_end` instead of `done` so the background title generation thread has time to emit the title update before the client disconnects.

## [v0.50.55] — 2026-04-15

### Fixed
- **Docker honcho extra** — `docker_init.bash` now installs `hermes-agent[honcho]` so `honcho-ai` is included in the venv on every fresh Docker build. Fixes `"Honcho session could not be initialized."` errors on rebuilt containers. (Fixes #553)
- **Version badge** — `index.html` version badge corrected to v0.50.55 (was missing the bump for this release).

## [v0.50.54] — 2026-04-15

### Changed
- **OpenRouter model list** — updated to 14 current models across 7 providers. All slugs verified live against the OpenRouter catalog. Removed `o4-mini`, old Gemini 2.x entries, and Llama 4. Added Claude Opus 4.6, GPT-5.4, Gemini 3.1 Pro Preview, Gemini 3 Flash Preview, DeepSeek R1, Qwen3 Coder, Qwen3.6 Plus, Grok 4.20, and Mistral Large. Both Claude 4.6 and 4.5 generations preserved. Fixed `grok-4-20` → `grok-4.20` slug and Gemini `-preview` suffixes.

## [v0.50.53] — 2026-04-15

### Fixed
- **Custom endpoint slash model IDs** — model IDs with vendor prefixes that are intrinsic (e.g. `zai-org/GLM-5.1` on DeepInfra) are now preserved when routing to a custom `base_url` endpoint. Previously, all prefixed IDs were stripped, causing `model_not_found` errors on providers that require the full vendor/model format. Known provider namespaces (`openai/`, `google/`, `anthropic/`, etc.) are still stripped as before. (Fixes #548, PR #549 by @eba8)

## [v0.50.52] — 2026-04-15

### Fixed
- **Simultaneous approval requests** — parallel tool calls that each require approval no longer overwrite each other. `_pending` is now a list per session; each entry gets a stable `approval_id` (uuid4) so `/api/approval/respond` can target a specific request. The UI shows a "1 of N pending" counter when multiple approvals are queued. Backward-compatible with old agent versions and old frontend clients. Adds 14 regression tests. (Fixes #527)

## [v0.50.51] — 2026-04-15

### Fixed
- **Orphaned tool messages** — conversation histories containing `role: tool` messages with no matching `tool_call_id` in a prior assistant message are now silently stripped before sending to the provider API. Fixes 400 errors from strictly-conformant providers (Mercury-2/Inception, newer OpenAI models). Adds 13 regression tests. (Fixes #534)

## [v0.50.50] — 2026-04-15

### Fixed
- **Code block syntax highlighting** — Prism theme now follows the active UI theme. Light mode uses the default Prism light theme; dark mode uses `prism-tomorrow`. Theme swaps happen immediately on toggle including on first load. Adds `id="prism-theme"` to the Prism CSS link so JavaScript can locate and swap it. (Closes #505, PR #530 by @mariosam95)

## [v0.50.49] — 2026-04-15

### Fixed
- **IME composition** — `isComposing` guard added to every Enter keydown handler so CJK/Japanese/Korean input method users never accidentally send mid-composition (fixes #531). Covers chat composer, command dropdown, session rename, project create/rename, app dialog, message edit, and workspace rename. Adds 3 regression tests. (PR #537 by @vansour)

## [v0.50.48] fix: toast when model is switched during active session (#419)

Synthesized from PRs #516 (armorbreak001), #517 and #518 (cloudyun888).

When a user switches the model via the model picker while a session already
has messages, a 3-second toast now reads: "Model change takes effect in
your next conversation." This avoids the confusing situation where the
dropdown shows the new model but the current conversation continues with
the original one.

The toast fires from `modelSelect.onchange` in `static/boot.js`, after the
existing provider-mismatch warning. It checks `S.messages.length > 0` (the
reliable in-memory array, always initialized by `loadSession`). The
`showToast` call is guarded with `typeof` for safety during boot.

Key differences from submitted PRs: placement in boot.js onchange (covers
all selection paths including chip dropdown, since `selectModelFromDropdown`
calls `sel.onchange`), and uses `S.messages` not `S.session.messages`.

4 new tests in `tests/test_provider_mismatch.py::TestModelSwitchToast`.

Total tests: 1272 (was 1268)


## [v0.50.47] fix/feat: batch fixes — root workspace, custom providers, cron cache, system theme

Synthesized from PRs #506, #507, #508, #509, #510, #514, #515, #519, #521.

### Fixes

**Allow /root as a workspace path** (PRs #510, #521 by @ccqqlo)
Removes `/root` from `_BLOCKED_SYSTEM_ROOTS` in `api/workspace.py`, so
deployments running as root (Docker, VPS) can set `/root` as their workspace
without a "system directory" rejection.

**Guard against split on missing [Attached files:]** (PR #521 by @ccqqlo)
`base_text` extraction in `api/streaming.py` now guards: `msg_text.split(...)[0]
if ... in msg_text else msg_text`. Previously split on the empty case returned
an empty string, causing attachment-matching to silently fail on messages with
no attachments.

**custom_providers models visible regardless of active provider** (#515, #519 by @shruggr, @cloudyun888)
`get_available_models()` in `api/config.py` no longer discards the 'custom'
provider from `detected_providers` when the user has `custom_providers` entries
in `config.yaml`. Previously, switching active_provider away from 'custom'
hid all custom model definitions from the picker.

**Cron skill picker cache invalidated on form open and skill save** (PRs #507, #508 by @armorbreak001)
`toggleCronForm()` now unconditionally nulls `_cronSkillsCache` before fetching,
so skills created in the same session appear immediately. `submitSkillSave()` also
nulls `_cronSkillsCache` after a successful write, mirroring the existing
`_skillsData = null` pattern. Fixes #502.

### Features

**System (auto) theme following OS prefers-color-scheme** (#504 / PRs #506, #509, #514 by @armorbreak001, @cloudyun888)
New "System (auto)" option in the theme picker follows the OS dark/light preference
via `window.matchMedia`. Changes:
- `static/boot.js`: `_applyTheme(name)` helper resolves 'system' via matchMedia,
  sets `data-theme`, and registers a MQ change listener for live OS tracking.
  `loadSettings()` calls `_applyTheme()` instead of direct assignment.
- `static/index.html`: flicker-prevention script resolves 'system' before first
  paint. Adds "System (auto)" as first theme option. onchange calls `_applyTheme()`.
- `static/commands.js`: adds 'system' to valid `/theme` names.
- `static/panels.js`: `_settingsThemeOnOpen` reads from localStorage (preserves
  'system' string). `_revertSettingsPreview` calls `_applyTheme()`.
- `static/i18n.js`: cmd_theme description lists 'system' first in all 5 locales.

### Tests

22 new tests in `tests/test_batch_fixes.py`.

Total tests: 1268 (was 1246)


## [v0.50.46] feat: clarify dialog flow and refresh recovery (#520)

Adds a full clarify dialog UX for interactive agent questions — modeled after
the approval card but for free-form clarification prompts.

### Backend

New `api/clarify.py` module with a per-session pending queue backed by
`threading.Event` unblocking, gateway notify callbacks, duplicate deduplication
while unresolved, and resolve/clear helpers.

Three new HTTP endpoints in `api/routes.py`:
- `GET /api/clarify/pending` — poll for pending clarify prompt
- `POST /api/clarify/respond` — resolve the pending prompt
- `GET /api/clarify/inject_test` — loopback-only, for automated tests

`api/streaming.py` wires `clarify_callback` into `AIAgent.run_conversation()`.
Emits `clarify` SSE events; blocks the tool flow until the user responds, times
out (120s), or the stream is cancelled. Also adds a 409 guard on `chat/start` so
page-refresh races return the active stream id instead of starting a duplicate.

### Frontend

`static/messages.js`: clarify card with numbered choices, Other button, and
free-text input. Composer is locked while clarify is active. DOM self-heals if
the card node is removed during a rerender. SSE `clarify` event listener plus
1.5s fallback polling. Session switch and reconnect start/stop clarify polling.
409 conflict flow reattaches to the active stream and queues the user message.
`CLARIFY_MIN_VISIBLE_MS = 30000` timer dedup mirrors the approval card pattern.

`static/ui.js`: `lockComposerForClarify()` / `unlockComposerForClarify()` with
saved-state restore. `updateSendBtn()` respects the disabled state.

`static/sessions.js`: `loadSession()` starts/stops clarify polling on switch
and inflight reattach.

`static/index.html` / `static/style.css`: clarify card markup with ARIA roles
and full responsive/mobile styles.

`static/i18n.js`: 6 new keys in all 5 locales (en, es, de, zh-Hans, zh-Hant).

### Tests

- `tests/test_clarify_unblock.py`: 14 new tests covering queue resolution,
  notify callbacks, clear-on-cancel, and all three HTTP endpoints.
- `tests/test_sprint30.py`: 31 new clarify tests (HTML markup, CSS classes,
  i18n keys, messages.js functions, streaming registration flags).
- `tests/test_sprint36.py`: expand search window for `setBusy` check after
  additional `stopClarifyPolling()` calls push it past the old 800-char limit.

Total tests: 1246 (was 1209)

Co-authored-by: franksong2702


## [v0.50.45] fix: suppress N/A source_tag in session list (#429)

Feishu and WeChat sessions (and any session with an unrecognised or legacy
`source` value in hermes-agent's state.db) were showing "N/A" or raw tag
strings in the session list sidebar.

Three fixes in `static/sessions.js`:

1. `_formatSourceTag()` now returns `null` for unrecognised tags instead of
   the raw string. Known platforms (telegram, discord, slack, feishu, weixin,
   cli) still display their human-readable label. Unknown/legacy values are
   silently suppressed.

2. The `metaBits` push is guarded: stores the result in `_stLabel` and only
   pushes if it is non-null. Prevents `null` or unrecognised platform names
   from appearing in the session metadata line.

3. The `[SYSTEM:]` title fallback now uses `_SOURCE_DISPLAY[s.source_tag] ||
   'Gateway'` — the raw `s.source_tag` middle term is removed so a session
   whose source is "N/A" does not use that as its visible title.

No backend changes. The upstream issue (hermes-agent not reliably setting
`source` for older Feishu/WeChat sessions) is tracked separately.

7 new tests in `tests/test_issue429.py`. Updated 1 existing test in
`tests/test_sprint40_ui_polish.py` to match the new guarded push pattern.

- Total tests: 1202 (was 1195)

## [v0.50.44] fix: code-in-table CSS sizing + markdown image rendering (#486, #487)

**CSS: inline code inside table cells** (fixes #486)

Inline `` `code` `` spans inside `<td>` and `<th>` cells were rendering too
large relative to the cell height — the `.msg-body code` rule sets `12.5px`
which sits awkward against the table's `12px` base font.

Fix: added two targeted rules in `static/style.css`:

    .msg-body td code,.msg-body th code { font-size:0.85em; padding:1px 4px; vertical-align:baseline; }
    .preview-md td code,.preview-md th code { font-size:0.85em; padding:1px 4px; vertical-align:baseline; }

Covers both the chat message surface (`.msg-body`) and the markdown preview
panel (`.preview-md`).

**JS renderer: `![alt](url)` image syntax** (fixes #487)

Standard markdown image syntax was not handled by `renderMd()`. The `!` was
left as a stray character and `[alt](url)` was consumed by the link pass,
producing `! <a href="url">alt</a>` instead of an `<img>`.

Fix: added an image pass to both `inlineMd()` (for images in table cells,
list items, blockquotes, headings) and the outer `renderMd()` pipeline (for
images in plain paragraphs):

- Regex: `![alt](https?://url)` — only `http://` and `https://` URIs accepted;
  `javascript:` and `data:` URIs cannot match.
- Alt text passes through `esc()` — XSS-safe.
- URL double-quotes percent-encoded to `%22` — attribute breakout prevented.
- Reuses `.msg-media-img` class — same click-to-zoom and max-width styling as
  agent-emitted `MEDIA:` images.
- `img` added to `SAFE_TAGS` allowlist so the generated `<img>` is not escaped.
- In `inlineMd()`: image pass runs while the `_code_stash` is still active,
  so `![alt](url)` inside a backtick span stays protected and is never rendered
  as an image. A new `_img_stash` (`\x00G`) protects rendered `<img>` tags
  from the autolink pass touching `src=` values.

**Tests**

45 new tests in `tests/test_issue486_487.py`:
- 13 CSS source checks and rendering tests for #486
- 22 JS source checks and rendering tests for #487
- 10 combination edge cases (code + image + link all in same table)

- Total tests: 1195 (was 1150)

## [v0.50.43] fix: markdown link rendering + KaTeX CSP fonts

**Markdown link rendering — `renderMd()` in `static/ui.js`** (PR #475, fixes #470)

Three related bugs fixed:

1. **Double-linking via autolink pass** — `[label](url)` was converted to `<a href="...">`, then the bare-URL autolink pass re-matched the URL sitting inside `href="..."` and wrapped it in a second `<a>` tag. Fixed with three stash/restore layers: `\x00L` (inlineMd labeled links), `\x00A` (existing `<a>` tags before outer link pass), `\x00B` (existing `<a>` tags before autolink pass).

2. **`esc()` on `href` values corrupts query strings** — `esc()` is HTML-entity encoding; applying it to URLs converted `&` → `&amp;` in query strings. Removed `esc()` from href values in all three locations. Display text (link labels) still uses `esc()` for XSS safety. `"` in URLs replaced with `%22` (URL encoding) to close the attribute-injection vector identified during review.

3. **Backtick code spans inside `**bold**` rendered as `&lt;code&gt;`** — `esc()` was applied to code spans after bold/italic processing. Added `\x00C` stash to protect backtick spans in `inlineMd()` before bold/italic regex runs.

**Security audit:** `javascript:` injection blocked by `https?://` prefix requirement. `"` attribute breakout fixed by `.replace(/"/g, '%22')`. Label/display text still HTML-escaped.

24 tests in `tests/test_issue470.py`.

**KaTeX CSP font-src** (fixes #477)

`api/helpers.py` CSP `font-src` now includes `https://cdn.jsdelivr.net` so KaTeX math rendering fonts load correctly. Previously ~50 CSP font-blocking errors appeared in the console on any page with math content. The CDN was already allowed in `script-src` and `style-src` for KaTeX JS/CSS — this extends the same allowance to fonts.

3 tests in `tests/test_issue477.py`.

- Total tests: 1150 (was 1130)

## [v0.50.42] fix: session display + model UX polish (sprint 42)

**Context indicator always shows latest usage** (PR #471, fixes #437)
The context ring/indicator in the composer footer was reading token counts and cost
from the stored session snapshot with `||` — meaning stale non-zero values from
previous turns always won over a fresh `0` from the current turn. Replaced all six
field merges with a `_pick(latest, stored, dflt)` helper that correctly prefers the
latest usage when it's a real value (including `0`).

**System prompt no longer leaks as gateway session title** (PR #472, fixes #441)
Telegram, Discord, and CLI gateway sessions inject a system message before any user
turn. When the session title is set from this message, the sidebar shows
`[SYSTEM: The user has inv...` instead of a meaningful name. Added a guard in
`_renderOneSession()`: if `cleanTitle` starts with `[SYSTEM:`, replace it with the
platform display name (`Telegram session`, `Discord session`, etc.).

**Thinking/reasoning panel persists across page reload** (PR #473, fixes #427)
The full chain-of-thought from Claude, Gemini, and DeepSeek thinking models was lost
after streaming completed and on every page reload. Two-part fix:
- `api/streaming.py`: `on_reasoning()` now accumulates `_reasoning_text`; before the
  session is serialised at stream end, `_reasoning_text` is injected into the last
  assistant message so it's stored in the session JSON
- `static/messages.js`: in the `done` SSE handler, `reasoningText` is also patched
  onto the last assistant message as a belt-and-suspenders client-side fallback

**Custom model ID input in model picker** (PR #474, fixes #444)
Users who need a model not in the curated list (~30 models) can now type any model
ID directly in the dropdown. A text input at the bottom of the model picker lets
users enter any string (e.g. `openai/gpt-5.4`, `deepseek/deepseek-r2`, or any
provider-prefixed ID) and press Enter or click + to use it immediately.
i18n keys added to en, es, zh.

- Total tests: 1130 (was 1117)

## [v0.50.41] feat(ui): render MEDIA: images inline in web UI chat (fixes #450)

When the agent outputs `MEDIA:<path>` tokens — screenshots from the browser tool,
generated images, vision outputs — the web UI now renders them **inline in the chat**,
the same way Claude.ai handles images. No more relaying screenshots through Telegram.

**How it works:**
- Local image path (`MEDIA:/tmp/screenshot.png`): rendered as `<img>` via `/api/media?path=...`
- HTTP(S) URL to image (`MEDIA:https://example.com/img.png`): `<img>` directly from the URL
- Non-image file (`MEDIA:/tmp/report.pdf`): styled download link (📎 filename)
- Click any inline image to toggle full-size zoom

**New endpoint — `GET /api/media?path=<encoded-path>`:**
- Path allowlist: `~/.hermes/`, `/tmp/`, active workspace — covers all agent output locations
- Auth-gated: requires valid session cookie when auth is enabled
- Inline image MIME types: PNG, JPEG, GIF, WebP, BMP
- SVG always served as download attachment (XSS prevention)
- RFC 5987-compliant `Content-Disposition` headers (handles Unicode filenames)
- `Cache-Control: private, max-age=3600`

**Security:**
- Original version had `~` (entire home dir) as an allowed root — **fixed** by independent reviewer
- Restricted to `~/.hermes/`, `/tmp/`, and active workspace only
- `Path.resolve()` + `commonpath` checks prevent symlink traversal

**Changes:**
- `api/routes.py`: `_handle_media()` handler + `/api/media` route
- `static/ui.js`: `MEDIA:` stash in `renderMd()` (runs before `fence_stash`, stash token `\x00D`)
- `static/style.css`: `.msg-media-img` (480px max-width, zoom-on-click), `.msg-media-link`
- `tests/test_media_inline.py`: 19 new tests (static analysis + integration)

- Total tests: 1117 (was 1098)

## [v0.50.40] feat: session UI polish + parallel test isolation

**Session sidebar improvements:**
- `static/sessions.js` + `style.css`: Hide session timestamps to give titles full available width — no more title truncation from inline timestamps (PR #449)
- `static/style.css`: Active session title now uses `var(--gold)` theme variable instead of hardcoded `#e8a030` — adapts correctly across all 7 themes (PR #451, fixes #440)
- `api/models.py` + `api/gateway_watcher.py`: Return `None` instead of the string `'unknown'` for missing gateway session model — Telegram sessions no longer show `telegram · unknown` (PR #452, fixes #443)
- `static/style.css` + `static/sessions.js`: Mute Telegram badge from saturated `#0088cc` to `rgba(0, 136, 204, 0.55)`. Add `_formatSourceTag()` helper mapping platform IDs to display names (`telegram` → `via Telegram`) (PR #453, fixes #442)

**Bug fixes:**
- `api/config.py` `resolve_model_provider()`: Strip provider prefix from model ID when a custom `base_url` is configured (`openai/gpt-5.4` → `gpt-5.4`) — fixes broken chats after switching to a custom endpoint (PR #454, fixes #433)
- `static/panels.js` `switchToProfile()`: Apply profile default workspace to new session created during profile switch — workspace chip no longer shows "No active workspace" after switching profiles mid-conversation (PR #455, fixes #424)

**Test infrastructure:**
- `tests/conftest.py` + `tests/_pytest_port.py` (new): Auto-derive unique port and state dir per worktree from repo path hash (range 20000-29999). Running pytest in two worktrees simultaneously no longer causes port conflicts. All 43 test files updated from hardcoded `BASE = "http://127.0.0.1:8788"` to `from tests._pytest_port import BASE` (PR #456)

- Total tests: 1098 (was 1078)

## [v0.50.39] fix: orphan gateway sessions + first-password-enablement session continuity

Two bug fixes:

**PR #423 — Fix orphan gateway sessions in sidebar (@aronprins, fix by maintainer)**
`gateway_watcher.py`'s `_get_agent_sessions_from_db()` was missing the
`HAVING COUNT(m.id) > 0` clause that `get_cli_sessions()` already had. Sessions
with no messages (e.g. created then abandoned before any turns) would appear in the
sidebar via the SSE watcher stream even after the initial page load filtered them out.
One-line SQL fix applied to both query paths.

**PR #434 — First-password-enablement session continuity (@SaulgoodMan-C)**
When a user enables a password for the first time via POST `/api/settings`,
the current browser session was being terminated — requiring the user to log in
again immediately after setting their password. Fix: the response now includes
`auth_enabled`, `logged_in`, and `auth_just_enabled` fields, and issues a
`hermes_session` cookie when auth is first enabled, so the browser remains logged in.
Also: legacy `assistant_language` key is now dropped from settings on next save.
New i18n keys for password replacement/keep-existing states (en, es, de, zh, zh-Hant).

- `api/config.py`: `_SETTINGS_LEGACY_DROP_KEYS` removes `assistant_language` on load
- `api/routes.py`: first-password-enable session continuity with `auth_just_enabled` flag
- `static/panels.js`: `_setSettingsAuthButtonsVisible()` + `_applySavedSettingsUi()` helpers
- `static/i18n.js`: password state i18n keys across 5 locales
- `tests/test_sprint45.py`: 3 new integration tests (auth continuity + legacy key cleanup)

- Total tests: 1078 (was 1075)


## [v0.50.38] feat: mobile nav cleanup, Prism syntax highlighting, zh-CN/zh-Hant i18n

Three community contributions combined:

**PR #425 — Remove mobile bottom nav (@aronprins)**
The fixed iOS-style bottom navigation bar on phones has been removed. The sidebar drawer
tabs already handle all navigation — the bottom nav was redundant and consumed ~56px of
vertical chat space. `test_mobile_layout.py` updated with `test_mobile_bottom_nav_removed()`
and new sidebar nav coverage tests.

**PR #426 — Prism syntax highlighting with light + dark theme token colors (@GiggleSamurai)**
Fenced code blocks now emit `class="language-{lang}"` on `<code>` elements, enabling Prism's
autoloader to apply token-level syntax highlighting. Added 36-line `:root[data-theme="light"]`
token color overrides scoped to light theme only; dark/dim/monokai/nord themes unaffected.
Background guard uses `var(--code-bg) !important` to prevent Prism's dark background from
overriding theme variables. 2 new regression tests in `test_issue_code_syntax_highlight.py`.

**PR #428 — zh-CN/zh-Hant i18n hardening (@vansour)**
Pluggable `resolvePreferredLocale()` function with smart zh-CN/zh-SG/zh-TW/zh-HK variant
mapping. Full zh-Simplified and zh-Traditional locale blocks added to `i18n.js`. Login page
locale routing updated in `api/routes.py` (`_resolve_login_locale_key()` helper). Hardcoded
strings in `panels.js` cron UI extracted to i18n keys. 3 new test files:
`test_chinese_locale.py`, `test_language_precedence.py`, `test_login_locale.py`.

- Total tests: 1075 (was 1063)

## [v0.50.37] fix(onboarding): skip wizard when Hermes is already configured

Fixes #420 — existing Hermes users with a valid `config.yaml` were shown the first-run
onboarding wizard on every WebUI load because the only completion gate was
`settings.onboarding_completed` in the WebUI's own settings file. Users who configured
Hermes via the CLI before the WebUI existed had no such flag, so the wizard always fired
and could silently overwrite their working config.

**Changes:**
1. `api/onboarding.py` `get_onboarding_status()`: auto-complete when `config.yaml` exists
   AND `chat_ready=True`. Existing configured users are never shown the wizard.
2. `api/onboarding.py` `apply_onboarding_setup()`: refuse to overwrite an existing
   `config.yaml` without `confirm_overwrite=True` in the request body. Returns
   `{error: "config_exists", requires_confirm: true}` for the frontend to handle.
3. `static/index.html`: "Skip setup" button added to wizard footer — users are never
   trapped in the wizard.
4. `static/onboarding.js`: `skipOnboarding()` calls `/api/onboarding/complete` without
   modifying config, then closes the overlay.
5. `static/boot.js`: Escape key now dismisses the onboarding overlay.
6. `static/i18n.js`: `onboarding_skip` / `onboarding_skipped` keys added to en + es locales.
7. `tests/test_onboarding_existing_config.py`: 8 new unit tests covering gate logic and
   overwrite guard.

- Total tests: 1063 (was 1055)


## [v0.50.36] fix: workspace list cleaner — allow own-profile paths, remove brittle string filter

Two bugs in `_clean_workspace_list()` caused workspace additions to silently disappear on the next `load_workspaces()` call, breaking `test_workspace_add_no_duplicate` and `test_workspace_rename` (and potentially causing real-world workspace list corruption):

**Bug 1 — Brittle string filter removed:** `if 'test-workspace' in path or 'webui-mvp-test' in path: continue` dropped any workspace path containing those substrings. In the test server, `TEST_WORKSPACE` is `~/.hermes/profiles/webui/webui-mvp-test/test-workspace`, so every workspace added during tests was silently discarded on the next `load_workspaces()` call. The `p.is_dir()` check already handles genuinely non-existent paths — the string filter was redundant and harmful.

**Bug 2 — Cross-profile filter was too broad:** `if p is under ~/.hermes/profiles/: skip` was designed to block cross-profile workspace leakage, but it also removed paths under the *current* profile's own directory (e.g. `~/.hermes/profiles/webui/...`). Fixed: now only skips paths under `profiles/` that are NOT under the current profile's own `hermes_home`.

- `api/workspace.py`: remove string-match filter; fix cross-profile check to allow own-profile paths
- All 1055 tests now pass (was 1053 pass + 2 fail)

## [v0.50.35] fix: workspace trust boundary — cross-platform, multi-workspace support

v0.50.34's workspace trust check was too restrictive: it required all workspaces to be under `DEFAULT_WORKSPACE` (/home/hermes/workspace), which blocked every profile-specific workspace (~/CodePath, ~/hermes-webui-public, ~/WebUI, ~/Camanji, etc.) and prevented switching between workspaces at all.

Replaced with a three-layer model that works cross-platform and supports multiple workspaces per profile:

1. **Blocklist** — `/etc`, `/usr`, `/var`, `/bin`, `/sbin`, `/boot`, `/proc`, `/sys`, `/dev`, `/root`, `/lib`, `/lib64`, `/opt/homebrew` always rejected, closing the original CVSS 8.8 vulnerability
2. **Home-directory check** — any path under `Path.home()` is trusted; `Path.home()` is cross-platform (`~/...` on Linux/macOS, `C:\\Users\\...` on Windows); allows all profile workspaces simultaneously since they don't need to share a single ancestor
3. **Saved-workspace escape hatch** — paths already in the profile's saved workspace list are trusted regardless of location, covering self-hosted deployments with workspaces outside home (`/data/projects`, `/opt/workspace`, etc.)

- `api/workspace.py`: rewritten `resolve_trusted_workspace()` with the three-layer model
- `tests/test_sprint3.py`: updated error-message assertions from `"trusted workspace root"` → `"outside"` (covers both old and new error strings)
- 1053 tests total (unchanged)

## [v0.50.34] fix(workspace): restrict session workspaces to trusted roots [SECURITY] (#415)

Session creation, update, chat-start, and workspace-add endpoints accepted arbitrary caller-supplied workspace paths. An authenticated caller could repoint a session to any directory the process could access, then use normal file read/write APIs to operate on attacker-chosen locations. CVSS 8.8 High (AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H).

- `api/workspace.py`: new `resolve_trusted_workspace(path)` helper — resolves path, checks existence + is_dir, enforces `path.relative_to(_BOOT_DEFAULT_WORKSPACE)` containment; requests outside the WebUI workspace root fail with 400
- `api/routes.py`: apply `resolve_trusted_workspace()` to all four entry points — `POST /api/session/new`, `POST /api/session/update`, `POST /api/chat/start` (workspace override), `POST /api/workspaces/add`
- `tests/test_sprint3.py`, `tests/test_sprint5.py`: regression tests for rejected outside-root paths on all four entry points; existing workspace tests updated to use trusted child directories
- `tests/test_sprint1.py`, `tests/test_sprint4.py`, `tests/test_sprint13.py`: aligned to new trusted-root contract
- Fix: use `_BOOT_DEFAULT_WORKSPACE` (respects `HERMES_WEBUI_DEFAULT_WORKSPACE` env for test isolation) rather than `_profile_default_workspace()` (reads agent terminal.cwd which may differ)
- Original PR by @Hinotoi-agent (cherry-picked; branch was 6 commits behind master)
- 1053 tests total (up from 1051; 2 pre-existing test_sprint5 isolation failures on master, not introduced by this PR)

## [v0.50.33] fix: workspace panel close button — no duplicate X on desktop, mobile X respects file preview (#413)

**Bug 1 — Duplicate X on desktop:** `#btnClearPreview` (the X icon) was always visible regardless of panel state, so desktop browse mode showed both the chevron collapse button and the X simultaneously. Fixed in `syncWorkspacePanelUI()`: on non-compact (desktop) viewports, `clearBtn.style.display` is set to `none` when no file preview is open, and cleared (shown) when a preview is active.

**Bug 2 — Mobile X collapsed the whole panel instead of dismissing the file:** `.mobile-close-btn` was wired to `closeWorkspacePanel()` directly, bypassing the two-step close logic. Fixed by changing `onclick` to `handleWorkspaceClose()`, which calls `clearPreview()` first if a file is open, and falls through to `closeWorkspacePanel()` otherwise.

**Also:** widened the `test_server_delete_invalidates_index` window from 600 → 1200 chars to accommodate the session_id validation guards added in v0.50.32 (#412).

- `static/boot.js`: `syncWorkspacePanelUI()` sets `clearBtn.style.display` based on `hasPreview` when `!isCompact`
- `static/index.html`: `.mobile-close-btn` onclick changed from `closeWorkspacePanel()` to `handleWorkspaceClose()`
- `tests/test_sprint44.py`: 10 new regression tests covering both fixes
- `tests/test_mobile_layout.py`: updated to accept `handleWorkspaceClose()` as valid onclick
- `tests/test_regressions.py`: widened delete handler window to 1200 chars
- 1051 tests total (up from 1041)

## [v0.50.32] fix(sessions): validate session_id before deleting session files [SECURITY] (#409)

`/api/session/delete` accepted arbitrary `session_id` values from the request body and built the delete path directly as `SESSION_DIR / f"{sid}.json"`. Because pathlib discards the prefix when `sid` is an absolute path, an attacker could supply `/tmp/victim` and cause the server to unlink `victim.json` outside the session store. Traversal-style values (`../../etc/target`) were also accepted. CVSS 8.1 High (AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:H).

- `api/routes.py`: validate `session_id` against `[0-9a-z_]+` allowlist (covers `uuid4().hex[:12]` WebUI IDs and `YYYYMMDD_HHMMSS_hex` CLI IDs) before path construction; resolve candidate path and enforce `path.relative_to(SESSION_DIR)` containment before unlinking; only invalidate session index on successful deletion path, not on rejected requests
- `tests/test_sprint3.py`: 2 new regression tests — absolute-path payload rejected and file preserved, traversal payload rejected and file preserved
- Original PR by @Hinotoi-agent (cherry-picked; branch was 4 commits behind master)
- 1041 tests total (up from 1039)

## [v0.50.31] fix: delegate all live model fetching to agent's provider_model_ids()

`_handle_live_models()` in `api/routes.py` previously maintained its own per-provider fetch logic and returned `not_supported` for Anthropic, Google, and Gemini. Now it delegates entirely to the agent's `hermes_cli.models.provider_model_ids()` — the single authoritative resolver — and `_fetchLiveModels()` in `ui.js` no longer skips any provider.

**What each provider now returns (live data where credentials are present, static fallback otherwise):**
- `anthropic` — live from `api.anthropic.com/v1/models` (API key or OAuth token with correct beta headers)
- `copilot` — live from `api.githubcopilot.com/models` with required Copilot headers
- `openai-codex` — Codex OAuth endpoint → `~/.codex/` cache → `DEFAULT_CODEX_MODELS`
- `nous` — live from Nous inference portal
- `deepseek`, `kimi-coding` — generic OpenAI-compat `/v1/models`
- `opencode-zen`, `opencode-go` — OpenCode live catalog
- `openrouter` — curated static list (live returns 300+ which floods the picker)
- `google`, `gemini`, `zai`, `minimax` — static list (non-standard or Anthropic-compat endpoints)
- All others — graceful static fallback from `_PROVIDER_MODELS`

The hardcoded lists in `_PROVIDER_MODELS` remain as credential-missing / network-unavailable fallbacks. `api/routes.py` shrank by ~100 lines. Updated 2 tests to reflect the improved behavior.

- 1039 tests total (up from 1038)

## [v0.50.30] fix: openai-codex live model fetch routes through agent's get_codex_model_ids()

`_handle_live_models()` was grouping `openai-codex` with `openai` and sending `GET https://api.openai.com/v1/models` — which returns 403 because Codex auth is OAuth-based via `chatgpt.com`, not a standard API key. The live fetch silently failed, so users only ever saw the hardcoded static list.

- `api/routes.py`: dedicated early-return branch for `openai-codex` that calls `hermes_cli.codex_models.get_codex_model_ids()` — the same resolver the agent CLI uses. Resolution order: live Codex API (if OAuth token available, hits `chatgpt.com/backend-api/codex/models`) → `~/.codex/` local cache (written by the Codex CLI) → `DEFAULT_CODEX_MODELS` hardcoded fallback. Users with a valid Codex session now get their exact subscription model list including any models not in the hardcoded list.
- `api/routes.py`: improved label generation for Codex model IDs (e.g. `gpt-5.4-mini` → `GPT 5.4 Mini`)
- `tests/test_opencode_providers.py`: structural regression test verifying the dedicated `openai-codex` branch exists and calls `get_codex_model_ids()`
- 1038 tests total (up from 1037)

## [v0.50.29] fix: correct tool call card rendering on session load after context compaction (closes #401) (#402)

- `static/sessions.js`: replace the flat B9 filter in `loadSession()` with a full sanitization pass that builds `origIdxToSanitizedIdx` — each `session.tool_calls[].assistant_msg_idx` is remapped to the new sanitized-array position as messages are filtered; for tool calls whose empty-assistant host was filtered out, they attach to the nearest prior kept assistant
- `static/sessions.js`: set `S.toolCalls=[]` instead of pre-filling from session-level `tool_calls` — this lets `renderMessages()` use its fallback derivation from per-message `tool_calls` (which already carry correct indices into the sanitized message array); the fix eliminates the "200+ tool cards all on the wrong message" symptom on context-compacted session load
- `tests/test_issue401.py`: 8 regression tests — 4 static structural checks and 4 behavioural Node.js tests covering index remapping, multiple consecutive empty assistants, no-filtering pass-through, and `tool`-role message exclusion
- Original PR by @franksong2702 (cherry-picked onto master; branch was 31 commits behind)
- 1037 tests total (up from 1029)

## [v0.50.28] fix: expand openai-codex model catalog to match DEFAULT_CODEX_MODELS

`_PROVIDER_MODELS["openai-codex"]` only listed `codex-mini-latest`, so profiles using the `openai-codex` provider (e.g. a CodePath profile with `default: gpt-5.4`) showed only one entry in the model dropdown. Updated to mirror the agent's authoritative `DEFAULT_CODEX_MODELS` list: `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, `codex-mini-latest`. Added 2 regression tests.

- 1029 tests total (up from 1027)

## [v0.50.27] feat: relative time labels in session sidebar (#394)

- `static/sessions.js`: new `_sessionCalendarBoundaries()` (DST-safe via `new Date(y,m,d)` construction), `_localDayOrdinal()`, `_formatSessionDate()` (includes year for dates from prior years); `_formatRelativeSessionTime()` now uses calendar midnight boundaries consistent with `_sessionTimeBucketLabel()` — no more label/bucket mismatch; all relative time strings call `t()` for localization; meta row only appended when non-empty (removes redundant group-header fallback); dead `ONE_DAY` constant removed
- `static/style.css`: add `session-item.active .session-title{color:#1a5a8a}` to light-theme block (fixes active title color in light mode)
- `static/i18n.js`: 11 new i18n keys (`session_time_*`) in both English and Spanish locale blocks; callable keys use arrow-function pattern consistent with existing `n_messages`
- `tests/test_session_sidebar_relative_time.py`: 5 tests — structural presence checks, behavioral Node.js tests via subprocess (yesterday/week boundary correctness, `just now` threshold, year-in-date for old sessions, full i18n key coverage for en+es)
- Original PR by @Jordan-SkyLF (two-pass review: blocking issues fixed in second commit)
- 1027 tests total (up from 1022)

## [v0.50.26] fix(sessions): redact sensitive titles in session list and search responses [SECURITY] (#400)

- `api/routes.py`: apply `_redact_text()` to session titles in all four response paths — `/api/sessions` merged list, `/api/sessions/search` empty-q, title-match, and content-match; use `dict(s)` copy before mutating to avoid corrupting the in-memory session cache
- `tests/test_session_summary_redaction.py`: 2 integration tests verifying `sk-` prefixed secrets in session titles are redacted from both list and search endpoint responses
- Original PR by @Hinotoi-agent (note: fix commit had a display artifact — `sk-` prefix was visually rendered as `***` in terminal output but the actual bytes were correct and the token was recognized by the redaction engine)
- 1022 tests total (up from 1020)

## [v0.50.25] Multi-PR batch: mobile scroll, import timestamps, profile security, mic fallback

### fix: restore mobile chat scrolling and drawer close (#397)
- `static/style.css`: `min-height:0` on `.layout` and `.main` (flex shrink chain fix); `-webkit-overflow-scrolling:touch`, `touch-action:pan-y`, `overscroll-behavior-y:contain` on `.messages`
- `static/boot.js`: call `closeMobileSidebar()` on new-conversation button and Ctrl+K shortcut so the transcript is visible immediately after starting a chat
- `tests/test_mobile_layout.py`: 41 new lines covering CSS fixes and both JS call sites
- Original PR by @Jordan-SkyLF

### fix: preserve imported session timestamps (#395)
- `api/models.py`: `Session.save(touch_updated_at=True)` — new flag; `import_cli_session()` accepts `created_at`/`updated_at` kwargs and saves with `touch_updated_at=False`
- `api/routes.py`: extract `created_at`/`updated_at` from `get_cli_sessions()` metadata and forward to import; post-import save also uses `touch_updated_at=False`
- `tests/test_gateway_sync.py`: +53 lines — integration test verifying imported session keeps original timestamp and sorts correctly; also fix session file cleanup in test finally block
- Original PR by @Jordan-SkyLF

### fix(profiles): block path traversal in profile switch and delete flows (#399) [SECURITY]
- `api/profiles.py`: new `_resolve_named_profile_home(name)` — validates name via `^[a-z0-9][a-z0-9_-]{0,63}$` regex then enforces path containment via `candidate.resolve().relative_to(profiles_root)`; use in `switch_profile()`
- `api/profiles.py`: add `_validate_profile_name()` call to `delete_profile_api()` entry
- `api/routes.py`: add `_validate_profile_name()` at HTTP handler level for both `/api/profile/switch` and `/api/profile/delete`
- `tests/test_profile_path_security.py`: 3 new tests — traversal rejected, valid name passes (cherry-picked from @Hinotoi-agent's PR, which was 62 commits behind master)

### feat: add desktop microphone transcription fallback (#396)
- `static/boot.js`: detect `_canRecordAudio`; keep mic button enabled when MediaRecorder available even without SpeechRecognition; full MediaRecorder recording → `/api/transcribe` fallback path with proper cleanup and error handling
- `api/upload.py`: add `transcribe_audio()` helper — temp file, calls transcription_tools, always cleans up
- `api/routes.py`: add `/api/transcribe` POST handler — CSRF-protected, auth-gated, 20MB limit
- `api/helpers.py`: change `Permissions-Policy` `microphone=()` → `microphone=(self)` (required for getUserMedia)
- `tests/test_voice_transcribe_endpoint.py`: 87 new lines (3 tests with mocked transcription)
- `tests/test_sprint19.py`: regression guard for microphone Permissions-Policy
- `tests/test_sprint20.py`: 3 updated tests for new fallback capability checks
- Original PR by @Jordan-SkyLF

- 1020 tests total (up from 1003)

## [v0.50.24] feat: opt-in chat bubble layout (closes #336)

- `api/config.py`: Add `bubble_layout` bool to `_SETTINGS_DEFAULTS` (default `False`) and `_SETTINGS_BOOL_KEYS` — new setting is opt-in, server-persisted, and coerced to bool on save
- `static/style.css`: 11 lines of CSS-only bubble layout — user rows `align-self:flex-end` / max-width 75%, assistant rows `flex-start`, all gated on `body.bubble-layout` class so the default full-width canvas is untouched; 700px responsive rule widens to 92%
- `static/boot.js`: Apply `body.bubble-layout` class from settings on page load; explicitly remove the class in the catch path so the feature stays off on API failure
- `static/panels.js`: Load checkbox state in `loadSettingsPanel`; write `body.bubble_layout` in `saveSettings` and immediately toggle `body.bubble-layout` class for live preview without a page reload
- `static/index.html`: Checkbox in the Appearance settings group, positioned between Show token usage and Show agent sessions
- `static/i18n.js`: English label + description keys; Spanish translations included in the same PR
- `tests/test_issue336.py`: 22 new tests covering config registration, JS class management in boot and panels, CSS selectors, HTML structure, i18n coverage for en+es, and API round-trip (default false, persist true/false, bool coercion)
- 1003 tests total (up from 981)

## [v0.50.23] Add OpenCode Zen and Go provider support (fixes #362)

- `api/config.py`: Add `opencode-zen` and `opencode-go` to `_PROVIDER_DISPLAY` — providers now show human-readable names in the UI instead of raw IDs
- `api/config.py`: Add full model catalogs for both providers to `_PROVIDER_MODELS` — Zen (pay-as-you-go credits, 32 models) and Go (flat-rate $10/month, 7 models) now show the correct model list in the dropdown instead of falling through to the unknown-provider fallback
- `api/config.py`: Add `OPENCODE_ZEN_API_KEY` / `OPENCODE_GO_API_KEY` to the env-var fallback detection path — providers are correctly detected as authenticated when keys are set in `.env`
- `tests/test_opencode_providers.py`: 6 new tests covering display registration, model catalog registration, and env-var detection for both providers
- 985 tests total (up from 979)

## [v0.50.22] Onboarding unblocked for reverse proxy / SSH tunnel deployments (fixes #390)

- `api/routes.py`: Onboarding setup endpoint now reads `X-Forwarded-For` and `X-Real-IP` headers before falling back to raw socket IP — reverse proxy (nginx/Caddy/Traefik) and SSH tunnel users are no longer incorrectly blocked
- Added `HERMES_WEBUI_ONBOARDING_OPEN=1` env var escape hatch for operators on remote servers who control network access themselves
- Error message now includes the env var hint so users know how to unblock themselves
- 18 new tests covering all IP resolution paths (`TestOnboardingIPLogic`, `TestOnboardingSetupEndpoint`)

> Living document. Updated at the end of every sprint.
> Repository: https://github.com/nesquena/hermes-webui

---

## [v0.50.21] Live reasoning, tool progress, and in-flight session recovery (PR #367)

- **Durable inflight reload recovery** (`static/ui.js`, `static/messages.js`): `saveInflightState` / `loadInflightState` / `clearInflightState` backed by `localStorage` (`hermes-webui-inflight-state` key, per-session, 10-minute TTL). Snapshots are saved on every token, tool event, and tool completion, and cleared when the run ends/errors/cancels. On a full page reload with an active stream, `loadSession()` hydrates from the snapshot before calling `attachLiveStream(..., {reconnecting:true})` — partial messages, live tool cards, and reasoning text all survive the reload.
- **Live reasoning cards during streaming** (`static/ui.js`, `static/messages.js`): The generic thinking spinner now upgrades to a live reasoning card when the backend streams reasoning text. `_thinkingMarkup(text)` and `updateThinking(text)` centralize the markup so the spinner and card share the same DOM slot. Works with models that emit reasoning via the agent's `reasoning_callback` or `tool_progress_callback`.
- **`tool_complete` SSE events** (`api/streaming.py`, `static/messages.js`): Tool progress callback now accepts the current agent signature `on_tool(*cb_args, **cb_kwargs)` — handles both the old 3-arg `(name, preview, args)` form and the new 4-arg `(event_type, name, preview, args)` form. `tool.completed` events transition live tool cards from running to done cleanly.
- **In-flight session state stable across switches** (`static/messages.js`, `static/sessions.js`): `attachLiveStream` refactored out of `send()` into a standalone function; partial assistant text mirrored into `INFLIGHT` state on every token; `data-live-assistant` DOM anchor preserved across `renderMessages()` calls so switching away and back doesn't lose or duplicate live output.
- **Reload recovery** (`api/models.py`, `api/routes.py`, `api/streaming.py`, `static/sessions.js`): `active_stream_id`, `pending_user_message`, `pending_attachments`, and `pending_started_at` now persisted on the session object before streaming starts and cleared on completion (or exception). `/api/session` returns these fields. After a page reload or session switch, `loadSession()` detects `active_stream_id` and calls `attachLiveStream(..., {reconnecting:true})` to reattach to the live SSE stream.
- **Session-scoped message queue** (`static/ui.js`, `static/messages.js`): Global `MSG_QUEUE` replaced with `SESSION_QUEUES` keyed by session ID. Queued follow-up messages are associated with the session they were typed in and only drained when that session becomes idle — no cross-session bleed.
- **`newSession()` idle reset** (`static/sessions.js`): Sets `S.busy=false`, `S.activeStreamId=null`, clears the cancel button, resets composer status — ensures a fresh chat is immediately usable even if another session's stream is still running.
- **Todos survive session reload** (`static/panels.js`): `loadTodos()` now reads from `S.session.messages` (raw, includes tool-role messages) rather than `S.messages` (filtered display), so todo state reconstructed from tool outputs survives reloads.
  - 12 new regression tests in `tests/test_regressions.py`; 961 tests total (up from 949)

## [v0.50.20] Silent error fix, stale model cleanup, live model fetching (fixes #373, #374, #375)

### Fix: Chat no longer silently swallows agent failures (fixes #373)

- **`api/streaming.py`**: After `run_conversation()` completes, the server now checks whether the agent produced any assistant reply. If not (e.g., auth error swallowed internally, model unavailable, network timeout), it emits an `apperror` SSE event with a clear message and type (`auth_mismatch` or `no_response`) instead of silently emitting `done`. A `_token_sent` flag tracks whether any streaming tokens were sent.
- **`static/messages.js`**: The `done` handler has a belt-and-suspenders guard — if `done` arrives but no assistant message exists in the session (the `apperror` path should usually catch this first), an inline "**No response received.**" message is shown. The `apperror` handler now also recognises the new `no_response` type with a distinct label.

### Cleanup: Remove stale OpenAI models from default list (fixes #374)

- **`api/config.py`**: `gpt-4o` and `o3` removed from `_FALLBACK_MODELS` and `_PROVIDER_MODELS["openai"]`. Both are superseded by newer models already in the list (`gpt-5.4-mini` for general use, `o4-mini` for reasoning). The Copilot provider list retains `gpt-4o` as it remains available via the Copilot API.

### Feature: Live model fetching from provider API (closes #375)

- **`api/routes.py`**: New `/api/models/live?provider=openai` endpoint. Fetches the actual model list from the provider's `/v1/models` API using the user's configured credentials. Includes URL scheme validation (B310), SSRF guard (private IP block), and graceful `not_supported` response for providers without a standard `/v1/models` endpoint (Anthropic, Google). Response normalised to `{id, label}` list, filtered to chat models.
- **`static/ui.js`**: `populateModelDropdown()` now calls `_fetchLiveModels()` in the background after rendering the static list. Live models that aren't already in the dropdown are appended to the provider's optgroup. Results are cached per session so only one fetch per provider per page load. Skips Anthropic and Google (unsupported). Falls back to static list silently if the fetch fails.
  - 25 new tests in `tests/test_issues_373_374_375.py`; 949 tests total (up from 924)


## [v0.50.19] Fix UnicodeEncodeError when downloading files with non-ASCII filenames (PR #378)

- **Workspace file downloads no longer crash for Unicode filenames** (`api/routes.py`): Clicking a PDF or other file with Chinese, Japanese, Arabic, or other non-ASCII characters in its name caused a `UnicodeEncodeError` because Python's HTTP server requires header values to be latin-1 encodable. A new `_content_disposition_value(disposition, filename)` helper centralises `Content-Disposition` generation: it strips CR/LF (injection guard), builds an ASCII fallback for the legacy `filename=` parameter (non-ASCII chars replaced with `_`), and preserves the full UTF-8 name in `filename*=UTF-8''...` per RFC 5987. Both `attachment` and `inline` responses use it.
  - 2 new integration tests in `tests/test_sprint29.py` covering Chinese filenames for both download and inline responses, verifying the header is latin-1 encodable and `filename*=UTF-8''` is present; 924 tests total (up from 922)

## [v0.50.18] Recover from invalid default workspace paths (PR #366)

- **WebUI no longer breaks when the configured default workspace is unavailable** (`api/config.py`): The workspace resolution path was refactored into three composable functions — `_workspace_candidates()`, `_ensure_workspace_dir()`, and `resolve_default_workspace()`. When the configured workspace (from env var, settings file, or passed path) cannot be created or accessed, the server falls back through an ordered priority list: `HERMES_WEBUI_DEFAULT_WORKSPACE` env var → `~/workspace` (if exists) → `~/work` (if exists) → `~/workspace` (create it) → `STATE_DIR/workspace`.
- **`save_settings()` now validates and corrects the workspace path** (`api/config.py`): If a client posts an invalid or inaccessible `default_workspace`, the saved value is corrected to the nearest valid fallback rather than persisting an unusable path.
- **Startup normalizes stale workspace paths** (`api/config.py`): If the settings file stores a workspace that no longer exists, the server rewrites it with the resolved fallback on startup so the problem self-heals.
  - 7 tests in `tests/test_default_workspace_fallback.py` (2 from PR + 5 added during review: fallback creation, RuntimeError on all-fail, deduplication, env var priority, unwritable path returns False); 922 tests total (up from 915)

## [v0.50.17] Docker: pre-install uv at build time + fix workspace permissions (fixes #357)

- **Docker containers no longer need internet access at startup** (`Dockerfile`): `uv` is now installed at image build time via `RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh` (run as root, so `uv` lands in `/usr/local/bin` — accessible to all users). The init script skips the download if `uv` is already on PATH (`command -v uv`), and falls back to downloading with a proper `error_exit` if it isn't. This fixes startup failures in air-gapped, firewalled, or isolated Docker networks where `github.com` is unreachable at runtime.
  - **Fix applied during review**: the original PR installed `uv` as the `hermeswebuitoo` user (to `~hermeswebuitoo/.local/bin`), which is not on the `hermeswebui` runtime user's `PATH`. Changed to install as `root` with `UV_INSTALL_DIR=/usr/local/bin` so `uv` is in the system PATH for all users.
- **Workspace directory now writable by the hermeswebui user** (`docker_init.bash`): The init script now uses `sudo mkdir -p` and `sudo chown hermeswebui:hermeswebui` for `HERMES_WEBUI_DEFAULT_WORKSPACE`. Docker auto-creates bind-mount directories as `root` if they don't exist on the host, making them unwritable by the app user. The `sudo chown` corrects ownership after creation.
  - 15 new structural tests in `tests/test_issue357.py`; 915 tests total (up from 900)

## [v0.50.16] Fix CSRF check failing behind reverse proxy on non-standard ports (PR #360)

- **CSRF no longer rejects POST requests from reverse-proxied deployments on non-standard ports** (`api/routes.py`, fixes #355): When serving behind Nginx Proxy Manager or similar on a port like `:8000`, browsers send `Origin: https://app.example.com:8000` while the proxy forwards `Host: app.example.com` (port stripped). The old string comparison failed this as cross-origin. Two changes fix it:
  - `_normalize_host_port()`: properly splits host:port strings including IPv6 bracket notation (`[::1]:8080`)
  - `_ports_match(scheme, origin_port, allowed_port)`: scheme-aware port equivalence — absent port equals `:80` for `http://` and `:443` for `https://`. This prevents the previous cross-protocol confusion where `http://host` could incorrectly match an `https://host:443` server (security fix applied on top of the original PR)
  - `HERMES_WEBUI_ALLOWED_ORIGINS` env var: comma-separated explicit origin allowlist for cases where port normalization alone isn't sufficient (e.g. non-standard ports like `:8000` where the proxy strips the port entirely). Entries without a scheme (`https://`) are rejected with a startup warning.
- **Security fix applied during review**: the original `_ports_match` treated both port 80 and port 443 as interchangeable with "absent port", which is scheme-unaware. An `http://host` origin would pass for an `https://host:443` server. Fixed by making the default-port lookup scheme-specific.
  - 29 new tests in `tests/test_sprint29.py` (5 from PR + 24 added during review): cover scheme-aware port matching, cross-protocol rejection, unit tests for `_normalize_host_port` and `_ports_match`, allowlist validation, comma-separated origins, no-scheme allowlist warning, the bug scenario with and without the allowlist; 900 tests total (up from 871)

## [v0.50.15] KaTeX math rendering for LaTeX in chat and workspace previews (fixes #347)

- **LaTeX / KaTeX math now renders in chat messages and workspace file previews** (`static/ui.js`, `static/workspace.js`, `static/style.css`, `static/index.html`): Inline math (`$...$`, `\(...\)`) and display math (`$$...$$`, `\[...\]`) are rendered via KaTeX instead of displaying as raw text. Follows the existing mermaid lazy-load pattern: delimiters are stashed before markdown processing, placeholder elements are emitted, and KaTeX JS is loaded from CDN on first use — no KaTeX JS is loaded unless math is present.
  - `$$...$$` and `\[...\]` → centered display math (`<div class="katex-block">`)
  - `$...$` and `\(...\)` → inline math (`<span class="katex-inline">`); requires non-space at `$` boundaries to avoid false positives on currency amounts like `$5`
  - KaTeX JS lazy-loaded from jsdelivr CDN with SRI hash; KaTeX CSS loaded eagerly in `<head>` to prevent layout shift
  - `throwOnError:false` — invalid LaTeX degrades to a `<code>` span rather than crashing the message
  - `trust:false` — disables KaTeX commands that could execute code
  - `<span>` added to `SAFE_TAGS` allowlist for inline math spans (tag name boundary check preserved)
- **Fix: fence stash now runs before math stash** (`static/ui.js`): The original PR had math stash before fence stash, meaning `\`$x$\`` inside backtick code spans was incorrectly extracted as math instead of being protected as code. Order corrected — fence_stash runs first so code spans protect their contents.
- **Workspace file previews now render math** (`static/workspace.js`): Added `requestAnimationFrame(renderKatexBlocks)` after markdown file preview renders, matching the chat message path. Without this, math placeholders appeared in previews but were never rendered.
  - 29 tests in `tests/test_issue347.py` (18 original + 11 new covering stash ordering, workspace wiring, false-positive prevention); 870 tests total (up from 841)

## [v0.50.14] Security fixes: B310 urlopen scheme validation, B324 MD5 usedforsecurity, B110 bare except logging + QuietHTTPServer (PR #354)

- **B324 — MD5 no longer triggers crypto warnings** (`api/gateway_watcher.py`): `_snapshot_hash` uses MD5 only as a non-cryptographic change-detection hash. Added `usedforsecurity=False` so systems with strict crypto policies (FIPS mode etc.) don't reject the call.
- **B310 — urlopen now validates URL scheme** (`api/config.py`, `bootstrap.py`): Both `get_available_models()` and `wait_for_health()` validate that the URL scheme is `http` or `https` before calling `urllib.request.urlopen`, preventing `file://` or other dangerous scheme injection. Added `# nosec B310` suppression after each validated call.
- **B110 — bare `except: pass` blocks replaced with `logger.debug()`** (12 files): All `except Exception: pass` and `except: pass` blocks now log the failure at DEBUG level so operators can diagnose issues in production without changing behavior. A module-level `logger = logging.getLogger(__name__)` was added to each file.
- **`QuietHTTPServer`** (`server.py`): Subclass of `ThreadingHTTPServer` that overrides `handle_error()` to silently drop `ConnectionResetError`, `BrokenPipeError`, `ConnectionAbortedError`, and socket errno 32/54/104 (client disconnect races). Real errors still delegate to the default handler. Reduces log spam from SSE clients that disconnect mid-stream.
- **Session title redaction** (`api/routes.py`): The `/api/sessions` list endpoint now applies `_redact_text` to session titles before returning them, consistent with the per-session `redact_session_data()` already applied elsewhere.
- **Fix**: `QuietHTTPServer.handle_error` uses `sys.exc_info()` (standard library) not `traceback.sys.exc_info()` (implementation detail); `sys` is now explicitly imported in `server.py`.
  - 19 new tests in `tests/test_sprint43.py`; 841 tests total (up from 822)

## [v0.50.13] Fix session_search in WebUI sessions — inject SessionDB into AIAgent (PR #356)

- **`session_search` now works in WebUI sessions** (`api/streaming.py`): The agent's `session_search` tool returned "Session database not available" for all WebUI sessions. The CLI and gateway code paths both initialize a `SessionDB` instance and pass it via `session_db=` to `AIAgent.__init__()`, but the WebUI streaming path was missing this step. `_run_agent_streaming` now initializes `SessionDB()` before constructing the agent and passes it in. A `try/except` wrapper makes the init non-fatal — if `hermes_state` is unavailable (older installs, test environments), a `WARNING` is printed and `session_db=None` is passed instead, preserving the prior behavior gracefully.
  - 7 new tests in `tests/test_sprint42.py`; 822 tests total (up from 815)

## [v0.50.12] Profile .env isolation — prevent API key leakage on profile switch (fixes #351)

- **API keys no longer leak between profiles on switch** (`api/profiles.py`): `_reload_dotenv()` now tracks which env vars were loaded from the active profile's `.env` and clears them before loading the next profile. Previously, switching from a profile with `OPENAI_API_KEY=X` to a profile without that key left `X` in `os.environ` for the duration of the process — effectively leaking credentials across the profile boundary. A module-level `_loaded_profile_env_keys: set[str]` tracks loaded keys; it is cleared and repopulated on every `_reload_dotenv()` call.
- **`apply_onboarding_setup()` ordering fixed** (`api/onboarding.py`): the belt-and-braces `os.environ[key] = api_key` direct assignment is now placed **after** `_reload_dotenv()`. Previously the key was wiped by the isolation cleanup when `_reload_dotenv()` ran immediately after the direct set.
  - 2 new tests in `tests/test_profile_env_isolation.py`; 815 tests total (up from 813)

## [v0.50.11] Chat table styles + plain URL auto-linking (fixes #341, #342)

- **Tables in chat messages now render with visible borders** (`static/style.css`): The `.msg-body` area had no table CSS, so markdown tables sent by the assistant were unstyled and unreadable. Four new rules mirror the existing `.preview-md` table styles: `border-collapse:collapse`, per-cell padding and borders via `var(--border2)`, and an alternating-row tint. Two `:root[data-theme="light"]` overrides ensure the borders and header background adapt correctly in light mode. (fixes #341)
- **Plain URLs in chat messages are now clickable** (`static/ui.js`): Bare URLs like `https://example.com` were rendered as plain text. A new autolink pass in `renderMd()` converts `https?://...` URLs to `<a>` tags automatically. Runs after the SAFE_TAGS escape pass (protecting code blocks), before paragraph wrapping. Also applied inside `inlineMd()` so URLs in list items, blockquotes, and table cells are linked too. Trailing punctuation stripped; `esc()` applied to both href and link text. (fixes #342)
  - 11 new tests (4 in `tests/test_issue341.py`, 7 in `tests/test_issue342.py`); 813 tests total (up from 802)
- **Test infrastructure fix** (`tests/test_sprint34.py` #349): two static-file opens used bare relative paths that failed when pytest ran from outside the repo root; replaced with `pathlib.Path(__file__).parent.parent` consistent with the rest of the suite. 813/813 now pass from any working directory.

## [v0.50.10] Title auto-generation fix + mobile close button (PR #333)

- **Session title now auto-generates for all default title values** (`'Untitled'`, `'New Chat'`, empty string): The condition in `api/streaming.py` that triggers `title_from()` previously only matched `'Untitled'`. It now also covers `'New Chat'` (used by some external clients/forks) and any empty/falsy title, so sessions started from those states get a proper auto-generated title after the first message.
- **Redundant workspace panel close button hidden on mobile** (`static/style.css`): On viewports ≤900px wide, both the desktop collapse button (`#btnCollapseWorkspacePanel`) and the mobile-specific X button (`.mobile-close-btn`) were rendered simultaneously. The desktop button is now hidden on mobile and `.mobile-close-btn` is hidden by default (desktop) and shown only on mobile — eliminating the duplicate control.
  - 11 new tests in `tests/test_sprint41.py`; 802 tests total (up from 791)

## [v0.50.9] Onboarding works from Docker bridge networks (PR #335, fixes #334)

- **Docker users can now complete onboarding without enabling auth first** (closes #334): The onboarding setup endpoint previously only accepted requests from `127.0.0.1`. Docker containers connect via bridge network IPs (`172.17.x.x`, etc.), so the endpoint returned a 403 mid-wizard with no clear explanation. The check now accepts any loopback or RFC-1918 private address (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) using Python's `ipaddress.is_loopback` and `is_private`. Public IPs are still blocked unless auth is enabled.

## [v0.50.8] Model dropdown deduplication — hyphen vs dot separator fix (PR #332)

- **Model dropdown no longer shows duplicates for hyphen-format configs** (e.g. `claude-sonnet-4-6` from hermes-agent config): The server-side normalization in `api/config.py` now unifies hyphens and dots when checking whether the default model is already in the dropdown. Previously, `claude-sonnet-4-6` (hermes-agent format) and `claude-sonnet-4.6` (WebUI list format) were treated as different models, causing the same model to appear twice — once as a raw unlabelled entry and once with the correct display name. The raw entry is now suppressed and the labelled one is selected as default.
- **README updated**: test count corrected to 791 / 51 files; all module line counts updated to current values; `onboarding.py`, `state_sync.py`, `updates.py` added to the architecture listing.

## [v0.50.7] OAuth provider onboarding path — Codex/Copilot no longer blocks setup (PR #331, fixes #329 bug 2)

- **OAuth providers now have a proper onboarding path** (closes bug 2): Users with `openai-codex`, `copilot`, `qwen-oauth`, or any other OAuth-authenticated provider now see a clear confirmation card instead of an unusable API key input form.
  - If already authenticated (`chat_ready: true`): blue "Provider already authenticated" card with a direct Continue button — no key entry required.
  - If not yet authenticated: amber card explaining how to run `hermes auth` or `hermes model` in a terminal to complete setup.
  - Either state includes a collapsible "switch provider" section for users who want to move to an API-key provider instead.
  - `_build_setup_catalog` now includes `current_is_oauth` boolean; fixed a latent `KeyError` crash when looking up `default_model` for OAuth providers.
  - 5 new i18n keys in English and Spanish (`onboarding_oauth_*`).
  - 15 new tests in `tests/test_sprint40.py`; 791 tests total (up from 776)

## [v0.50.6] Skip-onboarding env var + synchronous API key reload (PR #330, fixes #329 bugs 1+3)

- **`HERMES_WEBUI_SKIP_ONBOARDING=1`** (closes bug 1): Hosting providers can set this env var to bypass the first-run wizard entirely. Only takes effect when `chat_ready` is also true — a misconfigured deployment still shows the wizard. Accepts `1`, `true`, or `yes`.
- **API key takes effect immediately after onboarding** (closes bug 3): `apply_onboarding_setup` now sets `os.environ[env_var]` synchronously after writing the key to `.env`, so the running process can use it without a server restart. Also attempts to reload `hermes_cli`'s config cache as a belt-and-suspenders measure.
  - 8 new tests in `tests/test_sprint39.py`; 776 tests total (up from 768)

## [v0.50.5] Think-tag stripping with leading whitespace (PR #327)

- **Fix think-tag rendering for models that emit leading whitespace** (e.g. MiniMax M2.7): Some models emit one or more newlines before the `<think>` opening tag. The previous regex used a `^` anchor, so it only matched when `<think>` was the very first character. When the anchor failed, the raw `</think>` tag appeared in the rendered message body.
  - `static/ui.js` (stored messages): removed `^` anchor from `<think>` and Gemma channel-token regexes; switched from `.slice()` to `.replace()` + `.trimStart()` so stripping works regardless of position
  - `static/messages.js` (live stream): `trimStart()` before `startsWith`/`indexOf` checks; partial-tag-prefix guard also uses trimmed buffer
  - 10 new tests in `tests/test_sprint38.py`; 768 tests total (up from 758)

## [v0.50.3] Onboarding completes gracefully for pre-configured providers (PR #323, fixes #322)

- **OAuth/CLI-configured providers no longer blocked by onboarding** (closes #322): Users with providers already set up via the CLI (`openai-codex`, `copilot`, `nous`, etc.) hit `Unsupported provider for WebUI onboarding` when clicking "Open Hermes" on the finish page. The wizard now marks onboarding complete and lets them through — the agent setup is already done, no wizard steps needed.
  - 5 new tests in `tests/test_sprint34.py`; 758 tests total (up from 753)

## [v0.50.2] Workspace panel state persists across refreshes

- **Workspace panel open/closed persists** (localStorage key `hermes-webui-workspace-panel`): Once you open the workspace/files pane, it stays open after a page refresh. Closing it explicitly saves the closed state, which also survives a refresh. The restore happens in the boot sequence before the first render, so there is no flash of the wrong state. Works for both desktop and mobile.
  - State is stored as `'open'` or `'closed'` — `'open'` restores as `'browse'` mode; any preview state is re-evaluated normally.
  - 7 new tests in `tests/test_sprint37.py`; 753 tests total (up from 746)

## [v0.50.1] Mobile Enter key inserts newline (PR #315, fixes #269)

- **Enter inserts newline on mobile** (closes #269): On touch-primary devices (detected via `matchMedia('(pointer:coarse)')`), the Enter key now inserts a newline instead of sending. Users send via the Send button, which is always visible on mobile. Desktop behavior is unchanged — Enter sends, Shift+Enter inserts a newline.
  - The `ctrl+enter` setting continues to work as before on all devices.
  - Users who explicitly set send key to `enter` on mobile can override in Settings.
  - 4 new tests in `tests/test_mobile_layout.py`; 746 tests total (up from 742)

## [v0.50.0] Composer-centric UI refresh + Hermes Control Center (PR #242)

Major UI overhaul by **[@aronprins](https://github.com/aronprins)** — the biggest single contribution to the project. Rebased and reviewed on `pr-242-review`.

- **Composer as control hub** — model selector, profile chip, and workspace chip now live in the composer footer as pill buttons with dropdowns. The context window usage ring (token count, cost, fill) replaces the old linear pill.
- **Hermes Control Center** — a single sidebar launcher button (bottom of sidebar) replaces the gear icon settings modal. Tabbed 860px modal: Conversation tab (transcript/JSON export, import, clear), Preferences tab (all settings), System tab (version, password). Always resets to Conversation on close.
- **Activity bar removed** — turn-scoped status (thinking, cancelling) renders inline in the composer footer via `setComposerStatus`.
- **Session `⋯` dropdown** — per-row pin/archive/duplicate/move/delete actions move from inline buttons into a shared dropdown menu; click-outside/scroll/Escape handling.
- **Workspace panel state machine** — `_workspacePanelMode` (`closed`/`browse`/`preview`) in boot.js with proper transitions and discard-unsaved guard.
- **Icon additions** — save, chevron-right, arrow-right, pause, paperclip, copy, rotate-ccw, user added to icons.js.
- **i18n additions** — 6 new keys across en/de/zh/zh-Hant for control center sections.
- **OLED theme** — 7th built-in theme (true black background for OLED displays), originally contributed by **[@kevin-ho](https://github.com/kevin-ho)** in PR #168.
- **Mobile fixes** — icon-only composer chips below 640px, `overflow-y: hidden` on `.composer-left` to prevent scrollbar, profile dropdown `max-width: min(260px, calc(100vw - 32px))`.
- 742 tests total; all existing tests pass; version badge in System tab updated to v0.50.0.

## [v0.49.4] Cancel stream cleanup guaranteed (PR #309, fixes #299)

- **Reliable cancel cleanup** (closes #299): `cancelStream()` no longer depends on the SSE `cancel` event to clear busy state and status text. Previously, if the SSE connection was already closed when cancel fired, "Cancelling..." would linger indefinitely. Now `cancelStream()` clears `S.activeStreamId`, calls `setBusy(false)`, `setStatus('')`, and hides the cancel button directly after the cancel API request — regardless of SSE connection state. The SSE cancel handler still runs when the connection is alive (all operations are idempotent).
  - 9 new tests in `tests/test_sprint36.py`; 742 tests total (up from 733)

## [v0.49.3] Session title guard + breadcrumb nav + wider panel (PRs #301, #302)

- **Preserve user-renamed session titles** (PR #301 by **[@franksong2702](https://github.com/franksong2702)** / closes #300): `title_from()` now only runs when the session title is still `'Untitled'`. Previously it overwrote user-assigned titles on every conversation turn.
  - Fixed in both `api/streaming.py` (streaming path) and `api/routes.py` (sync path).
- **Clickable breadcrumb navigation** (PR #302 by **[@franksong2702](https://github.com/franksong2702)** / closes #292): Workspace file preview now shows a clickable breadcrumb path bar. Each segment navigates directly to that directory level. Paths with spaces and special characters handled correctly. `clearPreview()` restores the directory breadcrumb on close.
- **Wider right panel** (PR #302): `PANEL_MAX` raised from 500 to 1200 — right panel can now be dragged wider on ultrawide screens.
- **Responsive message width** (PR #302): `.messages-inner` now scales up gracefully at 1400px (1100px max) and 1800px (1200px max) viewport widths instead of capping at 800px on all screen sizes.
  - 12 new tests in `tests/test_sprint35.py`; 733 tests total (up from 721)

## [v0.49.2] OAuth provider support in onboarding (issues #303, #304)

- **OAuth provider bypass** (closes #303, #304): The first-run onboarding wizard now correctly recognizes OAuth-authenticated providers (GitHub Copilot, OpenAI Codex, Nous Portal, Qwen OAuth) as ready, instead of always demanding an API key.
  - New `_provider_oauth_authenticated()` helper in `api/onboarding.py` checks `hermes_cli.auth.get_auth_status()` first (authoritative), then falls back to parsing `~/.hermes/auth.json` directly for the known OAuth provider IDs (`openai-codex`, `copilot`, `copilot-acp`, `qwen-oauth`, `nous`).
  - `_status_from_runtime()` now has an `else` branch for providers not in `_SUPPORTED_PROVIDER_SETUPS`; OAuth-authenticated providers return `provider_ready=True` and `setup_state="ready"`.
  - The `provider_incomplete` status note no longer says "API key" for OAuth providers — it now says "Run 'hermes auth' or 'hermes model' in a terminal to complete setup."
  - 21 new tests in `tests/test_sprint34.py`; 721 tests total (up from 700)

## [v0.49.1] Docker docs + mobile Profiles button (PRs #291, #265)

- **Two-container Docker setup** (PR #291 / closes #288): New `docker-compose.two-container.yml` for running the Hermes Agent and WebUI as separate containers with shared volumes. Documents the architecture clearly; localhost-only port binding by default.
- **Mobile Profiles button** (PR #265 by **[@Bobby9228](https://github.com/Bobby9228)**): Adds Profiles to the mobile bottom navigation bar (last position: Chat → Tasks → Skills → Memory → Spaces → Profiles). Uses `mobileSwitchPanel()` for correct active-highlight behaviour; `data-panel="profiles"` attribute set; SVG matches other nav icons; 3 new tests.
  - 700 tests total (up from 697)

## [v0.49.0] First-run onboarding wizard + self-update hardening (PRs #285, #287, #289)

- **One-shot bootstrap and first-run setup wizard** (PR #285 — first-run onboarding flow): New users are greeted with a guided onboarding overlay on first load. The wizard checks system status, configures a provider (OpenRouter, Anthropic, OpenAI, or custom OpenAI-compatible endpoint), sets a workspace and optional password, and marks setup as complete — all without leaving the browser.
  - `bootstrap.py`: one-shot CLI bootstrap that writes `~/.hermes/config.yaml` and `~/.hermes/.env` from flags; idempotent and safe to re-run
  - `api/routes.py`: `/api/onboarding/status` (GET) and `/api/onboarding/complete` (POST) endpoints; real provider config persistence to `config.yaml` + `.env`
  - `static/onboarding.js`: full wizard JS module — step navigation, provider dropdown, model selector, API key input, Back/Continue flow, i18n support
  - `static/index.html`: onboarding overlay HTML shell + `<script src="/static/onboarding.js">` load
  - `static/i18n.js`: 40+ onboarding keys added to all 5 locales (en, es, de, zh-Hans, zh-Hant)
  - `static/boot.js`: on load, fetches `/api/onboarding/status` and opens wizard when `completed=false`
  - Wizard does NOT show when `onboarding_completed=true` in settings
  - 14 new tests in `tests/test_onboarding.py`; 693 tests total (up from 679)

- **Self-update git pull diagnostics** (PR #287): Fixes multiple failure modes in the WebUI self-update flow when the repo has a non-trivial git state.
  - `_run_git()` now returns stderr on failure (stdout fallback, then exit-code message) — users see actionable git errors instead of empty strings
  - New `_split_remote_ref()` helper splits `origin/master` into `('origin', 'master')` before `git pull --ff-only` — fixes silent failures where git misinterpreted the combined string as a repository name
  - `--untracked-files=no` added to `git status --porcelain` — prevents spurious stash failures in repos with untracked files
  - Early merge-conflict detection via porcelain status codes before attempting pull
  - 4 new unit tests in `tests/test_updates.py`

- **Skip flaky redaction test in agent-less environments** (PR #289): `test_api_sessions_list_redacts_titles` added to the CI skip list for environments without hermes-agent installed. Test still runs with the full agent; security coverage preserved by 6 pure-unit tests and 2 other API-level redaction tests.
  - 697 tests total (up from 693)

## [v0.48.2] Provider/model mismatch warning (PR #283, fixes #266)

- **Provider mismatch warning** (PR #283): WebUI now warns when you select a model from a provider different from the one Hermes is configured for, instead of silently failing with a 401 error.
  - `api/streaming.py`: 401/auth errors classified as `type='auth_mismatch'` with an actionable hint ("Run `hermes model` in your terminal to switch providers")
  - `static/ui.js`: `populateModelDropdown()` stores `active_provider` from `/api/models` as `window._activeProvider`; new `_checkProviderMismatch()` helper compares selected model's provider prefix against the configured provider
  - `static/boot.js`: `modelSelect.onchange` calls `_checkProviderMismatch()` and shows a toast warning immediately on selection
  - `static/messages.js`: `apperror` handler shows "Provider mismatch" label (via i18n) instead of "Error" for auth errors
  - `static/i18n.js`: `provider_mismatch_warning` and `provider_mismatch_label` keys added to all 5 locales (en, es, de, zh-Hans, zh-Hant)
  - Check skipped for `openrouter` and `custom` providers to avoid false positives
  - 21 new tests in `tests/test_provider_mismatch.py`; 679 tests total (up from 658)
## [v0.48.1] Markdown table inline formatting (PR #278)

- **Inline formatting in table cells** (PR #278, @nesquena): Table header and data cells now render `**bold**`, `*italic*`, `` `code` ``, and `[links](url)` correctly. Previously `esc()` was used, which displayed raw HTML tags as text. Changed to `inlineMd()` consistent with list items and blockquotes. XSS-safe: `inlineMd()` escapes all interpolated values. Two-line change in `static/ui.js`. Fixes #273.
## [v0.48.0] Real-time gateway session sync (PR #274)

- **Real-time gateway session sync** (PR #274, @bergeouss): Gateway sessions from Telegram, Discord, Slack, and other messaging platforms now appear in the WebUI sidebar and update in real time as new messages arrive. Enable via the "Show agent sessions" checkbox (renamed from "Show CLI sessions").
  - `api/gateway_watcher.py`: background daemon thread polling `state.db` every 5s using MD5 hash-based change detection
  - New SSE endpoint `/api/sessions/gateway/stream` for real-time push to browser
  - Dynamic source badges: telegram (blue), discord (purple), slack (dark purple), cli (green)
  - Zero changes to hermes-agent — WebUI reads the shared `state.db` that both components access
  - 10 new tests in `test_gateway_sync.py` covering metadata, filtering, SSE, and watcher lifecycle
  - 658 tests (up from 648)
## [v0.47.1] Spanish locale (PR #275)

- **Spanish (es) locale** (PR #275, @gabogabucho): Full Spanish translation for all 175 UI strings. Exposed automatically in the language selector via existing `LOCALES` wiring. Includes regression tests verifying locale presence, representative translations, and key-parity with English. 648 tests (up from 645).
## [v0.47.0] — 2026-04-11

### Features
- **`/skills [query]` slash command** (PR #257): Fetches from `/api/skills`, groups results by category (alphabetically), renders as a formatted assistant message. Optional query filters by name, description, or category. Shows in the `/` autocomplete dropdown. i18n for en/de/zh/zh-Hant. 1 regression test added.
- **Shared app dialogs replace native `confirm()`/`prompt()`** (PR #251, extracted from #242 by @aronprins): `showConfirmDialog()` and `showPromptDialog()` in `ui.js`, backed by `#appDialogOverlay`. Replaces all 11 native browser dialog call sites across panels.js, sessions.js, ui.js, workspace.js. Full keyboard focus trap (Tab/Escape/Enter), ARIA roles, danger mode, focus restore, mobile-responsive buttons. i18n for en/de/zh/zh-Hant. 5 new tests in `test_sprint33.py`.
- **Session `⋯` action dropdown** (PR #252, extracted from #242 by @aronprins): Replaces 5 per-row hover buttons (pin/move/archive/duplicate/delete) with a single `⋯` trigger. Menu uses `position:fixed` to avoid sidebar clipping. Full close handling: click-outside, scroll, Escape, resize-reposition. `test_sprint16.py` updated to assert the new trigger exists and old button classes are gone.

### Bug Fixes
- **Custom provider with slash model name no longer rerouted to OpenRouter** (PR #255): `resolve_model_provider()` now returns immediately with the configured `provider`/`base_url` when `base_url` is set, before the slash-based OpenRouter heuristic runs. Fixes `google/gemma-4-26b-a4b` with `provider: custom` being silently routed to OpenRouter (401 errors). 1 regression test added. Fixes #230.
- **Android Chrome: workspace panel now closeable on mobile** (PR #256): `toggleMobileFiles()` now shows/hides the mobile overlay. New `closeMobileFiles()` helper closes the right panel with correct overlay tracking. Overlay tap-to-close calls both `closeMobileSidebar()` and `closeMobileFiles()`. Mobile-only `×` close button added to workspace panel header. Fix applied during review: `closeMobileSidebar()` now checks if the right panel is still open before hiding the overlay. Fixes #247.
- **Android Chrome: profile dropdown no longer clipped on mobile** (PR #256): `.profile-dropdown` switches to `position:fixed; top:56px; right:8px` at `max-width:900px`, escaping the `overflow-x:auto` stacking context that was making it invisible. Fixes #246.

### Tests
- **Mobile layout regression suite** (PR #254): 14 static tests in `tests/test_mobile_layout.py` that run on every QA pass. Covers: CSS breakpoints at 900px/640px, right panel slide-over, mobile overlay, bottom nav, files button, profile dropdown z-index, chip overflow, workspace close, `100dvh`, 44px touch targets, 16px textarea font. All pass against current and future master.

**CSS hotfix (commit a2ae953, post-tag):** session action menu — icon now displays inline-left of text. The `.ws-opt` base class (`flex-direction:column`) was causing SVG icons to stack above the label. Fixed with 3 CSS rule overrides on `.session-action-opt`.

**645 tests (up from 624 on v0.46.0 — +21 new tests)**

---

## [v0.46.0] — 2026-04-11

### Features
- **Docker UID/GID matching** (PR #237 by @mmartial): New `docker_init.bash` entrypoint adds `hermeswebui`/`hermeswebuitoo` user pattern so container-created files match the host user UID/GID. Prevents `.hermes` volume mounts from being owned by root. Configure via `WANTED_UID` and `WANTED_GID` env vars (default 1000/1000). README updated with setup instructions.
  - `Dockerfile` — two-user pattern with passwordless sudo; `/.within_container` marker for in-container detection; starts as `hermeswebuitoo`, switches to correct UID/GID
  - `docker-compose.yml` — mounts `.hermes` at `/home/hermeswebui/.hermes`; uses `${UID:-1000}/${GID:-1000}` for UID/GID passthrough
  - `server.py` — detects `/.within_container` and prints a note when binding to 0.0.0.0

### Security
- **Credential redaction in API responses** (PR #243 by @kcclaw001): All API endpoints now redact credentials from responses at the response layer. Session files on disk are unchanged; only the API output is masked.
  - `api/helpers.py` — `redact_session_data()` and `_redact_value()` apply pattern-based redaction to messages, tool_calls, and title; covers GitHub PATs, OpenAI/Anthropic keys, AWS keys, Slack tokens, HuggingFace tokens, Authorization Bearer headers, and PEM private key blocks
  - `api/routes.py` — `GET /api/session`, `GET /api/session/export`, `GET /api/memory` all wrapped with redaction
  - `api/streaming.py` — SSE `done` event payload redacted before broadcast
  - `api/startup.py` — new `fix_credential_permissions()` called at startup; `chmod 600` on `.env`, `google_token.json`, `auth.json`, `.signing_key` if they have group/other read bits set
  - `tests/test_security_redaction.py` — 13 new tests covering redaction functions and endpoint structural verification

### Bug Fixes
- **Custom model list discovery with config API key** (PR #238 by @ccqqlo): `get_available_models()` now reads `api_key` from `config.yaml` before env vars when fetching `/v1/models` from custom endpoints (LM Studio, Ollama, etc.). Priority: `model.api_key` → `providers.<active>.api_key` → `providers.custom.api_key` → env vars. Also adds `OpenAI/Python 1.0` User-Agent header. Fixes model picker collapsing to single default model for config-only setups. 1 new regression test.
- **HTML entity decode before markdown processing** (PR #239 by @Argonaut790): Adds `decode()` helper in `renderMd()` to fix double-escaping of HTML entities from LLM output (e.g. `&lt;code&gt;` becoming `&amp;lt;code&amp;gt;` instead of rendering). XSS-safe: decode runs before `esc()`, only 5 entity patterns (`&lt;`, `&gt;`, `&amp;`, `&quot;`, `&#39;`).
- **Simplified Chinese translations completed** (PR #239 by @Argonaut790): 40+ missing keys added to `zh` locale (123 → 164 keys). New `zh-Hant` (Traditional Chinese) locale with 163 keys.
- **Cancel button now interrupts agent execution** (PR #244 by @huangzt): `cancel_stream()` now calls `agent.interrupt()` to stop backend tool execution, not just the SSE stream. `AGENT_INSTANCES` dict (protected by `STREAMS_LOCK`) tracks active agents. Race condition fixed: after storing agent, immediately checks if cancel was already requested. Frontend: removes stale "Cancelling..." status text; `setBusy(false)` always called on cancel. 6 new unit tests in `tests/test_cancel_interrupt.py`.

**624 tests (up from 604 on v0.45.0 — +20 new tests)**

---

## [v0.45.0] — 2026-04-10

### Features
- **Custom endpoint fields in new profile form** (PR #233, fixes #170): The New Profile form now accepts optional Base URL and API key fields. When provided, both are written into the new profile's `config.yaml` under the `model` section, enabling local-endpoint setups (Ollama, LMStudio, etc.) to be configured in one step without editing YAML manually. The write is a no-op when both fields are left blank, so existing profile creation behavior is unchanged.
  - `api/profiles.py` — `_write_endpoint_to_config()` merges `base_url`/`api_key` into `config.yaml` using `yaml.safe_load` + `yaml.dump`, preserving any existing keys
  - `api/routes.py` — accepts `base_url` and `api_key` from POST body; validates that `base_url`, if provided, starts with `http://` or `https://` (returns 400 for invalid schemes)
  - `static/index.html` — two new inputs added to the New Profile form: Base URL (with `http://localhost:11434` placeholder) and API key (password type)
  - `static/panels.js` — `submitProfileCreate()` reads both fields, validates URL format client-side before sending, and includes them in the create payload; `toggleProfileForm()` clears them on cancel
  - 9 tests in `tests/test_sprint31.py` covering: config write (base_url, api_key, both, merge, no-op), route acceptance, profile path in response, and invalid-scheme rejection

**604 tests (up from 595)**

## [v0.44.1] — 2026-04-10

- **Unskip 16 approval tests** (PR #231): `test_approval_unblock.py` was importing `has_pending` and `pop_pending` from `tools.approval`, which the agent module had removed. The import failure tripped the `APPROVAL_AVAILABLE` guard and skipped all 16 tests in the file. Neither symbol was used in any test body. Removing the stale imports restores **595/595 passing, 0 skipped**.

## [v0.44.0] — 2026-04-10

### Features
- **Lucide SVG icons** (PR #221): Replaces all emoji icons in the sidebar, workspace, and tool cards with self-hosted Lucide SVG paths via `static/icons.js`. No CDN dependency — icons are bundled directly. The `li(name)` renderer uses a hardcoded whitelist, so server-supplied tool names never inject arbitrary SVG. All 35 `onclick=` functions verified to exist in JS; all 21 icon references verified in `icons.js`.

### Bug Fixes
- **Approval card hides immediately on respond/stream-end** (PR #225): `respondApproval()` and all stream-end SSE handlers (done, cancel, apperror, error, start-error) now call `hideApprovalCard(true)`. Previously the 30s minimum-visibility guard deferred the hide, leaving the card visible with disabled buttons for up to 30s after the user clicked Approve/Deny or the session completed. The poll-loop tick correctly keeps no-force so the guard still protects against transient polling gaps. Adds 11 structural tests for the timer logic.
- **Login page CSP fix** (PR #226): Moves `doLogin()` and Enter key listener from inline `<script>`/`onsubmit`/`onkeydown` attributes into `static/login.js`. Inline handlers are blocked by strict `script-src` CSP, causing silent login failure. i18n error strings now passed via `data-*` attributes instead of injected JS literals. Also guards `res.json()` parse with try/catch so non-JSON server errors fall back to the password-error message. Fixes #222.
- **Update error messages** (PR #227): `_apply_update_inner()` now fetches before pulling and surfaces three distinct failure modes with actionable recovery commands: network unreachable, diverged history (`git reset --hard`), and missing upstream tracking branch (`git branch --set-upstream-to`). Generic fallback truncates to 300 chars with a sentinel for empty output. Adds 13 tests covering all new diagnostic code paths. Fixes #223.
- **Approval pending check** (PR #228): `GET /api/approval/pending` always returned `{pending: null}` after the agent module renamed `has_pending` to `has_blocking_approval`. The route now checks `_pending` directly under `_lock`, matching how `submit_pending` writes to it. Fixes `test_approval_submit_and_respond`.

### Tests
- 579 passing, 16 skipped at this tag (595/595 after v0.44.1 unskip — +24 new tests across PRs #225, #227, #228)

## [v0.43.1] — 2026-04-10

- **CSRF fix for reverse proxies** (PR #219): The CSRF check now accepts `X-Forwarded-Host` and `X-Real-Host` headers in addition to `Host`, so deployments behind Caddy, nginx, and Traefik no longer reject POST requests with "Cross-origin request rejected". Security is preserved — requests with no matching proxy header are still rejected. Fixes #218.

## [v0.43.0] — 2026-04-10

### Features
- **Auto-install agent dependencies on startup** (PRs #215 + #216): When `hermes-agent` is found on disk but its Python dependencies are missing (common in Docker deployments where the agent is volume-mounted post-build), `server.py` now calls `api/startup.auto_install_agent_deps()` to install from `requirements.txt` or `pyproject.toml`. Falls back gracefully — failures are logged and never fatal.

### Bug Fixes
- **Session ID validator broadened** (PR #212): `Session.load()` rejected any session ID containing non-hex characters, breaking sessions created by the new hermes-agent format (`YYYYMMDD_HHMMSS_xxxxxx`). Validator now accepts `[0-9a-z_]` while rejecting path traversal patterns (null bytes, slashes, backslashes, dot-extensions).
- **Test suite isolation** (PR #216): `conftest.py` now kills any stale process on the test port (8788) before starting the fixture server. Stale QA harness servers (8792/8793) could occupy 8788 and cause non-deterministic test failures across the full suite.

## [v0.42.2] — 2026-04-10

### Bug Fixes
- **CSP blocking inline event handlers** (PR #209): `script-src 'self'` blocked all 55+ inline `onclick=` handlers in `index.html`, making the settings panel, sidebar navigation, and most interactive controls non-functional. Added `'unsafe-inline'` to `script-src`. Also restores `https://cdn.jsdelivr.net` to `script-src` and `style-src` for Mermaid.js and Prism.js (dropped in v0.42.1).

## [v0.42.1] — 2026-04-11

### Bug Fixes
- **i18n button text stripping** (post-review): Three sidebar buttons (`+ New job`, `+ New skill`, `+ New profile`) and three suggestion buttons had `data-i18n` on the outer element, which caused `applyLocaleToDOM` to replace the entire `textContent` — stripping the `+` prefix and emoji characters on locale switch. Fixed by wrapping only the translatable label text in a `<span data-i18n="...">`.
- **German translation corrections** (post-review): Fixed `cancelling` (imperative → progressive `"Wird abgebrochen…"`), `editing` (first-person verb → noun `"Bearbeitung"`), and completed truncated descriptions for `empty_subtitle`, `settings_desc_check_updates`, and `settings_desc_cli_sessions`.

## [v0.42.0] — 2026-04-10

### Features
- **German translation** (PR #190 by **[@DavidSchuchert](https://github.com/DavidSchuchert)**): Complete `de` locale covering all UI strings — settings, commands, sidebar, approval cards. Also extends the i18n system with `data-i18n-title` and `data-i18n-placeholder` attribute support so tooltip text and input placeholders are now translatable. German speech recognition uses `de-DE`.

### Bug Fixes
- **Custom slash-model routing** (PR #189 by **[@smurmann](https://github.com/smurmann)**): Model IDs like `google/gemma-4-26b-a4b` from custom providers (LM Studio, Ollama) were silently misrouted to OpenRouter because of the slash-heuristic. Custom providers now win: entries in `config.yaml → custom_providers` are checked first, so their model IDs route to the correct local endpoint regardless of format.
- **Phantom Custom group in model picker** (PR #191 by @mbac): When `model.provider` was a named provider (e.g. `openai-codex`) and `model.base_url` was set, `hermes_cli` reported `'custom'` as authenticated, producing a duplicate "Custom" group in the dropdown. The real provider's group was missing the configured default model. Fixed by discarding the phantom `custom` entry when a real named provider is active.
- **Hyphen/space model group injection** (PR #191): The "ensure default_model appears" post-pass used `active_provider.lower() in group_name.lower()`, which fails for `openai-codex` vs display name `OpenAI Codex` (hyphen vs space). Now uses `_PROVIDER_DISPLAY` for exact display-name matching.

## [v0.41.0] — 2026-04-10

### Features
- **Optional HTTPS/TLS support** (PR #199): Set `HERMES_WEBUI_TLS_CERT` and
  `HERMES_WEBUI_TLS_KEY` env vars to enable HTTPS natively. Uses
  `ssl.PROTOCOL_TLS_SERVER` with TLS 1.2 minimum. Gracefully falls back to HTTP
  if cert loading fails. No reverse proxy required for LAN/VPN deployments.

### Bug Fixes
- **CSP blocking Mermaid and Prism** (PR #197): Added Content-Security-Policy and
  Permissions-Policy headers to every response. CSP allows `cdn.jsdelivr.net` in
  `script-src` and `style-src` for Mermaid.js (dynamically loaded) and Prism.js
  (statically loaded with SRI integrity hashes). All other external origins blocked.
- **Session memory leak** (PR #196): `api/auth.py` accumulated expired session tokens
  indefinitely. Added `_prune_expired_sessions()` called lazily on every
  `verify_session()` call. No background thread, no lock contention.
- **Slow-client thread exhaustion** (PR #198): Added `Handler.timeout = 30` to kill
  idle/stalled connections before they exhaust the thread pool.
- **False update alerts on feature branches** (PR #201): Update checker compared
  `HEAD..origin/master` even when on a feature branch, counting unrelated master
  commits as missing updates. Now uses `git rev-parse --abbrev-ref @{upstream}` to
  track the current branch's upstream. Falls back to default branch when no upstream
  is set.
- **CLI session file browser returning 404** (PR #204): `/api/list` only checked
  the WebUI in-memory session dict, so CLI sessions shown in the sidebar always
  returned 404 for file browsing. Now falls back to `get_cli_sessions()` — the same
  pattern used by `/api/session` GET and `/api/sessions` list.

## [v0.40.2] — 2026-04-09

### Features
- **Full approval UI** (PR #187): When the agent triggers a dangerous command
  (e.g. `rm -rf`, `pkill -9`), a polished approval card now appears immediately
  instead of leaving the chat stuck in "Thinking…" forever. Four one-click buttons:
  Allow once, Allow session, Always allow, Deny. Enter key defaults to Allow once.
  Buttons disable immediately on click to prevent double-submit. Card auto-focuses
  Allow once so keyboard-only users can approve in one keystroke. All labels and
  the heading are fully i18n-translated (English + Chinese).

### Bug Fixes
- **Approval SSE event never sent** (PR #187): `register_gateway_notify()` was
  never called before the agent ran, so the approval module had no way to push
  the `approval` SSE event to the frontend. Fixed by registering a callback that
  calls `put('approval', ...)` the instant a dangerous command is detected.
- **Agent thread never unblocked** (PR #187): `/api/approval/respond` did not call
  `resolve_gateway_approval()`, so the agent thread waited for the full 5-minute
  gateway timeout. Now calls it on every respond, waking the thread immediately.
- **`_unreg_notify` scoping** (PR #187): Variable was only assigned inside a `try`
  block but referenced in `finally`. Initialised to `None` before the `try` so the
  `finally` guard is always well-defined.

### Tests
- 32 new tests in `tests/test_sprint30.py`: approval card HTML structure, all 4
  button IDs and data-i18n labels, keyboard shortcut in boot.js, i18n keys in both
  locales, CSS loading/disabled/kbd states, messages.js button-disable behaviour,
  streaming.py scoping, HTTP regression for all 4 choices.
- 16 tests in `tests/test_approval_unblock.py` (gateway approval unit + HTTP).
- **547 tests total** (499 → 515 → 547).

---

## [v0.40.1] — 2026-04-09

### Bug Fixes
- **Default locale on first install** (PR #185): A fresh install would start in
  English based on the server default, but `loadLocale()` could resurrect a
  stale or unsupported locale code from `localStorage`. Now `loadLocale()` falls
  back to English when there is no saved code or the saved code is not in the
  LOCALES bundle. `setLocale()` also stores the resolved code, so an unknown
  input never persists to storage.

---

## [v0.40.0] — 2026-04-09

### Features
- **i18n — pluggable language switcher** (PR #179): Settings panel now has a
  Language dropdown. Ships with English and Chinese (中文). All UI strings use
  a `t()` helper that falls back to English for missing keys. The login page
  also localises — title, placeholder, button, and error strings all respond to
  the saved locale. Add a language by adding a LOCALES entry to `static/i18n.js`.
- **Notification sound + browser notifications** (PR #180): Two new settings
  toggles. "Notification sound" plays a short two-tone chime when the assistant
  finishes or an approval card appears. "Browser notification" fires a system
  notification when the tab is in the background.
- **Thinking / reasoning block display** (PR #181, #182): Inline `<think>…</think>`
  and Gemma 4 `<|channel>thought…<channel|>` tags are parsed out of assistant
  messages and rendered as a collapsible lightbulb "Thinking" card above the reply.
  During streaming, the bubble shows "Thinking…" until the tag closes. Hardened
  against partial-tag edge cases and empty thinking blocks.

### Bug Fixes
- **Stray `}` in message row HTML** (PR #183): A typo in the i18n refactor left
  an extra `}` in the `msg-role` div template literal, producing `<div class="msg-role user" }>`.
  Removed.
- **JS-escape login locale strings** (PR #183): `LOGIN_INVALID_PW` and
  `LOGIN_CONN_FAILED` were injected into a JS string context without escaping
  single quotes or backslashes. Now uses minimal JS-string escaping.

---

## [v0.39.1] — 2026-04-08

### Bug Fixes
- **_ENV_LOCK deadlock resolved.** The environment variable lock was held for
  the entire duration of agent execution (including all tool calls and streaming),
  blocking all concurrent requests. Now the lock is acquired only for the brief
  env variable read/write operations, released before the agent runs, and
  re-acquired in the finally block for restoration.

---

## [v0.39.0] — 2026-04-08

### Security (12 fixes — PR #171 by @betamod, reviewed by @nesquena-hermes)

- **CSRF protection**: all POST endpoints now validate `Origin`/`Referer` against `Host`. Non-browser clients (curl, agent) without these headers are unaffected.
- **PBKDF2 password hashing**: `save_settings()` was using single-iteration SHA-256. Now calls `auth._hash_password()` — PBKDF2-HMAC-SHA256 with 600,000 iterations and a per-installation random salt.
- **Login rate limiting**: 5 failed attempts per 60 seconds per IP returns HTTP 429.
- **Session ID validation**: `Session.load()` rejects any non-hex character before touching the filesystem, preventing path traversal via crafted session IDs.
- **SSRF DNS resolution**: `get_available_models()` resolves DNS before checking private IPs. Prevents DNS rebinding attacks. Known-local providers (Ollama, LM Studio, localhost) are whitelisted.
- **Non-loopback startup warning**: server prints a clear warning when binding to `0.0.0.0` without a password set — a common Docker footgun.
- **ENV_LOCK consistency**: `_ENV_LOCK` now wraps all `os.environ` mutations in both the sync chat and streaming restore blocks, preventing races across concurrent requests.
- **Stored XSS prevention**: files with `text/html`, `application/xhtml+xml`, or `image/svg+xml` MIME types are forced to `Content-Disposition: attachment`, preventing execution in-browser.
- **HMAC signature**: extended from 64 bits to 128 bits (16-char to 32-char hex).
- **Skills path validation**: `resolve().relative_to(SKILLS_DIR)` check added after skill directory construction to prevent traversal.
- **Secure cookie flag**: auto-set when TLS or `X-Forwarded-Proto: https` is detected. Uses `getattr` safely so plain sockets don't raise `AttributeError`.
- **Error path sanitization**: `_sanitize_error()` strips absolute filesystem paths from exception messages before they reach the client.

### Tests
- Added `tests/test_sprint29.py` — 33 tests covering all 12 security fixes.

---

## [v0.38.6] — 2026-04-07

### Fixed
- **`/insights` message count always 0 for WebUI sessions** (#163, #164): `sync_session_usage()` wrote token counts, cost, model, and title to `state.db` but never `message_count`. Both the streaming and sync chat paths now pass `len(s.messages)`. Note: `/insights` sync is opt-in — enable **Sync to Insights** in Settings (it's off by default).

---

## [v0.38.5] — 2026-04-06

### Fixed
- **Custom endpoint URL construction** (#138, #160): `base_url` ending in `/v1` was incorrectly stripped before appending `/models`, producing `http://host/models` instead of `http://host/v1/models`. Fixed to append directly.
- **`custom_providers` config entries now appear in dropdown** (#138, #160): Models defined under `config.yaml` `custom_providers` (e.g. Ollama aliases, Azure model overrides) are now always included in the dropdown, even when the `/v1/models` endpoint is unreachable.
- **Custom endpoint API key reads profile `.env`** (#138, #160): Custom endpoint auth now checks `~/.hermes/.env` keys in addition to `os.environ`.

---

## [v0.38.4] — 2026-04-06

### Fixed
- **Copilot false positive in model dropdown** (#158): `list_available_providers()` reported Copilot as available on any machine with `gh` CLI auth, because the Copilot token resolver falls back to `gh auth token`. The dropdown now skips any provider whose credential source is `'gh auth token'` — only explicit, dedicated credentials count. Users with `GITHUB_TOKEN` explicitly set in their `.env` still see Copilot correctly.

---

## [v0.38.3] — 2026-04-06

### Fixed
- **Model dropdown shows only configured providers** (#155): Provider detection now uses `hermes_cli.models.list_available_providers()` — the same auth check the Hermes agent uses at runtime — instead of scanning raw API key env vars. The dropdown now reflects exactly what the user has configured (auth.json, credential pools, OAuth flows like Copilot). When no providers are detected, shows only the configured default model rather than a full generic list. Added `copilot` and `gemini` to the curated model lists. Falls back to env var scanning for standalone installs without hermes-agent.

---

## [v0.38.2] — 2026-04-06

### Fixed
- **Tool cards actually render on page reload** (#140, #153): PR #149 fixed the wrong filter — it updated `vis` but not `visWithIdx` (the loop that actually creates DOM rows), so anchor rows were never inserted. This PR fixes `visWithIdx`. Additionally, `streaming.py`'s `assistant_msg_idx` builder previously only scanned Anthropic content-array format and produced `idx=-1` for all OpenAI-format tool calls (the format used in saved sessions); it now handles both. As a final fallback, `renderMessages()` now builds tool card data directly from per-message `tool_calls` arrays when `S.toolCalls` is empty, covering historical sessions that predate session-level tool tracking.

---

## [v0.38.1] — 2026-04-06

### Fixed
- **Model selector duplicates** (#147, #151): When `config.yaml` sets `model.default` with a provider prefix (e.g. `anthropic/claude-opus-4.6`), the model dropdown no longer shows a duplicate entry alongside the existing bare-ID entry. The dedup check now normalizes both sides before comparing.
- **Stale model labels** (#147, #151): Sessions created with models no longer in the current provider list now show `"ModelName (unavailable)"` in muted text with a tooltip, instead of appearing as a normal selectable option that would fail silently on send.

---

## [v0.38.0] — 2026-04-06

### Fixed
- **Multi-provider model routing (#138):** Non-default provider models now use `@provider:model` format. `resolve_model_provider()` routes them through `resolve_runtime_provider(requested=provider)` — no OpenRouter fallback for users with direct provider keys.
- **Personalities from config.yaml (#139):** `/api/personalities` reads from `config.yaml` `agent.personalities` (the documented mechanism). Personality prompts pass via `agent.ephemeral_system_prompt`.
- **Tool call cards survive page reload (#140):** Assistant messages with only `tool_use` content are no longer filtered from the render list, preserving anchor rows for tool card display.

---

## [v0.37.0] /personality command, model prefix routing fix, tool card reload fix
*April 6, 2026 | 465 tests*

### Features
- **`/personality` slash command.** Set a per-session agent personality from `~/.hermes/personalities/<name>/SOUL.md`. The personality prompt is prepended to the system message for every turn. Use `/personality <name>` to activate, `/personality none` to clear, `/personality` (no args) to list available personalities. Backend: `GET /api/personalities`, `POST /api/personality/set`. (PR #143)

### Bug Fixes
- **Model dropdown routes non-default provider models correctly (#138).** When the active provider is `anthropic` and you pick a `minimax` model, its ID is now prefixed `minimax/MiniMax-M2.7` so `resolve_model_provider()` can route it through OpenRouter. Guards added: `active_provider=None` prevents all-providers-prefixed, case is normalised, shared `_PROVIDER_MODELS` list is no longer mutated by the default_model injector. (PR #142)
- **Tool call cards persist correctly after page reload.** The reload rendering logic now anchors cards AFTER the triggering assistant row (not before the next one), handles multi-step chains sharing a filtered anchor in chronological order, and filters fallback anchor to assistant rows only. (PR #141)

---

## [v0.36.3] Configurable Assistant Name
*April 6, 2026 | 449 tests*

### Features
- **Configurable bot name.** New "Assistant Name" field in Settings panel.
  Display name updates throughout the UI: sidebar, topbar, message roles,
  login page, browser tab title, and composer placeholder. Defaults to
  "Hermes". Configurable via settings or `HERMES_WEBUI_BOT_NAME` env var.
  Server-side sanitization prevents empty names and escapes HTML for the
  login page. (PR #135, based on #131 by @TaraTheStar)

---

## [v0.36.2] OpenRouter model routing fix
*April 5, 2026 | 440 tests*

### Bug Fixes
- **OpenRouter models sent without prefix, causing 404 (#116).** `resolve_model_provider()` was stripping the `openrouter/` prefix from model IDs (e.g. sending `free` instead of `openrouter/free`) when `config_provider == 'openrouter'`. OpenRouter requires the full `provider/model` path to route upstream correctly. Fixed with an early return that preserves the complete model ID for all OpenRouter configs. (#127)
- Added 7 unit tests for `resolve_model_provider()` — first coverage on this function. Tests the regression, cross-provider routing, direct-API prefix stripping, bare models, and empty model.

---

## [v0.36.1] Login form Enter key fix
*April 5, 2026 | 433 tests*

### Bug Fixes
- **Login form Enter key unreliable in some browsers (#124).** `onsubmit="return doLogin(event)"` returned a Promise (async functions always return a truthy Promise), which could let the browser fall through to native form submission. Fixed with `doLogin(event);return false` plus an explicit `onkeydown` Enter handler on the password input as belt-and-suspenders. (#125)

---

## [v0.35.1] Model dropdown fixes
*April 5, 2026 | 433 tests*

### Bug Fixes
- **Custom providers invisible in model dropdown (#117).** `cfg_base_url` was scoped inside a conditional block but referenced unconditionally, causing a `NameError` for users with a `base_url` in config.yaml. Fix: initialize to `''` before the block. (#118)
- **Configured default model missing from dropdown (#116).** OpenRouter and other providers replaced the model list with a hardcoded fallback that didn't include `model.default` values like `openrouter/free` or custom local model names. Fix: after building all groups, inject the configured `default_model` at the top of its provider group if absent. (#119)

---

## [v0.34.3] Light theme final polish
*April 5, 2026 | 433 tests*

### Bug Fixes
- **Light theme: sidebar, role labels, chips, and interactive elements all broken.** Session titles were too faint, active session used washed-out gold, pin stars were near-invisible bright yellow, and all hover/border effects used dark-theme white `rgba(255,255,255,.XX)` values invisible on cream. Fixed with 46 scoped `[data-theme="light"]` selector overrides covering session items, role labels, project chips, topbar chips, composer, suggestions, tool cards, cron list, and more. (#105)
- Active session now uses blue accent (`#2d6fa3`) for strong contrast. Pin stars use deep gold (`#996b15`). Role labels are solid and high contrast.

---

## [v0.34.2] Theme text colors
*April 5, 2026 | 433 tests*

### Bug Fixes
- **Light mode text unreadable.** Bold text was hardcoded white (invisible on cream), italic was light purple on cream, inline code had a dark box on a light background. Fixed by introducing 5 new per-theme CSS variables (`--strong`, `--em`, `--code-text`, `--code-inline-bg`, `--pre-text`) defined for every theme. (#102)
- Also replaced remaining `rgba(255,255,255,.08)` border references with `var(--border)`, and darkened light theme `--code-bg` slightly for better contrast.

---

## [v0.34.1] Theme variable polish
*April 5, 2026 | 433 tests*

### Bug Fixes
- **All non-dark themes had broken surfaces, topbar, and dropdowns.** 30+ hardcoded dark-navy rgba/hex values in style.css were stuck on the Dark palette regardless of active theme. Fixed by introducing 7 new CSS variables (`--surface`, `--topbar-bg`, `--main-bg`, `--input-bg`, `--hover-bg`, `--focus-ring`, `--focus-glow`) defined per-theme, replacing every hardcoded reference. (#100)

---

## [v0.31.2] CLI session delete fix
*April 5, 2026 | 424 tests*

### Bug Fixes
- **CLI sessions could not be deleted from the sidebar.** The delete handler only
  removed the WebUI JSON session file, so CLI-backed sessions came back on refresh.
  Added `delete_cli_session(sid)` in `api/models.py` and call it from
  `/api/session/delete` so the SQLite `state.db` row and messages are removed too.
  (#87, #88)

### Notes
- The public test suite still passes at 424/424.
- Issue #87 already had a comment confirming the root cause, so no new issue comment
  was needed here.

## [v0.30.1] CLI Session Bridge Fixes
*April 4, 2026 | 424 tests*

### Bug Fixes
- **CLI sessions not appearing in sidebar.** Three frontend gaps: `sessions.js`
  wasn't rendering CLI sessions (missing `is_cli_session` check in render loop),
  sidebar click handler didn't trigger import, and the "cli" badge CSS selector
  wasn't matching the rendered DOM structure. (#58)
- **CLI bridge read wrong profile's state.db.** `get_cli_sessions()` resolved
  `HERMES_HOME` at server launch time, not at call time. After a profile switch,
  it kept reading the original profile's database. Now resolves dynamically via
  `get_active_hermes_home()`. (#59)
- **Silent SQL error swallowed all CLI sessions.** The `sessions` table in
  `state.db` has no `profile` column — the query referenced `s.profile` which
  caused a silent `OperationalError`. The `except Exception: return []` handler
  swallowed it, returning zero CLI sessions. Removed the column reference and
  added explicit column-existence checks. (#60)

### Features
- **"Show CLI sessions" toggle in Settings.** New checkbox in the Settings panel
  to show/hide CLI sessions in the sidebar. Persisted server-side in
  `settings.json` (`show_cli_sessions`, default `true`). When disabled, CLI
  sessions are excluded from `/api/sessions` responses. (#61)

---

## [v0.28.1] CI Pipeline + Multi-Arch Docker Builds
*April 3, 2026 | 426 tests*

### Features
- **GitHub Actions CI.** New workflow triggers on tag push (`v*`). Builds
  multi-arch Docker images (linux/amd64 + linux/arm64), pushes to
  `ghcr.io/nesquena/hermes-webui`, and creates a GitHub Release with
  auto-generated release notes. Uses GHA layer caching for fast rebuilds.
- **Pre-built container images.** Users can now `docker pull ghcr.io/nesquena/hermes-webui:latest`
  instead of building locally.

---

## [v0.18.1] Safe HTML Rendering + Sprint 16 Tests
*April 2, 2026 | 289 tests*

### Features
- **Safe HTML rendering in AI responses.** AI models sometimes emit HTML tags
  (`<strong>`, `<em>`, `<code>`, `<br>`) in their responses. Previously these
  showed as literal escaped text. A new pre-pass in `renderMd()` converts safe
  HTML tags to markdown equivalents before the pipeline runs. Code blocks and
  backtick spans are stashed first so their content is never touched.
- **`inlineMd()` helper.** New function for processing inline formatting inside
  list items, blockquotes, and headings. The old code called `esc()` directly,
  which escaped tags that had already been converted by the pre-pass.
- **Safety net.** After the full pipeline, any HTML tags not in the output
  allowlist (`SAFE_TAGS`) are escaped via `esc()`. XSS fully blocked -- 7
  attack vectors tested.
- **Active session gold style.** Active session uses gold/amber (`#e8a030`)
  instead of blue, matching the logo gradient. Project border-left skipped
  when active (gold always wins).

### Tests
- **74 new tests** in `test_sprint16.py`: static analysis (6), behavioral (10),
  exact regression (1), XSS security (7), edge cases (51). Total: 289 passed.

---

## [v0.17.3] Bug Fixes
*April 2, 2026*

### Bug Fixes
- **NameError crash in model discovery.** `logger.debug()` was called in the
  custom endpoint `except` block in `config.py`, but `logger` was never
  imported. Every failed custom endpoint fetch crashed with `NameError`,
  returning HTTP 500 for `/api/models`. Replaced with silent `pass` since
  unreachable endpoints are expected. (PR #24)
- **Project picker clipping and width.** Picker was clipped by
  `overflow:hidden` on ancestor elements. Width calculation improved with
  dynamic sizing (min 160px, max 220px). Event listener `close` handler
  moved after DOM append to fix reference-before-definition. Reordered
  `picker.remove()` before `removeEventListener` for correct cleanup. (PR #25)

---

## [v0.17.2] Model Update
*April 2, 2026*

### Enhancements
- **GLM-5.1 added to Z.AI model list.** New model available in the dropdown
  for Z.AI provider users. (Fixes #17)

---

## [v0.17.1] Security + Bug Fixes
*April 2, 2026 | 237 tests*

### Security
- **Path traversal in static file server.** `_serve_static()` now sandboxes
  resolved paths inside `static/` via `.relative_to()`. Previously
  `GET /static/../../.hermes/config.yaml` could expose API keys.
- **XSS in markdown renderer.** All captured groups in bold, italic, headings,
  blockquotes, list items, table cells, and link labels now run through `esc()`
  before `innerHTML` insertion.
- **Skill category path traversal.** Category param validated to reject `/`
  and `..` to prevent writing outside `~/.hermes/skills/`.
- **Debug endpoint locked to localhost.** `/api/approval/inject_test` returns
  404 to any non-loopback client.
- **CDN resources pinned with SRI hashes.** PrismJS and Mermaid tags now have
  `integrity` + `crossorigin` attributes. Mermaid pinned to `@10.9.3`.
- **Project color CSS injection.** Color field validated against
  `^#[0-9a-fA-F]{3,8}$` to prevent `style.background` injection.
- **Project name length limit.** Capped at 128 chars, empty-after-strip rejected.

### Bug Fixes
- **OpenRouter model routing regression.** `resolve_model_provider()` was
  incorrectly stripping provider prefixes from OpenRouter model IDs (e.g.
  `openai/gpt-5.4-mini` became `gpt-5.4-mini` with provider `openai`),
  causing AIAgent to look for OPENAI_API_KEY and crash. Fix: only strip
  prefix when `config.provider` explicitly matches that direct-API provider.
- **Project picker invisible.** Dropdown was clipped by `.session-item`
  `overflow:hidden`. Now appended to `document.body` with `position:fixed`.
- **Project picker stretched full width.** Added `max-width:220px;
  width:max-content` to constrain the fixed-positioned picker.
- **No way to create project from picker.** Added "+ New project" item at
  the bottom of the picker dropdown.
- **Folder button undiscoverable.** Now shows persistently (blue, 60%
  opacity) when session belongs to a project.
- **Picker event listener leak.** `removeEventListener` added to all picker
  item onclick handlers.
- **Redundant sys.path.insert calls removed.** Two cron handler imports no
  longer prepend the agent dir (already on sys.path via config.py).

---

## [v0.16.2] Model List Updates + base_url Passthrough
*April 1, 2026 | 247 tests*

### Bug Fixes
- **MiniMax model list updated.** Replaced stale ABAB 6.5 models with current
  MiniMax-M2.7, M2.7-highspeed, M2.5, M2.5-highspeed, M2.1 lineup matching
  hermes-agent upstream. (Fixes #6)
- **Z.AI/GLM model list updated.** Replaced GLM-4 series with current GLM-5,
  GLM-5 Turbo, GLM-4.7, GLM-4.5, GLM-4.5 Flash lineup.
- **base_url passthrough to AIAgent.** `resolve_model_provider()` now reads
  `base_url` from config.yaml and passes it to AIAgent, so providers with
  custom endpoints (MiniMax, Z.AI, local LLMs) route to the correct API.

---

## [v0.16.1] Community Fixes -- Mobile + Auth + Provider Routing
*April 1, 2026 | 247 tests*

Community contributions from @deboste, reviewed and refined.

### Bug Fixes
- **Mobile responsive layout.** Comprehensive `@media(max-width:640px)` rules
  for topbar, messages, composer, tool cards, approval cards, and settings modal.
  Uses `100dvh` with `100vh` fallback to fix composer cutoff on mobile browsers.
  Textarea `font-size:16px` prevents iOS/Android auto-zoom on focus.
- **Reverse proxy basic auth support.** All `fetch()` and `EventSource` URLs now
  constructed via `new URL(path, location.origin)` to strip embedded credentials
  per Fetch spec. `credentials:'include'` on fetch, `withCredentials:true` on
  EventSource ensure auth headers are forwarded through reverse proxies.
- **Model provider routing.** New `resolve_model_provider()` helper in
  `api/config.py` strips provider prefix from dropdown model IDs (e.g.
  `anthropic/claude-sonnet-4.6` → `claude-sonnet-4.6`) and passes the correct
  `provider` to AIAgent. Handles cross-provider selection by matching against
  known direct-API providers.

---

## [v0.12.2] Concurrency + Correctness Sweeps
*March 31, 2026 | 190 tests*

Two systematic audits of all concurrent multi-session scenarios. Each finding
became a regression test so it cannot silently return.

### Sweep 1 (R10-R12)
- **R10: Approval response to wrong session.** `respondApproval()` used
  `S.session.session_id` -- whoever you were viewing. If session A triggered
  a dangerous command requiring approval and you switched to B then clicked
  Allow, the approval went to B's session_id. Agent on A stayed stuck. Fixed:
  approval events tag `_approvalSessionId`; `respondApproval()` uses that.
- **R11: Activity bar showed cross-session tool status.** Session A's tool
  name appeared in session B's activity bar while you were viewing B. Fixed:
  `setStatus()` in the tool SSE handler is now inside the `activeSid` guard.
- **R12: Live tool cards vanished on switch-away and back.** Switching back to
  an in-flight session showed empty live cards even though tools had fired.
  Fixed: `loadSession()` INFLIGHT branch now restores cards from `S.toolCalls`.

### Sweep 2 (R13-R15)
- **R13: Settled tool cards never rendered after response completes.**
  `renderMessages()` has a `!S.busy` guard on tool card rendering. It was
  called with `S.busy=true` in the done handler -- tool cards were skipped
  every time. Fixed: `S.busy=false` set inline before `renderMessages()`.
- **R14: Wrong model sent for sessions with unlisted model.** `send()` used
  `$('modelSelect').value` which could be stale if the session's model isn't
  in the dropdown. Fixed: now uses `S.session.model || $('modelSelect').value`.
- **R15: Stale live tool cards in new sessions.** `newSession()` didn't call
  `clearLiveToolCards()`. Fixed.

---

## [v0.12.1] Sprint 10 Post-Release Fixes
*March 31, 2026 | 177 tests*

Critical regressions introduced during the server.py split, caught by users and fixed immediately.

- **`uuid` not imported in server.py** -- `chat/start` returned 500 (NameError) on every new message
- **`AIAgent` not imported in api/streaming.py** -- agent thread crashed immediately, SSE returned 404
- **`has_pending` not imported in api/streaming.py** -- NameError during tool approval checks
- **`Session.__init__` missing `tool_calls` param** -- 500 on any session with tool history
- **SSE loop did not break on `cancel` event** -- connection hung after cancel
- **Regression test file added** (`tests/test_regressions.py`): 10 tests, one per introduced bug. These form a permanent regression gate so each class of error can never silently return.

---
