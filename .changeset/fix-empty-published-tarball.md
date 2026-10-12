---
"dalux-build-api": patch
---

Actually ship `dist/` in the published tarball.

2.4.0 and 2.5.0 were published containing only `package.json` and `README.md`.
Nothing ran `tsup` before `changeset publish`, so the `"dist"` entry in `files`
matched nothing — and neither `npm pack --dry-run` nor `npm publish --dry-run`
treats an unmatched `files` glob as an error, so the release dry run in CI went
green on an empty package both times. Consumers installed a version that
resolved fine on the registry and then failed at build time with
`Cannot find module 'dalux-build-api/web'` (and the same for `.`, `./browser`
and `./next` — every entry point was missing, not just `/web`).

No API or behaviour change: the 2.5.0 source was correct and is unchanged. This
release is the first one whose tarball contains it.

To stop it recurring, the build is now bound to packaging rather than sitting in
front of it:

- A `prepack` script in `javascript/` runs `tsup` and then
  `scripts/verify-exports.mjs`. Because `prepack` fires on `npm pack` and
  `npm publish` alike, every path that produces a tarball — `changeset
  publish`, a manual publish, and CI's existing release dry run — now builds
  first.
- `scripts/verify-exports.mjs` asserts what the dry runs do not: every target
  named in `exports`, `main`, `types` and `module` exists on disk and is
  covered by a `files` entry. An empty or partial tarball now fails the
  release loudly instead of publishing.
- The root `release` script builds and verifies explicitly too, so the release
  does not depend on lifecycle-hook ordering alone.
