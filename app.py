from __future__ import annotations

import gzip
import io
import json
import math
import mimetypes
import os
import re
import shutil
import sys
import threading
import time
import uuid
import webbrowser
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

try:
    import pymupdf as fitz
except ImportError:  # PyMuPDF <= 1.26 also exposes fitz
    import fitz  # type: ignore

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
ASSET_DIR = STATIC_DIR / "assets"
RUNTIME_DIR = BASE_DIR / "runtime"
UPLOAD_DIR = RUNTIME_DIR / "uploads"
CACHE_DIR = RUNTIME_DIR / "cache"
for folder in (UPLOAD_DIR, CACHE_DIR):
    folder.mkdir(parents=True, exist_ok=True)

IS_CLOUD = os.environ.get("RENDER", "").lower() == "true" or bool(os.environ.get("RENDER_EXTERNAL_HOSTNAME"))
HOST = os.environ.get("HOST", "0.0.0.0" if IS_CLOUD else "127.0.0.1")
try:
    PORT = int(os.environ.get("PORT", "8765"))
except ValueError:
    PORT = 8765
MAX_UPLOAD = 120 * 1024 * 1024
PROJECTS: dict[str, dict[str, Any]] = {}
PROJECT_LOCK = threading.Lock()


def safe_name(name: str | None) -> str:
    name = Path(name or "drawing.pdf").name
    name = re.sub(r"[^A-Za-z0-9._() -]+", "_", name).strip()
    return (name or "drawing.pdf")[:160]


def point_xy(value: Any) -> tuple[float, float]:
    if hasattr(value, "x"):
        return float(value.x), float(value.y)
    return float(value[0]), float(value[1])


def transform_xy(value: Any, matrix: Any) -> list[float]:
    x, y = point_xy(value)
    p = fitz.Point(x, y) * matrix
    return [round(float(p.x), 2), round(float(p.y), 2)]


def bbox_of_points(points: list[list[float]]) -> list[float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)]


def color_hex(color: Any, fallback: str = "#000000") -> str:
    if color is None:
        return fallback
    try:
        r, g, b = color
        return f"#{max(0,min(255,round(r*255))):02x}{max(0,min(255,round(g*255))):02x}{max(0,min(255,round(b*255))):02x}"
    except Exception:
        return fallback


def int_color_hex(value: int) -> str:
    try:
        rgb = fitz.sRGB_to_rgb(value)
        return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"
    except Exception:
        return "#111111"


def detect_scale(text: str) -> str | None:
    for pattern in (
        r"(?:scale\s*[:=]?\s*)?(1\s*[:/]\s*\d{1,4})",
        r"(?:مقياس\s*[:=]?\s*)?(1\s*[:/]\s*\d{1,4})",
    ):
        match = re.search(pattern, text, re.I)
        if match:
            return re.sub(r"\s+", "", match.group(1)).replace("/", ":")
    return None


def page_stats(page: Any) -> dict[str, Any]:
    drawings = page.get_cdrawings()
    counts = {"lines": 0, "curves": 0, "rects": 0, "quads": 0}
    for path in drawings:
        for item in path.get("items", ()):  # type: ignore[assignment]
            kind = item[0]
            if kind == "l":
                counts["lines"] += 1
            elif kind == "c":
                counts["curves"] += 1
            elif kind == "re":
                counts["rects"] += 1
            elif kind == "qu":
                counts["quads"] += 1
    text_dict = page.get_text("dict", flags=fitz.TEXTFLAGS_TEXT)
    spans = 0
    for block in text_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans += len(line.get("spans", []))
    images = len(page.get_images(full=True))
    text = page.get_text("text") or ""
    total_vectors = sum(counts.values())
    if total_vectors >= 100:
        classification = "Vector PDF - editable geometry"
    elif total_vectors:
        classification = "Mixed PDF - limited vector geometry"
    elif images:
        classification = "Raster PDF - image underlay only"
    else:
        classification = "No editable geometry detected"
    return {
        **counts,
        "vector_entities": total_vectors,
        "paths": len(drawings),
        "text_spans": spans,
        "images": images,
        "classification": classification,
        "scale": detect_scale(text),
        "rotation": int(page.rotation),
    }


def create_thumbnail(pdf_path: Path, page_index: int, output: Path) -> None:
    if output.exists():
        return
    with fitz.open(pdf_path) as doc:
        page = doc[page_index]
        max_side = 360
        zoom = min(max_side / max(page.rect.width, page.rect.height), 0.6)
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        pix.save(output)


def analyze_pdf(pdf_path: Path, filename: str, project_id: str) -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    with fitz.open(pdf_path) as doc:
        for index, page in enumerate(doc):
            stats = page_stats(page)
            thumb = CACHE_DIR / f"{project_id}-thumb-{index}.png"
            create_thumbnail(pdf_path, index, thumb)
            pages.append({
                "index": index,
                "number": index + 1,
                "width": round(float(page.rect.width), 2),
                "height": round(float(page.rect.height), 2),
                "thumbnail": f"/api/project/{project_id}/thumb/{index}",
                **stats,
            })
    return {
        "project_id": project_id,
        "filename": filename,
        "page_count": len(pages),
        "size_mb": round(pdf_path.stat().st_size / 1024 / 1024, 2),
        "pages": pages,
    }


def _serialize_text(page: Any, matrix: Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    data = page.get_text("dict", flags=fitz.TEXTFLAGS_TEXT)
    tid = 0
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            direction = line.get("dir", (1.0, 0.0))
            for span in line.get("spans", []):
                text = span.get("text", "")
                if not text.strip():
                    continue
                origin = span.get("origin", (span["bbox"][0], span["bbox"][3]))
                p0 = fitz.Point(*origin) * matrix
                p1 = fitz.Point(origin[0] + direction[0], origin[1] + direction[1]) * matrix
                angle = math.degrees(math.atan2(p1.y - p0.y, p1.x - p0.x))
                rect = fitz.Rect(span["bbox"])
                corners = [
                    fitz.Point(rect.x0, rect.y0) * matrix,
                    fitz.Point(rect.x1, rect.y0) * matrix,
                    fitz.Point(rect.x1, rect.y1) * matrix,
                    fitz.Point(rect.x0, rect.y1) * matrix,
                ]
                bbox = bbox_of_points([[c.x, c.y] for c in corners])
                result.append({
                    "id": f"t{tid}",
                    "t": "text",
                    "text": text,
                    "x": round(float(p0.x), 2),
                    "y": round(float(p0.y), 2),
                    "size": round(float(span.get("size", 10.0)), 2),
                    "font": span.get("font", "Arial"),
                    "color": int_color_hex(int(span.get("color", 0))),
                    "angle": round(angle, 2),
                    "bbox": bbox,
                    "layer": "PDF_Text",
                })
                tid += 1
    return result


def extract_vectors(pdf_path: Path, page_index: int) -> dict[str, Any]:
    started = time.perf_counter()
    with fitz.open(pdf_path) as doc:
        if page_index < 0 or page_index >= len(doc):
            raise IndexError("Page index out of range")
        page = doc[page_index]
        matrix = page.rotation_matrix
        drawings = page.get_cdrawings()
        styles: list[dict[str, Any]] = []
        style_map: dict[tuple[Any, ...], int] = {}
        entities: list[dict[str, Any]] = []
        eid = 0

        def style_index(path: dict[str, Any]) -> int:
            stroke = color_hex(path.get("color"), "#111111")
            fill = color_hex(path.get("fill"), "") if path.get("fill") is not None else None
            width = float(path.get("width") or 0.0)
            if width <= 0:
                width = 0.28
            key = (
                stroke,
                fill,
                round(width, 3),
                round(float(path.get("stroke_opacity") or 1.0), 3),
                round(float(path.get("fill_opacity") or 1.0), 3),
                str(path.get("dashes") or ""),
            )
            if key not in style_map:
                style_map[key] = len(styles)
                styles.append({
                    "stroke": stroke,
                    "fill": fill,
                    "width": round(width, 3),
                    "strokeAlpha": key[3],
                    "fillAlpha": key[4],
                    "dashes": key[5],
                })
            return style_map[key]

        for path_no, path in enumerate(drawings):
            sidx = style_index(path)
            layer = path.get("layer") or "PDF_Geometry"
            seq = int(path.get("seqno") or path_no)
            for item in path.get("items", []):
                kind = item[0]
                base = {
                    "id": f"e{eid}",
                    "s": sidx,
                    "path": path_no,
                    "layer": layer,
                    "seq": seq,
                }
                if kind == "l":
                    p1, p2 = transform_xy(item[1], matrix), transform_xy(item[2], matrix)
                    length = round(math.hypot(p2[0] - p1[0], p2[1] - p1[1]), 2)
                    entities.append({**base, "t": "line", "p": p1 + p2, "bbox": bbox_of_points([p1, p2]), "len": length})
                    eid += 1
                elif kind == "c":
                    points = [transform_xy(value, matrix) for value in item[1:5]]
                    entities.append({**base, "t": "curve", "p": [n for p in points for n in p], "bbox": bbox_of_points(points)})
                    eid += 1
                elif kind == "re":
                    rect = item[1]
                    if not hasattr(rect, "x0"):
                        rect = fitz.Rect(rect)
                    points = [
                        transform_xy((rect.x0, rect.y0), matrix),
                        transform_xy((rect.x1, rect.y0), matrix),
                        transform_xy((rect.x1, rect.y1), matrix),
                        transform_xy((rect.x0, rect.y1), matrix),
                    ]
                    entities.append({**base, "t": "poly", "p": [n for p in points for n in p], "closed": True, "bbox": bbox_of_points(points)})
                    eid += 1
                elif kind == "qu":
                    raw = item[1]
                    points0 = [transform_xy(v, matrix) for v in raw]
                    # PyMuPDF Quad point order is UL, UR, LL, LR. Reorder around perimeter.
                    points = [points0[0], points0[1], points0[3], points0[2]]
                    entities.append({**base, "t": "poly", "p": [n for p in points for n in p], "closed": True, "bbox": bbox_of_points(points)})
                    eid += 1

        texts = _serialize_text(page, matrix)
        return {
            "page": page_index,
            "width": round(float(page.rect.width), 2),
            "height": round(float(page.rect.height), 2),
            "rotation": int(page.rotation),
            "styles": styles,
            "entities": entities,
            "texts": texts,
            "stats": {
                "entities": len(entities),
                "lines": sum(1 for e in entities if e["t"] == "line"),
                "curves": sum(1 for e in entities if e["t"] == "curve"),
                "polygons": sum(1 for e in entities if e["t"] == "poly"),
                "texts": len(texts),
                "seconds": round(time.perf_counter() - started, 3),
            },
        }


def project_from_sample() -> dict[str, Any]:
    source = ASSET_DIR / "sample_floor_plan.pdf"
    project_id = "sample"
    with PROJECT_LOCK:
        PROJECTS[project_id] = {"path": source, "filename": "A2Z Sample - Ground Floor.pdf"}
    return analyze_pdf(source, "A2Z Sample - Ground Floor.pdf", project_id)


def parse_multipart(body: bytes, content_type: str) -> tuple[bytes, str]:
    # cgi is deprecated but available through Python 3.12. Python 3.13 removed it,
    # so this parser intentionally uses only bytes operations.
    match = re.search(r"boundary=(?:\"([^\"]+)\"|([^;]+))", content_type)
    if not match:
        raise ValueError("Missing multipart boundary")
    boundary = (match.group(1) or match.group(2)).encode("utf-8")
    marker = b"--" + boundary
    for part in body.split(marker):
        if b"Content-Disposition:" not in part:
            continue
        head, sep, payload = part.partition(b"\r\n\r\n")
        if not sep:
            continue
        disposition = head.decode("utf-8", "replace")
        file_match = re.search(r'filename="([^"]*)"', disposition)
        if not file_match:
            continue
        filename = safe_name(file_match.group(1))
        payload = payload.rstrip(b"\r\n-")
        return payload, filename
    raise ValueError("No file part found")


class Handler(BaseHTTPRequestHandler):
    server_version = "A2ZVectorCAD/2.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def send_json(self, data: Any, status: int = 200, compress: bool = True) -> None:
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        use_gzip = compress and "gzip" in self.headers.get("Accept-Encoding", "") and len(payload) > 2048
        if use_gzip:
            payload = gzip.compress(payload, compresslevel=6)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if use_gzip:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_bytes(self, payload: bytes, mime: str, filename: str | None = None, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(payload)))
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(payload)

    def serve_file(self, path: Path) -> None:
        try:
            resolved = path.resolve()
            if STATIC_DIR.resolve() not in resolved.parents and resolved != STATIC_DIR.resolve():
                self.send_error(403)
                return
            payload = resolved.read_bytes()
        except FileNotFoundError:
            self.send_error(404)
            return
        mime = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        try:
            if path == "/":
                return self.serve_file(STATIC_DIR / "index.html")
            if path.startswith("/static/"):
                return self.serve_file(STATIC_DIR / path[len("/static/"):])
            if path == "/api/health":
                return self.send_json({"status": "ok", "engine": f"PyMuPDF {getattr(fitz, '__version__', '')}", "mode": "true-vector-pdf-import"})
            if path == "/api/sample":
                return self.send_json(project_from_sample())

            match = re.fullmatch(r"/api/project/([A-Za-z0-9_-]+)/thumb/(\d+)", path)
            if match:
                project_id, page_s = match.groups()
                project = PROJECTS.get(project_id)
                if not project:
                    return self.send_json({"detail": "Project not found"}, 404)
                output = CACHE_DIR / f"{project_id}-thumb-{page_s}.png"
                create_thumbnail(Path(project["path"]), int(page_s), output)
                return self.send_bytes(output.read_bytes(), "image/png")

            match = re.fullmatch(r"/api/project/([A-Za-z0-9_-]+)/vectors/(\d+)", path)
            if match:
                project_id, page_s = match.groups()
                project = PROJECTS.get(project_id)
                if not project:
                    return self.send_json({"detail": "Project not found"}, 404)
                page_index = int(page_s)
                cache = CACHE_DIR / f"{project_id}-vectors-{page_index}.json.gz"
                if cache.exists():
                    payload = cache.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Encoding", "gzip")
                    self.send_header("Content-Length", str(len(payload)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(payload)
                    return
                data = extract_vectors(Path(project["path"]), page_index)
                raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                packed = gzip.compress(raw, compresslevel=6)
                cache.write_bytes(packed)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(packed)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(packed)
                return

            self.send_error(404)
        except Exception as exc:
            self.send_json({"detail": f"Server error: {exc}"}, 500)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                return self.send_json({"detail": "Empty request"}, 400)
            if length > MAX_UPLOAD:
                return self.send_json({"detail": "File exceeds 120 MB demo limit"}, 413)
            body = self.rfile.read(length)

            if path == "/api/analyze":
                payload, filename = parse_multipart(body, self.headers.get("Content-Type", ""))
                if not payload.startswith(b"%PDF"):
                    return self.send_json({"detail": "This demo imports vector PDF only. DXF/DWG are phase 2."}, 415)
                project_id = uuid.uuid4().hex[:12]
                stored = UPLOAD_DIR / f"{project_id}.pdf"
                stored.write_bytes(payload)
                try:
                    result = analyze_pdf(stored, filename, project_id)
                except Exception:
                    stored.unlink(missing_ok=True)
                    raise
                with PROJECT_LOCK:
                    PROJECTS[project_id] = {"path": stored, "filename": filename}
                return self.send_json(result)

            if path == "/api/svg-to-pdf":
                data = json.loads(body.decode("utf-8"))
                svg = data.get("svg", "")
                if not svg or len(svg) > 30_000_000:
                    return self.send_json({"detail": "Invalid SVG"}, 400)
                svg_doc = fitz.open(stream=svg.encode("utf-8"), filetype="svg")
                pdf_bytes = svg_doc.convert_to_pdf()
                return self.send_bytes(pdf_bytes, "application/pdf", "A2Z-Lighting-Plan.pdf")

            self.send_error(404)
        except ValueError as exc:
            self.send_json({"detail": str(exc)}, 400)
        except Exception as exc:
            self.send_json({"detail": f"Server error: {exc}"}, 500)


def open_browser() -> None:
    # 0.0.0.0 is the bind address, not a browser destination.
    browser_host = "127.0.0.1" if HOST == "0.0.0.0" else HOST
    webbrowser.open(f"http://{browser_host}:{PORT}")


def main() -> None:
    project_from_sample()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("=" * 68)
    print("A2Z Vector PDF CAD Demo")
    public_host = os.environ.get("RENDER_EXTERNAL_HOSTNAME")
    if public_host:
        print(f"Open: https://{public_host}")
    else:
        browser_host = "127.0.0.1" if HOST == "0.0.0.0" else HOST
        print(f"Open: http://{browser_host}:{PORT}")
    print("This engine imports PDF vector paths as individually editable entities.")
    print("Press Ctrl+C to stop.")
    print("=" * 68)
    if not IS_CLOUD and os.environ.get("A2Z_NO_BROWSER") != "1":
        threading.Timer(1.0, open_browser).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
