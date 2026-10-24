"""Compare decoded raw video frames across two fixed-input exports."""
import subprocess
import sys


def framehash(path):
    data = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-map', '0:v:0',
                           '-f', 'framehash', '-hash', 'SHA256', '-'],
                          check=True, capture_output=True, text=True).stdout
    return [line.split(',')[-1].strip() for line in data.splitlines() if line and not line.startswith('#')]


first, second = map(framehash, sys.argv[1:3])
assert len(first) == len(second) == 300, (len(first), len(second))
assert first == second, 'Decoded video frames differ'
print('PASS: all 300 decoded video frame hashes match')
