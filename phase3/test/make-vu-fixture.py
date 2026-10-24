"""Ten-second 48 kHz stereo fixture for calibrated VU and peak ballistics."""
import math
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "artifacts" / "phase3" / "vu-10s-48k.wav"
RATE = 48000
# A sine with this amplitude has -14 dBFS RMS after the 300 ms VU window settles.
SINE_AMPLITUDE = 10 ** (-14 / 20) * math.sqrt(2)


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUTPUT), "wb") as stream:
        stream.setnchannels(2)
        stream.setsampwidth(2)
        stream.setframerate(RATE)
        for second in range(10):
            block = bytearray()
            for offset in range(RATE):
                frame = second * RATE + offset
                tone = 0 if second < 2 or second >= 8 else int(
                    SINE_AMPLITUDE * 32767 * math.sin(2 * math.pi * 1000 * frame / RATE))
                if 8.10 * RATE <= frame < 8.105 * RATE:
                    tone = 31000
                right = -tone if 4 <= second < 6 else 0 if 6 <= second < 8 else tone
                block.extend(struct.pack("<hh", tone, right))
            stream.writeframes(block)
    print(OUTPUT)


if __name__ == "__main__":
    main()
