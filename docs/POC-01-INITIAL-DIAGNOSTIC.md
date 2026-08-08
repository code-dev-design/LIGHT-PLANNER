# POC-01 — Initial Vector PDF Diagnostic

## Goal
Validate the first stage of the Phase 04 pipeline on representative real client PDFs before changing the editor logic.

## Files checked

### 1. FAINAL DRAWING 91-2025-Model.pdf
- Size: 0.54 MB
- Pages: 1
- Classification: Vector PDF
- Detected scale text: 1:100
- Vector entities: 27,596
- Lines: 25,003
- Curves: 2,419
- Quads: 174
- Text spans: 148
- Embedded images: 9
- Diagnostic analysis time: ~0.13 s in the local PyMuPDF environment

### 2. ايهاب(1).pdf
- Size: 0.59 MB
- Pages: 1
- Classification: Vector PDF
- Detected scale text: 1:100
- Vector entities: 128,827
- Lines: 122,045
- Curves: 5,850
- Rectangles: 809
- Quads: 123
- Text spans: 306
- Embedded images: 0
- Diagnostic analysis time: ~0.46 s in the local PyMuPDF environment

### 3. 64061231763800690-electrical.pdf
- Size: 0.67 MB
- Pages: 2
- Classification: Raster PDF
- Vector entities: 0
- Text spans: 0
- Embedded images: 16 total
- Diagnostic analysis time: ~0.01 s

## First technical conclusion
The real project samples already demonstrate at least two materially different PDF paths:

1. **Vector PDF**: can proceed to geometry extraction, scale validation, selection and editing tests.
2. **Raster PDF**: must be treated as an image underlay in V1 and must not be presented as editable CAD geometry.

This matches the V1 scope baseline and confirms that the importer must classify the source before opening the editing workflow.

## Risk discovered early
Entity density varies substantially. A one-page real project may contain roughly 27k entities, while another one-page sample exceeds 128k entities. Therefore POC-01 must validate not only extraction correctness but also editor responsiveness, hit-testing and rendering strategy on dense pages.

## Next POC-01 test
Use the moderate Vector PDF first (`FAINAL DRAWING 91-2025-Model.pdf`) inside the existing demo and validate, in order:

1. visual fidelity of imported geometry;
2. scale/calibration using a known dimension;
3. selection of an imported line/entity;
4. move/delete operation;
5. add a new line;
6. undo/redo;
7. pan/zoom responsiveness.

Only after these pass should the same checks be repeated on the 128k-entity sample.

## Status
- PDF source classification: PASS for tested samples
- Vector extraction availability: PASS at diagnostic level
- Scale text detection: PASS on two vector samples
- Editor fidelity: NOT YET VALIDATED
- Measurement accuracy: NOT YET VALIDATED
- Select/Edit performance: NOT YET VALIDATED
