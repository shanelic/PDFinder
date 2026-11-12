# Repository migration — 2026-11-12

## What changed

The curated source snapshot was rearranged into `src`, `vendor`, and `tests`. Relative imports were updated, a standalone esbuild build entry and pinned dependency lock were added, and existing test exports were given local runners. No new extraction feature, deployment, or cloud test was added. The historical handoff remains historical, including its then-current warning that the source was not independently buildable; this migration supersedes that packaging limitation only.

## Verification

Node.js 24.22.1; esbuild 0.28.0. Interface suite 302/302 passed; actual parser suite 32/32 passed with 0 observed global fetch calls. Local build succeeded. The expected PDF.js warning about the modern build under Node was emitted; it did not fail tests. The rebuilt bundle differs from the historical bundle because paths/banner changed. Neither bundle has proven current cloud request CPU compliance.

## Preserved knowledge

The Traditional Chinese handoff records crypto formats, Chinese CMap limitations, earlier 1,310 checks plus 30 loader checks, 11 mocked smoke checks, local CPU observations, the outbound 403, restore state, and next steps. Those historical counts are not added to today's test totals and were not rerun here.

## Excluded deliberately

Large deployment controllers, consumed live requests, authority/approval records, provider responses, expired credentials and private deployment identifiers stay out of public history. Prototype mailbox workflows and raw benchmark experiments are not claimed to be production-ready or included as runnable features. The historical source archive remains separately retained; this repository records its valuable findings without copying private operational context.

The PyMuPDF-based historical Chinese-fixture generator is not included. Its toolchain license must be reviewed before any future import; use of that generator is not a claim that the JavaScript runtime is AGPL. Third-party font rights are documented separately.

## Next steps (not started)

1. Review this archival import.
2. Once development resumes, choose a supported HTTP test channel and verify one encrypted synthetic document on the actual cloud runtime.
3. Measure real per-request CPU/latency before deciding on the Free tier.
4. Only then complete production authentication, secret handling, mailbox integration, and end-to-end acceptance.
