"""Create a deterministic nine-second stereo WAV with three phase relationships."""
import math
import struct
import wave
from pathlib import Path

RATE = 48000
DURATION = 9
OUTPUT = Path(__file__).resolve().parents[1] / "artifacts" / "phase0" / "stereo-phases.wav"


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUTPUT), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        frames = bytearray()
        for sample in range(RATE * DURATION):
            left = int(0.72 * 32767 * math.sin(2 * math.pi * 440 * sample / RATE))
            segment = sample // (3 * RATE)
            right = (left, 0, -left)[segment]
            frames.extend(struct.pack("<hh", left, right))
        wav.writeframes(frames)
    print(OUTPUT)


if __name__ == "__main__":
    main()
