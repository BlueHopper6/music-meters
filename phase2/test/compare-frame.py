"""Compare an editor canvas still with the corresponding encoded MP4 frame."""
import argparse
import json
import math
from PIL import Image


def trace_bounds(image):
    pixels = image.load()
    xs, ys = [], []
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue = pixels[x, y]
            if red < 140 and green > 150 and blue > 140 and green > red * 1.5:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise AssertionError("No cyan Prism trace was found")
    return (min(xs), min(ys), max(xs), max(ys))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("preview")
    parser.add_argument("encoded")
    args = parser.parse_args()
    preview = Image.open(args.preview).convert("RGB")
    encoded = Image.open(args.encoded).convert("RGB")
    assert preview.size == encoded.size == (1280, 720)
    squared = 0
    for a, b in zip(preview.tobytes(), encoded.tobytes()):
        squared += (a - b) ** 2
    rmse = math.sqrt(squared / (preview.width * preview.height * 3))
    psnr = 20 * math.log10(255 / rmse) if rmse else float("inf")
    preview_bounds = trace_bounds(preview)
    encoded_bounds = trace_bounds(encoded)
    horizontal_edge_delta = max(abs(preview_bounds[0] - encoded_bounds[0]),
                                abs(preview_bounds[2] - encoded_bounds[2]))
    assert psnr >= 40, f"Preview/export PSNR too low: {psnr:.2f} dB"
    assert horizontal_edge_delta <= 3, f"Prism trace shifted horizontally by {horizontal_edge_delta} pixels"
    print(json.dumps({"status": "PASS", "rmse": round(rmse, 3),
                      "psnrDb": round(psnr, 2), "traceBoundsPreview": preview_bounds,
                      "traceBoundsEncoded": encoded_bounds,
                      "horizontalEdgeDeltaPx": horizontal_edge_delta}))


if __name__ == "__main__":
    main()
