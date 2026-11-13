// 開発用：内蔵プリセットの各部の音量を、目標値（鳴っている間の dB）へ合わせ込む。
//   node tools/balance.mjs            目標との差を表示する
//   node tools/balance.mjs --write    合わせ込んだ音量を params.js に書き戻す
// 方針：土台（ドローンかノイズ）を -31〜-33 に置き、声・笛・鐘・反復はそれより下に沈める。
import { readFileSync, writeFileSync } from 'node:fs';
import { render, stats } from './render.mjs';
const { FACTORY, sanitize } = await import('../params.js');
const SR = 48000, KEY = { D: ['ドローン', 'droneLevel'], N: ['ノイズ', 'noiseLevel'], R: ['RES', 'resLevel'], A: ['ARP', 'arpLevel'],
  V: ['声', 'voiceLevel'], F: ['笛', 'fluteLevel'], B: ['鐘', 'bellLevel'] };
export const TARGET = {
  錬鉄: { D: -31, N: -44, R: -40 }, 潮: { N: -31, D: -37, R: -38 }, 夜雨: { N: -31, D: -38, R: -44 }, 焚火: { N: -31, D: -35, R: -44 },
  せせらぎ: { N: -32, D: -36, R: -44 }, 風穴: { N: -32, D: -35, R: -42 }, 沈降: { D: -32, A: -36, R: -40, N: -46 },
  囁き: { N: -33, D: -36, V: -40, R: -44 },
  賢者の石: { D: -30, R: -36 }, 倍音唱: { D: -31, N: -38, R: -44 }, 読経: { D: -32, V: -38, B: -42, R: -42, N: -50 },
  鐘楼: { D: -34, B: -36, R: -40, N: -44 }, 銅鑼: { D: -33, B: -36, R: -40, N: -48 }, 虚空: { D: -33, F: -39, R: -40, N: -46 },
  輪: { D: -33, A: -38, R: -38, N: -48 }, 無限階段: { D: -32, A: -38, R: -39, N: -46 },
  喫茶店: { N: -32, V: -39, D: -40, B: -47, R: -46 }, 遠い声: { D: -32, V: -41, R: -40, N: -42 },
  霧笛: { N: -33, F: -38, D: -38, B: -47, R: -44 }, 船室: { N: -32, D: -35, B: -48, R: -46 },
  彼方の笛: { D: -33, F: -41, R: -40, N: -46 }, 風鈴: { N: -33, B: -40, D: -38, R: -46 }, 空電: { N: -31, D: -37, V: -45, R: -48 },
  蓄音機: { N: -34, A: -36, D: -40 },
  電気嵐: { D: -31, N: -36, A: -37, F: -40, R: -40 }, ダブ: { D: -31, A: -36, B: -41, N: -40, R: -40 },
  交信: { D: -33, A: -36, N: -36, V: -40, R: -44 }, 帰還: { N: -31, D: -35, R: -38 },
};
const write = process.argv.includes('--write'), only = process.argv.slice(2).filter(a => !a.startsWith('--'));
let src = readFileSync(new URL('../params.js', import.meta.url), 'utf8');
for (const f of FACTORY) {
  const tg = TARGET[f.name];
  if (!tg || (only.length && !only.includes(f.name))) continue;
  const v = sanitize(f.p);
  let r, line;
  for (let it = 0; it < (write ? 5 : 1); it++) {
    r = render(v, f.seed, 200);
    line = [];
    for (const [k, t] of Object.entries(tg)) {
      const [nm, id] = KEY[k], m = r.parts[nm];
      if (!m) { line.push(`${nm} 鳴らず`); if (write) v[id] = Math.min(1, v[id] * 1.5 + 0.05); continue; }
      line.push(`${nm} ${m.on.toFixed(0)}→${t}`);
      if (write) v[id] = Math.min(1, Math.max(0.02, v[id] * Math.pow(10, (t - m.on) / 40)));
    }
  }
  const s = stats(r.L, r.R, SR * 5);
  console.log(f.name.padEnd(6), `全体 ${s.rms} 尖 ${s.peak} |`, line.join('  '), write ? '| ' + Object.entries(tg).map(([k]) => KEY[k][1].replace('Level', '') + ' ' + v[KEY[k][1]].toFixed(2)).join(' ') : '');
  if (write) {
    const m = new RegExp(`(name: '${f.name}', seed: \\d+,\\n    p: \\{)([\\s\\S]*?)(\\} \\},\\n)`).exec(src);
    let body = m[2];
    for (const [k] of Object.entries(tg)) {
      const id = KEY[k][1], re = new RegExp(`${id}: [0-9.]+`);
      if (!re.test(body)) throw new Error(f.name + ' に ' + id + ' が無い');
      body = body.replace(re, `${id}: ${+v[id].toFixed(2)}`);
    }
    src = src.slice(0, m.index) + m[1] + body + m[3] + src.slice(m.index + m[0].length);
  }
}
if (write) writeFileSync(new URL('../params.js', import.meta.url), src);
