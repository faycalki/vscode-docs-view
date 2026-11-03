"""Expand the versioned reference snapshot for development and release packaging."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1] / "reference"
with zipfile.ZipFile(root / "bundled.zip") as archive:
    archive.extractall(root / "data")
