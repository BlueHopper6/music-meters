"""Verify the MP4 gate and independently measure decoded audio with FFmpeg EBU R128."""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def ebur128(path):
    result = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
                             "-filter_complex", "ebur128=peak=true", "-f", "null", "NUL"],
                            capture_output=True, text=True, check=True)
    summary = result.stderr.split("Summary:")[-1]
    integrated = re.search(r"Integrated loudness:\s*I:\s*([-+\d.]+) LUFS", summary)
    peak = re.search(r"True peak:\s*Peak:\s*([-+\d.]+) dBFS", summary)
    assert integrated and peak, "FFmpeg did not return a loudness and true-peak summary"
    return float(integrated.group(1)), float(peak.group(1))


def main():
    source, output = map(Path, sys.argv[1:3])
    resolution = sys.argv[3] if len(sys.argv) > 3 else "1280x720"
    audio_gate = subprocess.run([sys.executable, str(ROOT / "phase3" / "test" / "verify-vu-export.py"),
                                 str(source), str(output), resolution],
                                check=True, capture_output=True, text=True)
    source_lufs, source_peak = ebur128(source)
    output_lufs, output_peak = ebur128(output)
    assert abs(source_lufs + 20.4) < .3 and abs(source_peak + .3) < .4
    assert abs(output_lufs - source_lufs) < .3
    assert abs(output_peak - source_peak) < .7
    print(json.dumps({"status": "PASS", "audioGate": json.loads(audio_gate.stdout),
                      "sourceLufs": source_lufs, "outputLufs": output_lufs,
                      "sourceTruePeakDb": source_peak, "outputTruePeakDb": output_peak}))


if __name__ == "__main__":
    main()
