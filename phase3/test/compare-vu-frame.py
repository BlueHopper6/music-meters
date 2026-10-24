"""Compare a numbered VU MP4 frame with its matching editor still."""
import json
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image

REGIONS = {"bar": (30, 160, 610, 600), "needle": (650, 160, 1230, 600)}


def psnr(first, second):
    squared = sum((a - b) ** 2 for a, b in zip(first.tobytes(), second.tobytes()))
    rmse = math.sqrt(squared / (first.width * first.height * 3))
    return 20 * math.log10(255 / rmse) if rmse else float("inf")


def main():
    still, video, frame, output = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]), Path(sys.argv[4])
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-vf",
                    f"select=eq(n\\,{frame})", "-vsync", "0", "-frames:v", "1", "-y", str(output)], check=True)
    preview = Image.open(still).convert("RGB")
    encoded = Image.open(output).convert("RGB")
    assert preview.size == encoded.size == (1280, 720)
    overall = psnr(preview, encoded)
    local = {name: psnr(preview.crop(box), encoded.crop(box)) for name, box in REGIONS.items()}
    print(json.dumps({"frame": frame, "psnrDb": round(overall, 2),
                      "regionPsnrDb": {name: round(value, 2) for name, value in local.items()}}))
    assert overall >= 30
    assert all(value >= 25 for value in local.values())


if __name__ == "__main__":
    main()
