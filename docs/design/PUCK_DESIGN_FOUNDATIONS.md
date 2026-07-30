# One-Click cursor puck — evidence-reviewed design foundations

Compiled 2026-07-30. Supersedes `puck-evidence.md`'s "Net design consequences" section.

Process: 14 claims verified against primary sources by 4 research agents; the 6 drawn takeaways then attacked by 3 adversarial reviewers (source fidelity — re-fetched every source; counterexample hunt — searched for disconfirming evidence; logic & transfer — attacked the reasoning). The reviewers independently converged. Result: 2 takeaways refuted as worded, 3 overstated, 1 survived with a caveat. This document contains only what survived, restated at defensible strength, plus the ontology the decisions are expressed in.

Evidence rule (standing): claims about external tools/research are presumed false until confirmed by a primary source. Counter-evidence from secondary sources (blogs, issue trackers) may WEAKEN a claim but nothing is built on secondary sources.

---

## 1. Ontology

Each concept: definition → distinguishing test → evidence status.

### 1.1 Surfaces

- **Passive readout** — displays information; interacting with it can mutate nothing.
  Test: no click/keystroke on it has any effect.
  Evidence: existence precedent — AutoCAD Dynamic Input ("a command interface that displays near the cursor", Autodesk docs); SketchUp inference cues. No measured attention benefit for passive readouts exists in our set. (The Hover Widgets CHI'06 result is about *active invocation*, and the paper contains anti-ambient evidence: "seeing the tunnels at all times would become visually distracting.")
- **Action surface** — receives clicks/keys that mutate state (commit, take an offer, refine, rename).
  Test: interacting with it changes the takeoff or a mode.

### 1.2 Appearance modes (what causes a surface to appear)

- **Ambient** — always present while the tool is active. Evidenced for passive readouts only (Dynamic Input, inference cues — existence precedents).
- **Summoned** — appears on an explicit UI-request act (right-click: Fusion marking menu; S-key: Onshape shortcut toolbar). Evidence: vendor docs, confirmed.
- **Act-gated** — appears as a side effect of a real *work* act (a selection, an operation), not a UI request. Evidence: confirmed precedents — Office Mini Toolbar ("When you select text with the mouse, the Mini toolbar appears", Microsoft docs); Blender's Adjust Last Operation HUD (appears after an operator runs, Blender manual); Photoshop Contextual Task Bar (per Adobe helpx via search extracts — **spot-check in a browser before citing verbatim**).
  Required properties, from every confirmed instance: (a) anchored to the user's act, (b) auto-dismisses when the user moves on ("If you move the mouse elsewhere, the Mini toolbar disappears"), (c) first-class off switch ("Show Mini Toolbar on selection" checkbox; Window > Contextual Task Bar).
- **Predictive / unbidden** — appears on system inference alone (hover, dwell, prediction), no user act. Evidence: NO confirmed precedent found; one documented **anti-precedent** — the Windows XP Tablet hover pop-up: "Some users may find this feature irritating. It can be activated accidentally" (Hover Widgets paper, p.2).

### 1.3 Acts

- **Hover** — informs; commits nothing.
- **Commit click** — the work itself (measures + creates the room). The act that gates offers.
- **Offer-take** — one click/keystroke accepting a pre-computed derived measurement.
- **Refine** — post-commit adjustment of the last committed thing.
- **Summons** — an act whose only meaning is "give me actions" (right-click, S-key). Distinct from commit click, whose meaning is the work.

### 1.4 State kinds

- **Quasimode** — mode held by continuous physical action (held key). "Because you must actively maintain a quasimode, you cannot accidentally forget you are in it" (Raskin). Confirmed.
  Accessibility constraint (Sticky Keys precedent, Microsoft docs): some users cannot sustain a hold — a held-key override must also be reachable as a toggle.
- **Latched mode** — persists after the activating act (the B toggle). Raskin's framework predicts mode errors from latched modes and, where unavoidable, REQUIRES the mitigation: mode state "as visible and unambiguous as possible." Consequence: if base rides as a latched run-mode, the base state must be displayed on the puck itself, at the locus of attention — not only in the toolbar.
- **Scope** — run-level (outlives any single act; can't be a quasimode by definition) vs room-level (one act; quasimode-eligible).

### 1.5 Offers

- **Tier A — reversible metadata** (room name): auto-apply on commit; a control to correct. Rationale: asking costs a click on the always-yes path; applying is undoable. (Design rule of ours — no external evidence claimed.)
- **Tier B — mints a quantity** (base LF, transition LF): never auto-applies; appears act-gated on the commit, pre-computed, one act to take, zero to ignore, gone on move-on.
- Confidence gate (ours): low confidence demotes Tier A to an offer.

### 1.6 Evidence statuses (used throughout)

- **Measured benefit** — a study measured it. Carry the honest magnitude and its conditions.
- **Existence precedent** — ships in a real product per vendor docs; no measured benefit.
- **Anti-precedent** — documented instance of the pattern failing.
- **Refuted** — checked and false as stated.
- **Unverified assumption** — load-bearing for a design choice, not yet checked. Named in §3.

---

## 2. Revised takeaways (what survived review)

**T1 — An ambient passive readout at the cursor is viable, not proven beneficial.**
Shipping mouse-driven CAD precedent: AutoCAD Dynamic Input; SketchUp cues. Existence precedents only. Hover Widgets may be cited only for localized *command invocation* reducing attention diversion in a pen-based attention-split task (icon 2.19s/5.6% err vs 1.76s/1.3%) — not for passive readouts, not for unconditional speed. Costs of a follower readout (occlusion, distraction) are unmeasured in our set.

**T2 — Action surfaces appear act-gated or summoned; never on prediction alone.**
Auto-appearing action trays have strong mainstream precedent (Office Mini Toolbar; Photoshop CTB; Blender's post-operator HUD) — every confirmed one is anchored to an explicit user act, auto-dismisses, and ships an off switch. No confirmed precedent, and one documented anti-precedent, for appearing on hover/prediction alone. The puck's offers-after-commit-click are squarely inside precedent (the Blender HUD is the closest match); the three required properties (act-anchored, auto-dismiss, off switch) are adopted as constraints.

**T3 — Accept-then-refine has precedent for refine-IMMEDIATELY, one operation wide.**
Blender F9/HUD: "You can tweak the parameters of an operator after running it" — but the window dies at the next operator, adjusting reverts intervening changes (Blender tracker #78171), and the 4.x ephemeral panel draws persistence complaints (#149487). Precedent transfers only if (a) our commits are cheaply re-parameterizable, (b) errors are noticed within the window. It licenses edit-right-after-accept; it does not license "refine anytime" — that would need our own design beyond precedent.

**T4 — Held-key override is Raskin-clean; the latched run toggle is a concession with mandatory mitigations.**
Quasimode override: confirmed entailment — can't be forgotten-on. Must also exist as a toggle for users who can't sustain holds (Sticky Keys precedent). The latched B run-mode is what Raskin warns causes mode errors; run-scoped state can't be held, which triggers his "if unavoidable → maximally visible" clause: base state rendered on the puck at the cursor, always. Load-bearing unverified assumption: that base rooms cluster in click order (§3).

**T5 — Offers stay a short list; radial is a bet we have no grounds to place.**
The marking-menu speedups (3.5–7×) are marks-vs-the-popped-radial at expert ceiling (n=2 field study; the "4×" user still popped the menu for 45% of selections) — they require high-repetition selection to materialize. Radial-vs-linear itself: Callahan '88 measured ~15% faster/fewer errors for 8-item pies in a targeted task; Murano & Khan 2015 found no significant time/error difference (pie won preference only, possible novelty; low-tier journal — weight accordingly); Samp & Decker (via M&K): visual search faster in linear, pointing faster in radial. For occasional, label-heavy offers (our case: 1–2 offers, intermittent), a list/chips is the evidence-aligned choice. Revisit radial only if an action set becomes small, stable, and high-frequency.

**T6 — Nothing inferred may touch a commit; inference is licensed only for costless, self-correcting adaptations with escape hatches.**
SmartShift (velocity-only — "dwell" does not appear in the Logitech docs) ships inference wrapped in a tunable threshold + manual override + off switch, and misfires are documented in the wild (disable-it guides, never-freespin requests — secondary sources, used only to weaken). Dwell has separate confirmed precedents as a *reveal* trigger only: marking-menu press-and-wait (~1/3 s pops the novice menu); Hover Widgets' fade-in. So: velocity/dwell may soften or reveal presentation; it may never select, commit, or take an offer.

---

## 3. Named unverified assumptions (open before build)

1. **Runs are real** — base-scoped rooms cluster in the order an estimator clicks them. If interleaved, the latch maximizes toggling and mode errors. Testable from real takeoff sessions.
2. **Errors are noticed** — accept-immediately assumes a bad flood is seen within the refine window. Unmeasured; a misclick becomes bid quantity.
3. **Commits are cheaply re-parameterizable** — the F9 transfer assumes it; our commit writes quantities.
4. **Invocation frequency** — every expert-speed argument gates on repetition volume we haven't measured for offers.
5. **Photoshop CTB details** — Adobe helpx quotes came from search extracts (helpx blocks fetchers); spot-check in a browser before citing verbatim anywhere external.

---

## 4. The puck, restated in the ontology

- Hover: **passive readout**, **ambient** (existence precedent; keep minimal — anti-ambient evidence exists for heavier always-on UI).
- Click: **commit click** — the work; also the **act** that gates offers.
- On commit: Tier A name auto-applies (confidence-gated); Tier B offers appear **act-gated** on the readout — pre-computed, auto-dismissing, off-switchable.
- Refine: available immediately post-commit, scoped to the last commit (T3's window).
- Base run: **latched mode**, state always visible on the puck; per-room skip: **quasimode** override with a toggle fallback.
- Offer presentation: short list/chips (T5). No radial.
- No surface appears, and nothing is selected or committed, from velocity/dwell/prediction alone (T2, T6).

## 5. Source index

Primary (fetched/read directly): Kurtenbach & Buxton InterCHI'93 (billbuxton.com/MMExpert.html; ACM 10.1145/169059.169426) · CHI'94 (billbuxton.com/MMUserLearn.html; 10.1145/191666.191759) · Callahan et al. CHI'88 (cs.umd.edu/~ben/papers/Callahan1988empirical.pdf) · Grossman et al., Hover Widgets, CHI'06 (patrickbaudisch.com/publications/2006-Grossman-CHI06-HoverWidgets.pdf) · Blender manual undo_redo · Blender tracker #78171, #149487 · Maya marking menus (Autodesk GUID-8BA1A3AA) · Fusion marking menu (GUID-6514ABC1) · Onshape shortcut-toolbar tech tip · AutoCAD Dynamic Input + DYNMODE (Autodesk help) · SketchUp drawing-basics (help.sketchup.com) · Revit spacebar (Autodesk help) · Office Mini Toolbar (support.microsoft.com) · Sticky Keys (support.microsoft.com) · Logitech SmartShift + gesture button + per-app settings (support.logi.com) · Raskin Center humane-interface summary + The Humane Interface, Addison-Wesley 2000, p.55 (TOC scan; book text not directly fetched) · Murano & Khan 2015 (pietromurano.org, PDF).
Secondary (weakening only): Ben Frain SmartShift fix guide · Solaar issue #2246 · Meadowcroft pie-menu report · Adobe helpx via search extracts (spot-check).
