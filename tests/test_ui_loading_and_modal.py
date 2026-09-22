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


    def test_theme_and_lighting_controls_are_wired(self) -> None:
        self.assertIn("theme:'light'", JS)
        self.assertIn("$('darkPlanToggle').onclick=()=>{S.theme=S.theme==='dark'?'light':'dark';invalidateBase();updateModeUi();render()}", JS)
        self.assertIn("function setEffects(on){S.layers.effects=!!on;updateModeUi();scheduleRender()}", JS)
        self.assertIn("if(S.layers.effects)for(const o of S.objects)if(o.type==='light')drawLightEffect(ctx,o);", JS)

    def test_measurement_is_free_unless_shift_snap_is_requested(self) -> None:
        self.assertIn("function measurePoint(w,start=null,ev=null){if(ev?.shiftKey)return measureSnap(w,start);S.snapPoint=null;return w}", JS)
        self.assertIn("القياس حر بين أي نقطتين", JS)
        self.assertIn("اضغط Shift", HTML)
        self.assertIn("const px=Math.hypot(S.draft.end.x-S.draft.start.x,S.draft.end.y-S.draft.start.y)*S.camera.zoom;if(px>=6)boxSelect", JS)

    def test_semantic_plan_palette_and_measurement_label_exist(self) -> None:
        self.assertIn("line:'#2f6fbd'", JS)
        self.assertIn("polyline:'#16877f'", JS)
        self.assertIn("ring:'#0d7f78'", JS)
        self.assertIn("color='#ef3f43'", JS)
        self.assertIn("c.fillText(m.label", JS)


if __name__ == "__main__":
    unittest.main()
