// 開発用：発音部をブラウザ抜きで回し、WAV に書き出して音量と処理速度を測る。
//   node tools/render.mjs <プリセット名|-> <秒> [出力.wav] [id=値 ...]
import { writeFileSync } from 'node:fs';
const SR = 48000;
globalThis.sampleRate = SR;
let Proc;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
globalThis.registerProcessor = (_, c) => { Proc = c; };
const { FACTORY, sanitize, BY_ID } = await import('../params.js');
await import('../engine.js');

export function render(values, seed, secs, hook) {
  const p = new Proc();
  p.port.onmessage({ data: { type: 'seed', seed } });
  p.port.onmessage({ data: { values, snap: true } });
  const blocks = Math.ceil(secs * SR / 128), L = new Float32Array(blocks * 128), R = new Float32Array(blocks * 128);
  const t0 = performance.now();
  for (let b = 0; b < blocks; b++) {
    if (hook) hook(p, b * 128 / SR);
    p.process([], [[L.subarray(b * 128, b * 128 + 128), R.subarray(b * 128, b * 128 + 128)]]);
  }
  return { L, R, speed: secs / ((performance.now() - t0) / 1000) };
}
export function stats(L, R, from = 0) {
  let s = 0, pk = 0, bad = 0, c = 0, sl = 0, sr = 0;
  for (let i = from; i < L.length; i++) {
    const l = L[i], r = R[i];
    if (!isFinite(l) || !isFinite(r)) bad++;
    s += l * l + r * r; pk = Math.max(pk, Math.abs(l), Math.abs(r)); c += l * r; sl += l * l; sr += r * r;
  }
  const db = x => (20 * Math.log10(x + 1e-12)).toFixed(1);
  return { rms: db(Math.sqrt(s / (2 * (L.length - from)))), peak: db(pk), corr: (c / Math.sqrt(sl * sr + 1e-20)).toFixed(2), bad };
}
export function wav(path, L, R) {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28);
  b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(path, b);
}
export function preset(name, extra = {}) {
  const f = FACTORY.find(x => x.name === name) || { seed: 1, p: {} };
  return { values: sanitize({ ...f.p, ...extra }), seed: f.seed };
}

if (process.argv[1].endsWith('render.mjs')) {
  const [name = '-', secs = '20', out, ...kv] = process.argv.slice(2);
  const extra = {};
  for (const s of kv) { const [k, v] = s.split('='); extra[k] = BY_ID[k].type === 'sel' ? v : +v; }
  const { values, seed } = preset(name, extra);
  const r = render(values, seed, +secs);
  console.log(name, stats(r.L, r.R, SR * 3), '実時間比 ×' + r.speed.toFixed(0));
  if (out) wav(out, r.L, r.R);
}
