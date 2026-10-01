# ADR 0015: Hash routing in the static demo

Status: accepted (2026-10-01)

## Context
The demo is published on GitHub Pages under `/<repository>/`. Pages serves files only: there
is no single-page-app fallback, so a reload or a shared link to `/<repository>/console` returns
404. `vite preview` does have a fallback, which hid the problem locally.

## Decision
- The demo build (`VITE_DEMO`) uses `HashRouter`: routes live after `#/`
  (`/<repository>/#/console`) and the server only ever receives `/<repository>/`. The real
  app keeps `BrowserRouter` with clean paths (nginx falls back to `index.html`).
- The demo is previewed and tested with `frontend/scripts/serve-static.mjs`, a static server
  that behaves like Pages (files under the sub-path, `index.html` for directories, plain 404
  otherwise). `npm run e2e:demo` runs Chromium and WebKit against it.

## Alternatives rejected
- Copying `index.html` to `404.html`: works on Pages, but every deep link is answered with
  HTTP 404 (crawlers, link previews and monitoring see an error) and the trick is host-specific.
- Pre-rendering one HTML file per route: Studio agent routes are dynamic (`/studio/<id>`).
