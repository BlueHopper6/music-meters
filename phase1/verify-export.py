"""Verify a Phase 1 MP4's streams, duration, decodability, and audio content."""
import argparse
import array
import json
import math
import subprocess
from pathlib import Path


def invoke(*args):
    return subprocess.run(args, check=True, capture_output=True).stdout


def samples(path, rate):
    raw = invoke("ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0",
                 "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "2", "-ar", str(rate), "pipe:1")
    values = array.array("h")
    values.frombytes(raw)
    return values


def window(values, rate, center):
    start = round((center - 0.05) * rate)
    end = round((center + 0.05) * rate)
    region = values[start * 2:end * 2]
    return region[::2], region[1::2]


def rms(values):
    return math.sqrt(sum(float(value) ** 2 for value in values) / len(values)) / 32768


def correlation(a, b):
    numerator = sum(float(x) * y for x, y in zip(a, b))
    denominator = math.sqrt(sum(float(x) ** 2 for x in a) * sum(float(y) ** 2 for y in b))
    return numerator / denominator


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--size", default="1280x720")
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--mono", action="store_true")
    args = parser.parse_args()
    width, height = (int(value) for value in args.size.split("x"))
    metadata = json.loads(invoke(
        "ffprobe", "-v", "error", "-count_frames",
        "-show_entries", "stream=codec_name,codec_type,pix_fmt,width,height,avg_frame_rate,nb_read_frames,duration,sample_rate:format=duration",
        "-of", "json", str(args.output)))
    video = next(stream for stream in metadata["streams"] if stream["codec_type"] == "video")
    audio = next(stream for stream in metadata["streams"] if stream["codec_type"] == "audio")
    assert (video["codec_name"], video["pix_fmt"], video["width"], video["height"], video["avg_frame_rate"]) == (
        "h264", "yuv420p", width, height, "30/1")
    assert audio["codec_name"] == "aac"
    expected_frames = round(args.duration * 30)
    assert abs(int(video["nb_read_frames"]) - expected_frames) <= 1, video
    assert abs(float(metadata["format"]["duration"]) - args.duration) < 0.1, metadata["format"]
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(args.output), "-f", "null", "NUL"], check=True)

    rate = int(audio["sample_rate"])
    source = samples(args.input, rate)
    output = samples(args.output, rate)
    frame_difference = (len(output) - len(source)) / 2
    assert abs(frame_difference) <= rate * 0.05, frame_difference
    for section, time in enumerate((args.duration / 6, args.duration / 2, args.duration * 5 / 6)):
        source_l, source_r = window(source, rate, time)
        output_l, output_r = window(output, rate, time)
        left_match = correlation(source_l, output_l)
        assert left_match > 0.94, (time, left_match)
        if args.mono:
            channel_relation = correlation(output_l, output_r)
            assert channel_relation > 0.99, (time, channel_relation)
        elif section == 1:
            assert rms(output_r) < 0.01, (time, rms(output_r))
            channel_relation = 0
        else:
            channel_relation = correlation(output_l, output_r)
            assert channel_relation * (1 if section == 0 else -1) > 0.94, (time, channel_relation)
        print(f"{time:.2f}s: left source/output r={left_match:.5f}; L/R relation={channel_relation:.5f}; R RMS={rms(output_r):.5f}")
    print(json.dumps({"status": "PASS", "frames": int(video["nb_read_frames"]),
                      "duration": float(metadata["format"]["duration"]), "audioFrameDifference": frame_difference}))


if __name__ == "__main__":
    main()
