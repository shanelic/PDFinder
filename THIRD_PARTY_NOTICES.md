# Third-party notices

The root Apache-2.0 license applies to project-owned code; it does not relicense the components below. Keep these notices and license files when distributing source or a generated bundle.

| Component | Version / provenance | License and retained notice |
| --- | --- | --- |
| PDF.js API and modified worker | 6.2.108, Mozilla Foundation | Apache-2.0: `vendor/pdfjs/LICENSE`; original copyright headers retained |
| Canvas geometry compatibility | @napi-rs/canvas 0.1.100, geometry.js only (not native canvas) | MIT: `vendor/canvas/LICENSE` |
| geometry-polyfill ancestry | Jarek Foksa, upstream f36bbc8f4bc43539d980687904ce46c8e915543d | MIT: `vendor/licenses/geometry-polyfill-MIT.txt` |
| Packaged Adobe CMaps | PDF.js CMap resource data | BSD-like: `vendor/cmaps/Adobe-CMap-LICENSE.txt` |
| Noto Sans CJK TC embedded subset in synthetic Chinese fixture | Source font copyright Adobe 2014–2021 | SIL OFL-1.1: `vendor/licenses/NotoSansCJK-OFL.txt` |
| esbuild (build dependency, not runtime) | 0.28.0, npm lockfile | MIT; package license installed with dependency |
| MCP server, core and development client SDK | 2.4.0, official npm packages pinned in lockfile | Apache-2.0 with retained MIT contributions as explained in each installed package's `LICENSE`; keep that complete notice when redistributing |
| MCP SDK transitive dependencies | Exact versions and integrity in npm lockfile | MIT (`zod`, `cross-spawn`, `eventsource`, `eventsource-parser`, `jose`, `path-key`, `pkce-challenge`, `shebang-command`, `shebang-regex`) or ISC (`isexe`, `which`); licenses installed with each package |

The PDF.js worker has local native-cryptography changes identified by `BEGIN LOCAL PDF20 NATIVE PRIMITIVES` markers; it is not an unmodified upstream release. The loader/resource adapter and local packaging were also adapted for this prototype. Adobe's name is not used to endorse this project.

Font software retains OFL terms. Embedding font data does not make all surrounding project code OFL. No standalone font subset or historical PyMuPDF/AGPL fixture generator is shipped here. Standard-font binary packages and native canvas binaries are not vendored. Any future inclusion requires its own license review.

Upstream references:
- https://github.com/mozilla/pdf.js
- https://github.com/Brooooooklyn/canvas
- https://github.com/jarek-foksa/geometry-polyfill
- https://github.com/notofonts/noto-cjk
- https://github.com/modelcontextprotocol/typescript-sdk
