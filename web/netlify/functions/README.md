# Serverless functions

The app is otherwise fully static; the only server code is the gated
schedule-scan reader. It stays **dark by default** — with no `GEMINI_API_KEY`
set, `/ai/parse-schedule` returns `501` and the "Import from a scanned schedule"
path never reaches a paid API. A default deploy is still 100% client-side.

## `parse-schedule.mjs` — gated scanned-schedule reader

When a marqueed schedule region has **no text layer** (a scanned/raster plan),
the canvas rasterizes it and POSTs the PNG here. This function reads the finishes
with a vision model and returns the same `ScheduleRow` shape the browser's vector
parser produces, so both feed the one approval dialog.

This endpoint spends money on every call, so it is **never public**:

1. Every request must carry a Google OAuth access token
   (`Authorization: Bearer …`). The client hides the feature when signed out,
   but **this server check is the real gate** — a hidden button doesn't stop
   `curl`.
2. The token is verified against Google, and the account's domain must match
   `ALLOWED_HD` when set.
3. The vision-model key lives **only** in this function's env — never in the
   browser bundle, never `VITE_`-prefixed, never committed.

### Environment variables (Netlify → Site settings → Environment)

| Variable         | Required | Default             | Notes |
| ---------------- | -------- | ------------------- | ----- |
| `GEMINI_API_KEY` | to enable | *(unset ⇒ off)*    | Google AI Studio key. Server-only secret. If unset, the endpoint returns `501` and the scan path stays off. |
| `GEMINI_MODEL`   | no       | `gemini-3.5-flash`  | Any `generateContent`-capable Gemini model id. Bump the default when Google retires it (early `404 NOT_FOUND` retirements happen — the function logs them distinctly). |
| `ALLOWED_HD`     | no       | *(any verified Google account)* | Restrict to one Workspace domain, e.g. `example.com`. Leave unset to allow any account that passes Google verification. |
| `GOOGLE_CLIENT_ID` | recommended | *(unset ⇒ audience check inactive)* | The same OAuth client id the browser signs in with (`VITE_GOOGLE_CLIENT_ID`), **without** the `VITE_` prefix — this one is read server-side. When set, the function checks the token's `aud` matches. Unset, it logs a warning and skips that check only. |

Set `ALLOWED_HD` to your Workspace domain in a real deployment so only your team
can spend against the key.

And set `GOOGLE_CLIENT_ID` alongside it. Without it the bearer token is still
verified against Google (`email_verified`, and `ALLOWED_HD` if set) — this is
not an open door — but the **audience** is not checked, so a token minted for a
*different* OAuth app and held by someone in an allowed domain is accepted. The
failure is silent apart from one line in the function log, which is exactly why
it is worth setting deliberately rather than discovering later.
