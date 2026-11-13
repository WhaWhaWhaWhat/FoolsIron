// 開発用：内蔵プリセットの縦フェーダー（各部の音量）と全体の音量を揃える。
//   node tools/balance.mjs            今の状態を測って表示する
//   node tools/balance.mjs --write    フェーダーとトリムを params.js に書き戻す
//
// 方針：どの種でも、フェーダーは役割に応じた狭い幅に置く。一本だけ突き出させない。
//       種を渡っても各部の音量が大きく跳ばぬよう、種ごとの差は役割の差（最大 2dB 余り）に留める。
//       全体の音量は、フェーダーには触れず出口のトリムで LOUD(dB) に揃える。尖頭は PEAK(dB) を越えさせない。
import { readFileSync, writeFileSync } from 'node:fs';
import { render, stats } from './render.mjs';
const { FACTORY, sanitize } = await import('../params.js');
const SR = 48000, LOUD = -23, PEAK = -3;
const KEY = { D: ['ドローン', 'droneLevel'], N: ['ノイズ', 'noiseLevel'], R: ['RES', 'resLevel'], A: ['ARP', 'arpLevel'],
  V: ['声', 'voiceLevel'], F: ['笛', 'fluteLevel'], B: ['鐘', 'bellLevel'] };
// 役割 → フェーダーの位置。b=土台 s=支え h=霞 e=出来事 f=かすかな出来事
const FADER = { b: 0.52, s: 0.45, h: 0.40, e: 0.45, f: 0.40 };
export const ROLE = {
  薄明: null,                                   // 利用者の一枚。フェーダーには触れず、トリムのみ
  錬鉄: 'Db Rs Nh', 潮: 'Nb Ds Rs', 夜雨: 'Nb Ds Rh', 焚火: 'Nb Ds Rh', せせらぎ: 'Nb Ds Rh', 風穴: 'Nb Ds Rs',
  沈降: 'Db Ae Rs Nh', 囁き: 'Nb Ds Ve Rh',
  賢者の石: 'Db Rs', 倍音唱: 'Db Ns Rh', 読経: 'Db Ve Bf Rs Nh', 鐘楼: 'Db Be Rs Nh', 銅鑼: 'Db Be Rs Nh',
  虚空: 'Db Fe Rs Nh', 輪: 'Db Ae Rs Nh', 無限階段: 'Db Ae Rs Nh',
  喫茶店: 'Nb Ve Dh Bf Rh', 遠い声: 'Db Ve Rs Nh', 霧笛: 'Nb Fe Ds Bf Rh', 船室: 'Nb Ds Bf Rh', 彼方の笛: 'Db Fe Rs Nh',
  風鈴: 'Nb Be Ds Rh', 空電: 'Nb Ds Vf Rh', 蓄音機: 'Nb Ae Dh Rh',
  電気嵐: 'Db Ns Ae Ff Rs', ダブ: 'Db Ae Bf Ns Rs', 交信: 'Db Ae Ns Ve Rh', 帰還: 'Nb Ds Rs',
};
const write = process.argv.includes('--write'), only = process.argv.slice(2).filter(a => !a.startsWith('--'));
let src = readFileSync(new URL('../params.js', import.meta.url), 'utf8');
for (const f of FACTORY) {
  if (!(f.name in ROLE) || (only.length && !only.includes(f.name))) continue;
  const roles = (ROLE[f.name] || '').split(' ').filter(Boolean).map(x => [x[0], x[1]]);
  const v = sanitize(f.p);
  if (write) { for (const [k, r] of roles) v[KEY[k][1]] = FADER[r]; v.trim = 0; }
  let r = render(v, f.seed, 200), s = stats(r.L, r.R, SR * 5), trim = v.trim;
  if (write) {            // トリムを定め、もう一度測って確かめる
    trim = Math.min(18, Math.max(-12, +(Math.min(LOUD - s.rms, PEAK - s.peak)).toFixed(1)));
    v.trim = trim; r = render(v, f.seed, 200); s = stats(r.L, r.R, SR * 5);
  }
  const parts = Object.entries(r.parts).map(([nm, m]) => {
    const id = Object.values(KEY).find(x => x[0] === nm)[1];
    return `${nm} ${Math.round(v[id] * 100)}:${(m.on + trim).toFixed(0)}`;
  });
  console.log(f.name.padEnd(6), `全体 ${s.rms} 尖 ${s.peak} トリム ${trim} | フェーダー:鳴っている間のdB |`, parts.join('  '));
  if (write) {
    const m = new RegExp(`(name: '${f.name}', seed: \\d+,\\n    p: \\{)([\\s\\S]*?)(\\} \\},\\n)`).exec(src);
    let body = m[2];
    for (const [k, role] of roles) {
      const id = KEY[k][1], re = new RegExp(`${id}: [0-9.]+`);
      if (!re.test(body)) throw new Error(f.name + ' に ' + id + ' が無い');
      body = body.replace(re, `${id}: ${FADER[role]}`);
    }
    body = /trim: -?[0-9.]+/.test(body) ? body.replace(/trim: -?[0-9.]+/, `trim: ${trim}`) : ` trim: ${trim},` + body;
    src = src.slice(0, m.index) + m[1] + body + m[3] + src.slice(m.index + m[0].length);
  }
}
if (write) writeFileSync(new URL('../params.js', import.meta.url), src);
