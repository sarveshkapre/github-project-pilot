# SECURITY

## Reporting
Report security issues privately to the maintainer. Do not open public issues for vulnerabilities.

## Threat Model Notes
- Input YAML could be malicious or malformed → strict schema validation.
- Generated files should not overwrite user data → always write to output dir.
- Future GitHub integration must use least-privilege tokens.
- GitHub publish command uses `gh` CLI auth and never stores tokens.
- Project draft creation requires `gh` auth with `project` scope.
