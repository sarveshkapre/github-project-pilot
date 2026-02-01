# GitHub Project Pilot

Local-first CLI that turns a YAML backlog into an execution plan + GitHub issue drafts (and optional `gh`-powered publishing), with deterministic, reviewable outputs.

## Features
- `simulate`: generate `plan.md`, issue draft markdown, CSV/JSON summary, and an HTML report
- Templates: override plan/issue templates with placeholders
- `publish`: create GitHub Issues via `gh` CLI (batched + delayed)
- `project-drafts`: create GitHub Project draft items via `gh` CLI

## Top risks / unknowns
- Backlog schema evolution (metadata fields, backward compatibility)
- Determinism vs. usability (timestamps, ordering, filename stability)
- `gh` CLI behavior drift across versions (flags, auth scopes)

## Commands
- Quality gate: `make check` (lint + typecheck + test + build)
- Dev help: `make dev`
- Example run: `node dist/index.js simulate -i examples/backlog.yml -o out`

For more, see `docs/PROJECT.md`.

## Shipped (latest)
- 2026-02-01: Per-item backlog labels + improved HTML report (filtering, a11y structure, dark-mode support)
- 2026-02-01: `simulate --no-html-report` to skip generating `report/index.html`
- 2026-02-01: `publish` resume support via `out/report/publish-state.json` (skips already-created issues)
- 2026-02-01: `simulate --clean` to remove the output directory before writing (prevents stale drafts/reports)
- 2026-02-01: Backlog duplicate ID validation (fails fast with a clear error)
- 2026-02-01: CLI error handling (clean user-facing errors, no stack traces)
- 2026-02-01: Fixed `--html-theme mono` styling to match the report layout
- 2026-02-01: Per-item `acceptance` + `risks` fields (override defaults in plan + issue drafts)
- 2026-02-01: `publish --assignee-from-owner` to assign issues from `Owner:` in issue drafts
- 2026-02-01: `project-drafts` resume state via `out/report/project-drafts-state.json`
- 2026-02-01: `simulate --format json` for CI-friendly stdout summaries
- 2026-02-01: `simulate --generated-at <iso>` for reproducible plan timestamps
- 2026-02-01: `simulate --sort id` for stable issue/plan ordering

## Next
- Per-item metadata overrides beyond labels (priority, milestones, assignees)
- GitHub Project field mapping (status/owner/priority)
