"""Compare each of eight meter regions in an editor still and numbered MP4 frame."""
import json
import math
import subprocess
import sys

from PIL import Image


def psnr(first, second):
    squared = sum((a - b) ** 2 for a, b in zip(first.tobytes(), second.tobytes()))
    rmse = math.sqrt(squared / (first.width * first.height * 3))
    return 20 * math.log10(255 / rmse) if rmse else float("inf")


def trace_pixels(image):
    return {(x, y) for y in range(image.height) for x in range(image.width)
            if (lambda r, g, b: r < 160 and g > 140 and b > 160)(*image.getpixel((x, y)))}


def nearby_fraction(source, target):
    if not source:
        return 1 if not target else 0
    return sum(any((x + dx, y + dy) in target for dx in (-1, 0, 1)
                   for dy in (-1, 0, 1)) for x, y in source) / len(source)


def main():
    still, video, frame, extracted = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf",
                    f"select=eq(n\\,{frame})", "-vsync", "0", "-frames:v", "1",
                    "-y", extracted], check=True)
    preview = Image.open(still).convert("RGB")
    encoded = Image.open(extracted).convert("RGB")
    assert preview.size == encoded.size == (1280, 720)
    names = ["vectorscope", "spectrum", "oscilloscope", "spectrogram",
             "waveform", "vu", "loudness", "waterfall"]
    regions = {}
    for index, name in enumerate(names):
        x, y = 20 + (index % 4) * 310, 160 + (index // 4) * 235
        box = (x, y, x + 300, y + 215)
        regions[name] = psnr(preview.crop(box), encoded.crop(box))
    overall = psnr(preview, encoded)
    osc_box = (640, 160, 940, 375)
    editor_trace = trace_pixels(preview.crop(osc_box))
    video_trace = trace_pixels(encoded.crop(osc_box))
    trace_overlap = min(nearby_fraction(editor_trace, video_trace),
                        nearby_fraction(video_trace, editor_trace))
    # CRF 20 costs more PSNR on the dense 1 kHz trace in a 300x215 meter.
    assert (overall >= 35 and all(value >= (29 if name == "oscilloscope" else 30)
                                  for name, value in regions.items()) and trace_overlap >= 0.90), \
        (overall, regions, trace_overlap)
    print(json.dumps({"status": "PASS", "frame": frame, "psnrDb": round(overall, 2),
                      "regionsDb": {name: round(value, 2) for name, value in regions.items()},
                      "oscilloscopeTraceWithinOnePixel": round(trace_overlap, 4)}))


if __name__ == "__main__":
    main()
