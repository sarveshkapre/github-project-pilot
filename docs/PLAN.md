# PLAN

## Summary
GitHub Project Pilot is a local-first orchestrator that turns backlog rows into execution plans and GitHub issue drafts. MVP avoids GitHub auth and produces files you can review before publishing.

## Stack
- Runtime: Node.js 20+
- Language: TypeScript
- CLI: commander
- Validation: zod
- YAML: yaml
- Tests: vitest

Rationale: small dependency footprint, fast CLI iteration, strong type safety.

## Architecture
- `src/index.ts`: CLI entrypoint and commands
- `examples/`: sample backlog input
- `out/`: generated plan + issue drafts

Data flow:
1. Parse backlog YAML
2. Validate schema
3. Build plan + issue drafts
4. Write outputs to disk

## MVP Checklist
- [x] Backlog YAML schema + validation
- [x] `simulate` command generates plan + issue drafts
- [x] Template overrides for plan + issues
- [x] Summary report output (CSV/JSON)
- [x] HTML report output
- [x] Deterministic output paths with item IDs
- [x] Smoke test for CLI
- [x] Repo scaffolding and CI

## Milestones
1. Scaffold repo + CLI skeleton
2. MVP generation workflow
3. UX polish: templates, labeling, and reports
4. Hardening: error messages + safer defaults

## Risks
- Scope creep into full GitHub automation
- Non-deterministic outputs
- Unclear backlog schema for real-world use

## Non-goals (for MVP)
- GitHub API integration
- Authentication
- UI dashboard
