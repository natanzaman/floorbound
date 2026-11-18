// Voice-overs for an episode: one audio file per `say` line, in a voice per cast member (free, local: Kokoro-82M via
// scripts/film/tts.py; setup in docs/story/FILMING.md "Voices"). The film and spectator views play a line's file when
// it's said (server/director.js names it in the chat event; public/audio.js plays it).
// Usage: node scripts/film/voices.mjs [sheet.yaml] [--voices <map.yaml>] [--force] [--samples <dir>]
//   sheet: default docs/story/ep1-first-line.yaml; the voice map defaults to ep<N>-voices.yaml next to it.
//   Writes public/voice/ep<N>/<key>.mp3 (+ manifest.json); unchanged lines are skipped, lines no longer in the sheet removed.
//   --samples <dir>: instead, a short sample per character in their voice and in each `try` voice, for picking voices.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { parseSheet, whoList, voiceDir, voiceKey } from '../../server/director-sheet.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = k => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const samples = opt('--samples'), voicesArg = opt('--voices'), force = flag('--force');
const sheetPath = path.resolve(args[0] || path.join(ROOT, 'docs/story/ep1-first-line.yaml'));

const r = parseSheet(fs.readFileSync(sheetPath, 'utf8'));
if (r.error) { console.error(`${sheetPath}: ${r.error}`); process.exit(1); }
const sheet = r.sheet, dir = voiceDir(sheet);
const mapPath = voicesArg ? path.resolve(voicesArg) : path.join(path.dirname(sheetPath), `${dir}-voices.yaml`);
const map = YAML.parse(fs.readFileSync(mapPath, 'utf8'))?.voices || {};
const cast = (sheet.cast || []).map(c => String(c.id));

// every line: who says what (a cue for several actors is one line each)
const lines = [];
for (const sc of sheet.scenes || []) for (const c of sc.cues || []) {
  if (c?.do !== 'say' || !String(c.text ?? '').trim()) continue;
  const who = whoList(c.who).flatMap(w => (w === 'all' ? cast : [w])).filter(w => cast.includes(w));
  for (const id of who) lines.push({ id, text: String(c.text).slice(0, 200).trim() });
}
const settings = v => ({ voice: String(v.voice), speed: +(v.speed ?? 1), pitch: +(v.pitch ?? 0) });
const missing = [...new Set(lines.map(l => l.id))].filter(id => !map[id]?.voice);
if (missing.length) { console.error(`${mapPath}: no voice for ${missing.join(', ')}`); process.exit(1); }

const PY = path.join(ROOT, 'tools/tts/venv/bin/python');
if (!fs.existsSync(PY) || !fs.existsSync(path.join(ROOT, 'tools/tts/models/voices-v1.0.bin'))) {
  console.error('Kokoro is not set up: see docs/story/FILMING.md "Voices" (a venv and two model files in tools/tts/).'); process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-voices-'));
// synthesise [{ text, voice, speed, pitch, out (.mp3) }]: Kokoro to wav, then ffmpeg to a small mono mp3 (pitch-shifted)
function render(jobs) {
  if (!jobs.length) return;
  const wavs = jobs.map((j, i) => ({ ...j, out: path.join(tmp, `${i}.wav`), mp3: j.out }));
  fs.writeFileSync(path.join(tmp, 'jobs.json'), JSON.stringify(wavs));
  execFileSync(PY, [path.join(ROOT, 'scripts/film/tts.py'), path.join(tmp, 'jobs.json')], { stdio: 'inherit' });
  for (const j of wavs) {
    const f = 2 ** (j.pitch / 12); // lower the pitch, keep the pace
    const af = j.pitch ? [`asetrate=24000*${f.toFixed(4)}`, 'aresample=24000', `atempo=${(1 / f).toFixed(4)}`] : [];
    af.push('silenceremove=start_periods=1:start_threshold=-50dB', 'loudnorm=I=-16:TP=-1.5');
    fs.mkdirSync(path.dirname(j.mp3), { recursive: true });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', j.out, '-af', af.join(','), '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '64k', j.mp3]);
  }
}

if (samples) { // a sample per character, in their voice and each `try` voice
  const out = path.resolve(samples.replace(/^~/, os.homedir()));
  const jobs = [];
  for (const [id, v] of Object.entries(map)) {
    const text = v.sample || lines.filter(l => l.id === id).slice(0, 2).map(l => l.text).join(' ');
    if (!text) continue;
    for (const voice of [v.voice, ...(v.try || [])]) {
      const s = settings({ ...v, voice });
      jobs.push({ text, ...s, out: path.join(out, `${id}${voice === v.voice ? '' : '-alt'}-${voice}.mp3`) });
    }
  }
  render(jobs);
  console.log(`${jobs.length} samples in ${out}`);
} else {
  const outDir = path.join(ROOT, 'public/voice', dir), manPath = path.join(outDir, 'manifest.json');
  const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : {};
  const next = {}, jobs = [];
  for (const l of lines) {
    const key = voiceKey(l.id, l.text), s = settings(map[l.id]), file = path.join(outDir, `${key}.mp3`);
    next[key] = { who: l.id, text: l.text, ...s };
    const same = JSON.stringify(man[key]) === JSON.stringify(next[key]);
    if (!force && same && fs.existsSync(file)) continue;
    if (!jobs.some(j => j.out === file)) jobs.push({ text: l.text, ...s, out: file });
  }
  render(jobs);
  let gone = 0;
  if (fs.existsSync(outDir)) for (const f of fs.readdirSync(outDir)) if (f.endsWith('.mp3') && !next[f.slice(0, -4)]) { fs.unlinkSync(path.join(outDir, f)); gone++; }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(manPath, JSON.stringify(next, null, 1) + '\n');
  console.log(`${Object.keys(next).length} lines: ${jobs.length} made, ${Object.keys(next).length - jobs.length} unchanged, ${gone} removed -> ${path.relative(ROOT, outDir)}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
