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
  { id: 'noise3', label: 'ノイズ事象' },
  { id: 'noise2', label: 'ノイズ加工' },
  { id: 'res',   label: 'RES' },
  { id: 'arp',   label: 'ARP' },
  { id: 'voice', label: '声' },
  { id: 'flute', label: '笛' },
  { id: 'bell',  label: '鐘' },
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
    map: { droneParts: 0.35, resLevel: 0.3, arpRest: -0.4, voiceGap: -0.3, noiseRes: 0.2, arpGate: 0.15, fluteGap: -0.3, bellGap: -0.3 } },
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
  { id: 'fluteLevel', sec: 'main', label: '笛',     type: 'lin', min: 0, max: 1, def: 0,   unit: '%' },
  { id: 'bellLevel',  sec: 'main', label: '鐘',     type: 'lin', min: 0, max: 1, def: 0,   unit: '%' },
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
  { id: 'noiseBase',   sec: 'noise', label: '地の雑音', type: 'lin', min: 0, max: 1, def: 1, unit: '%' },
  { id: 'noiseColor',  sec: 'noise', label: '色', type: 'lin', min: 0, max: 1, def: 0.7, unit: '%' },
  { id: 'noiseSwell',  sec: 'noise', label: '波の深さ',   type: 'lin', min: 0, max: 1, def: 0.4, unit: '%' },
  { id: 'noiseSwellT', sec: 'noise', label: '波の周期',   type: 'log', min: 2, max: 40, def: 9, unit: 's' },
  { id: 'noiseWidth',  sec: 'noise', label: 'ステレオ幅', type: 'lin', min: 0, max: 1, def: 0.8, unit: '%' },
  { id: 'noiseRes',    sec: 'noise', label: 'RES 送り', type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  // 素材
  { id: 'noiseFlutter', sec: 'noise', label: '荒れ',     type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  { id: 'noiseHum',     sec: 'noise', label: 'ハム',     type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  { id: 'noiseCrush',   sec: 'noise', label: 'クラッシュ', type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  // 事象：物理由来の非楽音
  { id: 'noiseCrackle',    sec: 'noise3', label: '粒子',     type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  { id: 'noiseDensity',    sec: 'noise3', label: '粒の密度', type: 'log', min: 0.5, max: 3000, def: 40, unit: '/s' },
  { id: 'noiseGrainSize',  sec: 'noise3', label: '粒の大きさ', type: 'lin', min: 0, max: 1, def: 0.15, unit: '%' },
  { id: 'noiseGrainRing',  sec: 'noise3', label: '粒の響き', type: 'lin', min: 0, max: 1, def: 0.1, unit: '%' },
  { id: 'noiseBubble',     sec: 'noise3', label: '泡',       type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  { id: 'noiseBubbleRate', sec: 'noise3', label: '泡の密度', type: 'log', min: 0.2, max: 400, def: 8, unit: '/s' },
  { id: 'noiseBubbleSize', sec: 'noise3', label: '泡の大きさ', type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'noiseCreak',      sec: 'noise3', label: '軋み',     type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  { id: 'noiseCreakRate',  sec: 'noise3', label: '軋みの速さ', type: 'log', min: 4, max: 300, def: 40, unit: 'Hz' },
  // 加工
  { id: 'noiseFilt',     sec: 'noise2', label: 'フィルター', type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  { id: 'noiseFiltFreq', sec: 'noise2', label: '周波数',     type: 'log', min: 60, max: 8000, def: 800, unit: 'Hz' },
  { id: 'noiseReso',     sec: 'noise2', label: 'レゾナンス', type: 'lin', min: 0, max: 1, def: 0.7, unit: '%' },
  { id: 'noiseFiltMode', sec: 'noise2', label: '動き方', type: 'sel', def: 'wander',
    opts: opts({ fix: '固定', wander: '漂う', scale: '音階', whistler: '降下' }) },
  { id: 'noiseFiltMove', sec: 'noise2', label: '動きの幅',   type: 'lin', min: 0, max: 1, def: 0.4, unit: '%' },
  { id: 'noiseFiltRate', sec: 'noise2', label: '動きの速さ', type: 'log', min: 0.02, max: 8, def: 0.3, unit: '/s' },
  { id: 'noiseFb',       sec: 'noise2', label: 'フィードバック', type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  { id: 'noiseDrive',    sec: 'noise2', label: '歪み',       type: 'lin', min: 0, max: 1, def: 0, unit: '%' },

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
  { id: 'voiceGap',    sec: 'voice', label: '間',       type: 'lin', min: 0, max: 1, def: 0.45, unit: 'gap' },
  { id: 'voiceBreath', sec: 'voice', label: '囁き',     type: 'lin', min: 0, max: 1, def: 0.25, unit: '%' },
  { id: 'voiceCons',   sec: 'voice', label: '子音',     type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'voiceTract',  sec: 'voice', label: 'フォルマント', type: 'lin', min: 0.75, max: 1.35, def: 1, unit: 'x' },
  { id: 'voiceTune',   sec: 'voice', label: '詠唱', type: 'lin', min: 0, max: 1, def: 0, unit: '%' },
  { id: 'voiceFar',    sec: 'voice', label: '遠さ',     type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'voiceSpread', sec: 'voice', label: 'ステレオ幅', type: 'lin', min: 0, max: 1, def: 0.6, unit: '%' },
  { id: 'voiceRes',    sec: 'voice', label: 'RES 送り', type: 'lin', min: 0, max: 1, def: 0.2, unit: '%' },

  // 笛
  { id: 'flutePitch',  sec: 'flute', label: '高低',     type: 'log', min: 60, max: 3000, def: 700, unit: 'Hz' },
  { id: 'fluteBody',   sec: 'flute', label: '太さ',     type: 'lin', min: 0, max: 1, def: 0.15, unit: '%' },
  { id: 'fluteBreath', sec: 'flute', label: '息',       type: 'lin', min: 0, max: 1, def: 0.4, unit: '%' },
  { id: 'fluteLen',    sec: 'flute', label: '音の長さ', type: 'log', min: 0.15, max: 8, def: 1.2, unit: 's' },
  { id: 'fluteNotes',  sec: 'flute', label: '音数',     type: 'lin', min: 1, max: 8, step: 1, def: 4, unit: 'n' },
  { id: 'fluteGap',    sec: 'flute', label: '間',       type: 'lin', min: 0, max: 1, def: 0.55, unit: 'gap' },
  { id: 'fluteRange',  sec: 'flute', label: '音域',     type: 'lin', min: 0, max: 1, def: 0.4, unit: '%' },
  { id: 'fluteGlide',  sec: 'flute', label: 'ポルタメント', type: 'lin', min: 0, max: 1, def: 0.3, unit: '%' },
  { id: 'fluteVib',    sec: 'flute', label: 'ビブラート', type: 'lin', min: 0, max: 1, def: 0.3, unit: '%' },
  { id: 'fluteFar',    sec: 'flute', label: '遠さ',     type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'flutePan',    sec: 'flute', label: 'ステレオ幅', type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'fluteRes',    sec: 'flute', label: 'RES 送り', type: 'lin', min: 0, max: 1, def: 0.3, unit: '%' },

  // 鐘
  { id: 'bellPitch',   sec: 'bell', label: '高低',     type: 'log', min: 40, max: 4000, def: 440, unit: 'Hz' },
  { id: 'bellTimbre',  sec: 'bell', label: '材質',     type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'bellDecay',   sec: 'bell', label: 'ディケイ', type: 'log', min: 0.3, max: 30, def: 6, unit: 's' },
  { id: 'bellHard',    sec: 'bell', label: '硬さ',     type: 'lin', min: 0, max: 1, def: 0.4, unit: '%' },
  { id: 'bellBeat',    sec: 'bell', label: 'うなり',   type: 'lin', min: 0, max: 1, def: 0.3, unit: '%' },
  { id: 'bellNotes',   sec: 'bell', label: '音数',     type: 'lin', min: 1, max: 8, step: 1, def: 3, unit: 'n' },
  { id: 'bellRate',    sec: 'bell', label: '打つ間隔', type: 'log', min: 0.15, max: 6, def: 1.6, unit: 's' },
  { id: 'bellGap',     sec: 'bell', label: '間',       type: 'lin', min: 0, max: 1, def: 0.6, unit: 'gap' },
  { id: 'bellRange',   sec: 'bell', label: '音域',     type: 'lin', min: 0, max: 1, def: 0.4, unit: '%' },
  { id: 'bellFar',     sec: 'bell', label: '遠さ',     type: 'lin', min: 0, max: 1, def: 0.4, unit: '%' },
  { id: 'bellPan',     sec: 'bell', label: 'ステレオ幅', type: 'lin', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'bellRes',     sec: 'bell', label: 'RES 送り', type: 'lin', min: 0, max: 1, def: 0.3, unit: '%' },

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
  { id: 'fluteEcho',   sec: 'fx', label: '送り 笛',       type: 'lin', min: 0, max: 1, def: 0.4, unit: '%' },
  { id: 'bellEcho',    sec: 'fx', label: '送り 鐘',       type: 'lin', min: 0, max: 1, def: 0.4, unit: '%' },
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
    case 'gap': { const g = 0.25 * Math.pow(240, v); return '約' + (g >= 10 ? g.toFixed(0) : g.toFixed(1)) + '秒'; }
    case 's2': return (v >= 1 ? v.toFixed(2) : v.toFixed(3)) + '秒';
    case 's': return (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + '秒';
    case 'cent': return (v > 0 ? '+' : '') + v.toFixed(0) + '¢';
    case '/s': return (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)) + '/秒';
    case 'oct': return (Number.isInteger(v) ? v : v.toFixed(2)) + 'oct';
    case 'x': return '×' + v.toFixed(2);
    case 'n': return Math.round(v) + '';
    default: return String(v);
  }
}

// 内蔵プリセット。既定値との差分のみを書く。cat は一覧での組分け
//
// 混ぜ方の規則（縦フェーダー＝各部の音量で考える）：
//   ・高い位置の部を一本きりにしない。主役は二本以上立てる（主役と準主役の差は付けてよい）
//   ・主役どうしは、共鳴への送り・同じ音階・エコーで繋ぐ。並べるだけにしない
//   ・その下に中の部を置き、薄い部を走らせて場を作る。多くはノイズが薄い役を担うが、主役になってもよい
//   ・ほぼ同じ高さの部を複数並べる型（薄明）も用いる
//   ・暗めを基調とする
// tools/presets.mjs が、この規則と全体の音量を点検する
export const CATS = ['眠り', '瞑想', '環境', '実験'];
export const FACTORY = [
  /* ---- 眠り：刺激の少ないもの。ダブは使わない ---- */
  { cat: '眠り', name: '薄明', seed: 7,                          // 利用者の一枚
    p: { mxLight: -0.37, mxMotion: -0.29, droneLevel: 0.2886, noiseLevel: 0.3314, resLevel: 0.4514, voiceLevel: 0.2972,
         root: 2, tone: 864.7, space: 0.65, scale: 'pentam', spaceDecay: 8, dronePitch: 10, droneBright: 0.3, droneBeat: 3.375,
         subLevel: 0.7976, noisePitch: 0.8047, resDecay: 10.2, resPitch: -14, arpRate: 0.7, arpGate: 2.2, arpSoft: 0.7,
         arpCenter: 137.6, arpWidth: 1.6, arpRes: 0.45, voiceCount: '3', voicePitch: 104.3, voiceGap: 1, voiceBreath: 0.6829,
         voiceTract: 1.15, voiceTune: 0.5459, voiceFar: 0.6294 } },
  { cat: '眠り', name: '錬鉄', seed: 1,                          // ドローンと共鳴
    p: { droneLevel: 0.78, resLevel: 0.7, noiseLevel: 0.18, tone: 1300, droneBright: 0.3, droneBeat: 1.2, subLevel: 0.7,
         noiseColor: 0.8, noiseRes: 0.45, resDecay: 6, resPitch: -12, fluc: 0.4, space: 0.65, spaceDecay: 8, spaceDamp: 0.7,
         lfo1Target: 'droneBeat', lfo1Rate: 0.012, lfo1Depth: 0.25 } },
  { cat: '眠り', name: '風穴', seed: 12,                         // 風と、風が鳴らす共鳴
    p: { noiseLevel: 0.85, resLevel: 0.7, droneLevel: 0.5, noiseColor: 0.6, noiseSwell: 0.45, noiseSwellT: 9, noiseFilt: 0.7,
         noiseReso: 0.86, noiseFiltMode: 'wander', noiseFiltFreq: 600, noiseFiltMove: 0.5, noiseFiltRate: 0.12, noiseRes: 0.75,
         resDecay: 6, resPitch: -12, droneBright: 0.2, subLevel: 0.65, tone: 2600, space: 0.7, spaceDecay: 9, spaceDamp: 0.7 } },
  { cat: '眠り', name: '潮', seed: 31,                           // 波とドローン
    p: { noiseLevel: 0.82, droneLevel: 0.68, resLevel: 0.45, noiseColor: 0.9, noiseSwell: 0.75, noiseSwellT: 12,
         noiseCrackle: 0.25, noiseDensity: 900, noiseGrainSize: 0.1, noiseGrainRing: 0, noiseBubble: 0.25, noiseBubbleRate: 150,
         noiseBubbleSize: 0.2, noiseRes: 0.6, resDecay: 6, resPitch: -12, scale: 'pentam', root: 8, droneBright: 0.2,
         droneParts: 6, droneBeat: 1, subLevel: 0.7, tone: 1900, space: 0.65, spaceDecay: 9, spaceDamp: 0.7 } },
  { cat: '眠り', name: '夜雨', seed: 66,                         // 雨と、雨が鳴らす共鳴
    p: { noiseLevel: 0.82, resLevel: 0.7, droneLevel: 0.5, noiseBase: 0.75, noiseColor: 0.6, noiseCrackle: 0.9, noiseDensity: 600,
         noiseGrainSize: 0.3, noiseGrainRing: 0.12, noiseBubble: 0.4, noiseBubbleRate: 2.5, noiseBubbleSize: 0.6, noiseSwell: 0.25,
         noiseSwellT: 20, noiseRes: 0.85, resPitch: 12, resDecay: 2, scale: 'penta', dronePitch: -12, droneBright: 0.2,
         droneParts: 6, subLevel: 0.6, tone: 3000, fluc: 0.6, flucRate: 0.2, space: 0.55, spaceDecay: 5, spaceDamp: 0.6 } },
  { cat: '眠り', name: '焚火', seed: 451,                        // 火とドローン
    p: { noiseLevel: 0.8, droneLevel: 0.7, resLevel: 0.3, dronePitch: -12, droneBright: 0.25, droneParts: 5, droneBeat: 0.6,
         subLevel: 0.75, noiseColor: 0.95, noisePitch: -0.2, noiseCrackle: 0.75, noiseDensity: 7, noiseGrainSize: 0.45,
         noiseGrainRing: 0.05, noiseFlutter: 0.3, noiseSwell: 0.3, noiseSwellT: 7, noiseRes: 0.3, resDecay: 5, resPitch: -12,
         root: 7, scale: 'fifth', tone: 2300, space: 0.45, spaceDecay: 4 } },
  { cat: '眠り', name: '沈降', seed: 404,                        // ドローンと、降り続けるグリッサンド
    p: { droneLevel: 0.74, arpLevel: 0.66, resLevel: 0.45, noiseLevel: 0.15, arpMode: 'gliss', arpDir: 'down', arpRate: 0.3,
         arpWidth: 1.8, arpCenter: 200, arpRes: 0.4, root: 5, scale: 'fifth', droneBright: 0.3, droneParts: 8, droneBeat: 1.5,
         subLevel: 0.7, resDecay: 7, resPitch: -12, tone: 1100, space: 0.65, spaceDecay: 10, spaceDamp: 0.75 } },
  { cat: '眠り', name: '囁き', seed: 9,                          // 囁きと雑音
    p: { voiceLevel: 0.82, noiseLevel: 0.72, droneLevel: 0.45, resLevel: 0.3, voiceCount: '3', voiceBreath: 1, voiceCons: 0.5,
         voiceRate: 2.8, voiceGap: 0.6, voiceFar: 0.55, voiceRes: 0.4, voiceEcho: 0, voiceSpread: 0.9, noiseColor: 0.75,
         noiseSwell: 0.15, dronePitch: -12, droneBright: 0.2, droneParts: 5, subLevel: 0.6, tone: 2400, space: 0.6,
         spaceDecay: 6, spaceDamp: 0.7 } },

  /* ---- 瞑想：音高と倍音に耳を置くもの ---- */
  { cat: '瞑想', name: '賢者の石', seed: 1972,                   // 明滅する倍音と、それに応える共鳴
    p: { droneLevel: 0.8, resLevel: 0.72, noiseLevel: 0, droneBright: 0.5, droneParts: 16, droneBeat: 0.3, subLevel: 0.6,
         noiseColor: 0.6, noiseRes: 0.5, resDecay: 8, fluc: 1, flucRate: 0.12, sway: 0.5, root: 7, tone: 1800,
         lfo1Target: 'droneBright', lfo1Shape: 'smooth', lfo1Rate: 0.03, lfo1Depth: 0.5, space: 0.65, spaceDecay: 9, spaceDamp: 0.7 } },
  { cat: '瞑想', name: '倍音唱', seed: 1206,                     // ドローンと、音階を踏む口笛
    p: { droneLevel: 0.72, noiseLevel: 0.85, resLevel: 0.4, dronePitch: -12, droneBright: 0.5, droneParts: 14, droneBeat: 0.2,
         subLevel: 0.5, noiseColor: 0.6, noiseSwell: 0.5, noiseSwellT: 14, noiseFilt: 1, noiseReso: 0.93, noiseFiltMode: 'scale',
         noiseFiltFreq: 800, noiseFiltMove: 0.4, noiseFiltRate: 0.25, noiseRes: 0.4, resDecay: 6, root: 5, fluc: 0.4,
         tone: 2400, space: 0.7, spaceDecay: 9 } },
  { cat: '瞑想', name: '読経', seed: 108,                        // 詠唱とドローン。鈴が中に入る
    p: { voiceLevel: 0.76, droneLevel: 0.74, bellLevel: 0.55, resLevel: 0.45, noiseLevel: 0.12, voiceCount: '3', voiceTune: 1,
         voicePitch: 92, voiceRate: 2, voiceGap: 0.3, voiceCons: 0.2, voiceBreath: 0.35, voiceFar: 0.6, voiceRes: 0.6,
         voiceEcho: 0, bellPitch: 660, bellTimbre: 0.25, bellDecay: 12, bellHard: 0.3, bellBeat: 0.7, bellNotes: 1,
         bellGap: 0.85, bellRange: 0, bellFar: 0.3, bellRes: 0.5, bellEcho: 0, scale: 'miyako', root: 8, droneBright: 0.3,
         droneEven: 0.5, subLevel: 0.65, resDecay: 7, resPitch: -12, tone: 1500, space: 0.75, spaceDecay: 9, spaceDamp: 0.75 } },
  { cat: '瞑想', name: '鐘楼', seed: 1185,                       // 梵鐘とドローン。鐘が共鳴を鳴らす
    p: { bellLevel: 0.95, droneLevel: 0.66, resLevel: 0.55, noiseLevel: 0.18, bellPitch: 110, bellTimbre: 0.75, bellDecay: 24,
         bellHard: 0.5, bellBeat: 0.75, bellNotes: 1, bellRate: 3, bellGap: 0.78, bellRange: 0, bellFar: 0.2, bellRes: 0.7,
         bellEcho: 0, root: 5, scale: 'pentam', dronePitch: -12, droneBright: 0.25, subLevel: 0.65, noiseColor: 0.85,
         resDecay: 8, resPitch: -12, tone: 1700, space: 0.75, spaceDecay: 14, spaceDamp: 0.7 } },
  { cat: '瞑想', name: '銅鑼', seed: 1300,                       // 銅鑼と、銅鑼に揺さぶられる共鳴
    p: { bellLevel: 0.95, resLevel: 0.75, droneLevel: 0.58, noiseLevel: 0.12, dronePitch: -12, droneBright: 0.3, droneParts: 8,
         subLevel: 0.6, bellPitch: 80, bellTimbre: 1, bellDecay: 28, bellHard: 0.6, bellBeat: 0.5, bellNotes: 1, bellGap: 0.72,
         bellRange: 0, bellFar: 0.2, bellRes: 0.9, bellEcho: 0, resDecay: 9, root: 2, scale: 'fifth', tone: 1600,
         space: 0.75, spaceDecay: 14 } },
  { cat: '瞑想', name: '虚空', seed: 1614,                       // 息の多い笛とドローン
    p: { fluteLevel: 0.66, droneLevel: 0.72, resLevel: 0.5, noiseLevel: 0.15, dronePitch: -12, droneBright: 0.25, droneParts: 6,
         subLevel: 0.65, flutePitch: 250, fluteBody: 0.25, fluteBreath: 0.7, fluteLen: 5, fluteNotes: 3, fluteGap: 0.75,
         fluteRange: 0.5, fluteGlide: 0.8, fluteVib: 0.4, fluteFar: 0.55, fluteRes: 0.6, fluteEcho: 0, resDecay: 7,
         scale: 'miyako', root: 5, tone: 2000, space: 0.6, spaceDecay: 9, spaceDamp: 0.7 } },
  { cat: '瞑想', name: '輪', seed: 1978,                         // 割り切れぬ輪と、輪が鳴らす共鳴
    p: { arpLevel: 0.7, resLevel: 0.72, droneLevel: 0.45, noiseLevel: 0.12, arpMode: 'loops', arpRate: 0.4, arpGate: 2.5,
         arpSoft: 0.95, arpWidth: 0.6, arpCenter: 260, arpRes: 0.85, arpEcho: 0.3, resDecay: 8, resPitch: -12, scale: 'penta',
         root: 8, droneBright: 0.2, droneParts: 6, subLevel: 0.6, tone: 1500, space: 0.8, spaceDecay: 12, spaceDamp: 0.7 } },
  { cat: '瞑想', name: '無限階段', seed: 7,                      // ドローンと、昇り続ける階段
    p: { droneLevel: 0.74, arpLevel: 0.66, resLevel: 0.45, noiseLevel: 0.15, arpMode: 'step', arpDir: 'up', arpRate: 0.5,
         arpGate: 2, arpSoft: 0.9, arpWidth: 1.8, arpCenter: 200, arpRes: 0.5, scale: 'pentam', root: 5, droneBright: 0.3,
         droneBeat: 1.2, subLevel: 0.7, resDecay: 8, resPitch: -12, tone: 1200, space: 0.7, spaceDecay: 9, spaceDamp: 0.75 } },

  /* ---- 環境：長い沈黙のあいだに、時おり何かが聞こえるもの ---- */
  { cat: '環境', name: '遠い声', seed: 55,                       // 利用者の一枚。声とドローン、共鳴が中、ノイズが薄く走る
    p: { droneLevel: 0.754, noiseLevel: 0.1559, resLevel: 0.4, voiceLevel: 0.864, root: 5, tone: 1357, fluc: 0.221, space: 0.802,
         width: 0.83, fine: 35.7, spaceDecay: 9, spaceDamp: 0.846, droneBright: 0.175, droneParts: 11.01, droneBeat: 1.915,
         droneWidth: 0.888, subLevel: 0.752, subDetune: 1.32, resWidth: 0.878, voiceCount: '2', voicePitch: 221.4, voiceRate: 7,
         voiceGap: 0.957, voiceBreath: 0.891, voiceCons: 0.814, voiceTract: 1.209, voiceFar: 0.75, voiceRes: 0.873,
         lfo1Target: 'droneBeat', lfo1Rate: 0.01126, lfo1Depth: 0.285 } },
  { cat: '環境', name: '喫茶店', seed: 23,                       // 話し声と店のざわめき。食器が中に入る
    p: { voiceLevel: 0.82, noiseLevel: 0.75, bellLevel: 0.5, droneLevel: 0.25, resLevel: 0.25, voiceCount: '3', voiceGap: 0.72,
         voiceFar: 0.5, voiceCons: 0.5, voiceBreath: 0.3, voiceRate: 3.4, voiceRes: 0.2, voiceSpread: 0.9, voiceEcho: 0,
         noiseColor: 0.7, noiseSwell: 0.05, noiseHum: 0.45, bellPitch: 1500, bellTimbre: 0.12, bellDecay: 0.6, bellHard: 0.6,
         bellNotes: 2, bellRate: 0.25, bellGap: 0.88, bellFar: 0.5, bellEcho: 0, dronePitch: -12, droneBright: 0.2,
         tone: 3000, space: 0.5, spaceDecay: 2.5 } },
  { cat: '環境', name: '霧笛', seed: 1859,                       // 警笛と波。浮標の鐘が中に入る
    p: { fluteLevel: 0.82, noiseLevel: 0.78, bellLevel: 0.45, droneLevel: 0.4, resLevel: 0.3, noiseColor: 0.95, noiseSwell: 0.5,
         noiseSwellT: 13, flutePitch: 98, fluteBody: 0.9, fluteBreath: 0.2, fluteLen: 5, fluteNotes: 2, fluteGap: 0.7,
         fluteRange: 0.2, fluteGlide: 0.5, fluteVib: 0.05, fluteFar: 0.65, fluteEcho: 0.3, fluteRes: 0.4, echoMix: 0.3,
         echoTime: 0.9, echoFb: 0.4, echoTone: 0.2, bellPitch: 420, bellTimbre: 0.5, bellDecay: 5, bellHard: 0.35, bellNotes: 2,
         bellRate: 1.2, bellGap: 0.88, bellRange: 0, bellFar: 0.8, dronePitch: -12, droneBright: 0.2, subLevel: 0.6,
         root: 9, scale: 'fifth', tone: 2000, space: 0.8, spaceDecay: 12, spaceDamp: 0.7 } },
  { cat: '環境', name: '船室', seed: 1851,                       // 軋む船材と、船底の低い唸り
    p: { noiseLevel: 0.82, droneLevel: 0.68, bellLevel: 0.4, resLevel: 0.25, dronePitch: -12, droneBright: 0.15, droneParts: 5,
         droneBeat: 0.5, subLevel: 0.8, noiseBase: 1, noiseColor: 0.95, noisePitch: 0, noiseSwell: 0.7, noiseSwellT: 14,
         noiseCreak: 0.9, noiseCreakRate: 22, noiseHum: 0.25, noiseBubble: 0.2, noiseBubbleRate: 15, noiseBubbleSize: 0.8,
         noiseRes: 0.4, bellPitch: 420, bellTimbre: 0.5, bellDecay: 4, bellHard: 0.3, bellNotes: 2, bellRate: 1.3, bellGap: 0.9,
         bellRange: 0, bellFar: 0.9, resDecay: 5, resPitch: -12, root: 7, scale: 'fifth', tone: 1900, space: 0.45, spaceDecay: 3 } },
  { cat: '環境', name: '彼方の笛', seed: 1928,                   // か細い笛と、笛に応える共鳴
    p: { fluteLevel: 0.7, resLevel: 0.75, droneLevel: 0.5, noiseLevel: 0.15, dronePitch: -12, droneBright: 0.2, subLevel: 0.6,
         flutePitch: 900, fluteBody: 0, fluteBreath: 0.65, fluteLen: 0.9, fluteNotes: 6, fluteGap: 0.7, fluteRange: 0.6,
         fluteGlide: 0.6, fluteVib: 0.5, fluteFar: 0.78, fluteRes: 0.9, fluteEcho: 0.3, echoMix: 0.2, echoTime: 0.7, echoFb: 0.45,
         echoTone: 0.2, resDecay: 8, scale: 'whole', tone: 2200, space: 0.85, spaceDecay: 11, spaceDamp: 0.7 } },
  { cat: '環境', name: '風鈴', seed: 77,                         // 風鈴と風
    p: { bellLevel: 0.9, noiseLevel: 0.75, resLevel: 0.5, droneLevel: 0.45, dronePitch: -12, droneBright: 0.2, noiseColor: 0.6,
         noiseSwell: 0.4, noiseSwellT: 8, noiseFilt: 0.35, noiseReso: 0.6, noiseFiltMode: 'wander', noiseFiltFreq: 500,
         noiseFiltMove: 0.5, noiseFiltRate: 0.15, bellPitch: 1100, bellTimbre: 0.05, bellDecay: 3.5, bellHard: 0.6, bellBeat: 0.3,
         bellNotes: 5, bellRate: 0.45, bellGap: 0.55, bellRange: 0.5, bellFar: 0.25, bellPan: 0.8, bellRes: 0.7, bellEcho: 0,
         resDecay: 5, scale: 'penta', tone: 3400, space: 0.6, spaceDecay: 5 } },
  { cat: '環境', name: 'せせらぎ', seed: 88,                     // 水と、水が鳴らす共鳴
    p: { noiseLevel: 0.82, resLevel: 0.72, droneLevel: 0.4, dronePitch: -12, droneBright: 0.2, subLevel: 0.6, noiseBase: 0.5,
         noiseColor: 0.7, noiseBubble: 0.8, noiseBubbleRate: 90, noiseBubbleSize: 0.6, noiseCrackle: 0.15, noiseDensity: 300,
         noiseGrainSize: 0.2, noiseSwell: 0.15, noiseSwellT: 16, noiseRes: 0.7, resDecay: 3, resPitch: 12, scale: 'penta',
         tone: 2600, space: 0.55, spaceDecay: 5 } },
  { cat: '環境', name: '空電', seed: 1901,                       // 空電と、受信しかけの声
    p: { noiseLevel: 0.82, voiceLevel: 0.7, droneLevel: 0.5, resLevel: 0.2, dronePitch: -12, droneBright: 0.2, subLevel: 0.6,
         noiseColor: 0.5, noiseSwell: 0.1, noiseCrackle: 0.6, noiseDensity: 5, noiseGrainSize: 0.2, noiseFlutter: 0.35,
         noiseHum: 0.4, noiseFilt: 0.8, noiseReso: 0.92, noiseFiltMode: 'whistler', noiseFiltFreq: 900, noiseFiltMove: 0.7,
         noiseFiltRate: 0.2, noiseEcho: 0.3, echoMix: 0.3, echoTime: 0.6, echoFb: 0.5, echoTone: 0.25, voiceFar: 0.8,
         voiceGap: 0.7, voiceBreath: 0.4, voiceCount: '2', voiceEcho: 0.5, tone: 3600, space: 0.45 } },
  { cat: '環境', name: '蓄音機', seed: 1925,                     // 回る旋律と針音
    p: { arpLevel: 0.8, noiseLevel: 0.75, droneLevel: 0.3, resLevel: 0.2, droneBright: 0.3, dronePitch: -12, noiseColor: 0.55,
         noiseSwell: 0.05, noiseCrackle: 0.6, noiseDensity: 12, noiseGrainSize: 0.1, noiseGrainRing: 0, noiseHum: 0.3,
         noiseRes: 0, arpMode: 'loops', arpRate: 1, arpGate: 1.5, arpSoft: 0.5, arpWidth: 0.4, arpCenter: 330, arpEcho: 0.9,
         arpRes: 0.2, echoMix: 0.55, echoTime: 0.11, echoFb: 0.25, echoTone: 0.2, echoWow: 1, echoPing: 0, scale: 'dorian',
         temper: 'et', tone: 2000, width: 0.25, space: 0.35, spaceDecay: 2 } },

  /* ---- 実験：聴くためのもの。眠りには向かない ---- */
  { cat: '実験', name: '電気嵐', seed: 1969,                     // ドローン・グリッサンド・笛の三本立て
    p: { droneLevel: 0.76, arpLevel: 0.68, fluteLevel: 0.66, noiseLevel: 0.45, resLevel: 0.45, arpMode: 'gliss', arpDir: 'pend',
         arpRate: 0.5, arpCenter: 280, arpWidth: 1.6, phaserMix: 0.8, phaserRate: 0.05, phaserFb: 0.7, noiseColor: 0.6,
         noiseFlutter: 0.3, noiseDrive: 0.3, droneBright: 0.5, droneBeat: 1.5, subLevel: 0.55, flutePitch: 600, fluteBody: 0.1,
         fluteGlide: 1, fluteVib: 0.8, fluteLen: 3, fluteNotes: 5, fluteRange: 0.8, fluteGap: 0.55, fluteFar: 0.55, fluteEcho: 0.7,
         echoMix: 0.35, echoTime: 0.42, echoFb: 0.6, echoTone: 0.3, resEcho: 0.5, arpEcho: 0.6, resDecay: 6, tone: 3200,
         space: 0.5, spaceDecay: 7 } },
  { cat: '実験', name: 'ダブ', seed: 1976,                       // 低いドローンと酔歩のアルペジオ。鐘がエコーに放り込まれる
    p: { droneLevel: 0.8, arpLevel: 0.8, bellLevel: 0.6, resLevel: 0.4, noiseLevel: 0.3, dronePitch: -12, subLevel: 0.8,
         droneBright: 0.3, noiseFilt: 0.8, noiseReso: 0.97, noiseFiltMode: 'wander', noiseFiltFreq: 450, noiseFiltMove: 0.35,
         noiseFiltRate: 1.4, noiseEcho: 0.8, arpMode: 'step', arpDir: 'walk', arpRate: 1.2, arpGate: 0.7, arpSoft: 0.35,
         arpWidth: 0.5, arpRest: 0.4, arpCenter: 300, scale: 'pentam', bellPitch: 240, bellTimbre: 0.6, bellDecay: 2.5,
         bellHard: 0.4, bellNotes: 2, bellRate: 0.45, bellGap: 0.55, bellFar: 0.4, bellEcho: 0.8, dub: 0.55, echoMix: 0.5,
         echoTime: 0.45, echoFb: 0.68, echoTone: 0.2, arpEcho: 0.6, resDecay: 5, tone: 2600, space: 0.5 } },
  { cat: '実験', name: '交信', seed: 1963,                       // 乱択のアルペジオと遠い声。荒れた雑音が中に入る
    p: { arpLevel: 0.78, voiceLevel: 0.75, noiseLevel: 0.6, droneLevel: 0.5, resLevel: 0.25, droneBright: 0.6, droneEven: 0.2,
         noiseColor: 0.4, noisePitch: 0.2, noiseFlutter: 0.5, noiseCrush: 0.35, arpMode: 'step', arpDir: 'rand', arpRate: 4,
         arpGate: 0.6, arpSoft: 0.2, arpWidth: 0.35, arpRest: 0.3, arpCenter: 500, arpEcho: 0.8, scale: 'chroma', temper: 'et',
         voiceBreath: 0.6, voiceFar: 0.6, voiceGap: 0.55, voiceEcho: 0.7, phaserMix: 0.6, phaserRate: 0.3, echoMix: 0.6,
         echoTime: 0.27, echoFb: 0.8, echoTone: 0.3, echoPing: 0.9, echoWow: 0.7, lfo1Target: 'arpCenter', lfo1Shape: 'step',
         lfo1Rate: 0.4, lfo1Depth: 0.5, lfo2Target: 'echoTime', lfo2Shape: 'smooth', lfo2Rate: 0.05, lfo2Depth: 0.3, dub: 0.3,
         tone: 3800, space: 0.5 } },
  { cat: '実験', name: '帰還', seed: 1958,                       // ハウリング寸前の帰還と、それに共振する共鳴
    p: { noiseLevel: 0.8, resLevel: 0.7, droneLevel: 0.5, droneBright: 0.3, subLevel: 0.6, noiseColor: 0.7, noiseSwell: 0.3,
         noiseFb: 0.97, noiseFiltMode: 'scale', noiseFiltFreq: 110, noiseFiltMove: 0.45, noiseFiltRate: 0.06, noiseDrive: 0.4,
         noiseHum: 0.4, noiseCrush: 0.1, noiseRes: 0.3, phaserMix: 0.5, noiseEcho: 0.4, echoMix: 0.4, echoTime: 0.5, echoFb: 0.6,
         echoTone: 0.2, scale: 'pentam', resDecay: 4, tone: 2400, space: 0.6 } },
];
