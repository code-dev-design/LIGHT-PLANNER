import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app
from poc01_geometry import detect_dimension_unit, detect_measurement_scale


ROOT = Path(__file__).resolve().parents[1]


class PerformanceOptimizationTests(unittest.TestCase):
    def test_analysis_cache_preserves_stats_and_reuses_result(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            pdf_path = root / "drawing.pdf"
            cache_dir = root / "cache"
            cache_dir.mkdir()

            doc = app.fitz.open()
            page = doc.new_page(width=400, height=300)
            page.draw_line((20, 20), (380, 20))
            page.insert_text((30, 60), "SCALE 1:100")
            doc.save(pdf_path)
            doc.close()

            fingerprint = app.file_fingerprint(pdf_path)
            with patch.object(app, "CACHE_DIR", cache_dir):
                first, first_hit = app.analysis_blueprint(pdf_path, fingerprint)
                second, second_hit = app.analysis_blueprint(pdf_path, fingerprint)

            self.assertFalse(first_hit)
            self.assertTrue(second_hit)
            self.assertEqual(first, second)
            self.assertIsNone(first["pages"][0]["vector_entities"])
            self.assertEqual(first["pages"][0]["images"], 0)
            self.assertIn("exact vectors checked on import", first["pages"][0]["classification"])

    def test_editor_uses_static_base_layer_and_frame_scheduling(self):
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

        self.assertIn('id="baseCanvas"', html)
        self.assertIn("function renderBase()", js)
        self.assertIn("requestAnimationFrame", js)
        self.assertIn("function scheduleRender()", js)
        self.assertIn("previewBaseCamera();scheduleRender()", js)
        self.assertIn("S.spatial.queryBox(viewBox())", js)
        self.assertIn("installRasterUnderlay", js)
        self.assertIn("calibrateUnscaledMeasure", js)
        self.assertIn("parseReferenceLabel", js)

    def test_raster_pdf_is_marked_for_underlay_instead_of_blank_editor(self):
        with tempfile.TemporaryDirectory() as folder:
            pdf_path = Path(folder) / "raster.pdf"
            doc = app.fitz.open()
            page = doc.new_page(width=200, height=120)
            pixmap = app.fitz.Pixmap(app.fitz.csRGB, app.fitz.IRect(0, 0, 20, 20), False)
            pixmap.clear_with(255)
            page.insert_image(page.rect, stream=pixmap.tobytes("png"))
            doc.save(pdf_path)
            doc.close()

            data = app.extract_editable_geometry(pdf_path, 0)

            self.assertTrue(data["raster_underlay"])
            self.assertEqual(data["stats"]["images"], 1)
            self.assertEqual(data["entities"], [])
            self.assertEqual(data["texts"], [])

    def test_scale_detection_accepts_dimension_labels_with_units(self):
        texts = []
        for index in range(7):
            x = index * 40.0
            texts.append({
                "text": "2.00 m",
                "angle": 0,
                "bbox": [x - 8, 96, x + 8, 104],
                "size": 6,
                "layer": "DIMENSIONS",
            })

        unit = detect_dimension_unit("", texts)
        scale = detect_measurement_scale(texts, unit)

        self.assertEqual(unit["unit"], "m")
        self.assertIsNotNone(scale)
        self.assertAlmostEqual(scale["scale"], 0.05, places=8)


if __name__ == "__main__":
    unittest.main()
