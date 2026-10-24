"""Generate a local, original RGBA album-art fixture with transparent corners."""
from pathlib import Path
import math
import struct
import zlib

SIZE = 512


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def main():
    output = Path(__file__).resolve().parents[2] / 'artifacts' / 'phase4' / 'generated-cover.png'
    output.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for y in range(SIZE):
        row = bytearray([0])
        for x in range(SIZE):
            dx, dy = x - 255.5, y - 255.5
            radius = math.hypot(dx, dy)
            angle = math.atan2(dy, dx)
            if radius > 244:
                rgba = (0, 0, 0, 0)
            else:
                rings = math.sin(radius * 0.28) > 0.88
                spoke = math.sin(angle * 17 + radius * 0.045) > 0.94
                red = int(40 + 110 * (x / SIZE) + (55 if rings else 0))
                green = int(55 + 110 * (y / SIZE) + (50 if spoke else 0))
                blue = int(110 + 85 * (1 - radius / 350))
                rgba = (min(red, 255), min(green, 255), min(blue, 255), 255)
            row.extend(rgba)
        rows.append(bytes(row))
    raw = b''.join(rows)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    output.write_bytes(png)
    print(output)


if __name__ == '__main__':
    main()
