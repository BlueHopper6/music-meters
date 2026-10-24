"""Compare the shared editor painter against a numbered lossy MP4 frame."""
import json
import math
import subprocess
import sys

from PIL import Image


def psnr(a, b):
    left, right = a.convert('RGB').tobytes(), b.convert('RGB').tobytes()
    mse = sum((x - y) ** 2 for x, y in zip(left, right)) / len(left)
    return 10 * math.log10(255 * 255 / mse) if mse else float('inf')


def main():
    still, video, number, extracted = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    subprocess.run(['ffmpeg', '-v', 'error', '-i', video, '-vf', f'select=eq(n\\,{number})',
                    '-vsync', '0', '-frames:v', '1', '-y', extracted], check=True)
    preview = Image.open(still).convert('RGB')
    encoded = Image.open(extracted).convert('RGB')
    assert preview.size == encoded.size == (1280, 720)
    boxes = {'title': (65, 45, 810, 140), 'artwork_overlap': (75, 225, 470, 550),
             'vectorscope': (300, 224, 730, 554), 'oscilloscope': (740, 245, 1205, 505),
             'spectrum': (175, 530, 1105, 700)}
    regions = {name: round(psnr(preview.crop(box), encoded.crop(box)), 2)
               for name, box in boxes.items()}
    overall = round(psnr(preview, encoded), 2)
    assert overall >= 35, (overall, regions)
    assert all(value >= 30 for value in regions.values()), regions
    print(json.dumps({'status': 'PASS', 'frame': number, 'overallPsnr': overall,
                      'regionPsnr': regions}))


if __name__ == '__main__':
    main()
