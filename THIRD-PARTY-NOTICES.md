# Third-party notices

OpenTakeoff is Apache-2.0 licensed. It builds on the following open-source projects,
which retain their own licenses:

| Project | License | Use |
|---|---|---|
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | Apache-2.0 | PDF parsing & rendering (incl. the bundled `pdf.worker`) |
| [React](https://github.com/facebook/react) / `react-dom` | MIT | UI runtime |
| [React Router](https://github.com/remix-run/react-router) | MIT | Routing |
| [Vite](https://github.com/vitejs/vite) | MIT | Build tool / dev server |
| [fflate](https://github.com/101arrowz/fflate) | MIT | Unzipping dropped `.zip` plan sets (lazy-loaded) |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | MIT | Wrapping dropped images into PDFs (lazy-loaded) |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 | Type-checking the geometry libs |
| [tsx](https://github.com/privatenumber/tsx) | MIT | Running TS tests under Node |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) (`@modelcontextprotocol/sdk`) | MIT | The `mcp/` server's protocol layer (stdio + in-memory test transport) |
| [Zod](https://github.com/colinhacks/zod) | MIT | Tool-input validation in `mcp/` |

The optional AI sandbox (`/server`) additionally uses
[FastAPI](https://github.com/fastapi/fastapi) (MIT), [Starlette](https://github.com/encode/starlette) (BSD-3-Clause),
[Uvicorn](https://github.com/encode/uvicorn) (BSD-3-Clause), and [Pydantic](https://github.com/pydantic/pydantic) (MIT).

`pdf.js` is distributed under the Apache License 2.0; a copy of that license is
available at <https://github.com/mozilla/pdf.js/blob/master/LICENSE>.

## Bundled binary artifacts

Redistributed in this repository and served from the app's own origin (not a
CDN). Each is unmodified apart from Google Fonts' `latin` / `latin-ext`
subsetting.

| Artifact | Family | Source | License |
|---|---|---|---|
| `web/public/fonts/bricolage-grotesque-*.woff2` | Bricolage Grotesque | Google Fonts | SIL OFL 1.1 |
| `web/public/fonts/inter-*.woff2` | Inter | Google Fonts | SIL OFL 1.1 |
| `web/public/fonts/jetbrains-mono-*.woff2` | JetBrains Mono | Google Fonts | SIL OFL 1.1 |
| `web/public/fonts/space-mono-*.woff2` | Space Mono | Google Fonts | SIL OFL 1.1 |
| `web/public/fonts/ibm-plex-mono-*.woff2` | IBM Plex Mono | Google Fonts | SIL OFL 1.1 |

The SIL Open Font License 1.1 text ships alongside them at
[`web/public/fonts/OFL.txt`](web/public/fonts/OFL.txt) and is served with the
app. The `@font-face` declarations that load them are generated into
[`web/src/styles/fonts.css`](web/src/styles/fonts.css), which documents how to
regenerate the set.
