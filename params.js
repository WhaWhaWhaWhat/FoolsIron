// パラメーター・音階・内蔵プリセットの定義表。
// 操作面（app.js）と発音部（engine.js）の双方がこれを読む。

export const SCALES = {
  harm:   { label: '倍音列',     ji: [1, 9 / 8, 5 / 4, 11 / 8, 3 / 2, 13 / 8, 7 / 4, 15 / 8] },
  penta:  { label: '五音・陽',   ji: [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3],                et: [0, 2, 4, 7, 9] },
  pentam: { label: '五音・陰',   ji: [1, 6 / 5, 4 / 3, 3 / 2, 9 / 5],                et: [0, 3, 5, 7, 10] },
  miyako: { label: '都節',       ji: [1, 16 / 15, 4 / 3, 3 / 2, 8 / 5],              et: [0, 1, 5, 7, 8] },
  ryukyu: { label: '琉球',       ji: [1, 5 / 4, 4 / 3, 3 / 2, 15 / 8],               et: [0, 4, 5, 7, 11] },
  dorian: { label: 'ドリア',     ji: [1, 9 / 8, 6 / 5, 4 / 3, 3 / 2, 5 / 3, 9 / 5],  et: [0, 2, 3, 5, 7, 9, 10] },
  lydian: { label: 'リディア',   ji: [1, 9 / 8, 5 / 4, 45 / 32, 3 / 2, 5 / 3, 15 / 8], et: [0, 2, 4, 6, 7, 9, 11] },
  whole:  { label: '全音',       ji: [1, 9 / 8, 5 / 4, 7 / 5, 8 / 5, 9 / 5],         et: [0, 2, 4, 6, 8, 10] },
  triad:  { label: '長三和音',   ji: [1, 5 / 4, 3 / 2],                              et: [0, 4, 7] },
  fifth:  { label: '五度',       ji: [1, 3 / 2],                                     et: [0, 7] },
  chroma: { label: '半音階',     ji: [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8],
            et: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

// 音階の各音を基音に対する比（1以上2未満）で返す
export function scaleRatios(key, temper) {
  const s = SCALES[key] || SCALES.harm;
  if (temper === 'et' && s.et) return s.et.map(c => Math.pow(2, c / 12));
  return s.ji.slice();
}

const opts = o => Object.entries(o).map(([k, label]) => ({ k, label }));

export const SECTIONS = [
  { id: 'macro', label: 'マクロ' },
  { id: 'main',  label: '卓',     open: true },
  { id: 'tune',  label: '調律と場' },
  { id: 'drone', label: 'ドローン' },
  { id: 'noise', label: 'ノイズ' },
  { id: 'res',   label: 'RES' },
  { id: 'arp',   label: 'ARP' },
  { id: 'voice', label: '声' },
  { id: 'fx',    label: 'FX' },
  { id: 'lfo1',  label: 'LFO 1' },
  { id: 'lfo2',  label: 'LFO 2' },
];

// type: lin=直線 / sq=二乗（低い側を細かく） / log=対数 / sel=選択
// 漠然とした大つまみ。複数の項目を束ねて動かす。値は 0..1 の正規化領域での偏り（つまみ +1 のとき）
export const MACROS = [
  { id: 'mxLight',    label: '明暗', lo: '暗', hi: '明',
    map: { tone: 0.3, droneBright: 0.35, noiseColor: -0.25, spaceDamp: -0.3, arpCenter: 0.15 } },
  { id: 'mxMotion',   label: '動静', lo: '静', hi: '動',
    map: { fluc: 0.4, flucRate: 0.3, sway: 0.4, noiseSwell: 0.3, droneBeat: 0.2, arpRate: 0.15, voiceRate: 0.15 } },
  { id: 'mxDist',     label: '遠近', lo: '近', hi: '遠',
    map: { space: 0.25, spaceDecay: 0.2, voiceFar: 0.35, width: 0.1, tone: -0.1 } },
  { id: 'mxWeight',   label: '重さ', lo: '軽', hi: '重',
    map: { root: -0.25, subLevel: 0.4, noiseColor: 0.2, droneBright: -0.15 } },
  { id: 'mxDense',    label: '密度', lo: '疎', hi: '密',
    map: { droneParts: 0.35, resLevel: 0.3, arpRest: -0.4, voiceGap: -0.3, noiseRes: 0.2, arpGate: 0.15 } },
  { id: 'mxPresence', label: '人気', lo: '無', hi: '有',
    map: { voiceLevel: 0.6, voiceCons: 0.25, voiceGap: -0.25, voiceRes: 0.15 } },
];

export const PARAMS = [
  ...MACROS.map(m => ({ id: m.id, sec: 'macro', label: m.label, type: 'lin', min: -1, max: 1, def: 0, unit: 'bi' })),

  // 卓
  { id: 'droneLevel', sec: 'main', label: 'ドローン', type: 'lin', min: 0, max: 1, def: 0.7, unit: '%' },
  { id: 'noiseLevel', sec: 'main', label: 'ノイズ',   type: 'lin', min: 0, max: 1, def: 0.3, unit: '%' },
  { id: 'resLevel',   sec: 'main', label: 'RES',   type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'arpLevel',   sec: 'main', label: 'ARP',   type: 'lin', min: 0, max: 1, def: 0,   unit: '%' },
  { id: 'voiceLevel', sec: 'main', label: '声',     type: 'lin', min: 0, max: 1, def: 0,   unit: '%' },
  { id: 'root',       sec: 'main', label: 'ルート',   type: 'lin', min: 0, max: 24, step: 1, def: 12, unit: 'note' },
  { id: 'tone',       sec: 'main', label: '明るさ', type: 'log', min: 200, max: 16000, def: 6000, unit: 'Hz' },
  { id: 'fluc',       sec: 'main', label: '揺らぎ', type: 'lin', min: 0, max: 1, def: 0.6, unit: '%' },
  { id: 'space',      sec: 'main', label: 'リバーブ',   type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'width',      sec: 'main', label: 'ステレオ幅', type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'sway',       sec: 'main', label: '漂い',   type: 'lin', min: 0, max: 1, def: 0.3, unit: '%' },

  // 調律と場
  { id: 'scale',      sec: 'tune', label: 'スケール', type: 'sel', def: 'harm',
    opts: Object.entries(SCALES).map(([k, s]) => ({ k, label: s.label })) },
  { id: 'temper',     sec: 'tune', label: 'チューニング',   type: 'sel', def: 'ji', opts: opts({ ji: '純正律', et: '平均律' }) },
  { id: 'fine',       sec: 'tune', label: 'ファイン', type: 'lin', min: -50, max: 50, def: 0, unit: 'cent' },
  { id: 'flucRate',   sec: 'tune', label: '揺らぎの速さ', type: 'log', min: 0.01, max: 1, def: 0.08, unit: 'Hz' },
  { id: 'spaceDecay', sec: 'tune', label: 'リバーブ長',   type: 'log', min: 0.5, max: 20, def: 6, unit: 's' },
  { id: 'spaceDamp',  sec: 'tune', label: 'ダンピング',   type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },

  // 持続音
  { id: 'dronePitch',  sec: 'drone', label: '高低', type: 'lin', min: -24, max: 24, step: 1, def: 0, unit: 'st' },
  { id: 'droneBright', sec: 'drone', label: '倍音の明るさ', type: 'lin', min: 0, max: 1, def: 0.45, unit: '%' },
  { id: 'droneParts',  sec: 'drone', label: '倍音の数',     type: 'lin', min: 1, max: 16, def: 12, unit: 'n' },
  { id: 'droneEven',   sec: 'drone', label: '偶数倍音',     type: 'lin', min: 0, max: 1, def: 1, unit: '%' },
  { id: 'droneBeat',   sec: 'drone', label: 'デチューン',       type: 'sq',  min: 0, max: 6, def: 0.4, unit: 'Hz' },
  { id: 'droneWidth',  sec: 'drone', label: 'ステレオ幅',   type: 'lin', min: 0, max: 1, def: 0.7, unit: '%' },
  { id: 'subLevel',    sec: 'drone', label: 'サブ',       type: 'lin', min: 0, max: 1, def: 0.4, unit: '%' },
  { id: 'subOct',      sec: 'drone', label: 'サブ オクターブ', type: 'sel', def: '1',
    opts: opts({ 0: '基音と同じ', 1: '1oct 下', 2: '2oct 下' }) },
  { id: 'subDetune',   sec: 'drone', label: 'サブ デチューン', type: 'lin', min: -60, max: 60, def: 4, unit: 'cent' },

  // 雑音
  { id: 'noisePitch',  sec: 'noise', label: '高低', type: 'lin', min: -1, max: 1, def: 0, unit: 'bi' },
  { id: 'noiseColor',  sec: 'noise', label: '色', type: 'lin', min: 0, max: 1, def: 0.7, unit: '%' },
  { id: 'noiseSwell',  sec: 'noise', label: '波の深さ',   type: 'lin', min: 0, max: 1, def: 0.4, unit: '%' },
  { id: 'noiseSwellT', sec: 'noise', label: '波の周期',   type: 'log', min: 2, max: 40, def: 9, unit: 's' },
  { id: 'noiseWidth',  sec: 'noise', label: 'ステレオ幅', type: 'lin', min: 0, max: 1, def: 0.8, unit: '%' },
  { id: 'noiseRes',    sec: 'noise', label: 'RES 送り', type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },

  // 共鳴
  { id: 'resDecay',    sec: 'res', label: 'ディケイ', type: 'log', min: 0.2, max: 12, def: 2.5, unit: 's' },
  { id: 'resPitch',    sec: 'res', label: '高低', type: 'lin', min: -24, max: 24, step: 1, def: 0, unit: 'st' },
  { id: 'resWidth',    sec: 'res', label: 'ステレオ幅', type: 'lin', min: 0, max: 1, def: 0.8, unit: '%' },

  // 反復
  { id: 'arpMode',     sec: 'arp', label: 'モード', type: 'sel', def: 'step',
    opts: opts({ step: 'アルペジオ', gliss: 'グリッサンド', loops: 'ループ' }) },
  { id: 'arpRate',     sec: 'arp', label: 'レート', type: 'log', min: 0.05, max: 8, def: 0.8, unit: '/s' },
  { id: 'arpDir',      sec: 'arp', label: 'パターン', type: 'sel', def: 'up',
    opts: opts({ up: 'アップ', down: 'ダウン', pend: 'アップダウン', walk: 'ウォーク', rand: 'ランダム' }) },
  { id: 'arpStride',   sec: 'arp', label: 'ステップ幅', type: 'lin', min: 1, max: 4, step: 1, def: 1, unit: 'n' },
  { id: 'arpGate',     sec: 'arp', label: 'ゲート',     type: 'log', min: 0.2, max: 6, def: 1.5, unit: 'x' },
  { id: 'arpSoft',     sec: 'arp', label: 'アタック',   type: 'lin', min: 0, max: 1, def: 0.6, unit: '%' },
  { id: 'arpRest',     sec: 'arp', label: '休符',       type: 'lin', min: 0, max: 0.9, def: 0, unit: '%' },
  { id: 'arpJitter',   sec: 'arp', label: 'ヒューマナイズ', type: 'lin', min: 0, max: 1, def: 0.1, unit: '%' },
  { id: 'arpCenter',   sec: 'arp', label: 'ピッチ',     type: 'log', min: 55, max: 3520, def: 440, unit: 'Hz' },
  { id: 'arpWidth',    sec: 'arp', label: 'オクターブ重ね', type: 'log', min: 0.25, max: 3, def: 1.2, unit: 'oct' },
  { id: 'arpPan',      sec: 'arp', label: 'パン幅',     type: 'lin', min: 0, max: 1, def: 0.6, unit: '%' },
  { id: 'arpRes',      sec: 'arp', label: 'RES 送り', type: 'lin', min: 0, max: 1, def: 0.3, unit: '%' },

  // 声
  { id: 'voiceCount',  sec: 'voice', label: '人数', type: 'sel', def: '1', opts: opts({ 1: '一人', 2: '二人', 3: '三人' }) },
  { id: 'voicePitch',  sec: 'voice', label: '声の高さ', type: 'log', min: 50, max: 500, def: 115, unit: 'Hz' },
  { id: 'voiceRate',   sec: 'voice', label: '話す速さ', type: 'log', min: 1, max: 7, def: 3.2, unit: '/s' },
  { id: 'voiceGap',    sec: 'voice', label: '間',       type: 'lin', min: 0, max: 1, def: 0.45, unit: '%' },
  { id: 'voiceBreath', sec: 'voice', label: '囁き',     type: 'lin', min: 0, max: 1, def: 0.25, unit: '%' },
  { id: 'voiceCons',   sec: 'voice', label: '子音',     type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'voiceTract',  sec: 'voice', label: 'フォルマント', type: 'lin', min: 0.75, max: 1.35, def: 1, unit: 'x' },
  { id: 'voiceTune',   sec: 'voice', label: '詠唱', type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  { id: 'voiceFar',    sec: 'voice', label: '遠さ',     type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'voiceSpread', sec: 'voice', label: 'ステレオ幅', type: 'lin', min: 0, max: 1, def: 0.6, unit: '%' },
  { id: 'voiceRes',    sec: 'voice', label: 'RES 送り', type: 'lin', min: 0, max: 1, def: 0.2, unit: '%' },

  // FX：フェイザー（ドローンとノイズに掛かる）、テープエコー、ダブ卓の自動演奏
  { id: 'phaserMix',   sec: 'fx', label: 'フェイザー', type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  { id: 'phaserRate',  sec: 'fx', label: 'Ph レート',  type: 'log', min: 0.01, max: 2, def: 0.08, unit: 'Hz' },
  { id: 'phaserDepth', sec: 'fx', label: 'Ph デプス',  type: 'lin', min: 0, max: 1, def: 0.8, unit: '%' },
  { id: 'phaserFb',    sec: 'fx', label: 'Ph 帰還',    type: 'lin', min: 0, max: 0.9, def: 0.5, unit: '%' },
  { id: 'echoMix',     sec: 'fx', label: 'エコー',     type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  { id: 'echoTime',    sec: 'fx', label: 'ディレイ',   type: 'log', min: 0.05, max: 1.5, def: 0.38, unit: 's2' },
  { id: 'echoFb',      sec: 'fx', label: 'フィードバック', type: 'lin', min: 0, max: 1.1, def: 0.55, unit: '%' },
  { id: 'echoTone',    sec: 'fx', label: 'トーン',     type: 'lin', min: 0, max: 1, def: 0.4, unit: '%' },
  { id: 'echoWow',     sec: 'fx', label: 'ワウ',       type: 'lin', min: 0, max: 1, def: 0.3, unit: '%' },
  { id: 'echoPing',    sec: 'fx', label: 'ピンポン',   type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'droneEcho',   sec: 'fx', label: '送り ドローン', type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  { id: 'noiseEcho',   sec: 'fx', label: '送り ノイズ',   type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  { id: 'resEcho',     sec: 'fx', label: '送り RES',      type: 'lin', min: 0, max: 1, def: 0.3, unit: '%' },
  { id: 'arpEcho',     sec: 'fx', label: '送り ARP',      type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'voiceEcho',   sec: 'fx', label: '送り 声',       type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'dub',         sec: 'fx', label: 'ダブ',       type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
];

// LFO は二基。対象は段階を持たぬ連続量すべて
const LFO_TARGETS = [{ k: 'none', label: 'なし' }].concat(
  PARAMS.filter(p => p.type !== 'sel' && !p.step).map(p => {
    const sec = SECTIONS.find(s => s.id === p.sec);
    return { k: p.id, label: (p.sec === 'main' ? '' : sec.label + '：') + p.label };
  }));
for (const n of [1, 2]) {
  const sec = 'lfo' + n, id = s => 'lfo' + n + s;
  PARAMS.push(
    { id: id('Target'), sec, label: 'ターゲット', type: 'sel', def: 'none', opts: LFO_TARGETS },
    { id: id('Shape'),  sec, label: '波形', type: 'sel', def: 'sine',
      opts: opts({ sine: 'サイン', tri: '三角波', smooth: 'ランダム', step: 'S&H' }) },
    { id: id('Rate'),   sec, label: 'レート', type: 'log', min: 0.005, max: 8, def: 0.05, unit: 'Hz' },
    { id: id('Depth'),  sec, label: 'デプス', type: 'lin', min: 0, max: 1, def: 0.3, unit: '%' },
  );
}

export const BY_ID = Object.fromEntries(PARAMS.map(p => [p.id, p]));

// 値 → 0..1
export function norm(p, v) {
  let t;
  if (p.type === 'log') t = Math.log(v / p.min) / Math.log(p.max / p.min);
  else if (p.type === 'sq') t = Math.sqrt(Math.max(0, (v - p.min) / (p.max - p.min)));
  else t = (v - p.min) / (p.max - p.min);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
// 0..1 → 値
export function denorm(p, t) {
  if (p.type === 'log') return p.min * Math.pow(p.max / p.min, t);
  if (p.type === 'sq') return p.min + (p.max - p.min) * t * t;
  return p.min + (p.max - p.min) * t;
}

export function defaults() {
  const o = {};
  for (const p of PARAMS) o[p.id] = p.def;
  return o;
}

// 未知の項目を捨て、範囲に収め、欠けを既定値で埋める
export function sanitize(src) {
  const o = defaults();
  if (!src) return o;
  // 旧い保存形式：共鳴の高さはオクターブ単位（既定 1）だった
  if (src.resOct !== undefined && src.resPitch === undefined) src = { ...src, resPitch: (src.resOct - 1) * 12 };
  for (const p of PARAMS) {
    const v = src[p.id];
    if (v === undefined || v === null) continue;
    if (p.type === 'sel') {
      if (p.opts.some(x => x.k === String(v))) o[p.id] = String(v);
    } else if (typeof v === 'number' && isFinite(v)) {
      let x = Math.min(p.max, Math.max(p.min, v));
      if (p.step) x = Math.round(x / p.step) * p.step;
      o[p.id] = x;
    }
  }
  return o;
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function rootHz(root, fine = 0) { return 55 * Math.pow(2, (root + fine / 100) / 12); }

export function format(p, v) {
  switch (p.unit) {
    case 'st': { const r = Math.round(v); return (r > 0 ? '+' : '') + r; }
    case 'bi': { const r = Math.round(v * 100); return (r > 0 ? '+' : '') + r; }
    case '%': return Math.round(norm(p, v) * 100) + '';
    case 'note': { const m = 33 + Math.round(v); return NOTES[m % 12] + (Math.floor(m / 12) - 1) + ' ' + Math.round(rootHz(v)) + 'Hz'; }
    case 'Hz': return (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3)) + 'Hz';
    case 's2': return (v >= 1 ? v.toFixed(2) : v.toFixed(3)) + '秒';
    case 's': return (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + '秒';
    case 'cent': return (v > 0 ? '+' : '') + v.toFixed(0) + '¢';
    case '/s': return (v >= 1 ? v.toFixed(1) : v.toFixed(2)) + '/秒';
    case 'oct': return (Number.isInteger(v) ? v : v.toFixed(2)) + 'oct';
    case 'x': return '×' + v.toFixed(2);
    case 'n': return Math.round(v) + '';
    default: return String(v);
  }
}

// 内蔵プリセット。既定値との差分のみを書く
export const FACTORY = [
  { name: '錬鉄', seed: 1972, p: {} },
  { name: '潮', seed: 31,
    p: { droneLevel: 0.35, noiseLevel: 0.75, resLevel: 0.6, noiseColor: 0.85, noiseSwell: 0.75, noiseSwellT: 11,
         noiseRes: 0.7, resDecay: 4, scale: 'pentam', root: 10, tone: 3500, droneBright: 0.25, droneParts: 6,
         space: 0.6, spaceDecay: 9 } },
  { name: '無限階段', seed: 7,
    p: { droneLevel: 0.5, noiseLevel: 0.15, resLevel: 0.45, arpLevel: 0.6, arpMode: 'step', arpDir: 'up',
         arpRate: 0.7, arpGate: 2.2, arpSoft: 0.7, arpWidth: 1.6, arpCenter: 392, arpRes: 0.45,
         scale: 'penta', droneBright: 0.3, space: 0.65, spaceDecay: 8 } },
  { name: '沈降', seed: 404,
    p: { droneLevel: 0.4, noiseLevel: 0.2, resLevel: 0.35, arpLevel: 0.6, arpMode: 'gliss', arpDir: 'down',
         arpRate: 0.35, arpWidth: 1.5, arpCenter: 330, arpRes: 0.2, root: 7, scale: 'fifth', tone: 4000,
         droneBright: 0.3, droneParts: 8, space: 0.6, spaceDecay: 10 } },
  { name: '輪', seed: 1978,
    p: { droneLevel: 0.3, noiseLevel: 0.1, resLevel: 0.45, arpLevel: 0.6, arpMode: 'loops', arpRate: 0.5,
         arpGate: 2.5, arpSoft: 0.85, arpWidth: 0.5, arpCenter: 440, arpRes: 0.6, resDecay: 5,
         scale: 'penta', root: 8, droneBright: 0.2, droneParts: 6, space: 0.75, spaceDecay: 12, spaceDamp: 0.6 } },
  { name: '遠い声', seed: 55,
    p: { droneLevel: 0.5, noiseLevel: 0.25, resLevel: 0.4, voiceLevel: 0.7, voiceCount: '2', voiceFar: 0.75,
         voiceGap: 0.5, voiceCons: 0.35, voiceBreath: 0.3, voiceRate: 2.8, voiceRes: 0.35, droneBright: 0.3,
         tone: 4500, space: 0.7, spaceDecay: 9 } },
  { name: '読経', seed: 108,
    p: { droneLevel: 0.55, noiseLevel: 0.1, resLevel: 0.3, voiceLevel: 0.5, voiceCount: '3', voiceTune: 1,
         voicePitch: 98, voiceRate: 2.2, voiceGap: 0.2, voiceCons: 0.25, voiceBreath: 0.1, voiceFar: 0.55,
         voiceRes: 0.4, scale: 'miyako', root: 10, droneBright: 0.35, droneEven: 0.5, space: 0.7, spaceDecay: 7 } },
  { name: '囁き', seed: 9,
    p: { droneLevel: 0.25, noiseLevel: 0.6, resLevel: 0.3, voiceLevel: 0.9, voiceCount: '2', voiceBreath: 1,
         voiceCons: 0.6, voiceRate: 3, voiceGap: 0.55, voiceFar: 0.3, voiceRes: 0.1, noiseColor: 0.6,
         noiseSwell: 0.3, tone: 7000, droneBright: 0.15, droneParts: 5, space: 0.4, spaceDecay: 4 } },
  { name: '電気嵐', seed: 1969,
    p: { droneLevel: 0.6, noiseLevel: 0.4, resLevel: 0.4, arpLevel: 0.45, arpMode: 'gliss', arpDir: 'pend', arpRate: 0.6,
         phaserMix: 0.8, phaserRate: 0.06, phaserFb: 0.7, noiseColor: 0.45, droneBright: 0.6, droneBeat: 1.2,
         echoMix: 0.45, echoTime: 0.42, echoFb: 0.6, resEcho: 0.5, arpEcho: 0.7, space: 0.5 } },
  { name: 'ダブ', seed: 1976,
    p: { droneLevel: 0.5, dronePitch: -12, subLevel: 0.6, noiseLevel: 0.2, resLevel: 0.45, arpLevel: 0.6, arpMode: 'step',
         arpDir: 'walk', arpRate: 1.4, arpGate: 0.6, arpSoft: 0.25, arpWidth: 0.5, arpRest: 0.35, scale: 'pentam',
         dub: 0.6, echoMix: 0.5, echoTime: 0.45, echoFb: 0.68, echoTone: 0.3, arpEcho: 0.6, space: 0.45 } },
];
