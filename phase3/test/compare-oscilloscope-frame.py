"""Compare a saved editor still with the exact numbered frame from an MP4."""
import json
import math
import subprocess
import sys
from pathlib import Path
from PIL import Image


REGIONS = {
    'spectrum': (80, 180, 840, 340),
    'pitchLocked': (80, 355, 840, 505),
    'freeRunning': (80, 515, 840, 670),
    'vectorscope': (910, 230, 1210, 530),
}


def psnr(first, second):
    squared = sum((a - b) ** 2 for a, b in zip(first.tobytes(), second.tobytes()))
    rmse = math.sqrt(squared / (first.width * first.height * 3))
    return 20 * math.log10(255 / rmse) if rmse else float('inf')


def wave_bounds(image):
    pixels = image.load()
    x_values, y_values = [], []
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue = pixels[x, y]
            if red < 150 and green > 180 and blue > 180 and green > red * 1.5:
                x_values.append(x)
                y_values.append(y)
    assert x_values, 'No oscilloscope trace in its own region'
    return min(x_values), max(x_values), min(y_values), max(y_values)


def main():
    preview_path = Path(sys.argv[1])
    video_path = Path(sys.argv[2])
    frame = int(sys.argv[3])
    output_path = Path(sys.argv[4])
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video_path), '-vf',
                    f'select=eq(n\\,{frame})', '-vsync', '0', '-frames:v', '1',
                    '-y', str(output_path)], check=True)
    preview = Image.open(preview_path).convert('RGB')
    encoded = Image.open(output_path).convert('RGB')
    assert preview.size == encoded.size == (1280, 720)
    overall = psnr(preview, encoded)
    local = {name: psnr(preview.crop(box), encoded.crop(box)) for name, box in REGIONS.items()}
    edges = {}
    for name in ('pitchLocked', 'freeRunning'):
        first = wave_bounds(preview.crop(REGIONS[name]))
        second = wave_bounds(encoded.crop(REGIONS[name]))
        edges[name] = max(abs(a - b) for a, b in zip(first, second))
    # Thin moving wave lines incur more H.264 pixel error than broad meter fills.
    # Check each layer and trace position as well as whole-frame fidelity.
    assert overall >= 36, f'Whole frame PSNR too low: {overall:.2f} dB'
    assert all(value >= 30 for value in local.values()), f'Layer fidelity too low: {local}'
    assert all(value <= 3 for value in edges.values()), f'Oscilloscope traces shifted: {edges}'
    print(json.dumps({'status': 'PASS', 'frame': frame, 'psnrDb': round(overall, 2),
                      'layerPsnrDb': {name: round(value, 2) for name, value in local.items()},
                      'oscilloscopeEdgeDeltaPx': edges}))


if __name__ == '__main__':
    main()
