# Architecture retained from the prototype

`src/worker.mjs` delegates to `candidate-factory.mjs`. Existing input/authentication/expiration gates run before lazy parser initialization. `fixed-fixtures.mjs` contains only fixed synthetic PDFs and expected outputs. `lazy-loader.mjs` initializes geometry, PDF.js API, modified parser worker, and the guarded extractor. `guarded-extractor.mjs` enforces bounded pages/text, cancellation and cleanup, and packaged CMap access.

`vendor/pdfjs/pdf.worker-native-guarded.mjs` is a modified PDF.js 6.2.108 worker. Its `BEGIN LOCAL PDF20 NATIVE PRIMITIVES` markers identify native crypto changes. Mozilla's Apache notice is preserved. This import changes dependency paths, not parser behavior. No arbitrary remote font or document fetching is enabled.

Only initialization is cached. This is not a persistent document/password/result cache. The interface still exposes synthetic benchmark behavior rather than an end-user PDF extraction service.
