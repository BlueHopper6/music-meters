"""Generate a deterministic ten-second stereo spectrum test signal."""
import math
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'artifacts' / 'phase3' / 'spectrum-10s-48k.wav'
RATE = 48000


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUTPUT), 'wb') as stream:
        stream.setnchannels(2)
        stream.setsampwidth(2)
        stream.setframerate(RATE)
        for second in range(10):
            block = bytearray()
            for offset in range(RATE):
                frame = second * RATE + offset
                tone = 0 if second < 2 else int(0.5 * 32767 * math.sin(
                    2 * math.pi * (1000 if second >= 8 else 440) * frame / RATE))
                right = -tone if 4 <= second < 6 else 0 if 6 <= second < 8 else tone
                block.extend(struct.pack('<hh', tone, right))
            stream.writeframes(block)
    print(OUTPUT)


if __name__ == '__main__':
    main()
