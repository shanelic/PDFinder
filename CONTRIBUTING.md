# Contribution workflow

Use Gitflow: `main` is the release baseline; `develop` is the integration branch; `feature/*` branches start from and target `develop`. Use `release/*` only when a release is actually ready and `hotfix/*` for release fixes. This import is not a release and is not merged automatically.

Use Conventional Commits, for example:

- `chore(deps): preserve licensed parser dependencies`
- `feat(parser): import existing synthetic extraction candidate`
- `test(parser): add reproducible local verification`
- `docs(history): record verified results and unresolved limitations`

These import commits document work today, not fabricated historical commit dates. Keep changes small and preserve provenance. Run `npm ci && npm run verify` before review. Open pull requests as drafts until reviewed. Do not force-push, silently rewrite user history, merge, publish a release, or deploy as part of archival work.

Never commit real documents, mail, passwords, tokens, `.env`, provider responses, operational requests, personal paths, or cloud account identifiers. Fixture passwords are explicitly public synthetic values. New fixtures need provenance and redistribution-license review.
