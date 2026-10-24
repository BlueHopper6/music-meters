"""Ten-second stereo fixture for waveform peaks, channel lanes, and band colors."""
import math
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "artifacts" / "phase3" / "waveform-10s-48k.wav"
RATE = 48000


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
                frequency = 5000 if second >= 8 else 100
                tone = 0 if second < 2 else int(0.50 * 32767 * math.sin(2 * math.pi * frequency * frame / RATE))
                if 8.10 * RATE <= frame < 8.105 * RATE:
                    tone = 32000
                right = -tone if 4 <= second < 6 else 0 if 6 <= second < 8 else tone
                block.extend(struct.pack("<hh", tone, right))
            stream.writeframes(block)
    print(OUTPUT)


if __name__ == "__main__":
    main()
