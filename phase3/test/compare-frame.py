"""Compare editor and export frames with separate geometry checks per meter region."""
import json
import math
import sys
from PIL import Image


def psnr(first, second):
    squared = sum((a - b) ** 2 for a, b in zip(first.tobytes(), second.tobytes()))
    rmse = math.sqrt(squared / (first.width * first.height * 3))
    return 20 * math.log10(255 / rmse) if rmse else float('inf')


def cyan_bounds(image):
    pixels = image.load()
    xs = []
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue = pixels[x, y]
            if red < 140 and green > 150 and blue > 140 and green > red * 1.5:
                xs.append(x)
    assert xs, 'No vectorscope trace in its own region'
    return min(xs), max(xs)


def main():
    preview = Image.open(sys.argv[1]).convert('RGB')
    encoded = Image.open(sys.argv[2]).convert('RGB')
    assert preview.size == encoded.size == (1280, 720)
    regions = {
        'upperSpectrum': (80, 185, 840, 385),
        'lowerSpectrum': (80, 415, 840, 615),
        'vectorscope': (910, 230, 1210, 530),
    }
    full = psnr(preview, encoded)
    local = {name: psnr(preview.crop(box), encoded.crop(box)) for name, box in regions.items()}
    first_bounds = cyan_bounds(preview.crop(regions['vectorscope']))
    second_bounds = cyan_bounds(encoded.crop(regions['vectorscope']))
    edge_delta = max(abs(a - b) for a, b in zip(first_bounds, second_bounds))
    assert full >= 40, f'Whole frame PSNR fell to {full:.2f} dB'
    assert all(value >= 32 for value in local.values()), f'Layer image fidelity too low: {local}'
    assert edge_delta <= 3, f'Vectorscope horizontal trace shifted by {edge_delta} pixels'
    print(json.dumps({'status': 'PASS', 'psnrDb': round(full, 2),
        'layerPsnrDb': {key: round(value, 2) for key, value in local.items()},
        'vectorscopeHorizontalEdgeDeltaPx': edge_delta}))


if __name__ == '__main__':
    main()
