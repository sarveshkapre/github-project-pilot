# CHANGELOG

## [Unreleased]
- Added per-item `labels` support in backlog YAML (propagates to drafts, CSV/JSON, and publishing)
- Added per-item `acceptance` and `risks` overrides in backlog YAML
- Added `--no-html-report` to disable HTML report generation
- Added `simulate --clean` to delete the output directory before writing
- Added `simulate --format json` to emit machine-readable summary to stdout
- Added `simulate --generated-at <iso>` to override plan timestamp (reproducible output)
- Improved HTML report UX (search/filter, accessible structure, responsive layout, dark-mode support for paper theme)
- Fixed `--html-theme mono` styling to match the report layout
- CLI version now reads from `package.json`
- Hardened backlog item IDs to be filename-safe
- CLI now prints clean error messages for user input errors (no stack traces)
- Publish input handling is more deterministic (sorted issue draft file listing)
- Added publish resume support via `publish-state.json` (skips already-created issues)
- Added `publish --assignee-from-owner` to assign issues from `Owner:` in issue drafts
- Added `project-drafts` resume support via `project-drafts-state.json` (skips already-created drafts)

## [0.1.0] - 2026-02-01
- Initial scaffold with local-first CLI
- `simulate` command to generate plan and issue drafts
- Example backlog and smoke tests
