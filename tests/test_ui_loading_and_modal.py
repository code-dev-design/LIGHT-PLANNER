from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "styles.css").read_text(encoding="utf-8")


class LoadingAndModalUiTests(unittest.TestCase):
    def test_html_ids_are_unique_and_js_references_exist(self) -> None:
        ids = re.findall(r'\bid="([^"]+)"', HTML)
        duplicates = sorted({item for item in ids if ids.count(item) > 1})
        self.assertEqual(duplicates, [])
        javascript_ids = set(re.findall(r"\$\('([^']+)'\)", JS))
        self.assertEqual(sorted(javascript_ids - set(ids)), [])

    def test_loading_overlay_is_global_and_accessible(self) -> None:
        self.assertEqual(HTML.count('id="loadingOverlay"'), 1)
        self.assertGreater(HTML.index('id="loadingOverlay"'), HTML.index('id="calibrationModal"'))
        self.assertIn('aria-live="polite"', HTML)
        self.assertIn('id="loadingProgressBar"', HTML)
        self.assertIn("position:fixed", CSS)
        self.assertIn("z-index:500", CSS)
        self.assertIn(".loading-progress.indeterminate", CSS)

    def test_upload_and_import_have_progress_feedback(self) -> None:
        self.assertIn("xhr.upload.onprogress", JS)
        self.assertIn("onUploadComplete", JS)
        self.assertIn("جاري رفع المخطط", JS)
        self.assertIn("جاري استيراد الصفحة", JS)
        self.assertIn("loadingElapsed", JS)

    def test_analysis_modal_has_all_close_paths(self) -> None:
        self.assertIn('data-close="analysisModal"', HTML)
        self.assertIn('aria-label="إغلاق نافذة الصفحات"', HTML)
        self.assertIn("function closeAnalysis()", JS)
        self.assertIn("e.target===$(id)", JS)
        self.assertIn("e.key==='Escape'", JS)


if __name__ == "__main__":
    unittest.main()
