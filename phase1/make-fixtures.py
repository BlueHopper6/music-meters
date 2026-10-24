"""Stream synthetic stereo and mono WAV fixtures to disk without large buffers."""
import math
import struct
import subprocess
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "artifacts" / "phase1" / "fixtures"


def make_wav(name, rate, duration, channels):
    path = DEST / name
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        for second in range(duration):
            data = bytearray()
            for offset in range(rate):
                frame = second * rate + offset
                left = int(0.72 * 32767 * math.sin(2 * math.pi * 440 * frame / rate))
                if channels == 1:
                    data.extend(struct.pack("<h", left))
                else:
                    section = min(2, (frame * 3) // (rate * duration))
                    right = (left, 0, -left)[section]
                    data.extend(struct.pack("<hh", left, right))
            wav.writeframes(data)
    print(path)
    return path


def convert(source, name, codec_args):
    output = DEST / name
    subprocess.run(["ffmpeg", "-v", "error", "-n", "-i", str(source), *codec_args, str(output)], check=True)
    print(output)


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    stereo = make_wav("stereo-10s-48k.wav", 48000, 10, 2)
    make_wav("mono-10s-44k.wav", 44100, 10, 1)
    make_wav("stereo-180s-48k.wav", 48000, 180, 2)
    convert(stereo, "stereo-10s-48k.flac", ["-c:a", "flac"])
    convert(stereo, "stereo-10s-48k.mp3", ["-c:a", "libmp3lame", "-q:a", "2"])


if __name__ == "__main__":
    main()
