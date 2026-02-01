# AGENTS

## Purpose
This repo is a local-first CLI that converts a backlog YAML into plan + issue drafts. No GitHub API calls in MVP.

## Guardrails
- Do not add authentication or network calls without an explicit request.
- Keep outputs deterministic; avoid timestamps in issue drafts (plan may include timestamp).
- Maintain `make check` as the quality gate.

## Commands
- `make setup`
- `make dev`
- `make check`
- `make release`

## Conventions
- TypeScript, strict mode.
- Filesystem outputs go under `out/` by default.
- Docs live in `docs/` except `README.md`.
