"""Verify VU fixture MP4 streams, full decode, and stereo source audio."""
import array
import json
import math
import subprocess
import sys
from pathlib import Path


def invoke(*args):
    return subprocess.run(args, check=True, capture_output=True).stdout


def samples(path):
    raw = invoke("ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0",
                 "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "2", "-ar", "48000", "pipe:1")
    values = array.array("h")
    values.frombytes(raw)
    return values


def window(values, second, width=0.05):
    start = round((second - width) * 48000) * 2
    end = round((second + width) * 48000) * 2
    return values[start:end:2], values[start + 1:end:2]


def rms(values):
    return math.sqrt(sum(float(value) ** 2 for value in values) / len(values)) / 32768


def correlation(a, b):
    num = sum(float(x) * y for x, y in zip(a, b))
    den = math.sqrt(sum(float(x) ** 2 for x in a) * sum(float(y) ** 2 for y in b))
    return num / den


def main():
    source, output = map(Path, sys.argv[1:3])
    width, height = map(int, (sys.argv[3] if len(sys.argv) > 3 else "1280x720").split("x"))
    metadata = json.loads(invoke("ffprobe", "-v", "error", "-count_frames", "-show_entries",
        "stream=codec_name,codec_type,pix_fmt,width,height,avg_frame_rate,nb_read_frames:format=duration",
        "-of", "json", str(output)))
    video = next(item for item in metadata["streams"] if item["codec_type"] == "video")
    audio = next(item for item in metadata["streams"] if item["codec_type"] == "audio")
    assert (video["codec_name"], video["pix_fmt"], video["width"], video["height"], video["avg_frame_rate"]) == (
        "h264", "yuv420p", width, height, "30/1")
    assert int(video["nb_read_frames"]) == 300
    assert audio["codec_name"] == "aac"
    assert abs(float(metadata["format"]["duration"]) - 10) < 0.1
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(output), "-f", "null", "-"], check=True)
    original, rendered = samples(source), samples(output)
    assert abs((len(rendered) - len(original)) / 2) < 2400
    sections = {}
    for second in (3, 5, 7):
        src_l, src_r = window(original, second)
        out_l, out_r = window(rendered, second)
        assert correlation(src_l, out_l) > .98
        if second == 7:
            assert rms(out_r) < .01
            relation = 0
        else:
            assert correlation(src_r, out_r) > .98
            relation = correlation(out_l, out_r)
            assert relation > .98 if second == 3 else relation < -.98
        sections[second] = round(relation, 5)
    silent_l, silent_r = window(rendered, 9.5)
    assert rms(silent_l) < .01 and rms(silent_r) < .01
    pulse_l, pulse_r = window(rendered, 8.102, .002)
    assert rms(pulse_l) > .2 and rms(pulse_r) > .2
    print(json.dumps({"status": "PASS", "frames": 300, "duration": 10,
                      "relations": sections, "pulseRms": round(rms(pulse_l), 4)}))


if __name__ == "__main__":
    main()
