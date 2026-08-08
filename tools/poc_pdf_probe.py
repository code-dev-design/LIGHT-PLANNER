from __future__ import annotations

import argparse
import json
import math
import re
import time
from pathlib import Path
from typing import Any

try:
    import pymupdf as fitz
except ImportError:
    import fitz  # type: ignore


def detect_scale(text: str) -> str | None:
    for pattern in (
        r"(?:scale\s*[:=]?\s*)?(1\s*[:/]\s*\d{1,4})",
        r"(?:مقياس\s*[:=]?\s*)?(1\s*[:/]\s*\d{1,4})",
    ):
        match = re.search(pattern, text, re.I)
        if match:
            return re.sub(r"\s+", "", match.group(1)).replace("/", ":")
    return None


def point_xy(value: Any) -> tuple[float, float]:
    if hasattr(value, "x"):
        return float(value.x), float(value.y)
    return float(value[0]), float(value[1])


def line_length(item: Any) -> float | None:
    if not item or item[0] != "l":
        return None
    x1, y1 = point_xy(item[1])
    x2, y2 = point_xy(item[2])
    return math.hypot(x2 - x1, y2 - y1)


def classify(vector_entities: int, images: int) -> str:
    if vector_entities >= 100:
        return "vector"
    if vector_entities > 0:
        return "mixed"
    if images:
        return "raster"
    return "empty"


def analyze_page(page: Any, page_number: int) -> dict[str, Any]:
    started = time.perf_counter()
    drawings = page.get_cdrawings()
    counts = {"lines": 0, "curves": 0, "rects": 0, "quads": 0}
    line_lengths: list[float] = []

    for path in drawings:
        for item in path.get("items", ()):  # type: ignore[assignment]
            kind = item[0]
            if kind == "l":
                counts["lines"] += 1
                length = line_length(item)
                if length is not None:
                    line_lengths.append(length)
            elif kind == "c":
                counts["curves"] += 1
            elif kind == "re":
                counts["rects"] += 1
            elif kind == "qu":
                counts["quads"] += 1

    text_dict = page.get_text("dict", flags=fitz.TEXTFLAGS_TEXT)
    text_spans = 0
    for block in text_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            text_spans += len(line.get("spans", []))

    images = len(page.get_images(full=True))
    text = page.get_text("text") or ""
    vector_entities = sum(counts.values())

    tiny = sum(1 for length in line_lengths if length < 1.0)
    tiny_ratio = tiny / len(line_lengths) if line_lengths else 0.0

    return {
        "page": page_number,
        "width_pt": round(float(page.rect.width), 2),
        "height_pt": round(float(page.rect.height), 2),
        "rotation": int(page.rotation),
        "classification": classify(vector_entities, images),
        "scale_text": detect_scale(text),
        "paths": len(drawings),
        "vector_entities": vector_entities,
        **counts,
        "text_spans": text_spans,
        "images": images,
        "tiny_line_ratio": round(tiny_ratio, 4),
        "analysis_seconds": round(time.perf_counter() - started, 4),
    }


def analyze_pdf(path: Path) -> dict[str, Any]:
    started = time.perf_counter()
    pages: list[dict[str, Any]] = []
    with fitz.open(path) as doc:
        for index, page in enumerate(doc):
            pages.append(analyze_page(page, index + 1))

    classifications: dict[str, int] = {"vector": 0, "mixed": 0, "raster": 0, "empty": 0}
    for page in pages:
        classifications[page["classification"]] += 1

    return {
        "file": path.name,
        "size_mb": round(path.stat().st_size / 1024 / 1024, 2),
        "page_count": len(pages),
        "classifications": classifications,
        "vector_entities_total": sum(p["vector_entities"] for p in pages),
        "vector_entities_max_page": max((p["vector_entities"] for p in pages), default=0),
        "text_spans_total": sum(p["text_spans"] for p in pages),
        "images_total": sum(p["images"] for p in pages),
        "detected_scales": sorted({p["scale_text"] for p in pages if p["scale_text"]}),
        "analysis_seconds": round(time.perf_counter() - started, 4),
        "pages": pages,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 04 POC-01 Vector PDF diagnostic probe")
    parser.add_argument("pdf", nargs="+", type=Path, help="PDF file(s) to inspect")
    parser.add_argument("--output", type=Path, help="Optional JSON report path")
    args = parser.parse_args()

    reports = []
    for path in args.pdf:
        if not path.exists():
            raise SystemExit(f"Missing file: {path}")
        reports.append(analyze_pdf(path))

    result = {
        "poc": "POC-01 Vector PDF Core",
        "goal": "Classify real client PDFs and measure vector extraction complexity before editor validation.",
        "reports": reports,
    }
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    print(payload)
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
