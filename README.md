# PDFinder

Experimental encrypted PDF text extraction toolkit with synthetic benchmarks for Cloudflare Workers and MCP integration.

**Research snapshot, not a production attachment service.** Development and cloud deployment are paused. This repository records existing work and makes its local verification reproducible. No real mail, documents, passwords, cloud account configuration, or deployment credentials are included.

## Local use

Node.js 22 or newer (migration verified on Node.js 24.22.1):

```sh
npm ci
npm run verify
```

`npm test` runs 302 interface checks with controlled dependencies. `npm run test:parser` runs 32 checks against the actual parser with fixed synthetic fixtures; outbound fetch is blocked. `npm run build` bundles to ignored `dist/worker.mjs`. None of these commands deploys or contacts a Worker. No deployment automation is provided.

Supported fixture coverage: plain PDF, RC4-128, AES-128, AES-256, and an embedded-font Chinese PDF. Password literals in fixtures are public synthetic data, not secrets. The worker accepts only fixed fixture IDs and returns bounded metadata, not arbitrary uploaded documents. Authentication and expiration configuration are required by its existing interface; this repository contains no working credentials.

## Evidence and limits

- Local migration verification: **302 interface checks + 32 actual-parser checks passed**; local build passed.
- Latest historical cloud attempt: **HTTP 403 at the MCP outbound channel**, with no verified parser response or request CPU measurement.
- Cloudflare Workers Free request CPU feasibility remains **unknown**. Whole-process local CPU measurements are not cloud per-request CPU.
- Mailbox integration, real-document acceptance, reusable password handling, and phone-to-mail-to-PDF flow are **not completed**.
- These tests cover fixtures, not all PDFs, encryption variants, fonts, or layouts.

See [status and history](docs/historical-handoff.zh-TW.md), [migration record](docs/migration.md), [architecture](docs/architecture.md), and [Gitflow](CONTRIBUTING.md).

## License

Project code: Apache-2.0, matching the repository owner's initial license. Vendored dependencies and embedded font data retain their own licenses. Read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistribution; do not distribute a generated bundle without its required notices.
