# Text to speech with Kokoro-82M (Apache-2.0), run by scripts/film/voices.mjs. Free and local: no account, no network.
# Usage: tools/tts/venv/bin/python scripts/film/tts.py <jobs.json>
# jobs.json: [{ "text", "voice", "speed", "out" (a .wav path) }]. Setup: docs/story/FILMING.md "Voices".
import json
import os
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tools', 'tts', 'models')
jobs = json.load(open(sys.argv[1]))
tts = Kokoro(os.path.join(ROOT, 'kokoro-v1.0.onnx'), os.path.join(ROOT, 'voices-v1.0.bin'))
for i, j in enumerate(jobs):
    lang = 'en-gb' if j['voice'].startswith('b') else 'en-us'
    audio, rate = tts.create(j['text'], voice=j['voice'], speed=float(j.get('speed', 1)), lang=lang)
    sf.write(j['out'], audio, rate)
    print(f"  {i + 1}/{len(jobs)} {j['voice']}: {j['text'][:60]}", flush=True)
