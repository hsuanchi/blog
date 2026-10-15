"""Crop browser-rendered HTML masters into the tutorial's illustration assets."""
import argparse
import json
from pathlib import Path

from PIL import Image


parser = argparse.ArgumentParser()
parser.add_argument("--source", type=Path, required=True,
                    help="Browser screenshots and clips.json from the HTML artboards")
parser.add_argument("--only", nargs="+", help="Export only the named artboards")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
target = root / "docs/image/netsuite-report-permissions"
target.mkdir(parents=True, exist_ok=True)
manifest = root / "artwork/netsuite-report-permissions/exports.json"
exports = json.loads(manifest.read_text()) if manifest.exists() else {}
exported = 0
for name, clip in json.loads((args.source / "clips.json").read_text()).items():
    if args.only and name not in args.only:
        continue
    picture = Image.open(args.source / f"{name}.jpg")
    scale = picture.width / clip["viewportWidth"]
    left, top = round(clip["x"] * scale), round(clip["y"] * scale)
    width, height = round(clip["width"] * scale), round(clip["height"] * scale)
    if top < 0 or left < 0 or left + width > picture.width or top + height > picture.height:
        raise ValueError(f"{name}: artboard was not fully visible")
    picture.crop((left, top, left + width, top + height)).save(
        target / f"{name}.jpg", quality=95, subsampling=0, optimize=True
    )
    exports[name] = {"file": f"{name}.jpg", "width": width, "height": height}
    exported += 1
manifest.write_text(json.dumps(exports, indent=2) + "\n")
print(f"Exported {exported} illustrations from HTML browser renders.")
