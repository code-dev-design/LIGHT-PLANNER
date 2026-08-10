# POC-01 PDF Closeout - Actual Results

Date: 2026-08-10

Repository: `code-dev-design/LIGHT-PLANNER`

Base branch: `phase-04-vector-pdf-poc`

Fix branch: `poc01-pdf-closeout-fixes`

Latest implementation commit at this update: `410132f71f159183dfa6f1aab5fd83f90110d014`

## Status

The implementation fixes and automated/HTTP verification are complete on the dedicated fix branch. POC-01 is **not marked formally closed yet** because the strict acceptance list also requires one final interactive Chrome regression pass and replay against the two source videos. Those local Windows video files were not available to this execution environment and the browser harness blocked navigation to localhost. No POC-02 or DWG/DXF work has started.

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
  - junction refresh/detach after movement;
  - preblended junction stroke color to prevent double-alpha darkening.
- `static/app.js`
  - integrates overlap cycling, locked-layer explanation, deletion/move history, Clean Junction, normalized rendering/export;
  - preserves Snap on endpoints/midpoints with constant visual tolerance and grid fallback;
  - supports moving imported Path/Subpath entities as complete logical objects;
  - includes user geometry/lights/dimensions in Window/Crossing rectangle selection;
  - fixes the Redo history cursor so one Redo restores exactly one state.
- `app.py`
  - serves normalized editable geometry schema v3 and uses a v3 vector cache.
- `tests/`
  - real `ايهاب(1).pdf` normalization/calibration regression;
  - synthetic selection/junction/120k-index test.

## Real file results - ايهاب(1).pdf

Source PDF primitives: **128,827**

Normalized editable entities: **35,258**

This reduction is logical coalescing of connected primitives, not rasterization or deletion of the drawing.

Normalized types:

- Lines: 18,060
- Polylines: 14,207
- Paths: 1,943
- Circles: 53
- Ellipses: 1
- Rectangles: 994
- PDF text spans: 306

The left grid column contains **18 logical ring symbols** and the target region contains an independent ring, outlined number, line and polyline.

Latest local extraction time observed: **3.20 s**.

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

Actual normalized file (35,258 entities):

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

Automated geometry tests pass for L, T and X. Each result retains two independent objects (`A != B`) and stores the Junction as a relation. The rendering/export path applies the junction correction while preserving independent widths and IDs. The alpha test confirms a 50% black stroke preblended over white produces `rgb(128,128,128)` once, avoiding double-opacity darkening at the junction.

## Multi-page classification smoke test

- `GROUND FLOOR.pdf`: 22 pages analyzed without crash; first five pages classified Raster PDF underlay (0 vector primitives).
- `FIRST FLOOR.pdf`: 24 pages analyzed without crash; first five pages classified Raster PDF underlay (0 vector primitives).

Observed analysis times: 7.725 s and 4.934 s respectively.

## Remaining acceptance before formal POC-01 closure

1. Run the committed fix branch in real Google Chrome and perform one complete interactive pass: Select -> overlap cycle -> Window/Crossing -> move -> delete -> Undo/Redo -> line add -> Snap -> Clean Junction -> Zoom/Pan -> SVG/PDF/PNG export.
2. Replay the two original problem videos side by side with the fixed branch. The Windows-path MP4 files were not accessible in this environment.
3. Record a short after-fix screen capture and confirm export appearance at several zoom levels.

Until those three manual evidence items are complete, the branch is ready for acceptance but POC-01 should not be marked formally closed. Do not start POC-02 or DWG/DXF.