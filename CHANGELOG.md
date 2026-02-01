# CHANGELOG

## [Unreleased]
- Added per-item `labels` support in backlog YAML (propagates to drafts, CSV/JSON, and publishing)
- Added `--no-html-report` to disable HTML report generation
- Added `simulate --clean` to delete the output directory before writing
- Improved HTML report UX (search/filter, accessible structure, responsive layout, dark-mode support for paper theme)
- CLI version now reads from `package.json`
- Hardened backlog item IDs to be filename-safe
- CLI now prints clean error messages for user input errors (no stack traces)
- Publish input handling is more deterministic (sorted issue draft file listing)
- Added publish resume support via `publish-state.json` (skips already-created issues)

## [0.1.0] - 2026-02-01
- Initial scaffold with local-first CLI
- `simulate` command to generate plan and issue drafts
- Example backlog and smoke tests
