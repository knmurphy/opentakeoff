# Outbound integrations — design proposal

> **Status:** design only. No code has been added for this yet. This documents
> *how* OpenTakeoff would push takeoff data to an external system securely, so the
> approach can be reviewed before anything is built.

OpenTakeoff ships as a client-only static app: the canvas, the geometry, and all
persistence run in the browser (IndexedDB + localStorage), and the build is a
static `dist/` with no backend. That's a deliberate property of the upstream
project — but a fork is free to add a network path. This document is the design
for one: **pushing a finished takeoff out to another system.**

## 1. The constraint that shapes everything

The app is a **static bundle**. Anything embedded in it — an API key, a webhook
signing secret, a bearer token — is shipped to every visitor in plaintext and is
visible in DevTools. Therefore:

> **A credential must never live in the client.** Any authenticated outbound
> integration needs a server-side component to hold the secret, even if that
> component is a single serverless function.

Everything below follows from that one rule.

## 2. The payload already exists

`web/src/lib/totals.js` → `reportJson()` produces a **versioned, additive-only**
envelope, schema `opentakeoff.report.v1`. It is already the JSON export and is
pinned by `web/test/totals.test.ts`, so its shape is stable and downstream
parsers can rely on it. Top-level keys:

| Key | Contents |
|---|---|
| `schema` | `"opentakeoff.report.v1"` |
| `project_name` | project label or `null` |
| `generated_with` | `"OpenTakeoff"` |
| `sheets[]` | `{ sheet_id, sheet, scale_source }` |
| `conditions[]` | per-condition totals (Floor/Wall/Border SF, LF, EA, SY, with/without waste) + assigned custom `columns` |
| `by_sheet[]` | ordered quantities sliced per sheet |
| `totals` | grand totals |
| `materials[]` | combined materials buy list (coverage → order qty) |
| `markups[]`, `rfis[]` | annotation + RFI register |

**Reuse this verbatim as the webhook body.** Do not invent a second schema.
Wrap it in a thin transport envelope (§4) and send it.

## 3. Direction and target

- **Direction:** push out (OpenTakeoff → external system). No inbound receiver
  is in scope for this design.
- **Target:** three realistic destinations, in increasing build cost:

  1. **Automation hub** (Zapier / Make / n8n / Pipedream catch-hook) — zero code
     on the destination; the hub fans out to Sheets/email/Airtable/QuickBooks.
     The hook URL *is* the secret; add HMAC (§5) if the data is sensitive.
  2. **Direct SaaS API** (Google Sheets, Airtable, Slack, an ERP) — native but
     needs OAuth/API-key handling, so it **requires the backend** (§4, shape B),
     one integration per vendor.
  3. **Your own receiver** — post `report.v1` to an endpoint you host and own
     both ends of. **Recommended primary target** for a flooring estimator fork:
     push finalized quantities back into your pricing/estimating system.

The rest of this design centers on **your own receiver** and keeps the
**automation-hub** path as the zero-backend quick start.

## 4. Architecture — two shapes

### Shape A — browser → third party directly (quick start, no backend)

```
Browser  ──POST report.v1──▶  Zapier/Make/n8n catch-hook  ──▶  anything
```

- Simplest possible; no infra to run.
- Viable **only** when the target treats the URL as an unguessable capability
  and you accept that the URL ships inside the static bundle (any user of the
  fork can read it).
- The receiver must permit CORS for the app origin.
- Good for "post my report to my own private Zap." Not good when leaking the
  endpoint matters.

### Shape B — browser → your forwarder → destination (recommended)

```
Browser  ──POST report.v1──▶  /api/push (serverless fn)  ──HMAC-signed──▶  your receiver
                                     │
                              holds the secret
```

- One endpoint: a **Netlify Function** or **Cloudflare Worker** (the app already
  deploys cleanly to both), or extend the existing FastAPI service in `server/`.
- The browser POSTs the report JSON to the **same-origin** `/api/push`; the
  function holds the signing secret, signs the payload, and forwards it.
- The secret never touches the client. This is the standard
  backend-for-frontend pattern and the right default for anything authenticated.

**Recommendation:** Shape B, serverless function, `report.v1` as the body.

## 5. Security model

The network gate is secondary; **the signature is the real security.**

- **No secrets in the client** — see §1. If auth is required, Shape B.
- **HMAC-sign every payload.** The forwarder computes
  `HMAC-SHA256(secret, timestamp + "." + raw_body)` and sends:
  - `X-OpenTakeoff-Signature: sha256=<hex>`
  - `X-OpenTakeoff-Timestamp: <unix seconds>`
  The receiver recomputes and compares in constant time, and **rejects a skew >
  5 minutes** → replay protection.
- **Idempotency key** — a UUID per send (`Idempotency-Key` header) so a retry
  can't double-post a takeoff.
- **HTTPS only.** Secrets live in the host's secret store (Netlify/CF env vars),
  never in the repo.
- **Least-privilege** on whatever token the destination issues.
- **Don't leak plan data** — the repo already warns "never commit real plans";
  the same care applies to what you pipe to a third party. The `report.v1`
  payload is quantities + labels, not the PDF, which keeps the blast radius
  small by construction.

## 6. Where Cloudflare Access fits (and where it doesn't)

Cloudflare Access (Zero Trust) is an **identity gate in front of an endpoint you
host**. It has two modes, and they map to the two hops differently:

- **Interactive Access page** (Google/GitHub/email-OTP login) → for **humans in
  a browser**. A webhook caller can't click through a login page.
- **Service token** (`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers)
  → for **machine-to-machine**.

Applied to Shape B's two hops:

| Hop | Protect it with | Why |
|---|---|---|
| **forwarder → your receiver** (machine→machine) | **HMAC** (primary); optionally a CF Access **service token** since both ends are yours | The signature authenticates the payload; the service token adds a network gate |
| **browser → forwarder** | **cannot** use a service token — the token would ship in the static bundle (§1). Either (a) leave it open but rate-limited, since its only power is posting *signed* data to *one fixed* destination, or (b) put the **interactive Access page in front of the whole app** so browser calls carry a `Cf-Access-Jwt-Assertion` the function validates | This is the one place the Access *page* legitimately fits |

**Bottom line on the original question — do we need a Cloudflare Access page?**

- To push to a **third-party** webhook (Shape A): **no.** You authenticate to
  *them*; CF Access is irrelevant to outbound calls.
- To run **your own forwarder** (Shape B): the Access **page** is **optional** —
  needed only if you want the *browser→forwarder* hop tied to an identity.
  For the *forwarder→receiver* hop you'd use HMAC (and optionally an Access
  *service token*, not the page).
- You never use the interactive Access **page** to secure the webhook traffic
  itself — that page is for gating humans, not machines.

## 7. Trigger & UX (proposal)

- Add a **"Send / Push"** action to the report toolbar (`ReportPanel.jsx`,
  alongside the existing CSV / XLSX / JSON export controls).
- v1: **manual** — click builds `reportJson(...)` and POSTs it, with a
  success/failure toast and the destination shown.
- The destination URL + which shape is configured via build-time env
  (`VITE_PUSH_ENDPOINT`) so a fork sets it without code changes.
- Later: opt-in **auto-push on report change**, debounced, with an idempotency
  key so repeats collapse.

## 8. Open questions to resolve before building

1. **Which target** — automation hub, a specific SaaS, or your own receiver?
   (Decides whether Shape A suffices or Shape B is required.)
2. **Host** — Netlify Function vs Cloudflare Worker vs extend `server/`.
3. **Does the browser→forwarder hop need an identity gate** (→ interactive CF
   Access page in front of the app), or is a rate-limited open forwarder + HMAC
   at the receiver enough?
4. **Manual send only, or auto-push** on change?

## 9. What a prototype would add (not in this design pass)

- `netlify/functions/push.ts` (or a CF Worker) — receives `report.v1`, signs,
  forwards; secret from env.
- A "Send" control in `ReportPanel.jsx` wired to `reportJson(...)`.
- `VITE_PUSH_ENDPOINT` wiring + docs.
- A tiny reference receiver that verifies the HMAC (for local testing).
