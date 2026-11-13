"""Reproduce the original public-domain-style instrumental (no third-party samples)."""
import math
import struct
import wave
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
    wav = Path(tmp) / 'interlude.wav'
    with wave.open(str(wav), 'wb') as w:
        w.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
        for block in range(60):
            data = bytearray()
            for i in range(24000):
                t = block + i / 24000
                fade = min(1, t / 3, (60 - t) / 3)
                tones = sum(math.sin(2 * math.pi * f * t) * math.sin(math.pi * (t % 12) / 12) ** 2
                            for f in [130.8128, 196, 261.6256, 329.6276])
                data.extend(struct.pack('<h', int(1100 * fade * tones)))
            w.writeframes(data)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-codec:a', 'libmp3lame',
                    '-b:a', '48k', str(root / 'public/assets/interlude.mp3')], check=True)
