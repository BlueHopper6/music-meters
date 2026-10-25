"""Inspect decoded Phase 5 video and compare its audio with both generated songs."""
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def decode(path):
    result = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0',
                             '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'],
                            check=True, capture_output=True)
    return np.frombuffer(result.stdout, dtype='<f4').astype(np.float64)


def best_correlation(source, output):
    start, count, limit = 48000, 8192, 512
    reference = source[start:start + count]
    norm = np.linalg.norm(reference)
    scores = []
    for lag in range(-limit, limit + 1):
        candidate = output[start + lag:start + lag + count]
        scores.append(float(np.dot(reference, candidate) / (norm * np.linalg.norm(candidate))))
    return max(scores)


def tone_amplitude(signal, frequency):
    section = signal[48000:96000]
    phase = np.arange(len(section)) * (2 * np.pi * frequency / 48000)
    return float(abs(np.dot(section, np.exp(-1j * phase))) / len(section) * 2)


def frame_hashes(path):
    result = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:v:0',
                             '-f', 'framehash', '-hash', 'SHA256', '-'],
                            check=True, capture_output=True, text=True)
    return [line.split(',')[-1].strip() for line in result.stdout.splitlines()
            if line and not line.startswith('#')]


def main(directory):
    video = directory / 'song-B-1080p.mp4'
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
                            'stream=codec_name,width,height,avg_frame_rate,nb_frames,sample_rate,channels',
                            '-show_entries', 'format=duration', '-of', 'json', str(video)],
                           check=True, capture_output=True, text=True)
    metadata = json.loads(probe.stdout)
    streams = metadata['streams']
    assert streams[0]['codec_name'] == 'h264' and streams[0]['width'] == 1920
    assert streams[0]['height'] == 1080 and streams[0]['avg_frame_rate'] == '30/1'
    assert streams[0]['nb_frames'] == '120'
    assert streams[1]['codec_name'] == 'aac' and streams[1]['sample_rate'] == '48000'
    assert streams[1]['channels'] == 2
    assert abs(float(metadata['format']['duration']) - 4) < 0.01
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video), '-f', 'null', 'NUL'], check=True)
    source_a, source_b, output = [decode(directory / name) for name in
                                  ('song-A-440.wav', 'song-B-880.wav', 'song-B-1080p.mp4')]
    correlation_b = best_correlation(source_b, output)
    correlation_a = best_correlation(source_a, output)
    amplitude_440, amplitude_880 = tone_amplitude(output, 440), tone_amplitude(output, 880)
    assert correlation_b > 0.99, correlation_b
    assert abs(correlation_a) < 0.1, correlation_a
    assert amplitude_880 > 30 * amplitude_440, (amplitude_440, amplitude_880)
    preview = np.asarray(Image.open(directory / 'song-B-preview.png').convert('RGB'), dtype=np.float64)
    frame = Image.open(directory / 'song-B-frame-60.png').convert('RGB').resize((1280, 720), Image.Resampling.LANCZOS)
    encoded = np.asarray(frame, dtype=np.float64)
    mse = float(np.mean((preview - encoded) ** 2))
    psnr = 10 * math.log10(255 ** 2 / mse)
    regions = {}
    for name, (x0, y0, x1, y1) in {
        'artwork': (50, 40, 230, 215), 'oscilloscope': (300, 230, 930, 440),
        'spectrum': (75, 475, 1230, 675), 'background': (1080, 30, 1250, 190)
    }.items():
        region_mse = float(np.mean((preview[y0:y1, x0:x1] - encoded[y0:y1, x0:x1]) ** 2))
        regions[name] = round(10 * math.log10(255 ** 2 / region_mse), 2)
    assert psnr > 28, (psnr, regions)
    repeat = directory / 'song-B-repeat-1080p.mp4'
    matched_frames = None
    if repeat.exists():
        original_hashes, repeated_hashes = frame_hashes(video), frame_hashes(repeat)
        assert len(original_hashes) == len(repeated_hashes) == 120
        assert original_hashes == repeated_hashes, 'Repeated decoded frames differ'
        matched_frames = 120
    result = {'status': 'PASS', 'frames': 120, 'resolution': '1920x1080', 'fps': 30,
              'durationSeconds': float(metadata['format']['duration']),
              'audioCorrelationWithSongB': round(correlation_b, 6),
              'audioCorrelationWithSongA': round(correlation_a, 6),
              'decodedAudioTone440': round(amplitude_440, 6),
              'decodedAudioTone880': round(amplitude_880, 6),
              'previewVsDownscaledVideoPsnrDb': round(psnr, 2), 'regionPsnrDb': regions,
              'deterministicRepeatMatchedFrames': matched_frames}
    (directory / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main(Path(sys.argv[1]).resolve())
