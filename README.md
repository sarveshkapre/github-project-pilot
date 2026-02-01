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
  --html-theme paper
```

Publish to GitHub (requires `gh auth login`):
```bash
node dist/index.js publish \
  --repo sarveshkapre/github-project-pilot \
  --issues-dir out/issues \
  --report-csv out/report/summary.csv \
  --limit 10 \
  --delay-ms 300
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
    status: backlog
    tasks:
      - Add docs
      - Configure CI
```

## Docker
Not applicable (CLI-only).

## Status
MVP scaffolded. See `docs/ROADMAP.md`.
