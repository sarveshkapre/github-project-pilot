# GitHub Project Pilot

Local-first orchestrator that turns a backlog into execution plans and GitHub issue drafts without fabricating history. No authentication required; everything runs on your machine and outputs files you can review before publishing.

## Why
- Keep planning deterministic and auditable.
- Generate issue drafts without touching GitHub.
- Maintain a “simulated timeline” option before real shipping.

## Quickstart
```bash
npm install
npm run build
node dist/index.js simulate -i examples/backlog.yml -o out
```

Outputs:
- `out/plan.md`
- `out/issues/*.md`
- `out/report/summary.json`
- `out/report/summary.csv`
- `out/report/index.html`

## CLI
```bash
node dist/index.js simulate -i <backlog.yml> -o <output-dir>
```

Template options:
```bash
node dist/index.js simulate \
  -i examples/backlog.yml \
  --issue-template examples/templates/issue.md \
  --plan-template examples/templates/plan.md \
  --report report \
  --clean \
  --no-html-report \
  --html-theme paper
```

Themes:
- `paper` (light + dark-mode aware)
- `mono` (dark, monospace)

Publish to GitHub (requires `gh auth login`):
```bash
node dist/index.js publish \
  --repo sarveshkapre/github-project-pilot \
  --issues-dir out/issues \
  --report-csv out/report/summary.csv \
  --limit 10 \
  --delay-ms 300 \
  --state-file out/report/publish-state.json
```

Create GitHub Project draft items (requires `gh auth login` + project scope):
```bash
node dist/index.js project-drafts \
  --owner sarveshkapre \
  --project-number 1 \
  --issues-dir out/issues \
  --report-csv out/report/summary.csv
```

## Backlog format
```yaml
project: Example Project
items:
  - id: ex-001
    title: Bootstrap repo
    pitch: Create the base repository scaffolding.
    owner: alice
    labels:
      - docs
      - ci
    status: backlog
    tasks:
      - Add docs
      - Configure CI
    acceptance:
      - All checks pass
      - Docs updated
    risks:
      - Scope creep
```

## Docker
Not applicable (CLI-only).

## Status
MVP scaffolded. See `docs/ROADMAP.md`.
