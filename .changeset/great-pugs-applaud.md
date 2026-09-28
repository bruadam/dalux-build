---
"dalux-build-api": minor
---

Add a browser-safe `dalux-build-api/web` entry that runs on an injected `fetch`.

Every `*Api` class now takes a `DaluxHttpClient` interface instead of the
concrete axios-backed `ApiClient`, so importing an endpoint group no longer
drags axios — and through it Node built-ins — into a bundle. `ApiClient`
implements the interface, so the Node surface is unchanged.

- `createWebClient({ baseUrl, apiKey, fetch, defaultParams })` returns all
  sixteen endpoint groups over a caller-supplied `fetch`. The `fetch` is
  required and never defaults to `globalThis.fetch`: a plugin host passes its
  own because that wrapper is where the outbound-host allow-list, the relay for
  an API that sends no CORS headers, redirect refusal and credential omission
  are enforced.
- `defaultParams` (Dalux's `daluxNode` selector) are applied only to requests on
  the configured base origin, and never override a parameter the caller or the
  URL already set — a pre-signed download link can carry a signature computed
  over its query string.
- New `FilesReadApi` holds the pure HTTP file reads, including
  `downloadFileBytes`. `FilesApi` extends it and keeps the Node-only
  bulk-download and interactive-selection helpers.
- `DaluxHttpClient.binary()` fetches a `downloadLink`'s bytes through the
  client's transport.
- The package now ships ESM alongside CJS, and every `exports` entry now carries per-condition
  types (`.d.mts` for `import`, `.d.ts` for `require`) so an ESM consumer under `node16`/`nodenext`
  resolution gets ESM typings instead of the CJS ones.
- `DaluxClientConfiguration.apiKey` is now optional. Only the Node-only
  `FilesApi.downloadFileFromLink` reads it — it streams the download itself instead of going
  through the client — so a host that authenticates in its own transport no longer has to hand this
  package a copy of its key to satisfy a type. That method now throws if the key is absent.
