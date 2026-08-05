# Technical scope

## Implemented
- PDF page analysis and selection.
- True extraction of PDF vector paths through PyMuPDF `Page.get_cdrawings()`.
- Lines, cubic Bezier curves, quads/polygons, styles, colors, line weights, and TrueType text extraction.
- Per-entity selection, crossing-window multi-selection, deletion, movement, and endpoint editing for line segments.
- User line drawing, endpoint/grid snap, calibration, dimensions, lighting product placement, equal distribution, BOQ.
- Vector SVG export and vector PDF reconstruction from the edited SVG.

## Not claimed
- Semantic recognition that a specific pair of lines is a wall.
- Recovery of original AutoCAD blocks, constraints, dimensions, or layer semantics when they were not stored in PDF.
- Raster-to-vector conversion for scanned PDFs.
- Direct DWG/DXF import in this proof of concept.
