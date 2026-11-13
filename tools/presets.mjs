// 開発用：内蔵プリセットを点検する。
//   node tools/presets.mjs [名 ...]
// ・縦フェーダーの並びを高い順に示し、混ぜ方の規則を確かめる
//   （高い位置の部が一本きりでないこと。ほぼ同じ高さを並べる型は別に認める）
// ・書き出して、全体の音量、尖頭、各部が鳴っている間の音量を測る
import { render, stats } from './render.mjs';
const { FACTORY, sanitize } = await import('../params.js');
const SR = 48000, only = process.argv.slice(2);
const PART = [['ドローン', 'droneLevel'], ['ノイズ', 'noiseLevel'], ['RES', 'resLevel'], ['ARP', 'arpLevel'], ['声', 'voiceLevel'], ['笛', 'fluteLevel'], ['鐘', 'bellLevel']];
let lo = 0, hi = -99;
for (const f of FACTORY) {
  if (only.length && !only.includes(f.name)) continue;
  const v = sanitize(f.p);
  const fad = PART.map(([nm, id]) => [nm, v[id]]).filter(x => x[1] > 0.005).sort((a, b) => b[1] - a[1]);
  const top = fad[0][1], mains = fad.filter(x => x[1] >= 0.65).length, flat = top - fad[Math.min(fad.length - 1, 2)][1] <= 0.2;
  const rule = mains >= 2 ? `主役 ${mains} 本` : flat ? '横並び' : '★主役が一本きり';
  const r = render(v, f.seed, 200), s = stats(r.L, r.R, SR * 5);
  lo = Math.min(lo, +s.rms); hi = Math.max(hi, +s.rms);
  console.log(`${f.cat} ${f.name}`.padEnd(11), `全体 ${s.rms} 尖 ${s.peak} 抑え ${r.lim.avg}/${r.lim.max}${s.bad ? ' 無効' + s.bad : ''} | ${rule} |`,
    fad.map(([nm, x]) => `${nm} ${Math.round(x * 100)}${r.parts[nm] ? '(' + r.parts[nm].on.toFixed(0) + ')' : '(鳴らず)'}`).join('  '));
}
console.log(`全体の音量の幅 ${lo}〜${hi} dB`);
