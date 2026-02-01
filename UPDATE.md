# Update (2026-02-01)

## What shipped
- Per-item backlog `labels` now flow into drafts, reports, and `publish`
- Per-item backlog `acceptance` and `risks` override the default sections
- `simulate` supports `--no-html-report`
- `simulate` supports `--clean` (removes output dir before writing)
- HTML report is more usable (search/filter, responsive layout, dark-mode support for paper theme)
- `--html-theme mono` styling now matches the report layout
- `publish` can resume via `out/report/publish-state.json` (skips already-created issues)
- Backlog duplicate IDs are rejected early with a clear error

## How to verify
- `make check`
- `node dist/index.js simulate -i examples/backlog.yml -o out`
- `node dist/index.js simulate -i examples/backlog.yml -o out --no-html-report`
- `node dist/index.js simulate -i examples/backlog.yml -o out --clean --no-html-report`
- `node dist/index.js publish --repo owner/repo --issues-dir out/issues --report-csv out/report/summary.csv --dry-run`

## Notes
- Per request: no PRs; work is committed directly on `main`.
