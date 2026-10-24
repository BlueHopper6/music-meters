"""Verify a spectrum fixture export, including audio sections and MP4 metadata."""
import array
import json
import math
import subprocess
import sys
from pathlib import Path


def invoke(*args):
    return subprocess.run(args, check=True, capture_output=True).stdout


def audio_samples(path):
    raw = invoke('ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0',
                 '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '2', '-ar', '48000', 'pipe:1')
    values = array.array('h')
    values.frombytes(raw)
    return values


def window(values, second):
    start = round((second - 0.05) * 48000) * 2
    end = round((second + 0.05) * 48000) * 2
    region = values[start:end]
    return region[::2], region[1::2]


def rms(values):
    return math.sqrt(sum(float(value) ** 2 for value in values) / len(values)) / 32768


def correlation(left, right):
    numerator = sum(float(a) * b for a, b in zip(left, right))
    denominator = math.sqrt(sum(float(a) ** 2 for a in left) * sum(float(b) ** 2 for b in right))
    return numerator / denominator


def main():
    source, output = map(Path, sys.argv[1:3])
    width, height = map(int, (sys.argv[3] if len(sys.argv) > 3 else '1280x720').split('x'))
    metadata = json.loads(invoke('ffprobe', '-v', 'error', '-count_frames',
        '-show_entries', 'stream=codec_name,codec_type,pix_fmt,width,height,avg_frame_rate,nb_read_frames,sample_rate:format=duration',
        '-of', 'json', str(output)))
    video = next(item for item in metadata['streams'] if item['codec_type'] == 'video')
    audio = next(item for item in metadata['streams'] if item['codec_type'] == 'audio')
    assert (video['codec_name'], video['pix_fmt'], video['width'], video['height'], video['avg_frame_rate']) == (
        'h264', 'yuv420p', width, height, '30/1')
    assert int(video['nb_read_frames']) == 300
    assert audio['codec_name'] == 'aac'
    assert abs(float(metadata['format']['duration']) - 10) < 0.1
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(output), '-f', 'null', '-'], check=True)
    original = audio_samples(source)
    rendered = audio_samples(output)
    padding = (len(rendered) - len(original)) / 2
    assert abs(padding) < 2400
    silent_l, silent_r = window(rendered, 1)
    assert rms(silent_l) < 0.01 and rms(silent_r) < 0.01
    sections = {}
    for second, relationship in [(3, 'in-phase'), (5, 'anti-phase'), (7, 'left-only'), (9, 'in-phase')]:
        source_l, source_r = window(original, second)
        output_l, output_r = window(rendered, second)
        left_match = correlation(source_l, output_l)
        assert left_match > 0.98, (second, left_match)
        if relationship == 'left-only':
            assert rms(output_r) < 0.01
            channel_relation = 0
        else:
            channel_relation = correlation(output_l, output_r)
            assert channel_relation > 0.98 if relationship == 'in-phase' else channel_relation < -0.98
            assert correlation(source_r, output_r) > 0.98
        sections[str(second)] = {'sourceOutputCorrelation': round(left_match, 5),
                                 'channelRelation': round(channel_relation, 5)}
    print(json.dumps({'status': 'PASS', 'frames': int(video['nb_read_frames']),
        'duration': float(metadata['format']['duration']), 'audioPaddingFrames': padding,
        'silenceRms': round(rms(silent_l), 6), 'sections': sections}))


if __name__ == '__main__':
    main()
