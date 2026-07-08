# OpenTakeoff — User Guide & Shortcuts

A fast, client‑only flooring takeoff canvas. Drop in a plan set, set the scale, draw
your conditions, read the report. Everything is saved in your browser — no account,
no server.

---

## 1. Quick start (a demo in 6 steps)

1. **Open plans** — drag a PDF, image, or `.zip` plan set onto the canvas (or use **Open plans**). The **gallery** (`G`) shows every sheet; click one (or several) to open.
2. **Set the scale** — on each sheet, click **Scale** and either pick a standard scale or **Calibrate**: click two points along a known dimension, type the real length in feet, **Apply**. Scale is remembered **per sheet**.
3. **Pick a condition** — the **Takeoffs panel** (docked on the right) holds your finishes (WD‑1, LVT‑1, …). Click a row to arm it (or press its number, `1`–`9`); the active row unfolds its properties — tag, color, hatch, ×N, waste, height, thickness. Drag the panel's left edge to resize, collapse it with **»** (the ☰ rail button brings it back), and turn on the optional **strip** (panel header) for a compact horizontal bar.
4. **Draw the takeoff** — pick a Measure tool and trace. Each shape is color‑coded to its condition.
5. **Add supporting materials** *(optional)* — open **Assemblies** on the condition (adhesive, sealer, poly…) with coverage rates; order quantities derive automatically.
6. **Report** — open **Report** for the per‑condition breakdown (SF/LF/EA, waste, SY) and the materials buy list; export **CSV**, **Excel (.xlsx)**, or **JSON**.

Your work autosaves to this browser continuously. Reload and it's still there.

---

## 2. Keyboard shortcuts

### Tools
| Key | Tool | What it does |
|---|---|---|
| `O` | **One‑Click Area** | Click inside a room; the enclosed space auto‑selects, traces, and snaps to corners — hatched/tiled rooms fill to the real walls (hatch linework is classified and seen through). Review, then Create. |
| `A` | **Area** | Trace a polygon → floor SF. |
| `R` | **Rectangle** | Two‑corner rectangle → floor SF. |
| `L` | **Linear** | Trace a run → LF (＋ border SF if the condition has a thickness). |
| `S` | **Surface Area** | Trace a wall run in plan → wall SF (run × condition height). |
| `C` | **Count** | Click to count items → EA. |
| `D` | **Deduct** | Trace a void/column → subtracts SF. |
| `⇧D` | **Deduct rectangle** | Rectangle deduct. |
| `P` | **Pan** | Move around the sheet. |
| `V` | **Select** | Select / move / edit / reassign / delete a shape. |
| `G` | **Gallery** | Open the plan‑set gallery / sheet picker. |

### Conditions
| Key | Action |
|---|---|
| `1`–`9` | Make condition N the active one. |

### While drawing
| Key / action | Effect |
|---|---|
| **Click** (no drag) | Place a point. |
| **Press‑and‑drag** | Pan mid‑measure (without placing a point). |
| **Scroll** | Zoom. |
| `Enter` or **double‑click** | Finish the shape (Area/Deduct need ≥3 points; Linear/Surface ≥2). In One‑Click, `Enter` creates the selected space(s). |
| `Backspace` / `Delete` | Remove the last placed point; if nothing's in progress, delete the **selected** shape; in One‑Click, drop the last region. |
| `⌘Z` / `Ctrl+Z` | Undo the last placed point. |
| `Esc` | Cancel the in‑progress shape / selection / proposal. |
| **Hold `⇧` (Shift)** | Force the next segment onto the nearest 45°/90° axis, at any cursor angle (see Angle lock below). |

### Angle lock (45°/90°) & the aim cursor
On the canvas the crosshair **is** the cursor: the OS pointer hides in draw modes, full-page hairlines meet at a star, and everything in progress draws in the instrument's cobalt — committed takeoffs wear their condition's own color.

With the **45°** toggle on (it's on by default, next to Snap), the segment you're drawing **locks to the 45° family** — 0°, 45°, 90°, 135° across the sheet — whenever your cursor comes within a few degrees of one. The lock is deliberately quiet: the star swells, the hairlines brighten, the preview line thickens, and a small chip by the cursor reads the locked angle plus the **live length of the segment** (once the sheet has a scale). The point you click is the locked point, so walls come out dead square. Hold **`⇧`** to force the lock at any angle; toggle **45°** off for free-angle tracing. Endpoint **Snap** (when enabled) takes priority over the angle lock — corners beat axes.

### Selected shape (Select tool)
| Key | Action |
|---|---|
| `⌘C` / `Ctrl+C` | Copy the takeoff. |
| `⌘V` / `Ctrl+V` | Paste it under the cursor (lands on the sheet you're hovering). |
| `⌘D` / `Ctrl+D` | Duplicate it. |

---

## 3. What each part does

### The Takeoffs panel
Conditions live in a **docked, resizable panel** on the right (drag the left edge; width, collapse, and view prefs are remembered per browser). Each row shows the finish with its running totals and shape count; the active row unfolds the full property editor. At scale: **filter** box, **A→Z** natural sort (CT‑2 before CT‑10), and **≡ grp** grouping by tag family (CPT, LVT, …) — all views only, so `1`–`9` keep their numbering. **⌘‑click / ⇧‑click** rows to multi‑select for bulk waste / color / delete; **⌖** (or double‑click) zooms the canvas to a condition's takeoffs. The **Library** tab stores reusable condition templates (browser‑wide): save the active condition, apply templates anywhere, and fresh workspaces seed from your library instead of the built‑in defaults.

### Conditions (finishes)
A condition is one finish (e.g. `WD-1` red oak). It carries:
- **Line / fill color** and a **hatch pattern** (plank, herringbone, tile, terrazzo, …) so each finish reads like the real drawing.
- **Multiplier (×N)** — measure one identical unit, multiply by N.
- **Waste %** — a flooring allowance applied **only in the Report** (order quantity), never to the live measured number.
- **Height (H)** — default height for new Surface‑Area (wall) traces; also drives vertical‑SF display. Existing walls keep the height they were drawn at.
- **Thickness (T)** — a Linear run with thickness also yields border/feature‑strip SF (LF × T/12).

### Supporting materials (assemblies)
Per condition, list the consumables (adhesive, sealer, polyurethane, thinset, grout, cove‑base adhesive…). Each has a **coverage rate** and a **basis** (floor SF / linear LF / each). Order qty = measured ÷ coverage, **rounded up** to whole units. Adhesive lines get a **trowel picker** that fills the SF/gal from the notch size. A `note` field carries trowel notch / # of coats. The Report sums these into a **buy list**.

### Material library
The Takeoffs panel's **Materials** tab holds reusable materials, browser‑wide. Attaching one to a condition (**+ from library…** in the assemblies editor) **copies** its values onto the condition and keeps a link (⛓) — so totals, exports, and snapshots never depend on the library. Edit a linked line freely: fields that differ from the library tint **amber** with a per‑field **↺** revert. Library edits never propagate silently — **update linked (N)** pushes them explicitly. Deleting a library material only removes the link; lines keep their values. **→ lib** on any material line saves it to the library.

### Custom columns
Classify conditions along your own dimension — **CSI Division**, bid package, trade. The Takeoffs panel's **Columns** tab defines project-wide columns with a list of values; once columns exist, the active condition's properties (Takeoffs tab) pick one value per condition. Renaming a value updates every assigned condition; deleting one keeps the assignment, shown as *"(removed)"*. The Report can **group** by any custom column. Columns are hidden in the table/CSV by default — toggle them in the **Columns** picker (grouping by a column always includes it in CSV/XLSX); the JSON export always carries definitions and values.

### Measure roles → totals (the math)
| Role | Adds to |
|---|---|
| `floor_area` / `rect` | Floor SF |
| `deduct` | Subtracts from floor SF |
| `surface_area` | Wall SF (traced LF × height) |
| `linear` | LF (＋ border SF if thickness) |
| `count` | EA |
| `multiplier` | × N on every quantity |
| `waste %` | Added on top in the Report (SF + LF; never EA) |

### Plan set & sheets
- **Gallery** (`G`) — the visual sheet picker; open one or several sheets side‑by‑side.
- **Per‑sheet scale** — plan sets are never one uniform scale; set it per sheet.
- **Regroup** — restore the last side‑by‑side composition in one click after scaling sheets individually.
- **Hi‑Res** — crisper rendering when zoomed in (per sheet, per browser). Does **not** change quantities.
- **Snap (beta)** — snap points to plan lines/corners.
- **Dark view (☾)** — negative-print mode in the zoom cluster: sheets invert to light-on-dark, hatches stay legible, and the toggle is remembered per browser.

### Markup layer
Revision clouds, callouts, and text notes — annotations only, kept separate from measurements (never counted). The markup (◇) toggle and the takeoffs (☰) collapse/expand button live on the slim **rail on the canvas's right edge** (zoom-cluster style).

### Report & export
Per‑condition breakdown (Floor/Wall/Border SF, LF, EA, Total SF, SY, with and without waste), a combined materials buy list, a **Group** select — restructure the table by **sheet** (each sheet's slice with waste and ×N applied, subtotaled) or by any **custom column**, with the grouping named on the printed page — and **CSV / XLSX / JSON** export — plus **Marked set**: a distribution-ready PDF of every sheet that carries takeoffs or markups, with the work burned in as drawn and a legend cover (net totals, waste-adjusted order quantities, by-sheet breakdown). It exports in your current view — dark canvas → dark PDF. Share it with a PM or GC; they need nothing but a PDF reader.

**XLSX** downloads a four-tab Excel workbook, built entirely in your browser: **Conditions** (the report table — it follows your Columns picker, same as the CSV), **By sheet** (measured base quantities per sheet), **Materials** (per-condition lines plus the combined buy list), and **Shapes** (per-shape measured detail — no multiplier, no waste). The numbers are the same ones on screen: waste is applied only to order quantities, never to measured values.

### Saving
All drawings, scales, conditions, and markups autosave to this browser (IndexedDB + localStorage). Storage is **per origin** — i.e. per `localhost:PORT` / per domain. A different port = a fresh, empty workspace.

---

## 4. Tips

- Door openings usually stay closed in One‑Click (the door leaf + swing arc are linework). If a fill **spills**, click a more enclosed spot or trace with **Area**. A hatched room with a genuinely open doorway still refuses rather than guessing — that's deliberate.
- Raster (scanned) plans have no vector linework — One‑Click/Snap won't work; trace manually.
- Set the scale **before** you measure; changing it re‑flows dependent shapes.
- Waste is per condition — set it to match the install (e.g. ~8% straight‑lay, ~15% diagonal, ~20% herringbone).
