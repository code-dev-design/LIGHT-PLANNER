# A2Z Lighting Vector PDF CAD Demo

Browser-based demo that imports vector PDF geometry as editable entities, supports lighting placement and visual light effects, and exports the edited plan.

## Local run

- Windows: run `run_demo.bat`
- Linux/macOS: run `./run_demo.sh`

## GitHub + Render deployment

This repository includes:

- `render.yaml`
- `requirements.txt`
- `.python-version`
- `/api/health`
- cloud-safe host and port handling

Arabic deployment instructions are available in `DEPLOY_RENDER_AR.md`.

## Scope

- Vector PDF import and editing
- Lighting products and visual effects
- Dark/white plan modes
- SVG/PDF export

The light effects are visual approximations, not certified photometric calculations. Accurate simulation requires product IES/LDT files and project parameters such as mounting height and surface reflectance.
