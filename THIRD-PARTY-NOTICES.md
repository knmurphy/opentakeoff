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
| [pdf-lib](https://github.com/Hopding/pdf-lib) | MIT | Web: wrapping dropped images into PDFs (lazy-loaded). MCP server: a direct runtime dependency since 0.9.x, for `export_marked_pdf` |
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
CDN). Each is a **Google Fonts `latin` / `latin-ext` woff2 subset** of the
upstream release — under OFL 1.1 §1 that makes them Modified Versions (glyphs
removed, format changed). They remain under OFL 1.1, and no Reserved Font Name
is used by a renamed derivative.

| Family | Version | Copyright | Upstream | License |
|---|---|---|---|---|
| Bricolage Grotesque | 1.001 | The Bricolage Grotesque Project Authors, 2022 | [ateliertriay/bricolage](https://github.com/ateliertriay/bricolage) | SIL OFL 1.1 |
| Inter | 4.001 | The Inter Project Authors, 2016 | [rsms/inter](https://github.com/rsms/inter) | SIL OFL 1.1 |
| JetBrains Mono | 2.211 | The JetBrains Mono Project Authors, 2020 | [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono) | SIL OFL 1.1 |
| Space Mono | 1.003 | The Space Mono Project Authors, 2016 | [googlefonts/spacemono](https://github.com/googlefonts/spacemono) | SIL OFL 1.1 |
| IBM Plex Mono | 2.3 | IBM Corp., 2017 — **Reserved Font Name "Plex"** | [IBM/plex](https://github.com/IBM/plex) | SIL OFL 1.1 |

**On the IBM Plex family name.** OFL §3 bars a Modified Version from presenting
a Reserved Font Name as its primary font name. These subsets are produced and
published by Google Fonts, IBM's own distribution channel for Plex, so what we
redistribute is the holder's distributed form rather than a third-party
derivative — and every self-hosting toolchain ships these under the original
family names. We keep `font-family: 'IBM Plex Mono'` on that basis. Recorded
here so it is a considered position, not an oversight.

The SIL Open Font License 1.1 text and the per-family copyright notices ship
beside the fonts at [`web/public/fonts/OFL.txt`](web/public/fonts/OFL.txt) and
are served with the app. Per-file SHA-256 hashes, versions and source URLs are
in [`web/public/fonts/MANIFEST.txt`](web/public/fonts/MANIFEST.txt); check them
with `python3 scripts/fetch-fonts.py --verify`. The `@font-face` declarations
are generated into [`web/src/styles/fonts.css`](web/src/styles/fonts.css) by
[`scripts/fetch-fonts.py`](scripts/fetch-fonts.py), which is also how the set is
regenerated.
