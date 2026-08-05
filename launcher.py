from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
APP = BASE / "app.py"
VENV = BASE / ".venv"


def clean_env() -> dict[str, str]:
    env = os.environ.copy()
    for key in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "PIP_CERT"):
        env.pop(key, None)
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    return env


def can_import(python: Path | str) -> bool:
    try:
        result = subprocess.run(
            [str(python), "-c", "import fitz; print(fitz.__doc__[:8])"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
            env=clean_env(),
        )
        return result.returncode == 0
    except Exception:
        return False


def venv_python(folder: Path) -> Path:
    if os.name == "nt":
        return folder / "Scripts" / "python.exe"
    return folder / "bin" / "python"


def find_existing_engine() -> Path | None:
    own = venv_python(VENV)
    if own.exists() and can_import(own):
        return own
    # Reuse the working environment from the earlier A2Z demo when present.
    parent = BASE.parent
    candidates = []
    for pattern in ("A2Z_Lighting_Planner_Demo*", "A2Z_*Lighting*Demo*"):
        for folder in parent.glob(pattern):
            py = venv_python(folder / ".venv")
            if py.exists():
                candidates.append(py)
    for py in candidates:
        if can_import(py):
            return py
    if can_import(sys.executable):
        return Path(sys.executable)
    return None


def create_engine() -> Path:
    print("[1/2] Creating local Python environment...")
    subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True, env=clean_env())
    py = venv_python(VENV)
    print("[2/2] Installing PyMuPDF PDF vector engine...")
    subprocess.run(
        [str(py), "-m", "pip", "install", "--disable-pip-version-check", "pymupdf>=1.26,<1.29"],
        check=True,
        env=clean_env(),
    )
    return py


def main() -> int:
    try:
        engine = find_existing_engine() or create_engine()
        print(f"Using engine: {engine}")
        print("Starting A2Z Vector PDF CAD Demo...")
        return subprocess.call([str(engine), str(APP)], cwd=str(BASE), env=clean_env())
    except Exception as exc:
        print("\nSTARTUP FAILED")
        print(exc)
        print("\nThe demo needs Python 3.10+ and PyMuPDF.")
        print("If an older A2Z demo already works, keep both folders in the same parent folder so this launcher can reuse its environment.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
