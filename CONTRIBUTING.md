# Contributing to Hermes One-Click

Thanks for helping improve **Hermes One-Click**.

This repository is a publish/export layer built on top of:
- **Hermes** (agent / CLI / gateway stack)
- **Hermes Web UI** (`hermes-UI`)

Please keep contributions focused on desktop packaging, UX polish, docs, and integration quality for the One-Click experience.

---

## Quick Scope

Good contribution targets:
- Desktop startup/build/release flow (`hermes-desktop`, packaging scripts)
- Web UI polish and localization for One-Click UX
- Export/publish pipeline (`github/` scripts and docs)
- Build reliability and Windows compatibility

Out of scope for this repo's contribution surface:
- Large upstream architecture changes to Hermes core that should go to upstream first

---

## Local Dev (short)

1. Work in the full monorepo root.
2. Make your changes.
3. Regenerate publish mirror:

```powershell
cd <repo-root>
.\github\sync-export.ps1
```

4. Validate the generated `github/repository/` output.

---

## Pull Request Checklist

- Keep PR focused (one logical change)
- Describe what changed and why
- Include test/verification steps
- Confirm no secrets are committed
- If UI changed, attach screenshots

---

## License and Attribution

By contributing, you agree your contribution is provided under the applicable MIT terms in this project.

- Export-layer and publishing materials in `github/` use the Devsoul MIT notice.
- Upstream components keep their original notices and attribution; see `THIRD_PARTY_NOTICES.md`.

---

## 中文补充

- 本仓库对外发布的是 **Hermes One-Click**，基于 **Hermes** 与 **Hermes Web UI**。
- 欢迎优先提交：Windows 构建稳定性、界面体验优化、导出发布流程优化、文档改进。
- 若涉及上游 Hermes 核心的大改，建议先在上游仓库讨论或提交。
