# POC-01 PDF Closeout - Actual Results

Date: 2026-08-11

Repository: `code-dev-design/LIGHT-PLANNER`

Base branch: `phase-04-vector-pdf-poc`

Fix branch: `poc01-pdf-closeout-fixes`

Starting branch commit for this pass: `0eb80855a29b40a88277ab59aac8a917d92d57ff`

## Status

The implementation fixes, automated verification, real-file regression, and the complete interactive Chrome workflow pass are complete on the dedicated fix branch. Chrome successfully opened the local application on `http://127.0.0.1:8765`, imported the real `ايهاب(1).pdf`, and completed the Select / Window / Crossing / Move / Delete / Undo / Redo / Add / Snap / L-T-X Clean Junction / Zoom / Pan / SVG-PDF-PNG export cycle.

The engineering acceptance gates now pass. The supplied 2026-08-11 MP4 was replayed completely through a local HTTP media server and compared with the corrected live behavior. Formal administrative closure has only an optional evidence item: record a separate after-fix video if the client requires a packaged recording in addition to the completed Chrome pass and screenshots. No POC-02 or DWG/DXF work has started.

## Root causes fixed

### Selection

1. The previous importer emitted each PyMuPDF drawing item (`l`, `c`, `re`, `qu`) as a separate editable entity. A single visible grid bubble could therefore be dozens of primitives.
2. The old default selection mode was `structural`, which rejected small geometry and did not select text by default.
3. Hit testing scanned all entities and returned the first hit. It did not account for stroke width, had no overlap cycling, and rectangle selection only behaved as Crossing Selection.
4. Some visible numbers in `ايهاب(1).pdf` are vector outlines, not PDF text spans, so text hit testing alone could never select them correctly.

### Junctions

1. Snap only aligned endpoints; it did not create a junction relation between independent lines.
2. Separate strokes with independent caps could leave a gap/protrusion at L/T/X intersections.
3. Semi-transparent strokes could be composited twice at the overlap, producing a darker square.

## Implementation

- `poc01_geometry.py`
  - preserves connected PDF subpaths as logical editable entities;
  - normalizes Line / Polyline / Path / Circle / Ellipse / Rectangle;
  - keeps real PDF text as Text;
  - groups outlined vector glyph fragments into a single logical `outlined_text` entity;
  - groups the concentric parts of grid bubbles as a logical `ring_symbol`, while leader lines remain independent.
- `static/poc01_core.js`
  - stroke-aware hit testing;
  - constant screen-space click tolerance (`px / zoom`);
  - spatial index for large scenes;
  - Window and Crossing selection;
  - line intersection and Clean Junction for L/T/X;
  - trim/extend of junction endpoints without merging object IDs;
  - exact stroke-strip intersection patch for visually filled L/T/X junctions;
  - different-width junction patch geometry without square-cap protrusions;
  - deterministic junction detachment when either independent member is deleted;
  - junction refresh/detach after movement;
  - preblended junction stroke color to prevent double-alpha darkening.
- `static/app.js`
  - integrates overlap cycling, locked-layer explanation, deletion/move history, Clean Junction, normalized rendering/export;
  - preserves object Snap on endpoints/midpoints with constant visual tolerance, without forcing every free point onto a 5-point grid;
  - supports moving imported Path/Subpath entities as complete logical objects;
  - includes user geometry/lights/dimensions in Window/Crossing rectangle selection;
  - fixes the Redo history cursor so one Redo restores exactly one state.
  - renders butt-capped independent members plus one junction patch in Canvas, SVG, PDF and PNG;
  - restores the missing right-panel tab switching needed to isolate PDF and user geometry;
  - detaches a junction in the same history command when one member is deleted.
- `app.py`
  - serves normalized editable geometry schema v6 and uses a v6 vector cache.
- `tests/`
  - real `ايهاب(1).pdf` normalization/calibration regression;
  - synthetic selection/junction/120k-index test.

## Real file results - ايهاب(1).pdf

Source PDF primitives: **128,827**

Normalized editable entities: **34,618**

This reduction is logical coalescing of connected primitives, not rasterization or deletion of the drawing.

Normalized types:

- Lines: 17,940
- Polylines: 13,587
- Paths: 2,051
- Circles: 53
- Ellipses: 1
- Rectangles: 986
- PDF text spans: 307

The left grid column contains **18 logical ring symbols**. One complete target bubble now contains exactly three independently selectable logical parts: double ring, outlined numeral, and small marker. The marker itself coalesces six source fragments.

Latest local extraction time observed in the final automated run: **4.302 s reported / 4.341 s wall time**.

HTTP run on the same machine:

- `/api/analyze`: 1.162 s
- `/vectors/0` end-to-end response: 4.427 s
- vector JSON download after gzip transport: about 1.20 MB

## Calibration

A single scale was derived from the complete written left vertical dimension chain (total 2980 cm), then five individual written dimensions were used as validation points.

| Written | Measured | Error |
|---:|---:|---:|
| 320 cm | 319.572 cm | 0.134% |
| 290 cm | 290.475 cm | 0.164% |
| 190 cm | 189.636 cm | 0.191% |
| 470 cm | 470.077 cm | 0.016% |
| 500 cm | 500.178 cm | 0.036% |

Average error: **0.108%**

Maximum error: **0.191%**

Acceptance targets were <= 0.5% average and <= 1% maximum, therefore the calibration accuracy test passes.

## Selection tests

On the actual target fixture extracted from `ايهاب(1).pdf`:

- ring independently hittable: PASS;
- outlined number independently hittable: PASS;
- leader/line independently hittable: PASS;
- repeated-click overlap candidates at the target: 7;
- Window Selection includes ring and number: PASS;
- Crossing Selection includes ring and number: PASS;
- 8 px visual tolerance remains constant across zoom by conversion to world tolerance: PASS.

## Spatial-index performance

Actual normalized file (34,618 entities):

- index build: 90.47 ms in the recorded run;
- 2,000 point queries: 39.29 ms total;
- average query: 0.0196 ms;
- index cells: 4,743;
- overflow items: 19.

Synthetic 120,000-entity sanity test:

- build: 201.20 ms in the recorded run;
- 1,000 hit queries: 81.60 ms total;
- test completed without full-scene O(n) scanning.

These numbers are local development measurements, not production SLA guarantees.

## Junction tests

Automated geometry tests pass for L, T and X. Each result retains two independent objects (`A != B`) and stores the Junction as a relation. The final renderer no longer uses square caps as a visual approximation. It uses butt-capped independent strokes and a parallelogram computed from the exact intersection of both stroke strips, using both line widths. This fills the outside L quadrant without a gap or protrusion and normalizes the overlap at T/X. The same patch is emitted to Canvas, SVG, PDF and PNG. The alpha test confirms a 50% black stroke preblended over white produces `rgb(128,128,128)` once, avoiding double-opacity darkening at the junction.

The synthetic Chrome fixture contained six independently identified lines and three active Junction relations (`L,T,X`). The exported SVG contained six joined custom `<line>` elements, three junction patch polygons, 13,657 butt caps in total, and zero square caps. Endpoint error for both L members and the T terminal member was exactly `0` in the exported project JSON.

Deleting one L member left the other line in the model, changed the relation to `active=false` with `detachedReason=member-deleted`, and did not render a ghost patch. Undo restored two distinct line IDs and the active L relationship.

## Interactive Chrome acceptance - 2026-08-10 (historical schema v3 pass)

Environment:

- Chrome through the connected user browser;
- local URL: `http://127.0.0.1:8765`;
- server health: PyMuPDF 1.26.7, schema 3;
- branch start: `poc01-pdf-closeout-fixes` at `0eb8085`.

Synthetic sample results:

- sample import: `32,798 -> 13,651 editable`;
- Window Selection isolated exactly two L members after hiding PDF geometry/text;
- L toast: `Clean Junction: L - filled corner` and visual inspection at 345% showed a square, filled corner with no marker, gap or protrusion;
- T and X each selected as exactly two members and rendered cleanly;
- Zoom exercised from 56% to 345%; Pan preserved zoom while moving the viewport;
- line add used Snap for the shared endpoint;
- junction Undo/Redo, single-line Delete/Undo/Redo, and member deletion/detachment passed.

Real `ايهاب(1).pdf` Chrome results:

- import: `128,827 -> 35,258 editable`, plus 306 PDF text spans;
- repeated click at the target column cycled through nine overlapping candidates (`2/9`, `3/9`) instead of being stuck on the first primitive;
- a narrow Window selected one fully contained logical item; the reverse Crossing rectangle selected 108 touched items including the long dimension/grid geometry;
- deleting one target entity changed the geometry count `35,258 -> 35,257`; Undo restored `35,258`, Redo returned `35,257`, and the final Undo restored `35,258`;
- moving one independently selected target symbol and Undo both completed;
- locking PDF Geometry showed the explicit reason `geometry layer locked` when selection was attempted.

Export results from the six-line L/T/X fixture:

| Format | Result | Size |
|---|---:|---:|
| SVG | PASS | 2,315,182 bytes |
| PDF | PASS | 248,806 bytes |
| PNG | PASS | 1,090,551 bytes |
| Project JSON | PASS | 2,971 bytes |

The exported PDF was rasterized through Poppler at 144 dpi and visually inspected. The PDF and high-resolution PNG both preserved the filled L, clean T, and clean X without a green marker, white gap, square-cap spur, or double-alpha dark square.

Latest synthetic 120,000-entity run after the final changes:

- index build: **184.06 ms**;
- 1,000 queries: **40.44 ms**;
- full Node test process: **711.16 ms**;
- failures: **0**.

## Multi-page classification smoke test

- `GROUND FLOOR.pdf`: 22 pages analyzed without crash; first five pages classified Raster PDF underlay (0 vector primitives).
- `FIRST FLOOR.pdf`: 24 pages analyzed without crash; first five pages classified Raster PDF underlay (0 vector primitives).

Observed analysis times: 7.725 s and 4.934 s respectively.

## Visual, lighting, measurement and symbol regression pass - 2026-08-11

The supplied 18-second Chrome recording was reviewed through a local HTTP media server. It confirmed two measurement defects: every pointer position fell back to a fixed 5-point grid when no object snap was present, and the resulting red dimension line had no numeric label.

Implemented corrections:

- achromatic or low-contrast PDF strokes are mapped to a stable engineering palette by logical type while original meaningful colors are preserved;
- Dark Plan and Light Plan now switch the actual canvas and exported background, with readable type colors in both modes;
- the global lighting effect button, the panel checkbox, master intensity, per-unit on/off, intensity, spread and temperature controls are wired to the renderer;
- lighting units render a visible warm/cool radial effect in Canvas; SVG/PDF uses a PyMuPDF-compatible multi-ring alpha falloff because PyMuPDF rendered SVG `radialGradient` as black;
- Measure is free-point input even while object Snap is enabled, has no forced grid fallback, shows its value live during dragging, and stores a labeled dimension with end ticks;
- uncalibrated dimensions explicitly report `PDF - uncalibrated`; calibrated dimensions report the user-confirmed `m`, `cm`, or `mm` unit;
- one double-ring numbered symbol is normalized to three logical parts instead of 7-10 raw fragments;
- the welcome modal now closes after a real uploaded PDF page is imported;
- dimensions and lights are included in SVG, PDF and PNG exports.

Chrome results on the isolated current server at `http://127.0.0.1:8766`:

- `ايهاب(1).pdf`: `128,827 -> 34,618 editable`, schema v4, 4.515-6.535 s cold import depending on cache state;
- `ARCH - 01 (26).pdf`, page 5: `15,423 -> 7,584 editable`, 1.497 s import;
- Dark to Light background switch: PASS, button label changed and visual background/plan colors changed;
- global Lighting Effect ON/OFF: PASS, button label, checkbox state and visible glow changed;
- per-unit on/off: PASS, state label changed to `متوقف`, glow disappeared, and the symbol remained as an off-state unit;
- free diagonal measurement: PASS, live/stored label `259.90 pt` observed;
- measurement Undo removed the complete dimension; Redo restored line, ticks and label: PASS;
- Zoom exercised from 40% to 66%; Pan moved the viewport and Fit returned to 40%: PASS;
- no browser console errors during either real-file pass.

Exports produced from the real `ايهاب(1).pdf` Chrome pass:

| Format | Result | Size |
|---|---:|---:|
| SVG | PASS | 7,420,348 bytes |
| PDF | PASS | 678,205 bytes |
| PNG | PASS | 2,471,376 bytes |

The exported A2 PDF was rendered with Poppler at 140 dpi and inspected. It preserved the engineering palette, PDF text, placed lighting unit and labeled dimension. A separate PyMuPDF conversion test verified the final multi-ring lighting falloff without the black radial-gradient compatibility defect.

Latest automated results:

- real file calibration average error: 0.108%; maximum error: 0.191%;
- target bubble logical parts: 3;
- total normalized symbol markers: 120;
- 120,000 synthetic index build: 155.65-197.33 ms across recorded runs;
- 1,000 synthetic hit queries: 33.09-35.05 ms;
- Node and Python failures: 0.

## Remaining evidence before administrative closure

1. Record a short after-fix screen capture only if the client requires a separate video artifact in addition to the completed live Chrome pass and screenshots.
2. The supplied 2026-08-11 regression MP4 was replayed completely through a local HTTP media server. The earlier two junction/selection recordings can still be placed side by side with a new capture if a formal video package is required.

All code, geometry, accuracy, performance, browser-interaction and export gates exercised in this pass are green. Do not start POC-02 or DWG/DXF until the client accepts the remaining video-evidence item or explicitly waives it.

## Text-layout, automatic wall-network and unit workflow pass - 2026-08-11 (schema v6)

This pass addresses the final client regressions on the real architectural drawings.

### PDF text layout and subset-font decoding

- PDF text is no longer positioned as one browser-font string inside an RTL page. Each glyph uses the exact PDF baseline, rotation and relative origin, so Latin labels and numbers do not drift left or accumulate font-substitution error.
- Canvas explicitly uses left-aligned LTR coordinates for Latin CAD text and shaped RTL rendering for Arabic text. SVG export uses the same glyph positions and fitted widths.
- `get_texttrace()` glyph IDs recover printable ASCII from subset fonts with broken ToUnicode maps. The previously corrupted sample now decodes as `RISER = 16 cm`.
- `FULL DRWAINGS.pdf`, page 2: 513 text spans, zero replacement glyphs in the regression check. The A-K grid labels are centered in their original bubbles in Chrome and in the exported PDF.

### Automatic wall-network junctions

Walls are identified from CAD layer semantics such as WALL / MASONRY / BLOCKWORK / PARTITION while hatch, finish, tile, text, dimension, note and symbol layers are excluded. Junction topology is rebuilt automatically when a page opens and after wall deletion or movement. Independent wall entities remain independent in the model; the renderer applies small endpoint extensions plus one exact intersection patch, eliminating gaps, cap protrusions and double-alpha overlap.

Real-page results using the same production options (`tolerance=1.4`, `maxCos=0.2`, `minLength=2.5`):

| Drawing | Wall entities | L | T | X | Total junctions | Build |
|---|---:|---:|---:|---:|---:|---:|
| `FULL DRWAINGS.pdf`, page 2 | 332 | 249 | 42 | 16 | 307 | 6.11 ms |
| `ARCH - 01 (26).pdf`, page 5 | 4,715 | 4,941 | 242 | 2 | 5,185 | 185.05 ms |

The synthetic tests also pass clean L, T and X cases, exclusion of non-wall annotation lines, and refusal to bridge a drafting gap larger than the strict tolerance.

### Measurement and calibration workflow

Raw PDF coordinates are not a physical length unit. Before calibration the editor therefore shows a value such as `96.78 PDF - uncalibrated`; it no longer labels that value `pt`. Calibration asks for the number printed on one known dimension and its written unit (`m`, `cm`, or `mm`). The stored scale is:

`confirmed written length / selected PDF-coordinate distance`

Every later measurement is converted using that scale and displays the confirmed unit. In the Chrome acceptance example, the 96.78-PDF segment was calibrated from the printed `3.78 m` dimension and subsequently displayed `3.780 m`. Undo removed the calibration and Redo restored it.

Detected client-drawing conventions:

| File / sheet family | Unit result |
|---|---|
| `FULL DRWAINGS.pdf` main architectural sheets | metres, explicitly written; some detail sheets separately state cm/mm |
| `ARCH - 01 (26).pdf` | centimetres, explicitly written |
| `ARCH DWG..pdf` | metres, explicitly written |
| `ARCHITECTURAL DRAWING.pdf` | centimetres, explicitly written |
| `ايهاب(1).pdf` | centimetres inferred from 97 dimension-like integer labels and confirmed by the known-dimension calibration |

The application detects the unit per page and shows whether it is explicit or inferred; it does not assume one unit for an entire client package.

### Chrome and export acceptance on schema v6

Local acceptance server: `http://127.0.0.1:8767`, PyMuPDF 1.26.7, schema 6.

- `FULL DRWAINGS.pdf`: `18,806 -> 14,714 editable`, 1.015 s cached Chrome load, explicit metre unit, 307 automatic wall junctions.
- `ARCH - 01 (26).pdf`, page 5: `15,423 -> 7,584 editable`, 0.422 s cached Chrome load, explicit centimetre unit, 5,185 automatic wall junctions.
- `ايهاب(1).pdf`: `128,827 -> 34,618 editable`, 2.476 s Chrome load, inferred centimetre unit, target double-ring symbol remains exactly three logical parts.
- Undo/Redo after placing a lighting unit: `0 -> 1 -> 0 -> 1` units.
- Dark/Light plan toggle: `dark -> light -> dark`; global lighting effect: `ON -> OFF -> ON`; selected-unit state: `true -> false -> true`.
- Zoom, Pan, free-point measurement, Snap and calibration had already passed the interactive regression and remain on the same input/history code path in v6.

Fresh real-page exports from Chrome:

| Format | Result | Size / dimensions |
|---|---:|---:|
| SVG | PASS | 3,203,084 bytes; XML parsed successfully |
| PDF | PASS | 306,149 bytes; rendered with Poppler at 180 dpi and visually inspected |
| PNG | PASS | 1,303,629 bytes; 2526 x 3573 |

The v6 PDF render preserves the original A-K positions, readable decoded CAD labels, automatic clean wall intersections and the engineering palette. Browser console error checks returned no application errors on the three retained acceptance tabs.
