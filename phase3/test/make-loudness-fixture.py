"""Ten-second stereo fixture for BS.1770 loudness and intersample true peak."""
import math
import struct
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TONE_AMPLITUDE = 10 ** (-23 / 20) * math.sqrt(2)
RATE_NAMES = {44100: "44k1", 48000: "48k", 96000: "96k"}


def main():
    rate = int(sys.argv[1]) if len(sys.argv) > 1 else 48000
    if rate not in RATE_NAMES:
        raise ValueError("Choose 44100, 48000, or 96000 Hz")
    output = ROOT / "artifacts" / "phase3" / f"loudness-10s-{RATE_NAMES[rate]}.wav"
    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as stream:
        stream.setnchannels(2)
        stream.setsampwidth(2)
        stream.setframerate(rate)
        for second in range(10):
            block = bytearray()
            for offset in range(rate):
                frame = second * rate + offset
                tone = 0 if second < 2 or second >= 8 else int(
                    TONE_AMPLITUDE * 32767 * math.sin(2 * math.pi * 1000 * frame / rate))
                if 8.10 * rate <= frame < 8.105 * rate:
                    tone = int(0.95 * 32767 * math.sin(2 * math.pi * 12000 * frame / rate + math.pi / 4))
                right = -tone if 4 <= second < 6 else 0 if 6 <= second < 8 else tone
                block.extend(struct.pack("<hh", tone, right))
            stream.writeframes(block)
    print(output)


if __name__ == "__main__":
    main()
