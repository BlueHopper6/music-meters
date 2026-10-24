"""Check decoded AAC against the generated WAV and segment change times."""
import array
import math
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "artifacts" / "phase0" / "stereo-phases.wav"
VIDEO = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "artifacts" / "phase0" / "stereo-phases.mp4"
RATE = 48000


def channels(samples, start, duration):
    start_frame = round(start * RATE)
    end_frame = round((start + duration) * RATE)
    region = samples[start_frame * 2:end_frame * 2]
    return region[::2], region[1::2]


def rms(samples):
    return math.sqrt(sum(float(value) ** 2 for value in samples) / len(samples)) / 32768


def correlation(a, b):
    numerator = sum(float(x) * y for x, y in zip(a, b))
    denominator = math.sqrt(sum(float(x) ** 2 for x in a) * sum(float(y) ** 2 for y in b))
    return numerator / denominator


with wave.open(str(SOURCE), "rb") as wav:
    assert (wav.getnchannels(), wav.getframerate(), wav.getsampwidth()) == (2, RATE, 2)
    source = array.array("h", wav.readframes(wav.getnframes()))

decoded = subprocess.run(
    ["ffmpeg", "-v", "error", "-i", str(VIDEO), "-f", "s16le", "-acodec", "pcm_s16le",
     "-ac", "2", "-ar", str(RATE), "pipe:1"],
    check=True, capture_output=True,
)
output = array.array("h", decoded.stdout)
trailing_frames = (len(output) - len(source)) // 2
assert len(output) % 2 == 0 and 0 <= trailing_frames <= 1024, (len(output), len(source))
output = output[:len(source)]
print(f"AAC decoder trailing padding: {trailing_frames} frames ({trailing_frames / RATE * 1000:.3f} ms)")

for time, phase in [(1.5, "in phase"), (4.5, "left only"), (7.5, "anti phase")]:
    src_l, src_r = channels(source, time, 0.1)
    out_l, out_r = channels(output, time, 0.1)
    left_similarity = correlation(src_l, out_l)
    assert left_similarity > 0.98, (time, left_similarity)
    right_level = rms(out_r)
    if phase == "left only":
        assert right_level < 0.005, (time, right_level)
    else:
        assert correlation(src_r, out_r) > 0.98
        expected_phase = 1 if phase == "in phase" else -1
        assert correlation(out_l, out_r) * expected_phase > 0.98
    print(f"{time:.1f}s {phase}: left source/output r={left_similarity:.6f}, right RMS={right_level:.6f}")

for start, expected_active in [(2.90, True), (3.03, False), (5.90, False), (6.03, True)]:
    _, right = channels(output, start, 0.07)
    level = rms(right)
    assert (level > 0.3) == expected_active, (start, level)
    print(f"{start:.2f}s right RMS={level:.6f}, expected {'active' if expected_active else 'quiet'}")

print("PASS: decoded AAC content and phase changes align within 30 ms of the fixture")
