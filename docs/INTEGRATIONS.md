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

### Glide (no-code app builder) — two ingest paths, very different auth

Glide can be fed **two** ways, and the auth model differs sharply:

**(a) Glide Tables API** (`mutateTables`)
- `POST` to `https://api.glideapp.io/api/function/mutateTables` (legacy) or the
  newer Big Tables API at `https://api.glideapps.com`; body carries
  `add-row-to-table` mutations, ≤ 500 per call.
- Auth: `Authorization: Bearer <token>` where the token is **team-wide** —
  Glide's docs say it "has access to all applications and data in your team" and
  "should not be exposed in client environments."
- Consequence for this path: the browser can **never** hold this secret; a
  server-side holder (forwarder or a Windmill flow) is mandatory. This is the
  strict case.

**(b) Glide webhook trigger** (starts a Glide *workflow*)
- A per-workflow **capability URL**; you `POST` a JSON payload and it runs a
  Glide workflow with the body available.
- Auth: an **optional, per-workflow bearer token** you set on that trigger —
  **not** the team-wide key. Blast radius if it leaks is that one workflow
  (worst case: junk rows), the same low-risk profile as Windmill's scoped token.
- The workflow runs Glide's own logic, so the `report.v1` → rows **flatten can
  live inside Glide** instead of in a forwarder.

**Takeaway:** via the *webhook-trigger* path, Glide and Windmill are essentially
**symmetric** — POST `report.v1` to a per-workflow URL guarded by a per-workflow
token, and their side runs the transform. The "team-wide token ⇒ forwarder
mandatory" rule applies only to Glide's *Tables API*, not its webhook trigger.

Payload shape either way: Glide tables are **flat rows**; `report.v1` is nested,
so something flattens it — one row per condition (*Takeoffs*), per material
(*Materials*), per project (*Projects*). With path (b) that's a Glide workflow;
with path (a) it's the forwarder. Practical notes: the Tables API is a paid-plan
feature (Business/Enterprise); add-row is not idempotent, so re-sends need an
upsert strategy (stable `project_id + condition_id` key + `set-columns-in-row`,
or delete-then-add per project).

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

### Consequence: the two targets converge on one pattern

Because Glide's webhook trigger and Windmill's webhook both take a *per-workflow*
token and both run logic on their side, the target choice stops driving the
architecture. Either way the app does the same thing: **POST `report.v1` to a
per-workflow URL guarded by a per-workflow token, and let the destination
transform it.** You can point at Glide, at Windmill, or at both.

Two composition options:

- **Direct to each** — the forwarder (§4 Shape B) fans out to the Glide trigger
  URL and/or the Windmill webhook, holding each per-workflow token in its env.
- **Windmill as a hub** — POST once to Windmill, and a Windmill flow fans out to
  Glide (and anything else), holding the downstream tokens in Windmill's secret
  store. Attractive if you want one ingestion point, richer transform logic, or
  to use Glide's *Tables API* (team-wide token) without a bespoke forwarder —
  Windmill becomes the safe holder for that team token.

Only the Glide **Tables API** path *forces* a server-side token holder; the
webhook-trigger paths do not. What actually decides whether you need a forwarder
is no longer the target — it's whether you want to keep even the per-workflow
token out of the static bundle and tie writes to your app's identity gate (§6),
which for a data-writing deployment you do.

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

> The subsection above answers "does the *webhook hop* need Access?" (no). But
> that was not the real question — see §6.1.

## 6.1 The real question: gating the app deployment itself

The moment `takeoff.345flooring.com` can write into Glide/Windmill, it stops
being a harmless read-only canvas and becomes a **lever that pushes data into
company systems**. So the access-control question is not about the webhook hop —
it's *who is allowed to load the app and pull that lever*. This is exactly what a
Cloudflare Access **page** is for: gate the deployment, restrict to your
`@345flooring.com` Google Workspace domain (or GitHub org / OTP), and only your
crew can open it.

**Critical: gating the page is necessary but not sufficient.** An Access page in
front of the UI does nothing to stop a direct `POST` to the write endpoint that
skips the UI. So the write endpoint must **independently verify identity** — it
cannot assume "this request came from our gated app."

The two compose cleanly if you keep the forwarder **same-origin** and put the app
*and* the forwarder under **one Access application**:

```
User ─▶ Access page (login: @345flooring.com only)
     ─▶ takeoff.345flooring.com            (app loads)
     ─▶ POST /api/push  (same origin → Access identity JWT rides along)
              │
        forwarder verifies the Access JWT   ← rejects anything without a valid crew identity
              │  (Cf-Access-Jwt-Assertion / CF_Authorization, checked vs your team's public keys, aud + email/domain)
              │
        uses the server-side per-workflow token(s)   ← secret lives here, never in the browser
              │
        ─▶ Glide trigger / Windmill webhook
```

Result: only your crew can open the app, only a valid crew identity can trigger a
write, and the Glide/Windmill tokens never leave the server. That is the property
being asked for.

Constraints and gotchas:

- **Hosting.** Production is on Netlify; Cloudflare Access lives at the DNS/proxy
  layer, so the domain must be **proxied through Cloudflare** (Cloudflare in
  front of Netlify) and `/api/*` must route through Cloudflare too for the gate
  to apply. Cleanest if committing to Access: front with Cloudflare and make the
  forwarder a **Cloudflare Worker / Pages Function** on the same proxied domain,
  so Access + JWT validation is native. A same-origin Netlify Function behind the
  proxy also works if the function validates the JWT itself.
- **Cross-origin kills the free identity.** If the browser posts *directly* to a
  Windmill/Glide URL (different origin), it can't carry the app's Access JWT and
  would need a token in the bundle. Keeping a **same-origin forwarder** is what
  lets one Access app cover the whole write path — another reason to prefer it
  over browser-direct.
- **Confused-deputy / CSRF.** If the forwarder trusts the Access cookie, also
  require a custom header (e.g. `X-Requested-By: opentakeoff`) or check `Origin`,
  so a malicious page in a logged-in user's browser can't ride the ambient cookie
  to trigger a write.
- **Non-CF alternatives** to gate the app exist (Netlify password / Identity, an
  auth provider), but CF Access is the lowest-effort "restrict to my Workspace
  domain" and integrates with the same-origin-forwarder JWT check above.

**Bottom line on the deployment question: yes — put a Cloudflare Access page in
front of `takeoff.345flooring.com`, and make the same-origin write endpoint
validate the Access JWT.** That is the correct, intended use of the Access page
(gating humans), and it is separate from — and more important than — anything
about the webhook hop itself.

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

Resolved so far: direction is **push out**; targets are **Glide and/or Windmill**
via their per-workflow **webhook triggers** (symmetric — §3.1); the deployment
**will be gated with a Cloudflare Access page** and the write endpoint will
validate the Access JWT (§6.1).

Still open:

1. **Host / topology** — same-origin **Cloudflare Worker** in front of a
   Cloudflare-proxied domain (cleanest with Access), a same-origin **Netlify
   Function** behind Cloudflare, or extend `server/`? (§6.1 argues Worker.)
2. **Fan-out shape** — forwarder posts to each target directly, or POST once to
   **Windmill as a hub** that fans out to Glide? (§3.1)
3. **Glide path** — webhook **trigger** (per-workflow token, transform in Glide)
   vs **Tables API** (team-wide token, transform in forwarder)? Trigger is the
   lower-blast-radius default.
4. **Manual send only, or auto-push** on report change (debounced + idempotency
   key)?
5. **Access rollout** — which identity provider / allowed domain, and does the
   public demo stay open while the company deployment is gated?

## 9. What a prototype would add (not in this design pass)

- `netlify/functions/push.ts` (or a CF Worker) — receives `report.v1`, signs,
  forwards; secret from env.
- A "Send" control in `ReportPanel.jsx` wired to `reportJson(...)`.
- `VITE_PUSH_ENDPOINT` wiring + docs.
- A tiny reference receiver that verifies the HMAC (for local testing).
