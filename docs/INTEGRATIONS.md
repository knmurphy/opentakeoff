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

## 3.1 Concrete targets under evaluation: Windmill and Glide

Two specific destinations are on the table. They authenticate differently, and
that difference — not the transport — is what decides the architecture.

### Glide (no-code app builder) — direct SaaS API

- Ingest is the **Glide Tables API**: `POST` to
  `https://api.glideapp.io/api/function/mutateTables` (legacy) or the newer Big
  Tables API at `https://api.glideapps.com`, body carries `add-row-to-table`
  mutations, ≤ 500 mutations per call.
- Auth: `Authorization: Bearer <token>`. **The token is team-wide** — Glide's
  own docs state it "has access to all applications and data in your team" and
  "should not be exposed in client environments."
- **Consequence: a forwarder is mandatory.** There is no scoped/capability
  token; the browser can never hold this secret. Glide is the strict case.
- Payload shape mismatch: Glide tables are **flat rows**; `report.v1` is nested.
  Something must flatten it — one row per condition (a *Takeoffs* table), one
  row per material (a *Materials* table), one row per project (*Projects*).
- Practical notes: API is a paid-plan feature (Business/Enterprise); add-row is
  not idempotent, so re-sends need an upsert strategy (a stable
  `project_id + condition_id` key column + `set-columns-in-row`, or
  delete-then-add per project).

### Windmill (open-source workflow engine) — self-hosted webhook + code

- Ingest is a **webhook**: `POST` to the script/flow URL
  (`/api/w/<workspace>/jobs/run[/_wait_result]/p/<path>`).
- Auth: Bearer token, **but Windmill can mint a token pre-scoped to a single
  script/flow** — "safe to share publicly" per their docs. Worst case if it
  leaks: someone triggers that one flow. Blast radius is one flow, unlike
  Glide's team-wide key.
- **Windmill runs your code**, so it is not just a sink — it is a
  transform-and-fan-out hub. A Windmill flow can hold *its own* secrets
  (including the Glide team token, in Windmill's variables/secrets store), do
  the `report.v1` → rows flatten, verify an HMAC, and deliver onward.
- No native inbound HMAC verification (open request:
  windmill-labs/windmill#5115), but you can verify a signature *inside* the
  script trivially since it's your code.

### The insight: Windmill can be the forwarder

If Glide is the ultimate destination, you don't have to build a custom forwarder
to hold the Glide team token — **let Windmill hold it.** Then:

```
Browser ──report.v1──▶ Windmill webhook ──▶ Windmill flow ──▶ Glide Big Tables
                                          (holds Glide token,
                                           flattens, upserts)
```

Every high-value secret (the Glide team key) lives in Windmill's secret store,
never in the browser. The only thing left to protect is the **browser → Windmill
webhook** hop, and Windmill's scoped webhook token already covers that at low
blast radius. Add a tiny forwarder in front only if you want to keep even the
scoped token out of the bundle or gate the hop with identity (§6).

**Recommendation:** make **Windmill the ingestion point**. It fits a fork that
wants to own its stack (open-source, self-hostable), it natively models the
"webhook payload" you described, and it absorbs the Glide-secret problem instead
of forcing a bespoke forwarder. Route to Glide *from* Windmill if/when you need
the Glide app populated.

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

**Per target:**

- **Glide** — Glide is *their* cloud; you can't put Cloudflare Access in front of
  it. CF Access is **irrelevant** to the Glide hop. The whole security story is
  keeping the team-wide token server-side (forwarder or Windmill). No Access
  page needed.
- **Windmill (self-hosted)** — this is the only place CF Access *could* apply: if
  you self-host Windmill behind Cloudflare, you may gate the instance with an
  Access **service token** (the caller/forwarder then sends
  `CF-Access-Client-Id/Secret` alongside the Windmill bearer token). But this is
  **optional and additive** — Windmill's scoped webhook token already
  authenticates the call. The interactive Access **page** is still only for
  humans reaching the Windmill UI or for gating the browser→forwarder hop, never
  for the webhook itself.

**So, for Windmill or Glide: you do not need a Cloudflare Access page.** For
Windmill you might reach for Access *service tokens* (not the page) if you
self-host and want a network gate on top of the scoped token; for Glide, Access
plays no part at all.

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
