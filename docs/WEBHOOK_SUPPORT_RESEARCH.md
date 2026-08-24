# Webhook support for OpenTakeoff — research

**Status:** research spike. No app code, no commitment. Written 2026-08-24.
**Question:** can OpenTakeoff emit **webhooks** — a signed HTTP callback to a
URL a user configures, fired when something meaningful happens (a takeoff is
exported, a marked set is built, an RFI is raised, a contribution is banked) —
and where in this architecture can such a thing *honestly* live?

**Short answer:** yes, but not as one feature in one place. The default build is
a static, client-only app whose headline promise is that *nothing leaves your
machine*, and a browser tab cannot make the delivery guarantees a webhook is
supposed to make (at-least-once, retried, signed). So "webhook support" is
really **three different things at three different tiers**, and the honest move
is to build the cheapest, highest-fit one first and let the other two follow the
people who already run a server.

**Recommendation in one line:** **generalize the existing opt-in
`contribute`-endpoint pattern into a typed, derived-only, best-effort outbound
*notification* from the browser first; add real signed-and-retried webhooks to
the capture server (for `contribution.banked`) and the MCP server (for agent
deliverables) as separate, later, server-only tiers.** Do **not** build inbound
webhooks into the static app, and do **not** build a hosted broker.

---

## 1. What the codebase already has (measured, not assumed)

This decides everything downstream, so it goes first.

| Reality | Where | Consequence for webhooks |
|---|---|---|
| **No domain-event bus exists** | whole repo | Every `dispatchEvent`/`addEventListener` hit is raw DOM plumbing (keydown, resize, pointer, media-query). There is no business-event emitter, no listener registry, no pub/sub. A webhook needs a **new seam**, wherever it goes. |
| The one real mutation choke-point (web) | `web/src/pages/TakeoffCanvas.jsx:486` `dispatchShape`, `:545` `dispatchApproval` | Pure reducers from `lib/shapeCommands.js` / `lib/approvals.js` with an undo stack. Every committed-shape and approval-seal change funnels through these two functions. This is where a web emitter taps in. |
| The one cross-cutting seam (MCP) | `mcp/src/tools.ts:40` `run(tool, fn)` | Every tool handler is already wrapped by `run`, which already calls `traceToolCall(...)` (`mcp/src/trace.ts`) after each call. That is the *only* existing "hook" — trace logging, not notification. A webhook fan-out slots in right next to it. |
| The one existing outbound domain event | `web/src/lib/contribute.js:117` `buildContribution` → `:170` `sendContribution` | Already does exactly "derive an audited payload → `POST` it to a configurable endpoint" (`opentakeoff_contribute_endpoint` localStorage override or `VITE_CONTRIBUTE_ENDPOINT`). **This is the template.** Webhooks are this pattern, generalized to more event types. |
| A server-side event sink that already fans out | `capture/capture_server.py` `do_POST` (line ~301) → `Corpus.ingest` (170) → `_mirror` (215) | Receives contributions, banks them, and already **fans out** to a synced folder on an expendable daemon thread with a wall-clock cap and a 3-slot strand budget — best-effort side effects that never stall or fail the response. Already imports `urllib.request`. This discipline is exactly what a webhook relay needs. |
| Egress is treated as an audited boundary | `web/test/voicePrivacy.test.ts` | A test stubs `fetch`/`XMLHttpRequest`/`WebSocket` and asserts the voice path makes **zero** network calls. The project already guards egress with tests — webhooks must be added the same way. |
| Hard rule: no secrets in the bundle | `README.md` (the `VITE_AI_KEY` warning), `server/README.md` | Vite inlines env into the shipped static bundle. A browser therefore **cannot hold an HMAC signing secret**. This single fact is why browser-origin webhooks can never be authenticated, and why the tiers below split the way they do. |

**The single most important finding:** the browser already POSTs a derived,
whitelisted payload to a user-configured endpoint today (`contribute.js`). The
plumbing, the opt-in model, the "never send the PDF / names / coordinates"
discipline, and the config surface all exist. A browser-tier notification is
mostly *taxonomy and an emitter*, not new infrastructure.

## 2. Prior art in this repo — and the constraints it sets

- **`docs/CLIENT_SIDE_OCR_RESEARCH.md`** established the house pattern for a
  spike like this: measure what exists first, respect the client-only promise,
  prefer opt-in over ambient.
- **`docs/SYNC_ARCHITECTURE.md`** shows how the project already does reliable
  server-ish delivery in a client-first world: monotonic `rev`, get-before-put
  preconditions, single-flight push, remote-wins-but-snapshot-first. The
  delivery-semantics section below borrows from it.
- **`docs/GLIDE_INTEGRATION.md`** shows the real integration target. The team
  runs projects in **Glide** over a shared Drive; a webhook that fires when a
  deliverable is ready is precisely what would let Glide (or Make/Zapier) react
  without polling. This is the concrete user story, not a hypothetical.
- **The privacy posture** (`README.md`): anonymous, local-only, no upload, no
  account, no telemetry by default. Any webhook must be **strictly additive** —
  set nothing and it does not exist — exactly like the AI socket and the
  contribute endpoint.

The grep is clean: the only "webhook" string in the repo today is an incidental
mention in `docs/PDF_DATA_SURFACE.md:520`. This is greenfield.

## 3. The design space, honestly

### 3.1 Outbound vs inbound

- **Outbound** (OpenTakeoff fires an event *at* a URL): the natural fit, and the
  whole of this document.
- **Inbound** (an external system POSTs *to* OpenTakeoff to make it act): there
  is **no always-on server in the default build** to receive a callback. A
  static site cannot host an inbound endpoint; only a self-hosted MCP or a
  serverless function could, and that is a different product (a hosted takeoff
  service) than the one this repo is. **Recommendation: out of scope.** If an
  agent needs to be *triggered*, that is the orchestrator's job upstream of the
  MCP server, not a webhook into OpenTakeoff.

### 3.2 Where can an outbound emitter *honestly* originate?

There is no single place that delivers "reliable + signed + all events + both
human and agent + on the default deploy." The client-only identity forbids it.
Three candidate emitters, three different profiles:

| Emitter | Delivery it can promise | Can sign (HMAC)? | Data it can see | Fires for | Cost |
|---|---|---|---|---|---|
| **A. Browser** (tap `dispatchShape`/exports) | **At-most-once**, no durable retry (tab can close) | **No** — no secret storage (bundle inlining) | Derived / whitelisted only (must preserve the privacy promise) | Human-at-canvas | ~1 new emitter module + taxonomy |
| **B. Capture server** (fan out in `do_POST`) | **At-least-once**, retry + backoff, idempotency key | **Yes** (secret via env) | Corpus payload only — *never* project/client names, coordinates, or scale values | Contribution events only | Small; reuses `_mirror` discipline |
| **C. MCP server** (fan out in `run()`) | **At-least-once** within the session; session-scoped | **Yes** (secret via env) | Full session state (real geometry, quantities) | Agent-driven takeoffs | One seam next to `traceToolCall` |

The AI sandbox (`server/app.py`) is **not** a viable emitter — confirmed
request/response only: no `async`, no `BackgroundTasks`, no threading, no
outbound client in `requirements.txt`. Skip it.

The consequence: **tier the feature to the emitter, don't pretend one webhook
covers all of it.**

## 4. Recommended plan — three tiers, build in order

### Tier 0 — Browser "notify" (do this first)

Generalize `contribute.js` into a small `web/src/lib/notify.js` that POSTs a
**typed event envelope** to a user-configured URL on a *curated* set of events.
Framed honestly as **opt-in, best-effort, at-most-once, unsigned**.

- **Config, mirroring the contribute pattern exactly:**
  `localStorage.opentakeoff_notify_endpoint` override, `VITE_NOTIFY_ENDPOINT`
  build default. Unset ⇒ zero UI, zero network calls, feature does not exist.
- **Seam:** a tiny in-app emitter (a plain module-level `emit(type, data)`, not
  a DOM `EventTarget`) called from the existing choke-points — `dispatchShape`
  (`add`/`review`/`delete`), `dispatchApproval`, the `ReportPanel` export
  handlers (`exportCsv`/`exportJson`/`exportXlsx`/RFI/shapes,
  `ReportPanel.jsx:314-329`), the marked-set builder (`TakeoffCanvas.jsx:4654`),
  RFI (`raiseRfi`/`updateRfi`, `4932`/`4964`), and revisions
  (`RevisionsPanel.jsx:73`). Fire-and-forget `fetch(..., {keepalive:true})`
  alongside the existing download so a closing tab still gets a chance to send.
- **Payload discipline:** reuse the contribute **whitelist** — derived-only. No
  PDF, no file/project/client names, no absolute coordinates, no scale values.
  An `export.ready` event carries *what* and *how much* (format, condition
  totals), an opaque project ref, and a link the user's own tooling can act on —
  never the drawing.
- **Why first:** highest real-world fit (fires a Make/Zapier/Glide scenario when
  a deliverable is ready — the actual Glide story), works on the static deploy,
  reuses an audited pattern, needs the least code. It is honest about being
  best-effort because a browser genuinely is.
- **What it explicitly is NOT:** a guaranteed-delivery, signed webhook. Say so
  in the docs. Users who need those run Tier 1/2.

### Tier 1 — Capture server webhook relay (for teams running a server)

Promote the capture server into an optional **signed webhook relay** for
`contribution.banked`.

- **Seam:** in `do_POST`, after `corpus.ingest(payload)` succeeds (~line 312),
  fan out an HTTP POST to configured webhook URLs — **reusing the exact
  `_mirror` strand-budget + wall-clock-timeout discipline** so a slow/wedged
  receiver never stalls or fails the `/contribute` response. `urllib.request` is
  already imported.
- **Real webhook semantics:** HMAC-SHA256 signature header
  (`X-OpenTakeoff-Signature`), secret from env (never a flag, never logged),
  retry with capped exponential backoff, the event `id` as an idempotency key so
  the receiver can dedupe.
- **Caveat, stated up front:** payloads here are **corpus-scoped** — the capture
  server only ever sees the derived, anonymized contribution. Great for "a
  takeoff was contributed, N rows banked, finish breakdown X"; useless for
  "project Acme's takeoff is ready" (it doesn't know the project). That business
  event belongs in Tier 0/2.

### Tier 2 — MCP server webhooks (for agent pipelines)

Emit signed webhooks from the MCP `run()` seam for the mutating/export tools, so
an orchestrator downstream picks up agent deliverables (`export_marked_pdf`
finished → go fetch it).

- **Seam:** `mcp/src/tools.ts:40`, right beside `traceToolCall`. One wrap covers
  every mutating tool (`one_click`, `measure_*`, `edit_*`, `mark_verdict`,
  `export_takeoff`/`export_report`/`export_marked_pdf`, `import_takeoff`, …).
- **Sees full data** (real geometry, quantities) and can sign (env secret), but
  is **session-scoped**: it fires only for agent-driven takeoffs and lives only
  as long as the stdio session. That is the right shape for agent workflows and
  the wrong shape for a durable human-canvas notification — which is why this is
  a separate tier, not the base.

## 5. Cross-cutting design decisions (apply to all tiers)

- **Versioned envelope**, matching the repo's schema convention
  (`opentakeoff.contribution.v2`, `opentakeoff.report.v1`):

  ```jsonc
  {
    "schema": "opentakeoff.event.v1",
    "id": "evt_<opaque>",              // idempotency key
    "type": "export.ready",           // see taxonomy below
    "occurred_at": "2026-08-24T…Z",
    "source": "browser|capture|mcp",
    "project_ref": "<opaque, optional>",
    "data": { /* type-specific, derived-only for browser source */ }
  }
  ```

- **Event taxonomy** (from the mutation map, deduped and de-chattified):
  `shape.committed`, `shape.reviewed` (human seal), `verdict.marked` (agent
  diamond), `rfi.raised`, `rfi.answered`, `revision.saved`, `sheet.revised`,
  `export.ready` (carries `format`), `markedset.ready`, `contribution.banked`.
  **Autosave is deliberately excluded** — `store.saveAnnotations` fires on every
  debounced edit (`TakeoffCanvas.jsx:~2159`); it is far too chatty for a webhook.
  If a "work in progress" signal is ever wanted, coalesce to an idle-flush, don't
  emit per-edit.

- **Delivery semantics:** at-least-once + retry/backoff + idempotency key on the
  **server** tiers (1, 2); at-most-once on the **browser** tier (0), stated
  plainly. Receivers dedupe on `id`.

- **Security posture — must not regress a single promise:**
  - Strictly additive: unset ⇒ no UI, no calls, doesn't exist (like the AI
    socket).
  - No secrets in the bundle — signing secret via **env only**, never
    `VITE_*`-inlined (the `VITE_AI_KEY` rule applies verbatim).
  - Derived-only for browser-origin events — reuse the contribute whitelist so
    "nothing sensitive leaves your machine" still holds.
  - No telemetry — a webhook goes only where the user points it, same as
    contribute.
  - Guard it with a test in the spirit of `voicePrivacy.test.ts`: assert **no
    egress unless an endpoint is configured**, and assert the browser payload
    never contains blacklisted keys (PDF bytes, file/project names, absolute
    coords, scale values).

## 6. What NOT to build

- **Inbound webhooks into the static app** — no server to receive them; it is a
  different product.
- **A hosted, multi-tenant webhook broker** — against the self-host, no-account,
  no-backend ethos. Users bring their own receiver (Make/Zapier/Glide/n8n/a
  Netlify function).
- **Emitting raw geometry or PII from the browser** — breaks the headline
  promise; the whitelist is non-negotiable for browser-origin events.
- **A DOM `EventTarget`/`CustomEvent` bus for business events** — heavier than
  needed and blurs the line with the existing DOM plumbing. A plain module-level
  `emit()` at the two reducer choke-points is enough.

## 7. Open questions for whoever picks this up

1. **Which tier is actually wanted first?** The Glide story points squarely at
   Tier 0 (`export.ready`/`markedset.ready` → a Make/Glide scenario). Confirm
   before building 1 or 2.
2. **`project_ref` design** — Tier 0's whitelist forbids project *names*, but a
   webhook is useless if the receiver can't tell *which* project fired it. The
   opaque, locally-minted id already used to dedupe re-contributions
   (`contribute.js`) is the likely handle; needs a decision on stability across
   revisions.
3. **Receiver menu** — do we ship a documented recipe for one concrete receiver
   (a Netlify function forwarding to Glide) the way `capture/` ships a concrete
   server, so the feature has a working end-to-end path out of the box?
4. **Signature scheme** — HMAC-SHA256 with a shared secret is the obvious
   default for Tiers 1/2; confirm no requirement for asymmetric signing.

---

*This is a spike, not a plan of record. It commits to no code and no schema; it
argues for a shape and names the seams. The one firm recommendation: build the
browser notification tier first, because it is the only one that fits the
default deploy and the only one the existing `contribute` pattern already
almost is.*
