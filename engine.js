// FoolsIron 発音部（AudioWorklet）
// 持続音・雑音・共鳴器群・反復・声・残響を一つの処理器の中で鳴らす。
import { PARAMS, MACROS, scaleRatios, norm, denorm } from './params.js';

const SR = sampleRate;
const LN1000 = 6.907755;

/* ---------- 共通の道具 ---------- */
const TS = 4096;
const SIN = new Float32Array(TS + 2);
for (let i = 0; i < TS + 2; i++) SIN[i] = Math.sin(2 * Math.PI * i / TS);

function mulberry32(a) {
  return function () {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

let ns = 0x2545F491 | 0;
function white() {             // -1..1 の一様乱数
  ns ^= ns << 13; ns ^= ns >> 17; ns ^= ns << 5;
  return ns * 4.656612873077393e-10;
}

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

// 非周期のゆるい動き。乱数の目標値のあいだを余弦で渡る
class Wander {
  constructor(rng) {
    this.rng = rng;
    this.a = rng() * 2 - 1; this.b = rng() * 2 - 1;
    this.t = rng(); this.d = 0.6 + rng() * 0.8; this.v = 0;
  }
  step(dt, rate) {
    this.t += dt * rate / this.d;
    while (this.t >= 1) {
      this.t -= 1; this.a = this.b; this.b = this.rng() * 2 - 1; this.d = 0.6 + this.rng() * 0.8;
    }
    return this.v = this.a + (this.b - this.a) * (0.5 - 0.5 * Math.cos(Math.PI * this.t));
  }
}

// 等パワーの左右配分（中央で両側 1）
function panL(p) { return Math.cos((clamp(p, -1, 1) + 1) * Math.PI / 4) * Math.SQRT2; }
function panR(p) { return Math.sin((clamp(p, -1, 1) + 1) * Math.PI / 4) * Math.SQRT2; }

// 発音部の出力を、音量を滑らかに渡しながら乾音と残響送りへ足す
function mixTo(n, sL, sR, g0, g1, dL, dR, send, wL, wR, e0, e1, eL, eR) {
  const dg = (g1 - g0) / n, de = (e1 - e0) / n;
  let g = g0, e = e0;
  for (let k = 0; k < n; k++) {
    g += dg; e += de;
    const l = sL[k] * g, r = sR[k] * g;
    dL[k] += l; dR[k] += r;
    wL[k] += l * send; wR[k] += r * send;
    eL[k] += l * e; eR[k] += r * e;
  }
}

/* ---------- 音階の上を歩く道具（雑音・笛・鐘が使う） ---------- */
// 「間」のつまみ → 沈黙の平均秒数（0.25秒〜60秒）
const gapSec = g => 0.25 * Math.pow(240, g);

// 中心の上下 range オクターブに入る音階の音（log2 Hz）を低い順に並べる
function ladder(f0, ratios, center, range) {
  const lc = Math.log2(center), l0 = Math.log2(f0), out = [];
  let best = l0, bd = 1e9;
  for (let o = Math.floor(lc - range - l0) - 1; o <= Math.ceil(lc + range - l0) + 1; o++) {
    for (const r of ratios) {
      const l = l0 + o + Math.log2(r), d = Math.abs(l - lc);
      if (d <= range) out.push(l);
      if (d < bd) { bd = d; best = l; }
    }
  }
  if (!out.length) out.push(best);
  return out;
}
// 梯子の上を一、二段ずつ歩く。端では折り返す
function walk(rng, idx, len) {
  if (len < 2) return 0;
  const r = rng();
  idx += r < 0.12 ? 0 : (rng() < 0.5 ? -1 : 1) * (r < 0.75 ? 1 : 2);
  if (idx < 0) idx = Math.min(len - 1, -idx);
  if (idx >= len) idx = Math.max(0, 2 * (len - 1) - idx);
  return idx;
}

/* ---------- 持続音：倍音格子 ---------- */
class Drone {
  constructor(rng) {
    this.N = 16;
    this.ph = new Float64Array(this.N * 2);
    this.amp = new Float64Array(this.N);
    this.base = new Float64Array(this.N);
    this.beatMul = new Float64Array(this.N);
    this.w = []; this.pw = [];
    for (let i = 0; i < this.N; i++) {
      this.ph[i * 2] = rng(); this.ph[i * 2 + 1] = rng();
      this.beatMul[i] = 0.7 + rng() * 0.6;
      this.w.push(new Wander(rng)); this.pw.push(new Wander(rng));
    }
    this.subPh = 0; this.subAmp = 0;
  }
  render(P, S, f0, n, tL, tR) {
    const dt = n / SR, N = this.N;
    const tilt = 2.4 - 1.9 * P.droneBright;
    let sumsq = 0;
    for (let i = 0; i < N; i++) {
      const h = i + 1;
      let g = Math.pow(h, -tilt) * clamp(P.droneParts - i, 0, 1);
      if ((h & 1) === 0) g *= P.droneEven;
      if (f0 * h > SR * 0.45) g = 0;
      this.base[i] = g; sumsq += g * g;
    }
    const nrm = 0.42 / Math.sqrt(sumsq || 1);
    const wd = P.droneWidth;
    for (let i = 0; i < N; i++) {
      const z = this.w[i].step(dt, P.flucRate);
      const po = this.pw[i].step(dt, P.flucRate * 0.7) * P.sway * 0.8;
      const target = this.base[i] * nrm * Math.max(0, 1 + P.fluc * z);
      let a = this.amp[i];
      if (a < 1e-7 && target < 1e-7) { this.amp[i] = target; continue; }
      const da = (target - a) / n;
      const fr = f0 * (i + 1), b = P.droneBeat * this.beatMul[i] * 0.5;
      const i1 = Math.max(1, fr - b) / SR, i2 = (fr + b) / SR;
      const sl = 1 - Math.max(0, po), sr = 1 + Math.min(0, po);
      const gl1 = (0.5 + 0.5 * wd) * sl, gr1 = (0.5 - 0.5 * wd) * sr;
      const gl2 = (0.5 - 0.5 * wd) * sl, gr2 = (0.5 + 0.5 * wd) * sr;
      let p1 = this.ph[i * 2], p2 = this.ph[i * 2 + 1];
      for (let k = 0; k < n; k++) {
        let x = p1 * TS, j = x | 0;
        const s1 = SIN[j] + (SIN[j + 1] - SIN[j]) * (x - j);
        x = p2 * TS; j = x | 0;
        const s2 = SIN[j] + (SIN[j + 1] - SIN[j]) * (x - j);
        a += da;
        tL[k] += a * (s1 * gl1 + s2 * gl2);
        tR[k] += a * (s1 * gr1 + s2 * gr2);
        p1 += i1; if (p1 >= 1) p1 -= 1;
        p2 += i2; if (p2 >= 1) p2 -= 1;
      }
      this.ph[i * 2] = p1; this.ph[i * 2 + 1] = p2; this.amp[i] = target;
    }
    // 副発振：基音の下、あるいは同じ高さでずらして唸らせる
    const st = P.subLevel * P.subLevel * 0.3;
    if (this.subAmp > 1e-7 || st > 1e-7) {
      const inc = f0 * Math.pow(2, -(+S.subOct) + P.subDetune / 1200) / SR;
      let a = this.subAmp, p = this.subPh;
      const da = (st - a) / n;
      for (let k = 0; k < n; k++) {
        const x = p * TS, j = x | 0;
        const s = SIN[j] + (SIN[j + 1] - SIN[j]) * (x - j);
        a += da;
        tL[k] += a * s; tR[k] += a * s;
        p += inc; if (p >= 1) p -= 1;
      }
      this.subPh = p;
    }
    this.subAmp = st;
  }
}

/* ---------- 雑音：乱数の雑音に限らず、空電・ハム・帰還・発振するフィルターまで ---------- */
// 帯域を移すと痩せる分の埋め合わせ。高域側は耳につくので半ばまで
const MAKEUP = (pt, c) => Math.pow(10, pt * pt * (pt < 0 ? 12 - 6 * c : 5 + 8 * c) / 20);
const CN = 4096;      // 帰還路の遅延線の長さ
class Noise {
  constructor(rng) {
    this.rng = rng;
    this.b = [new Float64Array(7), new Float64Array(7)];
    this.br = [0, 0];
    this.swPh = rng(); this.swVar = 1;
    this.gL = 0; this.gR = 0; this.gE = 0;
    this.fs = [new Float64Array(4), new Float64Array(4)];     // 帯域を移す濾波の状態
    this.buf = [new Float32Array(128), new Float32Array(128)];
    this.sg = new Float32Array(128);
    // 素材
    // 事象：粒子（ぶつかる粒）、泡（水中の気泡）、軋み（貼り付いては滑る摩擦）
    const f8 = () => new Float64Array(8);
    this.pt = { x: f8(), y: f8(), c: f8(), s: f8(), be: f8(), bd: f8(), g: f8(), gl: f8(), gr: f8() }; this.pi = 0; this.ptOn = false;
    this.bb = { ph: f8(), inc: f8(), di: f8(), a: f8(), d: f8(), gl: f8(), gr: f8() }; this.bi = 0; this.bbOn = false;
    this.cr = { x: new Float64Array(3), y: new Float64Array(3), c: new Float64Array(3), s: new Float64Array(3) };
    this.crPh = 0; this.crThr = 1; this.crW = new Wander(rng); this.crOn = false;
    this.spT = 1; this.spV = 1; this.spLeft = 0;        // 荒れ（不規則な噴き）
    this.humPh = 0;
    this.crCnt = [0, 0]; this.crHold = [0, 0];
    // 加工
    this.comb = [new Float32Array(CN), new Float32Array(CN)]; this.cw = 0; this.clp = [0, 0];
    this.sv = [new Float64Array(2), new Float64Array(2)]; this.vp = [0, 0];     // 共振フィルターの状態
    this.lf = Math.log2(800); this.tlf = this.lf; this.fw = new Wander(rng);
    this.stepLeft = 0; this.idx = -1;
    this.whT = 0; this.whDur = 1; this.whLeft = 0; this.whGate = 0;
    this.mix = 0; this.fbg = 0;
  }
  // 共振フィルター（と帰還路）の周波数を、選ばれた動き方で進める
  moveFilter(P, S, f0, ratios, dt) {
    const rng = this.rng, c = Math.log2(P.noiseFiltFreq), span = P.noiseFiltMove * 2, mode = S.noiseFiltMode;
    let gate = 1;
    if (mode === 'wander') this.tlf = c + span * this.fw.step(dt, P.noiseFiltRate);
    else if (mode === 'scale') {
      this.stepLeft -= dt * P.noiseFiltRate;
      if (this.stepLeft <= 0) {
        this.stepLeft += 0.6 + 0.8 * rng();
        const lad = ladder(f0, ratios, P.noiseFiltFreq, span);
        if (this.idx < 0 || this.idx >= lad.length) this.idx = Math.floor(rng() * lad.length);
        this.idx = walk(rng, this.idx, lad.length);
        this.tlf = lad[this.idx];
      }
    } else if (mode === 'whistler') {            // 高みから降りてくる口笛。空電の一種
      if (this.whLeft > 0) {
        this.whLeft -= dt;
        const u = clamp(1 - this.whLeft / this.whDur, 0, 1);
        this.tlf = c + span * (1 - 2 * Math.sqrt(u));
        gate = Math.sin(Math.PI * u);
      } else {
        gate = 0;
        this.whT -= dt * P.noiseFiltRate;
        if (this.whT <= 0) {
          this.whT = 0.3 + 1.5 * rng(); this.whDur = this.whLeft = 0.5 + 1.6 * rng();
          this.lf = this.tlf = c + span;
        }
      }
    } else this.tlf = c;
    this.lf += (this.tlf - this.lf) * (1 - Math.exp(-dt / (mode === 'scale' ? 0.03 : 0.015)));
    this.whGate += (gate - this.whGate) * (1 - Math.exp(-dt / 0.05));
    return clamp(Math.pow(2, this.lf), 30, Math.min(12000, SR * 0.4));
  }
  // 物理由来の事象を、左右の作業領域へ足し込む
  events(P, n, dt) {
    const rng = this.rng, A = this.buf[0], B = this.buf[1];

    // 粒子：多数の粒が器や地面にぶつかる。一粒ごとに、短い雑音の突きが小さな共鳴体を鳴らす
    const pg = P.noiseCrackle * P.noiseCrackle;
    if (pg > 1e-4 || this.ptOn) {
      const q = this.pt, size = P.noiseGrainSize, ring = P.noiseGrainRing;
      const pd = pg > 1e-4 ? P.noiseDensity / SR : 0;
      const lvl = pg * 1.4 * Math.min(1, Math.pow(200 / P.noiseDensity, 0.4));
      let e = 0;
      for (let k = 0; k < n; k++) {
        const u = white();
        if (u > 0 && u < pd) {
          const i = this.pi = (this.pi + 1) & 7;
          const fc = Math.min(6500 * Math.pow(0.03, size) * Math.pow(2, (rng() - 0.5) * 1.8), SR * 0.4);
          const t60 = (0.003 + 0.06 * size * size) * (1 + 20 * ring * ring);
          const r = Math.exp(-LN1000 / (t60 * SR)), th = 2 * Math.PI * fc / SR, a = rng();
          q.c[i] = r * Math.cos(th); q.s[i] = r * Math.sin(th);
          q.be[i] = 0.25 + 0.75 * a * a; q.bd[i] = Math.exp(-1 / ((0.0003 + 0.003 * size) * SR));
          q.g[i] = Math.sqrt(1 - r) * 2.2;
          const p = rng() * 2 - 1; q.gl[i] = panL(p * 0.9); q.gr[i] = panR(p * 0.9);
        }
        let l = 0, rr = 0;
        for (let i = 0; i < 8; i++) {
          const be = q.be[i], x = q.x[i], y = q.y[i];
          if (be < 1e-5 && x * x + y * y < 1e-10) continue;
          const nx = q.c[i] * x - q.s[i] * y + (be > 1e-5 ? white() * be * q.g[i] : 0);
          const ny = q.s[i] * x + q.c[i] * y;
          q.x[i] = nx; q.y[i] = ny; q.be[i] = be * q.bd[i];
          l += ny * q.gl[i]; rr += ny * q.gr[i]; e += ny * ny;
        }
        A[k] += l * lvl; B[k] += rr * lvl;
      }
      this.ptOn = e > 1e-9 || pd > 0;
    }

    // 泡：水中の気泡。小さいほど高く短く鳴り、水面へ近づくにつれ音が上へ滑る
    const bg = P.noiseBubble * P.noiseBubble;
    if (bg > 1e-4 || this.bbOn) {
      const q = this.bb, size = P.noiseBubbleSize;
      const pd = bg > 1e-4 ? P.noiseBubbleRate / SR : 0;
      const lvl = bg * 0.9 * Math.min(1, Math.pow(40 / P.noiseBubbleRate, 0.4));
      let e = 0;
      for (let k = 0; k < n; k++) {
        const u = white();
        if (u > 0 && u < pd) {
          const i = this.bi = (this.bi + 1) & 7;
          const fb = Math.min(4500 * Math.pow(0.07, size) * Math.pow(2, (rng() - 0.5) * 1.6), SR * 0.3);
          const dmp = 0.043 * fb + 0.0014 * Math.pow(fb, 1.5);            // 減衰（毎秒）。半径の小さい泡ほど速く消える
          const a = rng();
          q.ph[i] = 0; q.inc[i] = fb / SR; q.di[i] = fb * dmp * 0.14 * rng() / SR / SR;
          q.a[i] = (0.2 + 0.8 * a * a) * Math.pow(600 / fb, 0.3); q.d[i] = Math.exp(-dmp / SR);
          const p = rng() * 2 - 1; q.gl[i] = panL(p * 0.9); q.gr[i] = panR(p * 0.9);
        }
        let l = 0, rr = 0;
        for (let i = 0; i < 8; i++) {
          const a = q.a[i];
          if (a < 1e-5) continue;
          let p = q.ph[i] + q.inc[i]; if (p >= 1) p -= 1;
          q.ph[i] = p; q.inc[i] += q.di[i]; q.a[i] = a * q.d[i];
          const x = p * TS, j = x | 0, v = (SIN[j] + (SIN[j + 1] - SIN[j]) * (x - j)) * a;
          l += v * q.gl[i]; rr += v * q.gr[i]; e += a;
        }
        A[k] += l * lvl; B[k] += rr * lvl;
      }
      this.bbOn = e > 1e-5 || pd > 0;
    }

    // 軋み：押す力が溜まり、限度を越えた瞬間に滑って胴を叩く。その繰り返しが軋みになる
    const cg = P.noiseCreak * P.noiseCreak;
    if (cg > 1e-4 || this.crOn) {
      const q = this.cr, rate = P.noiseCreakRate;
      // 押す速さは不規則に漂い、止まることもある
      const speed = cg > 1e-4 ? clamp(this.crW.step(dt, 0.7) * 2.4 - 0.45, 0, 1.6) : 0;
      const k3 = Math.pow(60 / rate, 0.25);
      const modes = [310 * k3, 790 * k3, 2050 * k3];
      for (let i = 0; i < 3; i++) {
        const r = Math.exp(-LN1000 / ((0.05 - 0.012 * i) * SR)), th = 2 * Math.PI * Math.min(modes[i], SR * 0.4) / SR;
        q.c[i] = r * Math.cos(th); q.s[i] = r * Math.sin(th);
      }
      const inc = rate * speed / SR, lvl = cg * 0.35 * Math.min(1, Math.pow(40 / rate, 0.3));
      let ph = this.crPh, thr = this.crThr, e = 0;
      for (let k = 0; k < n; k++) {
        ph += inc;
        let imp = 0;
        if (ph >= thr) { ph -= thr; imp = thr * (white() > 0 ? 1 : -1); thr = 0.93 + 0.14 * rng(); }       // 限度は毎回僅かに違う。揃いすぎれば楽音に、乱れすぎれば雑音になる
        let o = 0;
        for (let i = 0; i < 3; i++) {
          const x = q.x[i], y = q.y[i];
          const nx = q.c[i] * x - q.s[i] * y + imp * (1 - 0.25 * i);
          const ny = q.s[i] * x + q.c[i] * y;
          q.x[i] = nx; q.y[i] = ny; o += ny;
        }
        e += o * o;
        A[k] += o * lvl; B[k] += o * lvl * 0.8;
      }
      this.crPh = ph; this.crThr = thr;
      this.crOn = e > 1e-9 || speed > 0;
    }
  }
  render(P, S, f0, ratios, n, tL, tR, excN) {
    if (this.buf[0].length < n) { this.buf = [new Float32Array(n), new Float32Array(n)]; this.sg = new Float32Array(n); }
    const rng = this.rng, dt = n / SR;
    const c = P.noiseColor;
    let wW = 0, wP = 0, wB = 0;
    if (c < 0.5) { wW = Math.cos(c * Math.PI); wP = Math.sin(c * Math.PI); }
    else { wP = Math.cos((c - 0.5) * Math.PI); wB = Math.sin((c - 0.5) * Math.PI); }
    const base = P.noiseBase * P.noiseBase;       // 地の雑音の量。零にすれば事象だけが鳴る
    wW *= 0.35 * base; wP *= 0.118 * base; wB *= 2.3 * base;       // 三色の実効値を揃える係数

    // 荒れ：不規則な間隔で、音量が跳ね、沈む。左右共通
    const fl = P.noiseFlutter, sg = this.sg;
    if (fl > 0.002) {
      let v = this.spV, t = this.spT, left = this.spLeft;
      const ks = 1 - Math.exp(-1 / (0.004 * SR));
      for (let k = 0; k < n; k++) {
        if (--left <= 0) {
          left = -Math.log(1 - rng() * 0.999) * SR / (8 + 50 * fl);
          const u = rng();
          t = u * u * u * 2.8;
        }
        v += (t - v) * ks;
        sg[k] = 1 - fl + fl * v;
      }
      this.spV = v; this.spT = t; this.spLeft = left;
    }
    // ハム：電源由来の低い唸り（50Hz とその奇数倍）
    const hum = P.noiseHum * P.noiseHum * 0.22;
    let hp = this.humPh;
    const hinc = 50 / SR;
    // クラッシュ：標本化を粗くする
    const crN = 1 + Math.floor(P.noiseCrush * P.noiseCrush * 60);

    for (let ch = 0; ch < 2; ch++) {
      const b = this.b[ch], o = this.buf[ch];
      let br = this.br[ch];
      let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6];
      let ph = this.humPh;
      for (let k = 0; k < n; k++) {
        const w = white();
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
        br = (br + 0.02 * w) / 1.02;
        let y = w * wW + pink * wP + br * wB;
        if (fl > 0.002) y *= sg[k];
        if (hum > 1e-5) {
          ph += hinc; if (ph >= 1) ph -= 1;
          const x = ph * TS, j = x | 0, s1 = SIN[j];
          y += hum * (s1 + 0.5 * SIN[(j * 3) & (TS - 1)] + 0.33 * SIN[(j * 5) & (TS - 1)] + 0.2 * SIN[(j * 7) & (TS - 1)]);
        }
        o[k] = y;
      }
      hp = ph;
      b[0] = b0; b[1] = b1; b[2] = b2; b[3] = b3; b[4] = b4; b[5] = b5; b[6] = b6;
      this.br[ch] = br;
      if (crN > 1) {
        let cnt = this.crCnt[ch], hold = this.crHold[ch];
        for (let k = 0; k < n; k++) { if (++cnt >= crN) { cnt = 0; hold = o[k]; } o[k] = hold; }
        this.crCnt[ch] = cnt; this.crHold[ch] = hold;
      }
    }
    this.humPh = hp;
    this.events(P, n, dt);

    // 加工：帰還路 → 共振フィルター → 歪み
    const mix1 = P.noiseFilt, fb1 = P.noiseFb * 1.04;
    const active = mix1 > 0.002 || this.mix > 0.002 || fb1 > 0.002 || this.fbg > 0.002;
    if (active) {
      const f = this.moveFilter(P, S, f0, ratios, dt);
      const r = P.noiseReso;
      const kq = 2 * Math.pow(1 - r, 2.5) - 0.03 * Math.pow(r, 12);       // 0 を割れば自ら発振する
      const g = Math.tan(Math.PI * f / SR);
      // 鋭くするほど入力を絞り、雑音を通したときの音量を保つ
      const inG = Math.sqrt(Math.max(kq, 0.002) / 2) * 3.3;
      const nrm = 0.9 * this.whGate;
      const cut = S.noiseFiltMode === 'whistler' ? 0.25 : 1;     // 降下では、地の雑音を残したまま口笛を重ねる
      const D = clamp(SR / f, 2, CN - 2);
      const klp = 1 - Math.exp(-2 * Math.PI * 5000 / SR);
      const dm = (mix1 - this.mix) / n, df = (fb1 - this.fbg) / n;
      const w0 = this.cw;
      for (let ch = 0; ch < 2; ch++) {
        const o = this.buf[ch], cb = this.comb[ch], sv = this.sv[ch];
        let w = w0, clp = this.clp[ch], ic1 = sv[0], ic2 = sv[1], m = this.mix, fb = this.fbg, vp = this.vp[ch];
        for (let k = 0; k < n; k++) {
          m += dm; fb += df;
          let x = o[k];
          // 帰還路：フィルターの音高に合わせた遅延。帰還が 1 を超えるとハウリングになる
          let pos = w - D; if (pos < 0) pos += CN;
          if (pos >= CN) pos = 0;                  // 丸めで端に乗ることがある
          const i = pos | 0, j = i + 1 >= CN ? 0 : i + 1;
          const d = cb[i] + (cb[j] - cb[i]) * (pos - i);
          clp += (d - clp) * klp;
          x = x * (1 - 0.4 * fb) + Math.tanh(clp) * fb;
          cb[w] = x + 1e-20; if (++w >= CN) w = 0;
          // 共振フィルター（帯域通過）
          // 振れが大きいほど減衰を増す。発振は一定の振幅で釣り合い、暴走しない
          const ke = kq + 0.25 * vp * vp;
          const a1 = 1 / (1 + g * (g + ke)), a2 = g * a1, a3 = g * a2;
          const v3 = x * inG - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
          ic1 = v1 + v1 - ic1; ic2 = v2 + v2 - ic2;
          if (ic1 > 8) ic1 = 8; else if (ic1 < -8) ic1 = -8;
          if (ic2 > 8) ic2 = 8; else if (ic2 < -8) ic2 = -8;
          vp = v1;
          o[k] = x * (1 - m * cut) + v1 * nrm * m;
        }
        this.clp[ch] = clp; sv[0] = ic1; sv[1] = ic2; this.vp[ch] = vp;
        if (ch) this.cw = w;
      }
      this.mix = mix1; this.fbg = fb1;
    }
    const drv = P.noiseDrive;
    if (drv > 0.002) {
      const pre = 1 + drv * drv * 40, post = 0.5 / Math.tanh(0.5 * pre) * (1 - 0.35 * drv);
      for (let ch = 0; ch < 2; ch++) { const o = this.buf[ch]; for (let k = 0; k < n; k++) o[k] = Math.tanh(o[k] * pre) * post; }
    }

    // 高低：負なら高域を削り、正なら低域を削る（いずれも 12dB/oct）
    const pt = P.noisePitch;
    const kl = 1 - Math.exp(-2 * Math.PI * (pt < 0 ? 20000 * Math.pow(0.006, -pt) : 20000) / SR);
    const kh = 1 - Math.exp(-2 * Math.PI * (pt > 0 ? 20 * Math.pow(250, pt) : 20) / SR);
    const mk = MAKEUP(pt, c);
    for (let ch = 0; ch < 2; ch++) {
      const o = this.buf[ch], fs = this.fs[ch];
      let l1 = fs[0], l2 = fs[1], h1 = fs[2], h2 = fs[3];
      for (let k = 0; k < n; k++) {
        let y = o[k];
        l1 += (y - l1) * kl; l2 += (l1 - l2) * kl; y = l2;
        h1 += (y - h1) * kh; y -= h1; h2 += (y - h2) * kh; y -= h2;
        o[k] = y * mk;
      }
      fs[0] = l1; fs[1] = l2; fs[2] = h1; fs[3] = h2;
    }

    // 寄せては返す音量の波
    this.swPh += n / SR / P.noiseSwellT * this.swVar;
    if (this.swPh >= 1) { this.swPh -= 1; this.swVar = 0.75 + this.rng() * 0.5; }
    const d = P.noiseSwell;
    const mL = 1 - d * (0.5 + 0.5 * Math.cos(2 * Math.PI * this.swPh));
    const mR = 1 - d * (0.5 + 0.5 * Math.cos(2 * Math.PI * (this.swPh + 0.06 * P.noiseWidth)));
    const mE = (mL + mR) * 0.5 * P.noiseRes * P.noiseRes;
    const wc = Math.cos(P.noiseWidth * Math.PI / 2), wsn = Math.sin(P.noiseWidth * Math.PI / 2);
    const A = this.buf[0], B = this.buf[1];
    let gL = this.gL, gR = this.gR, gE = this.gE;
    const dL = (mL - gL) / n, dR = (mR - gR) / n, dE = (mE - gE) / n;
    for (let k = 0; k < n; k++) {
      gL += dL; gR += dR; gE += dE;
      const a = A[k], r = a * wc + B[k] * wsn;
      tL[k] += a * gL; tR[k] += r * gR;
      excN[k] += (a + B[k]) * 0.5 * gE;
    }
    this.gL = mL; this.gR = mR; this.gE = mE;
  }
}

/* ---------- 共鳴器群：音階に調律し、全発音部が共有する ---------- */
class ResBank {
  constructor(rng) {
    this.N = 16;
    this.x = new Float64Array(this.N); this.y = new Float64Array(this.N);
    this.lf = new Float64Array(this.N).fill(-1);
    this.g = new Float64Array(this.N);
    this.w = []; this.pw = []; this.pan = new Float64Array(this.N);
    for (let k = 0; k < this.N; k++) {
      this.w.push(new Wander(rng)); this.pw.push(new Wander(rng));
      this.pan[k] = ((k * 0.618034) % 1) * 2 - 1;
    }
  }
  render(P, f0, ratios, n, excN, excT, tL, tR) {
    const dt = n / SR, L = ratios.length;
    const kf = 1 - Math.exp(-dt / 0.12);
    const top = Math.min(SR * 0.42, 10000);
    for (let k = 0; k < this.N; k++) {
      const oct = Math.floor(k / L);
      const lt = Math.log2(f0 * ratios[k % L]) + 1 + P.resPitch / 12 + oct;
      if (this.lf[k] < 0) this.lf[k] = lt;
      this.lf[k] += (lt - this.lf[k]) * kf;
      const f = Math.pow(2, this.lf[k]);
      const z = this.w[k].step(dt, P.flucRate);
      const pz = this.pw[k].step(dt, P.flucRate * 0.7);
      const og = f < top ? Math.max(0, 1 + P.fluc * z) / Math.sqrt(1 + oct) : 0;
      let g = this.g[k];
      const dg = (og - g) / n;
      const t60 = clamp(P.resDecay * Math.pow(220 / f, 0.35), 0.05, 30);
      const r = Math.exp(-LN1000 / (t60 * SR));
      const th = 2 * Math.PI * Math.min(f, top) / SR;
      const c = r * Math.cos(th), s = r * Math.sin(th);
      const gN = Math.sqrt(2 * (1 - r)) * 0.45, gT = (1 - r) * 2.5;
      const p = clamp(this.pan[k] * P.resWidth + pz * P.sway * 0.6, -1, 1);
      const gl = panL(p), gr = panR(p);
      let x = this.x[k], y = this.y[k];
      for (let i = 0; i < n; i++) {
        const nx = c * x - s * y + excN[i] * gN + excT[i] * gT + 1e-20;
        y = s * x + c * y; x = nx;
        g += dg;
        const o = y * g;
        tL[i] += o * gl; tR[i] += o * gr;
      }
      this.x[k] = x; this.y[k] = y; this.g[k] = og;
    }
  }
}

/* ---------- 反復：オクターブ積層の声部（シェパード音）を三つの型で鳴らす ---------- */
const AK = 10;        // 積層するオクターブの数
class Arp {
  constructor(rng) {
    this.rng = rng;
    this.voices = [];
    for (let i = 0; i < 10; i++) this.voices.push({ on: false, ph: new Float64Array(AK) });
    this.m = new Float32Array(128);
    this.clock = 0; this.idx = 0; this.pos = 0; this.pdir = 1;
    this.gPh = new Float64Array(AK); this.gAmp = new Float64Array(AK); this.gP = 0; this.gOn = 0;
    this.gW = new Wander(rng);
    this.reseed(rng);
  }
  reseed(rng) {
    this.slots = [];
    const mult = [1, 1.272, 1.618, 2.058, 2.618, 3.33];
    for (let i = 0; i < 6; i++) {
      const m = mult[i] * (0.96 + rng() * 0.08);
      this.slots.push({ mult: m, pos: Math.floor(rng() * 24), clock: m * 8 * rng() });
    }
  }
  trigger(ratio, shift, snap, len, P) {
    let v = this.voices.find(x => !x.on);
    if (!v) { v = this.voices[0]; for (const x of this.voices) if (x.age / x.total > v.age / v.total) v = x; }
    const soft = P.arpSoft;
    v.on = true; v.ratio = ratio; v.shift = shift; v.snap = snap;
    v.att = 0.012 + soft * Math.min(len * 0.5, 2.5);
    v.rel = 0.06 + soft * Math.min(len, 5) + 0.15 * len;
    v.len = Math.max(len, v.att); v.age = 0; v.total = v.len + v.rel;
    v.vel = 0.7 + this.rng() * 0.3;
    v.pan = (this.rng() * 2 - 1) * P.arpPan;
  }
  env(v, t) {
    if (t < v.att) return 0.5 - 0.5 * Math.cos(Math.PI * t / v.att);
    if (t < v.len) return 1;
    const u = (t - v.len) / v.rel;
    return u >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * u);
  }
  stepSeq(P, S, ratios) {
    const L = ratios.length, M = 2 * L, st = Math.round(P.arpStride), rng = this.rng;
    let deg, shift = 0, snap = false;
    if (S.arpDir === 'up' || S.arpDir === 'down') {
      this.idx = ((this.idx + (S.arpDir === 'up' ? st : -st)) % L + L) % L;
      deg = this.idx;
    } else {
      if (S.arpDir === 'pend') this.pos += this.pdir * st;
      else if (S.arpDir === 'walk') this.pos += (rng() < 0.5 ? -1 : 1) * (rng() < 0.3 ? 2 : 1) * st;
      else this.pos = Math.floor(rng() * M);
      if (this.pos >= M - 1) { this.pos = Math.max(0, 2 * (M - 1) - this.pos); this.pdir = -1; }
      else if (this.pos <= 0) { this.pos = Math.min(M - 1, -this.pos); this.pdir = 1; }
      deg = this.pos % L; shift = Math.floor(this.pos / L) - 0.5; snap = true;
    }
    if (rng() < P.arpRest) return;
    this.trigger(ratios[deg], shift, snap, P.arpGate / P.arpRate, P);
  }
  render(P, S, f0, ratios, n, tL, tR, excT) {
    if (this.m.length < n) this.m = new Float32Array(n);
    const dt = n / SR, m = this.m, rng = this.rng;
    const mode = S.arpMode;
    const sig = P.arpWidth, lfc = Math.log2(P.arpCenter);
    // 音階の一オクターブが途切れず並ぶよう、中心を基音の半オクターブ上へ寄せた値
    const lsnap = Math.log2(f0) + 0.5 + Math.round(lfc - Math.log2(f0) - 0.5);
    const gE = P.arpRes * P.arpRes * P.arpLevel * P.arpLevel;

    if (mode === 'step') {
      this.clock -= P.arpRate * dt;
      let guard = 0;
      while (this.clock <= 0 && guard++ < 8) {
        this.stepSeq(P, S, ratios);
        this.clock += Math.max(0.2, 1 + P.arpJitter * (rng() - 0.5) * 1.2);
      }
    } else if (mode === 'loops') {
      const L = ratios.length;
      for (const s of this.slots) {
        s.clock -= P.arpRate * dt;
        if (s.clock <= 0) {
          s.clock += s.mult * 8 * (1 + P.arpJitter * (rng() - 0.5) * 0.3);
          if (rng() >= P.arpRest) {
            this.trigger(ratios[s.pos % L], (Math.floor(s.pos / L) % 2) - 0.5, true, 2 * P.arpGate / P.arpRate, P);
          }
        }
      }
    }

    for (const v of this.voices) {
      if (!v.on) continue;
      const t0 = v.age / SR, e0 = this.env(v, t0) * v.vel, e1 = this.env(v, t0 + dt) * v.vel;
      v.age += n;
      if (t0 + dt >= v.total) v.on = false;
      const lc = (v.snap ? lsnap : lfc) + v.shift;
      const base = f0 * 0.25 * v.ratio, lb = Math.log2(base);
      m.fill(0, 0, n);
      let sumsq = 0;
      for (let j = 0; j < AK; j++) {
        const f = base * (1 << j);
        if (f > SR * 0.45) break;
        const d = (lb + j - lc) / sig, a = Math.exp(-0.5 * d * d);
        if (a < 0.003) continue;
        sumsq += a * a;
        const inc = f / SR;
        let p = v.ph[j];
        for (let k = 0; k < n; k++) {
          const x = p * TS, q = x | 0;
          m[k] += (SIN[q] + (SIN[q + 1] - SIN[q]) * (x - q)) * a;
          p += inc; if (p >= 1) p -= 1;
        }
        v.ph[j] = p;
      }
      const nrm = 0.3 / Math.sqrt(sumsq || 1);
      const gl = panL(v.pan), gr = panR(v.pan), de = (e1 - e0) / n;
      let e = e0;
      for (let k = 0; k < n; k++) {
        e += de;
        const o = m[k] * nrm * e;
        tL[k] += o * gl; tR[k] += o * gr; excT[k] += o * gE;
      }
    }

    // 滑走：途切れなく昇り（降り）続ける音の束
    const gt = mode === 'gliss' ? 1 : 0;
    const g0 = this.gOn;
    this.gOn += (gt - this.gOn) * (1 - Math.exp(-dt / 0.6));
    if (this.gOn > 1e-4 || gt) {
      const dir = S.arpDir === 'up' ? 1 : S.arpDir === 'down' ? -1 : this.gW.step(dt, 0.04);
      const dp = dir * P.arpRate / 12 * dt;
      const p0 = this.gP;
      this.gP = ((p0 + dp) % AK + AK) % AK;
      const amps = [], incs = [];
      let sumsq = 0;
      for (let j = 0; j < AK; j++) {
        const u0 = (j + p0) % AK, u1 = u0 + dp;
        const fa = 16 * Math.pow(2, u0), fb = 16 * Math.pow(2, u1);
        const d = (4 + (u0 + u1) * 0.5 - lfc) / sig;                       // log2(16)=4
        const win = Math.sin(Math.PI * clamp((u0 + u1) * 0.5 / AK, 0, 1));
        let a = Math.exp(-0.5 * d * d) * win * win;
        if (fb > SR * 0.45 || fa > SR * 0.45) a = 0;
        amps.push(a); incs.push(fa / SR, fb / SR);
        sumsq += a * a;
      }
      const nrm = 0.42 / Math.sqrt(sumsq || 1);
      const sp = P.arpPan * 0.5;
      for (let j = 0; j < AK; j++) {
        const a1 = amps[j] * nrm * this.gOn;
        let a = this.gAmp[j];
        this.gAmp[j] = a1;
        if (a < 1e-6 && a1 < 1e-6) continue;
        const da = (a1 - a) / n;
        let inc = incs[j * 2];
        const di = (incs[j * 2 + 1] - inc) / n;
        const pn = (j & 1 ? sp : -sp), gl = panL(pn), gr = panR(pn);
        let p = this.gPh[j];
        for (let k = 0; k < n; k++) {
          const x = p * TS, q = x | 0;
          a += da;
          const o = (SIN[q] + (SIN[q + 1] - SIN[q]) * (x - q)) * a;
          tL[k] += o * gl; tR[k] += o * gr; excT[k] += o * gE;
          inc += di; p += inc; if (p >= 1) p -= 1;
        }
        this.gPh[j] = p;
      }
    }
  }
}

/* ---------- 声：声道の物理モデルによる、意味の取れぬ発話 ---------- */
// 声門の音源を、区間に刻んだ管（声門 0 〜 唇 1）に通す。舌と唇で管の断面を動かし、狭めた所で乱流を起こす
// 母音：[舌の位置, 舌の高さ（小さいほど狭い）, 唇の開き（9 は丸めなし）]。声道の応答を測って合わせ込んだ値
const VOW = {
  a: [0.32, 2.55, 9], i: [0.68, 2.35, 1.1], u: [0.50, 3.25, 0.45], e: [0.60, 2.85, 9],
  o: [0.46, 2.25, 0.8], '@': [0.54, 2.75, 1.1], E: [0.52, 3.45, 9], O: [0.42, 2.25, 1.1],
};
// 子音：d=長さ(秒) cx=狭めの位置 cd=狭めの開き（負は閉鎖） vel=鼻へ抜ける av=有声 ah=気息 fr=摩擦 T=舌の構え
const CONS = {
  m: { w: 1.0, p: [{ d: .07, cx: 0.97, cd: -0.2, vel: 1, av: 0.8 }] },
  n: { w: 1.0, p: [{ d: .06, cx: 0.83, cd: -0.2, vel: 1, av: 0.8 }] },
  r: { w: 0.9, p: [{ d: .03, cx: 0.83, cd: 0.08, av: 0.8 }] },
  l: { w: 0.5, p: [{ d: .06, cx: 0.83, cd: 0.6, av: 0.9 }] },
  w: { w: 0.5, p: [{ d: .06, cx: 0.97, cd: 0.5, av: 0.9, T: [0.36, 2.3] }] },
  y: { w: 0.5, p: [{ d: .06, av: 0.9, T: [0.68, 2.1] }] },
  h: { w: 0.7, p: [{ d: .07, av: 0, ah: 1 }] },
  b: { w: 0.5, p: [{ d: .06, cx: 0.97, cd: -0.2, av: 0.5 }] },
  d: { w: 0.6, p: [{ d: .055, cx: 0.83, cd: -0.2, av: 0.5 }] },
  g: { w: 0.5, p: [{ d: .06, cx: 0.55, cd: -0.2, av: 0.5 }] },
  p: { w: 0.3, p: [{ d: .07, cx: 0.97, cd: -0.2, av: 0 }, { d: .03, av: 0, ah: 0.8 }] },
  t: { w: 0.5, p: [{ d: .07, cx: 0.83, cd: -0.2, av: 0 }, { d: .03, av: 0, ah: 0.8 }] },
  k: { w: 0.5, p: [{ d: .075, cx: 0.55, cd: -0.2, av: 0 }, { d: .035, av: 0, ah: 0.8 }] },
  s: { w: 0.5, p: [{ d: .1, cx: 0.84, cd: 0.42, av: 0, ah: 0.4, fr: 1 }] },
  S: { w: 0.4, p: [{ d: .1, cx: 0.74, cd: 0.45, av: 0, ah: 0.4, fr: 1 }] },
  f: { w: 0.2, p: [{ d: .08, cx: 0.97, cd: 0.4, av: 0, ah: 0.4, fr: 0.6 }] },
  z: { w: 0.2, p: [{ d: .07, cx: 0.84, cd: 0.42, av: 0.7, fr: 0.8 }] },
};
const T_BLADE = 10 / 44, T_TIP = 32 / 44, T_LIP = 39 / 44, T_NOSE = 17 / 44;

// 声道：行きの波 R と帰りの波 L を、区間の継ぎ目ごとに断面の比で反射させる（Kelly-Lochbaum）
class Tract {
  constructor(N) { this.setN(N); }
  setN(N) {
    this.N = N;
    const f = n => new Float64Array(n);
    this.R = f(N); this.L = f(N); this.jR = f(N + 1); this.jL = f(N + 1); this.refl = f(N + 1); this.dia = f(N);
    const NN = this.NN = Math.max(6, Math.round(N * 28 / 44));
    this.nR = f(NN); this.nL = f(NN); this.njR = f(NN + 1); this.njL = f(NN + 1); this.nrefl = f(NN + 1);
    const nA = f(NN);
    for (let i = 0; i < NN; i++) {
      const d = 2 * (i / NN), dm = Math.min(1.9, d < 1 ? 0.4 + 1.6 * d : 0.5 + 1.5 * (2 - d));
      nA[i] = dm * dm;
    }
    for (let i = 1; i < NN; i++) this.nrefl[i] = (nA[i - 1] - nA[i]) / (nA[i - 1] + nA[i]);
    this.ns = Math.max(2, Math.min(N - 2, Math.round(N * T_NOSE)));
    this.rl = 0; this.rr = 0; this.rn = -1; this.noseOn = false; this.noseIdle = 0;
  }
  // tx=舌の位置 td=舌の高さ lip=唇の開き cx,cd=子音の狭めの位置と開き velum=鼻への開き
  shape(tx, td, lip, cx, cd, velum) {
    const N = this.N, dia = this.dia, amp = 1.5 - (2 + (td - 2) / 1.5) + 1.7;
    const cw = cx < 25 / 44 ? 10 / 44 : cx >= T_TIP ? 5 / 44 : (10 - 5 * (cx - 25 / 44) / (T_TIP - 25 / 44)) / 44;
    const kc = 1.1 * Math.PI / (T_TIP - T_BLADE);
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N;
      let d = x < 7 / 44 ? 0.6 : x < 12 / 44 ? 1.1 : 1.5;
      if (x > T_BLADE - 0.03 && x < T_LIP) {
        const e = Math.min(1, (x - (T_BLADE - 0.03)) / 0.06, (T_LIP - x) / 0.06);
        d = 1.5 - amp * Math.cos(kc * (tx - x)) * e * e * (3 - 2 * e);
      }
      if (x > T_LIP - 0.02 && lip < d) d = lip + (d - lip) * clamp((T_LIP + 0.03 - x) / 0.05, 0, 1);      // 唇の丸め
      if (cd < d) {
        const rel = Math.abs(x - cx) - 0.5 / N;
        d = cd + (d - cd) * (rel <= 0 ? 0 : rel > cw ? 1 : 0.5 * (1 - Math.cos(Math.PI * rel / cw)));
      }
      dia[i] = d < 0 ? 0 : d;
    }
    const refl = this.refl;
    for (let i = 1; i < N; i++) {
      const a = dia[i - 1] * dia[i - 1], b = dia[i] * dia[i];
      refl[i] = b < 1e-6 ? 0.999 : (a - b) / (a + b);
    }
    const ns = this.ns, a = dia[ns - 1] * dia[ns - 1], b = dia[ns] * dia[ns], c = velum * velum, sum = a + b + c + 1e-9;
    this.rl = (2 * a - sum) / sum; this.rr = (2 * b - sum) / sum; this.rn = (2 * c - sum) / sum;
    if (velum > 0.03) { this.noseOn = true; this.noseIdle = 0; }
    else if (this.noseOn && ++this.noseIdle > 600) { this.noseOn = false; this.nR.fill(0); this.nL.fill(0); }   // 鼻が閉じて静まれば省く
  }
}

function makeLang(rng) {
  const vk = Object.keys(VOW).filter(() => rng() < 0.7);
  for (const k of ['a', 'i', 'o']) if (vk.length < 3 && !vk.includes(k)) vk.push(k);
  const ck = [], cw = [];
  let tot = 0;
  for (const [k, c] of Object.entries(CONS)) {
    if (rng() < 0.25) continue;
    const w = c.w * (0.25 + rng() * 1.5);
    ck.push(k); cw.push(w); tot += w;
  }
  const pickC = () => {
    if (rng() < 0.22) return null;
    let x = rng() * tot;
    for (let i = 0; i < ck.length; i++) { x -= cw[i]; if (x <= 0) return ck[i]; }
    return ck[ck.length - 1];
  };
  const pickV = () => vk[Math.floor(rng() * vk.length)];
  const words = [];
  for (let i = 0; i < 28; i++) {
    const ns = 1 + Math.floor(rng() * rng() * 3.5), w = [];
    for (let s = 0; s < ns; s++) {
      w.push({ c: pickC(), v: pickV(), v2: rng() < 0.18 ? pickV() : null, n: rng() < 0.15 });
    }
    words.push(w);
  }
  return { words };
}

class Speaker {
  constructor(i, rng) {
    this.i = i; this.rng = rng;
    this.pitchMul = [1, 0.76, 1.31][i] * (0.97 + rng() * 0.06);
    this.tractMul = [1, 0.93, 1.1][i];
    this.rateMul = [1, 0.9, 1.12][i];
    this.panBase = [0, -0.7, 0.7][i];
    this.segs = []; this.segLeft = Math.floor((0.3 + rng() * 1.5 + i * 0.8) * SR);
    this.tract = new Tract(24);
    // 調音の現在値と目標値
    this.tx = 0.5; this.td = 2.8; this.lip = 9; this.cx = 0.8; this.cd = 3; this.vel = 0.01;
    this.ttx = 0.5; this.ttd = 2.8; this.tlip = 9; this.tcd = 3; this.tvel = 0.01;
    this.av = 0; this.ah = 0; this.fr = 0; this.tav = 0; this.tah = 0; this.tfr = 0;
    this.lp = Math.log2(110); this.tlp = this.lp;
    // 声門
    this.gt = rng(); this.ten = 0.6; this.setWave(0.6);
    this.an = [0, 0, 0, 0]; this.fn = [0, 0, 0, 0];            // 気息と摩擦の帯域通過の状態
    this.hp = 0; this.l1 = 0; this.l2 = 0;
    this.jit = new Wander(rng); this.drift = new Wander(rng); this.pw = new Wander(rng); this.tw = new Wander(rng);
    this.active = false; this.gE = 0;
  }
  // 声門の波形（LF モデル）を、張りの強さから一周期ぶん用意する
  setWave(ten) {
    const Rd = clamp(3 * (1 - ten), 0.5, 2.7);
    const Ra = -0.01 + 0.048 * Rd, Rk = 0.224 + 0.118 * Rd;
    const Rg = (Rk / 4) * (0.5 + 1.2 * Rk) / (0.11 * Rd - Ra * (0.5 + 1.2 * Rk));
    const Tp = 1 / (2 * Rg), Te = Tp + Tp * Rk;
    const eps = 1 / Ra, shift = Math.exp(-eps * (1 - Te)), Delta = 1 - shift;
    const rhs = ((1 / eps) * (shift - 1) + (1 - Te) * shift) / Delta;
    const upper = -(-(Te - Tp) / 2 + rhs);
    const omega = Math.PI / Tp, sn = Math.sin(omega * Te);
    const alpha = Math.log(-Math.PI * sn * upper / (Tp * 2)) / (Tp / 2 - Te);
    this.wA = alpha; this.wE0 = -1 / (sn * Math.exp(alpha * Te)); this.wEps = eps; this.wSh = shift;
    this.wD = Delta; this.wTe = Te; this.wOm = omega; this.loud = Math.pow(ten, 0.25);
  }
  buildPhrase(P, lang) {
    const rng = this.rng, syls = [];
    const nw = 1 + Math.floor(rng() * rng() * 5);
    for (let i = 0; i < nw; i++) {
      const w = lang.words[Math.floor(rng() * rng() * lang.words.length)];
      for (const s of w) syls.push(s);
    }
    const ds = 4.5 / (P.voiceRate * this.rateMul), N = syls.length;
    let lastV = VOW.a, pm = 1;
    syls.forEach((s, i) => {
      const pos = N > 1 ? i / (N - 1) : 1, last = i === N - 1;
      pm = (1.16 - 0.3 * pos) * (1 + (rng() - 0.5) * 0.14);
      if (last && rng() < 0.2) pm *= 1.22;
      const V = VOW[s.v];
      if (s.c) {
        for (const q of CONS[s.c].p) {
          this.segs.push({ d: q.d * (0.5 + 0.5 * ds), V: q.T ? [q.T[0], q.T[1], V[2]] : V, cx: q.cx, cd: q.cd,
            vel: q.vel, av: q.av, ah: q.ah || 0, fr: q.fr || 0, pm });
        }
      }
      const vd = (0.1 + rng() * 0.08) * ds * (last ? 1.6 : 1);
      this.segs.push({ d: vd, V, av: 1, ah: 0, fr: 0, pm });
      lastV = V;
      if (s.v2) { lastV = VOW[s.v2]; this.segs.push({ d: vd * 0.7, V: lastV, av: 0.95, ah: 0, fr: 0, pm: pm * 0.97 }); }
      if (s.n) this.segs.push({ d: 0.07 * ds, V: lastV, cx: 0.83, cd: -0.2, vel: 1, av: 0.7, ah: 0, fr: 0, pm: pm * 0.95 });
    });
    this.segs.push({ d: 0.08, V: lastV, av: 0, ah: 0, fr: 0, pm: pm * 0.9 });
    this.segs.push({ d: gapSec(P.voiceGap) * (0.5 + rng()), V: lastV, av: 0, ah: 0, fr: 0, pm: 1, pause: true });
  }
  nextSeg(P, f0, ratios, lang) {
    if (!this.segs.length) {
      // 声道の長さは、句の切れ目でのみ替える
      const N = clamp(Math.round(24 / (P.voiceTract * this.tractMul)), 14, 36);
      if (N !== this.tract.N) this.tract.setN(N);
      this.buildPhrase(P, lang);
    }
    const s = this.segs.shift();
    this.segLeft += Math.max(16, Math.round(s.d * SR));
    this.ttx = s.V[0]; this.ttd = s.V[1]; this.tlip = s.V[2];
    this.tav = s.av; this.tah = s.ah; this.tfr = s.fr;
    this.tvel = s.vel ? 0.4 : 0.01;
    if (s.cd !== undefined) { this.cx = s.cx; this.tcd = s.cd; } else this.tcd = 3;
    if (!s.pause) {
      const raw = Math.log2(P.voicePitch * this.pitchMul * s.pm);
      let lt = raw;
      if (P.voiceTune > 0.001) {          // 音階の最も近い音へ寄せる
        const x = raw - Math.log2(f0), oc = Math.floor(x), fr = x - oc;
        let best = 1, bd = 1 - fr;
        for (const r of ratios) { const l = Math.log2(r), dd = Math.abs(fr - l); if (dd < bd) { bd = dd; best = l; } }
        lt = raw + (Math.log2(f0) + oc + best - raw) * P.voiceTune;
      }
      this.tlp = lt;
    }
  }
  render(P, f0, ratios, lang, n, tL, tR, excT, count) {
    const on = this.i < count;
    if (!on && !this.active) return;
    if (on && !this.active) {
      this.active = true; this.segs.length = 0; this.segLeft = Math.floor((0.2 + this.rng() * 1.2) * SR);
      this.tav = this.tah = this.tfr = 0; this.tcd = 3; this.tvel = 0.01;
    }
    const br = P.voiceBreath, cons = P.voiceCons;
    const khp = 1 - Math.exp(-2 * Math.PI * 90 / SR);
    const far = P.voiceFar;
    const kfar = 1 - Math.exp(-2 * Math.PI * (7000 * (1 - far) * (1 - far) + 700) / SR);
    const dt = n / SR;
    const pan = clamp(this.panBase * P.voiceSpread + this.pw.step(dt, P.flucRate) * P.sway * 0.5, -1, 1);
    const gl = panL(pan), gr = panR(pan);
    const gE1 = P.voiceRes * P.voiceRes * P.voiceLevel * P.voiceLevel * 1.5, dE = (gE1 - this.gE) / n;
    let gE = this.gE;
    const jz = this.jit.step(dt, 7), dz = this.drift.step(dt, 0.4);
    const tenT = clamp(0.62 - 0.5 * br + 0.06 * this.tw.step(dt, 1.5), 0.05, 0.9);
    const T = this.tract;
    // 帯域通過（気息 500Hz、摩擦 1000Hz、いずれも広い）
    const bp = fc => { const w0 = 2 * Math.PI * fc / SR, al = Math.sin(w0), a0 = 1 + al; return [al / a0, -2 * Math.cos(w0) / a0, (1 - al) / a0]; };
    const [ab, aa1, aa2] = bp(500), [fb, fa1, fa2] = bp(1000);
    const an = this.an, fn = this.fn;

    for (let i = 0; i < n;) {
      const sub = Math.min(16, n - i);
      this.segLeft -= sub;
      while (this.segLeft <= 0) {
        if (!on && !this.segs.length) { this.active = false; this.tav = this.tah = this.tfr = 0; this.segLeft = SR; break; }
        this.nextSeg(P, f0, ratios, lang);
      }
      const ka = 1 - Math.exp(-sub / (SR * 0.011));
      this.av += (this.tav - this.av) * ka; this.ah += (this.tah - this.ah) * ka; this.fr += (this.tfr - this.fr) * ka;
      if (this.tav === 0 && this.tah === 0 && this.tfr === 0 && this.av < 1e-4 && this.ah < 1e-4 && this.fr < 1e-4) {
        i += sub; gE += dE * sub; continue;       // 沈黙の間は声道を回さない
      }
      // 調音：舌・唇・狭め・鼻を目標へ寄せ、声道の形を作り直す
      const km = 1 - Math.exp(-sub / (SR * 0.035)), kc = 1 - Math.exp(-sub / (SR * 0.012));
      this.tx += (this.ttx - this.tx) * km; this.td += (this.ttd - this.td) * km;
      this.lip += (this.tlip - this.lip) * km;
      // 子音を弱めると、閉鎖や狭めが緩む
      const cdT = this.tcd < 2 ? this.tcd + (1 - cons) * 0.9 : this.tcd;
      this.cd += (cdT - this.cd) * kc;
      this.vel += (this.tvel - this.vel) * (1 - Math.exp(-sub / (SR * 0.02)));
      T.shape(this.tx, this.td, this.lip, this.cx, this.cd, this.vel);
      this.lp += (this.tlp - this.lp) * (1 - Math.exp(-sub / (SR * 0.06)));
      const dp = Math.pow(2, this.lp) * (1 + 0.012 * jz + 0.02 * dz) / SR;
      // 乱流：狭めが細く、かつ閉じ切っていない所で起きる。閉鎖が開く瞬間にも一瞬起きる（破裂）
      const flow = Math.max(this.av * 0.5, this.ah, this.fr);
      const turb = 0.66 * clamp(8 * (0.7 - this.cd), 0, 1) * clamp(30 * (this.cd - 0.3), 0, 1) * flow * (0.3 + 0.7 * cons);
      const N = T.N, ci = clamp(Math.floor(this.cx * N), 0, N - 3);
      const gV = this.av * (1 - br * br), gA = (this.av * (0.04 + 0.6 * br) + this.ah * (0.4 + 0.6 * cons)) * 1.4;
      const R = T.R, L = T.L, jR = T.jR, jL = T.jL, refl = T.refl, ns = T.ns, noseOn = T.noseOn;
      const nR = T.nR, nL = T.nL, njR = T.njR, njL = T.njL, nrefl = T.nrefl, NN = T.NN, rl = T.rl, rr = T.rr, rn = T.rn;
      let gt = this.gt, hp = this.hp, l1 = this.l1, l2 = this.l2;
      for (let k = i; k < i + sub; k++) {
        // 声門
        gt += dp;
        if (gt >= 1) { gt -= 1; this.ten += (tenT - this.ten) * 0.3; this.setWave(this.ten); }
        const lf = gt > this.wTe ? (-Math.exp(-this.wEps * (gt - this.wTe)) + this.wSh) / this.wD
                                 : this.wE0 * Math.exp(this.wA * gt) * Math.sin(this.wOm * gt);
        const nz = white();
        const ay = ab * (nz - an[1]) - aa1 * an[2] - aa2 * an[3];
        an[1] = an[0]; an[0] = nz; an[3] = an[2]; an[2] = ay;
        const mod = 0.1 + 0.2 * Math.max(0, SIN[(gt * TS) | 0]);           // 声門が開く瞬間に息が強まる
        const glot = lf * gV * this.loud + ay * gA * (gV > 0.01 ? mod * 3 : 1);
        // 声道を一歩進める
        jR[0] = L[0] * 0.75 + glot;
        jL[N] = R[N - 1] * -0.85;
        for (let q = 1; q < N; q++) { const w = refl[q] * (R[q - 1] + L[q]); jR[q] = R[q - 1] - w; jL[q] = L[q] + w; }
        let o = 0;
        if (noseOn) {
          jL[ns] = rl * R[ns - 1] + (1 + rl) * (nL[0] + L[ns]);
          jR[ns] = rr * L[ns] + (1 + rr) * (R[ns - 1] + nL[0]);
          njR[0] = rn * nL[0] + (1 + rn) * (L[ns] + R[ns - 1]);
          njL[NN] = nR[NN - 1] * -0.85;
          for (let q = 1; q < NN; q++) { const w = nrefl[q] * (nR[q - 1] + nL[q]); njR[q] = nR[q - 1] - w; njL[q] = nL[q] + w; }
          for (let q = 0; q < NN; q++) { nR[q] = njR[q]; nL[q] = njL[q + 1]; }
          o = nR[NN - 1];
        }
        for (let q = 0; q < N; q++) { R[q] = jR[q] * 0.999; L[q] = jL[q + 1] * 0.999; }
        if (turb > 1e-4) {
          const nz2 = white();
          const fy = fb * (nz2 - fn[1]) - fa1 * fn[2] - fa2 * fn[3];
          fn[1] = fn[0]; fn[0] = nz2; fn[3] = fn[2]; fn[2] = fy;
          const t = fy * turb * 0.5;
          R[ci + 1] += t; L[ci + 1] += t;
        }
        o = (o + R[N - 1]) * 0.9;
        hp += (o - hp) * khp; o -= hp;
        l1 += (o - l1) * kfar; l2 += (l1 - l2) * kfar; o = l2;
        gE += dE;
        tL[k] += o * gl; tR[k] += o * gr; excT[k] += o * gE;
      }
      this.gt = gt; this.hp = hp; this.l1 = l1; this.l2 = l2;
      i += sub;
    }
    this.gE = gE1;
  }
}

/* ---------- 残響：八本の遅延線による帰還網 ---------- */
function nextPrime(n) {
  for (; ; n++) { let ok = n > 1; for (let d = 2; d * d <= n; d++) if (n % d === 0) { ok = false; break; } if (ok) return n; }
}
class Reverb {
  constructor() {
    this.len = [31.7, 37.9, 43.3, 47.1, 55.7, 61.3, 71.9, 79.3].map(ms => nextPrime(Math.round(ms * SR / 1000)));
    this.buf = this.len.map(l => new Float32Array(l));
    this.idx = new Int32Array(8);
    this.lp = new Float64Array(8); this.g = new Float64Array(8); this.v = new Float64Array(8); this.sl = 0;
    this.ap = [5.1, 1.73, 5.9, 2.11].map(ms => ({ b: new Float32Array(nextPrime(Math.round(ms * SR / 1000))), i: 0 }));
  }
  process(P, n, inL, inR, outL, outR, g0, g1) {
    const t60 = P.spaceDecay;
    for (let i = 0; i < 8; i++) this.g[i] = Math.exp(-LN1000 * this.len[i] / (t60 * SR));
    const dm = 1 - P.spaceDamp;
    const a = 1 - Math.exp(-2 * Math.PI * (11000 * dm * dm + 1200) / SR);
    const buf = this.buf, idx = this.idx, len = this.len, lp = this.lp, g = this.g, v = this.v, ap = this.ap;
    const dg = (g1 - g0) / n, ks = 1 - Math.exp(-2 * Math.PI * 300 / SR);
    let gw = g0;
    for (let k = 0; k < n; k++) {
      let xl = inL[k], xr = inR[k];
      for (let q = 0; q < 4; q++) {           // 入力を散らす全域通過
        const A = ap[q], d = A.b[A.i], x = q < 2 ? xl : xr;
        const w = x + d * 0.6;
        A.b[A.i] = w; if (++A.i >= A.b.length) A.i = 0;
        if (q < 2) xl = d - w * 0.6; else xr = d - w * 0.6;
      }
      let s = 0;
      for (let i = 0; i < 8; i++) { v[i] = buf[i][idx[i]]; s += v[i]; }
      s *= 0.25;
      for (let i = 0; i < 8; i++) {
        lp[i] += (v[i] - s - lp[i]) * a;
        buf[i][idx[i]] = lp[i] * g[i] + (i & 1 ? xr : xl) + 1e-20;
        if (++idx[i] >= len[i]) idx[i] = 0;
      }
      gw += dg;
      // 低域は左右の差を落とす。低い持続音が逆相に寄ると、単一スピーカーで痩せるため
      const l = v[0] - v[2] + v[4] - v[6], r = v[1] - v[3] + v[5] - v[7];
      const mid = (l + r) * 0.5;
      let side = (l - r) * 0.5;
      this.sl += (side - this.sl) * ks; side -= this.sl;
      outL[k] += (mid + side) * gw;
      outR[k] += (mid - side) * gw;
    }
  }
}

/* ---------- 笛：管の物理モデル。息の圧が歌口の非線形を越えると鳴り出す ---------- */
// 太さの低い側はエアリード（フルート、尺八）、高い側はリード（警笛、クラリネット寄り）
const FBN = 8192, FJN = 4096, FRN = 4096;
class Flute {
  constructor(rng) {
    this.rng = rng; this.segs = []; this.left = Math.floor((1 + rng() * 3) * SR);
    this.lp = Math.log2(440); this.tlp = this.lp; this.amp = 0; this.tamp = 0;
    this.pan = 0; this.vph = rng(); this.vw = new Wander(rng); this.dw = new Wander(rng);
    this.l1 = 0; this.l2 = 0; this.gE = 0; this.idx = -1;
    // エアリードの管
    this.bore = new Float32Array(FBN); this.jet = new Float32Array(FJN); this.bw = 0; this.jw = 0;
    this.bd = 100; this.jd = 30; this.blast = 0; this.flp = 0; this.dx = 0; this.dy = 0;
    // リードの管
    this.rb = new Float32Array(FRN); this.rw = 0; this.rd = 50; this.rlast = 0; this.rz = 0;
    // 息の雑音（管の外へ漏れる分）
    this.nx = 0; this.ny = 0; this.chiff = 0;
    this.wj = 1; this.quiet = 0; this.vel = 1; this.tvel = 1;
  }
  build(P, f0, ratios) {
    const rng = this.rng, lad = ladder(f0, ratios, P.flutePitch, P.fluteRange * 1.5);
    const n = 1 + Math.floor(Math.pow(rng(), 1.4) * P.fluteNotes);
    if (this.idx < 0 || this.idx >= lad.length || rng() < 0.4) this.idx = Math.floor(rng() * lad.length);
    for (let i = 0; i < n; i++) {
      const d = P.fluteLen * (0.6 + rng() * 0.8) * (i === n - 1 ? 1.4 : 1);
      this.segs.push({ d, lp: lad[this.idx], a: 1, vel: 0.75 + 0.25 * rng() });
      this.idx = walk(rng, this.idx, lad.length);
      if (i < n - 1 && rng() > P.fluteGlide) this.segs.push({ d: 0.05 + 0.1 * rng(), a: 0 });   // 吹き直し
    }
    this.segs.push({ d: gapSec(P.fluteGap) * (0.5 + rng()), a: 0, pause: true });
    this.pan = (rng() * 2 - 1) * P.flutePan;
  }
  render(P, f0, ratios, n, tL, tR, excT) {
    const dt = n / SR, body = P.fluteBody, br = P.fluteBreath;
    this.left -= n;
    while (this.left <= 0) {
      if (!this.segs.length) this.build(P, f0, ratios);
      const s = this.segs.shift();
      this.left += Math.max(n, Math.round(s.d * SR));
      this.tamp = s.a;
      if (s.a > 0) {
        this.tlp = s.lp; this.tvel = s.vel;
        if (this.amp < 0.03) this.lp = s.lp;       // 無音からの吹き始めは滑らせない
        this.chiff = 1;
      }
    }
    this.lp += (this.tlp - this.lp) * (1 - Math.exp(-dt / (0.008 + P.fluteGlide * 0.3)));
    const rise = this.tamp > this.amp;
    const a1 = this.amp + (this.tamp - this.amp) * (1 - Math.exp(-dt / (rise ? 0.03 + 0.3 * body : 0.06 + 0.4 * body)));
    const gE1 = P.fluteRes * P.fluteRes * P.fluteLevel * P.fluteLevel;
    if (a1 < 1e-4 && this.amp < 1e-4) {
      // 息が止まっても管はしばらく鳴り残る。静まり切ったら計算を省く
      if (++this.quiet > 0.6 * SR / n) { this.amp = a1; this.gE = gE1; return; }
    } else this.quiet = 0;

    // 音高：ビブラートと僅かな揺らぎ
    this.vph += (4.6 + 1.2 * this.vw.step(dt, 0.5)) * dt; this.vph -= Math.floor(this.vph);
    const vs = Math.sin(2 * Math.PI * this.vph) * P.fluteVib;
    const f = clamp(Math.pow(2, this.lp + vs * 0.012 + this.dw.step(dt, 0.3) * 0.003), 18, 5000);
    const T = SR / f, w = 2 * Math.PI * f / SR;

    // 歌口の型の割合
    const wj1 = clamp((0.6 - body) / 0.15, 0, 1);
    const wj0 = this.wj, dwj = (wj1 - wj0) / n;
    const useJ = wj0 > 1e-3 || wj1 > 1e-3, useR = wj0 < 0.999 || wj1 < 0.999;

    // 息の圧。閾を下回れば、鳴らずに息だけが漏れる
    const pvib = 1 + vs * 0.05;
    const pj = (1.06 - 0.215 * Math.pow(br, 1.5)) * pvib, nj = 0.05 + 0.25 * br;
    const pr = (0.88 - 0.24 * br) * pvib, nr = 0.05 + 0.2 * br;

    // エアリード：管を一往復半して歌口へ戻る。輪の中の濾波と直流除去の位相を差し引いて調律する
    const cr = 2.2 + 7 * Math.min(body, 0.6);
    const pole = Math.exp(-2 * Math.PI * clamp(cr * f, 200, 9000) / SR), DCR = 0.9993;
    const pd1 = Math.atan2(pole * Math.sin(w), 1 - pole * Math.cos(w)) / w;
    const lead = (Math.atan2(Math.sin(w), 1 - Math.cos(w)) - Math.atan2(DCR * Math.sin(w), 1 - DCR * Math.cos(w))) / w;
    const bd1 = clamp(1.5 * T - pd1 + lead - 0.75 + 0.0113 * T, 2, FBN - 2), jd1 = clamp(0.48 * T, 1, FJN - 2);
    const rd1 = clamp(0.5 * T - 1.5, 1, FRN - 2);
    const dbd = (bd1 - this.bd) / n, djd = (jd1 - this.jd) / n, drd = (rd1 - this.rd) / n;
    const slope = -0.3;       // リードの硬さ。これより硬いと、息の圧でリードが閉じ切って鳴らない

    // 管の外へ漏れる息：音高のまわりに絞った雑音。吹き始めに一瞬強まる
    this.chiff *= Math.exp(-dt / 0.06);
    const r = Math.exp(-Math.PI * (f / 5 + 60) / SR), c = r * Math.cos(w), sn = r * Math.sin(w);
    const gn = Math.sqrt(2 * (1 - r)) * br * (0.7 + 1.8 * this.chiff) * wj1 + Math.sqrt(2 * (1 - r)) * br * 0.3 * (1 - wj1);

    const far = P.fluteFar, kfar = 1 - Math.exp(-2 * Math.PI * (9000 * (1 - far) * (1 - far) + 600) / SR);
    this.vel += (this.tvel - this.vel) * (1 - Math.exp(-dt / 0.05));       // 音ごとの強さは、息の圧ではなく出口の音量に掛ける
    const gl = panL(this.pan) * this.vel, gr = panR(this.pan) * this.vel;
    const da = (a1 - this.amp) / n, dE = (gE1 - this.gE) / n;
    const bore = this.bore, jet = this.jet, rb = this.rb;
    let a = this.amp, gE = this.gE, wj = wj0, l1 = this.l1, l2 = this.l2, nx = this.nx, ny = this.ny;
    let bw = this.bw, jw = this.jw, bd = this.bd, jd = this.jd, blast = this.blast, flp = this.flp, dx = this.dx, dy = this.dy;
    let rw = this.rw, rd = this.rd, rlast = this.rlast, rz = this.rz;
    for (let k = 0; k < n; k++) {
      a += da; gE += dE; wj += dwj;
      const nz = white();
      let o = 0;
      if (useJ) {
        bd += dbd; jd += djd;
        const breath = a * pj * (1 + nj * nz);
        flp = (1 - pole) * blast + pole * flp;
        let t = -flp;
        const y = t - dx + DCR * dy; dx = t; dy = y; t = y;
        // 噴流の遅延
        jet[jw] = breath - 0.5 * t;
        let p = jw - jd; if (p < 0) p += FJN; if (p >= FJN) p = 0;
        let i = p | 0, j = i + 1 >= FJN ? 0 : i + 1;
        let x = jet[i] + (jet[j] - jet[i]) * (p - i);
        if (++jw >= FJN) jw = 0;
        x = x * (x * x - 1); if (x > 1) x = 1; else if (x < -1) x = -1;        // 噴流が歌口の縁を行き来する非線形
        // 管
        bore[bw] = x + 0.5 * t + 1e-20;
        p = bw - bd; if (p < 0) p += FBN; if (p >= FBN) p = 0;
        i = p | 0; j = i + 1 >= FBN ? 0 : i + 1;
        blast = bore[i] + (bore[j] - bore[i]) * (p - i);
        if (++bw >= FBN) bw = 0;
        o += blast * 0.32 * wj;
      }
      if (useR) {
        rd += drd;
        const breath = a * pr * (1 + nr * nz);
        const fz = 0.5 * (rlast + rz); rz = rlast;
        const pd = -0.95 * fz - breath;
        let rt = 0.7 + slope * pd; if (rt > 1) rt = 1; else if (rt < -1) rt = -1;     // リードの開き
        rb[rw] = breath + pd * rt + 1e-20;
        let p = rw - rd; if (p < 0) p += FRN; if (p >= FRN) p = 0;
        const i = p | 0, j = i + 1 >= FRN ? 0 : i + 1;
        rlast = rb[i] + (rb[j] - rb[i]) * (p - i);
        if (++rw >= FRN) rw = 0;
        o += rlast * 0.45 * (1 - wj);
      }
      const t2 = c * nx - sn * ny + nz * gn * a + 1e-20;
      ny = sn * nx + c * ny; nx = t2;
      o += ny * 0.45;
      l1 += (o - l1) * kfar; l2 += (l1 - l2) * kfar; o = l2;
      tL[k] += o * gl; tR[k] += o * gr; excT[k] += o * gE * 0.5;
    }
    this.amp = a1; this.gE = gE1; this.wj = wj1; this.l1 = l1; this.l2 = l2; this.nx = nx; this.ny = ny;
    this.bw = bw; this.jw = jw; this.bd = bd1; this.jd = jd1; this.blast = blast; this.flp = flp; this.dx = dx; this.dy = dy;
    this.rw = rw; this.rd = rd1; this.rlast = rlast; this.rz = rz;
  }
}

/* ---------- 鐘：モーダル合成。物体の振動の型を一つずつ鳴らす ---------- */
// r=型の周波数比（1 が鳴らす音高） a=強さ p=高い型ほど早く消える度合い dbl=うなりの対の出やすさ
const BELL_T = [
  { r: [1, 2.756, 5.404, 8.933, 13.345, 18.64, 24.81],                     // 棒・チャイム
    a: [1, 0.7, 0.5, 0.35, 0.25, 0.16, 0.1], p: 0.55, dbl: 0.2 },
  { r: [1, 2.71, 4.95, 7.7, 10.9, 14.5],                                    // 椀・お鈴
    a: [1, 0.6, 0.4, 0.25, 0.15, 0.1], p: 0.7, dbl: 1 },
  { r: [0.5, 1, 1.2, 1.5, 2, 2.5, 2.67, 3, 4, 5.33, 6.67],                  // 洋鐘（ハム・基音・短三度・五度・オクターブ…）
    a: [0.6, 1, 0.7, 0.45, 0.8, 0.4, 0.3, 0.45, 0.35, 0.22, 0.15], p: 0.85, dbl: 0.5 },
  { r: [1, 2.3, 3.86, 5.5, 7.4, 9.4, 11.6],                                 // 梵鐘
    a: [1, 0.75, 0.55, 0.4, 0.3, 0.2, 0.14], p: 1.05, dbl: 1 },
  { r: [1, 1.59, 2.14, 2.65, 2.92, 3.5, 4.06, 4.6, 5.21, 5.9, 6.7, 7.6],    // 板・銅鑼
    a: [1, 0.9, 0.8, 0.72, 0.65, 0.58, 0.5, 0.45, 0.4, 0.34, 0.3, 0.25], p: 0.5, dbl: 0.4 },
];
const BM = 34;       // 一打あたりの型の上限（隣り合う二つの材質＋うなりの対）
class Bell {
  constructor(rng) {
    this.rng = rng; this.q = []; this.left = Math.floor((1 + rng() * 4) * SR); this.idx = -1; this.pan = 0;
    this.v = [];
    const f = () => new Float64Array(BM);
    for (let i = 0; i < 6; i++) this.v.push({ on: false, n: 0, xr: f(), xi: f(), cr: f(), ci: f(), e: 0 });
    this.m = new Float32Array(128); this.fl = [0, 0, 0, 0];
  }
  build(P, f0, ratios) {
    const rng = this.rng, lad = ladder(f0, ratios, P.bellPitch, P.bellRange * 1.5);
    const n = 1 + Math.floor(Math.pow(rng(), 1.4) * P.bellNotes);
    if (this.idx < 0 || this.idx >= lad.length || rng() < 0.4) this.idx = Math.floor(rng() * lad.length);
    for (let i = 0; i < n; i++) {
      this.q.push({ lp: lad[this.idx], vel: 0.6 + 0.4 * rng(), wait: P.bellRate * (0.85 + 0.3 * rng()) });
      this.idx = walk(rng, this.idx, lad.length);
    }
    this.q.push({ wait: gapSec(P.bellGap) * (0.5 + rng()) });
    this.pan = (rng() * 2 - 1) * P.bellPan;
  }
  strike(P, lp, vel) {
    let v = this.v.find(x => !x.on);
    if (!v) { v = this.v[0]; for (const x of this.v) if (x.e < v.e) v = x; }      // 最も静まったものを奪う
    const rng = this.rng, hard = P.bellHard, beat = P.bellBeat, dec = P.bellDecay;
    const x = Math.min(P.bellTimbre * (BELL_T.length - 1), BELL_T.length - 1.0001), si = x | 0, fr = x - si;
    const f = Math.pow(2, lp);
    // 撞木の硬さ：柔らかいほど触れている時間が長く、高い型を揺り起こせない
    const fc = f * (1.2 + 30 * hard * hard);
    let n = 0, sumsq = 0;
    const add = (fq, amp, t60) => {
      if (n >= BM || fq > SR * 0.45 || amp < 0.002) return;
      const r = Math.exp(-LN1000 / (clamp(t60, 0.03, 60) * SR)), th = 2 * Math.PI * fq / SR;
      v.cr[n] = r * Math.cos(th); v.ci[n] = r * Math.sin(th); v.xr[n] = amp; v.xi[n] = 0;
      sumsq += amp * amp; n++;
    };
    for (let t = 0; t < 2; t++) {
      const T = BELL_T[si + t], wt = t ? Math.sin(fr * Math.PI / 2) : Math.cos(fr * Math.PI / 2);
      if (wt < 0.06) continue;
      for (let i = 0; i < T.r.length; i++) {
        const fq = f * T.r[i], q = fq / fc;
        const amp = T.a[i] * wt / (1 + q * q) * (0.7 + 0.6 * rng());            // 打つ場所で型の出方は毎回変わる
        const t60 = dec * Math.pow(T.r[i], -T.p);
        // 低い型は僅かにずれた対を持ち、うなる
        if (i < 4 && beat * T.dbl > 0.02) {
          add(fq, amp * 0.72, t60);
          add(fq * (1 + beat * T.dbl * 0.0045 * (0.4 + rng())), amp * 0.5, t60 * 0.93);
        } else add(fq, amp, t60);
      }
    }
    const nrm = 0.3 * vel / Math.sqrt(sumsq || 1);
    for (let i = 0; i < n; i++) v.xr[i] *= nrm;
    v.n = n; v.on = n > 0; v.e = 1;
    v.att = 0; v.attLen = Math.round((0.0005 + (1 - hard) * 0.008) * SR);       // 撞木が触れている時間
    v.gl = panL(this.pan + (rng() - 0.5) * 0.3 * P.bellPan); v.gr = panR(this.pan + (rng() - 0.5) * 0.3 * P.bellPan);
  }
  render(P, f0, ratios, n, tL, tR, excT) {
    if (this.m.length < n) this.m = new Float32Array(n);
    this.left -= n;
    while (this.left <= 0) {
      if (!this.q.length) this.build(P, f0, ratios);
      const e = this.q.shift();
      this.left += Math.max(n, Math.round(e.wait * SR));
      if (e.lp !== undefined) this.strike(P, e.lp, e.vel);
    }
    const m = this.m, gE = P.bellRes * P.bellRes * P.bellLevel * P.bellLevel * 0.5;
    const far = P.bellFar, kfar = 1 - Math.exp(-2 * Math.PI * (10000 * (1 - far) * (1 - far) + 700) / SR);
    const fl = this.fl;
    let any = false;
    for (const v of this.v) {
      if (!v.on) continue;
      any = true;
      m.fill(0, 0, n);
      let e = 0, w = 0;
      for (let i = 0; i < v.n; i++) {
        let xr = v.xr[i], xi = v.xi[i];
        const a2 = xr * xr + xi * xi;
        if (a2 < 1e-9) continue;                 // 消えた型は捨てる
        const cr = v.cr[i], ci = v.ci[i];
        for (let k = 0; k < n; k++) {
          const t = xr * cr - xi * ci;
          xi = xr * ci + xi * cr; xr = t;
          m[k] += xi;
        }
        e += a2;
        v.xr[w] = xr; v.xi[w] = xi; v.cr[w] = cr; v.ci[w] = ci; w++;
      }
      v.n = w; v.e = e;
      if (!w) { v.on = false; continue; }
      const gl = v.gl, gr = v.gr;
      for (let k = 0; k < n; k++) {
        let o = m[k];
        if (v.att < v.attLen) { const u = ++v.att / v.attLen; o *= u * u * (3 - 2 * u); }
        tL[k] += o * gl; tR[k] += o * gr; excT[k] += o * gE;
      }
    }
    if (!any && Math.abs(fl[1]) + Math.abs(fl[3]) < 1e-7) return;
    for (let k = 0; k < n; k++) {              // 遠さ：高域を落とす
      fl[0] += (tL[k] - fl[0]) * kfar; fl[1] += (fl[0] - fl[1]) * kfar; tL[k] = fl[1];
      fl[2] += (tR[k] - fl[2]) * kfar; fl[3] += (fl[2] - fl[3]) * kfar; tR[k] = fl[3];
    }
  }
}

/* ---------- フェイザー：六段の全域通過。左右で掃引の位相をずらす ---------- */
class Phaser {
  constructor(ph) {
    this.st = [new Float64Array(12), new Float64Array(12)];
    this.fb = [0, 0]; this.a = [-1, -1]; this.ph = ph; this.m = 0;
  }
  process(P, n, L, R) {
    const m1 = P.phaserMix;
    this.ph += P.phaserRate * n / SR; this.ph -= Math.floor(this.ph);
    if (m1 < 0.002 && this.m < 0.002) { this.m = m1; return; }
    const fbk = P.phaserFb, dm = (m1 - this.m) / n;
    for (let ch = 0; ch < 2; ch++) {
      const buf = ch ? R : L, st = this.st[ch];
      const l = Math.sin(2 * Math.PI * (this.ph + ch * 0.25));
      const tn = Math.tan(Math.PI * 760 * Math.pow(4.2, l * P.phaserDepth) / SR), a1 = (1 - tn) / (1 + tn);
      let a = this.a[ch] < 0 ? a1 : this.a[ch], fb = this.fb[ch], m = this.m;
      const da = (a1 - a) / n;
      for (let k = 0; k < n; k++) {
        a += da; m += dm;
        const x = buf[k];
        let y = x + fb * fbk + 1e-20;
        for (let q = 0; q < 12; q += 2) {
          const o = -a * y + st[q] + a * st[q + 1];
          st[q] = y; st[q + 1] = o; y = o;
        }
        fb = y;
        buf[k] = x * (1 - 0.5 * m) + y * 0.5 * m;
      }
      this.a[ch] = a1; this.fb[ch] = fb;
    }
    this.m = m1;
  }
}

/* ---------- テープエコー：繰り返すたびに曇り、揺れ、帰還を上げれば自ら鳴り出す ---------- */
class Echo {
  constructor() {
    this.N = Math.ceil(SR * 2.4);
    this.bL = new Float32Array(this.N); this.bR = new Float32Array(this.N);
    this.w = 0; this.d = 0.38 * SR;
    this.lp = [0, 0]; this.hp = [0, 0]; this.wph = 0; this.fph = 0; this.idle = true; this.sdl = 0;
  }
  process(P, n, inL, inR, outL, outR, wL, wR, g0, g1, fbExtra) {
    if (g0 < 1e-5 && g1 < 1e-5) { this.idle = true; return; }
    if (this.idle) { this.bL.fill(0); this.bR.fill(0); this.lp[0] = this.lp[1] = this.hp[0] = this.hp[1] = 0; this.idle = false; }
    const N = this.N, bL = this.bL, bR = this.bR;
    const dt = clamp(P.echoTime, 0.03, 2.2) * SR, kd = 1 - Math.exp(-1 / (0.25 * SR));
    const fb = Math.min(1.12, P.echoFb + fbExtra), ping = P.echoPing;
    const kl = 1 - Math.exp(-2 * Math.PI * 700 * Math.pow(12, P.echoTone) / SR);
    const kh = 1 - Math.exp(-2 * Math.PI * 130 / SR);
    const wow = P.echoWow, dg = (g1 - g0) / n;
    let g = g0, w = this.w, d = this.d, wph = this.wph, fph = this.fph;
    let lpL = this.lp[0], lpR = this.lp[1], hpL = this.hp[0], hpR = this.hp[1], sdl = this.sdl;
    const ksd = 1 - Math.exp(-2 * Math.PI * 300 / SR);
    for (let k = 0; k < n; k++) {
      d += (dt - d) * kd;                         // 長さを変えると、テープのように音高が滑る
      wph += 0.55 / SR; if (wph >= 1) wph -= 1;
      fph += 6.3 / SR; if (fph >= 1) fph -= 1;
      const md = d * (1 + wow * (0.004 * SIN[(wph * TS) | 0] + 0.0007 * SIN[(fph * TS) | 0]));
      let pos = w - md; if (pos < 0) pos += N;
      if (pos >= N) pos = 0;                      // 丸めで端に乗ることがある
      const i = pos | 0, fr = pos - i, j = i + 1 >= N ? 0 : i + 1;
      let yl = bL[i] + (bL[j] - bL[i]) * fr, yr = bR[i] + (bR[j] - bR[i]) * fr;
      lpL += (yl - lpL) * kl; hpL += (lpL - hpL) * kh; yl = lpL - hpL;
      lpR += (yr - lpR) * kl; hpR += (lpR - hpR) * kh; yr = lpR - hpR;
      const sl = Math.tanh(yl), sr = Math.tanh(yr);      // テープの飽和。帰還が 1 を超えても発散しない
      const il = inL[k], ir = inR[k], mono = (il + ir) * 0.5;
      bL[w] = il * (1 - ping) + mono * ping + fb * (sl * (1 - ping) + sr * ping) + 1e-20;
      bR[w] = ir * (1 - ping) + fb * (sr * (1 - ping) + sl * ping) + 1e-20;
      if (++w >= N) w = 0;
      g += dg;
      // 低域は左右の差を落とす。低い持続音が左右で逆相に寄ると、単一スピーカーで痩せるため
      const em = (yl + yr) * 0.5;
      let es = (yl - yr) * 0.5;
      sdl += (es - sdl) * ksd; es -= sdl;
      const ol = (em + es) * g * 0.7, or = (em - es) * g * 0.7;
      outL[k] += ol; outR[k] += or;
      wL[k] += ol * 0.3; wR[k] += or * 0.3;
    }
    this.w = w; this.d = d; this.wph = wph; this.fph = fph;
    this.lp[0] = lpL; this.lp[1] = lpR; this.hp[0] = hpL; this.hp[1] = hpR; this.sdl = sdl;
  }
}

const NP = 7;        // 部の数：ドローン・ノイズ・RES・ARP・声・笛・鐘
/* ---------- ダブ卓の自動演奏：時おり部を消し、エコーへ放り込み、低域を掃き、帰還を煽る ---------- */
class Dub {
  constructor(rng) {
    this.rng = rng; this.next = 4;
    const z = v => new Array(NP).fill(v);
    this.mute = z(1); this.muteT = z(1); this.muteLeft = z(0);
    this.thr = z(0); this.thrT = z(0); this.thrLeft = z(0);
    this.hp = 0; this.swLeft = 0; this.swDur = 1; this.swDepth = 0;
    this.swell = 0; this.swellT = 0; this.swellLeft = 0;
  }
  step(a, dt, active) {
    const rng = this.rng;
    if (a > 0.01) {
      this.next -= dt;
      if (this.next <= 0) {
        this.next = (4 + 36 * (1 - a) * (1 - a)) * (0.4 + 1.2 * rng());
        const on = [];
        for (let i = 0; i < NP; i++) if (active[i]) on.push(i);
        if (on.length) {
          const i = on[Math.floor(rng() * on.length)], r = rng();
          if (r < 0.4) { this.thrT[i] = 1; this.thrLeft[i] = 0.25 + rng() * 0.9; }
          else if (r < 0.65) {
            if (on.filter(q => this.muteT[q] > 0.5).length >= 2) { this.muteT[i] = 0; this.muteLeft[i] = (2 + rng() * 6) * (0.5 + a); }
          } else if (r < 0.85) {
            if (this.swLeft <= 0) { this.swDur = this.swLeft = 3 + rng() * 6; this.swDepth = 0.5 + 0.5 * rng(); }
          } else { this.swellT = 1; this.swellLeft = 2 + rng() * 4; }
        }
      }
    } else {
      for (let i = 0; i < NP; i++) { this.muteLeft[i] = 0; this.thrLeft[i] = 0; }
      this.swellLeft = 0; this.next = 2;
    }
    const km = 1 - Math.exp(-dt / 0.12), kt = 1 - Math.exp(-dt / 0.03), ks = 1 - Math.exp(-dt / 0.5);
    for (let i = 0; i < NP; i++) {
      if ((this.muteLeft[i] -= dt) <= 0) this.muteT[i] = 1;
      if ((this.thrLeft[i] -= dt) <= 0) this.thrT[i] = 0;
      this.mute[i] += (this.muteT[i] - this.mute[i]) * km;
      this.thr[i] += (this.thrT[i] - this.thr[i]) * kt;
    }
    if ((this.swellLeft -= dt) <= 0) this.swellT = 0;
    this.swell += (this.swellT - this.swell) * ks;
    if (this.swLeft > 0) {
      this.swLeft -= dt;
      const u = Math.sin(Math.PI * clamp(1 - this.swLeft / this.swDur, 0, 1));
      this.hp = u * u * this.swDepth;
    } else this.hp = 0;
  }
}

/* ---------- 処理器本体 ---------- */
class FoolsIron extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cont = PARAMS.filter(p => p.type !== 'sel');
    this.ci = {}; this.cont.forEach((p, i) => { this.ci[p.id] = i; });
    const nc = this.cont.length;
    this.cur = new Float64Array(nc); this.tgt = new Float64Array(nc); this.stp = new Float64Array(nc);
    this.off = new Float64Array(nc);
    this.P = {}; this.S = {};
    for (const p of PARAMS) {
      if (p.type === 'sel') this.S[p.id] = p.def;
      else { const i = this.ci[p.id]; this.cur[i] = this.tgt[i] = norm(p, p.def); this.P[p.id] = p.def; }
    }
    // マクロ：[つまみの番号, [対象の番号, 偏り]...]
    this.macros = MACROS.map(m => [this.ci[m.id], Object.entries(m.map).map(([k, w]) => [this.ci[k], w])]);
    this.lfo = [{ ph: 0, v: 0, hold: 0 }, { ph: 0, v: 0, hold: 0 }];
    this.g = { drone: 0, noise: 0, res: 0, arp: 0, voice: 0, flute: 0, bell: 0, wet: 0, echo: 0 };
    this.es = new Array(NP).fill(0);             // 各部のエコー送り（前の区切りでの値）
    this.act = new Array(NP).fill(false);
    this.mhp = [0, 0, 0, 0];
    this.lf0 = Math.log2(110);
    this.mk(128);
    this.reverb = new Reverb();
    this.echo = new Echo();
    this.phD = new Phaser(0); this.phN = new Phaser(0.37);
    this.bq = [0, 0, 0, 0, 0, 0, 0, 0];     // 主低域通過の状態 (x1,x2,y1,y2)×2
    this.dc = [0, 0, 0, 0];
    this.sw = 1;
    this.mt = null;          // 開発用の計器。各部の音量を個別に測る（tools/render.mjs が使う）
    this.seed(1);
    this.port.onmessage = e => this.onMsg(e.data);
  }
  mk(n) {
    this.bn = n;
    const f = () => new Float32Array(n);
    this.tL = f(); this.tR = f(); this.dL = f(); this.dR = f(); this.wL = f(); this.wR = f();
    this.eN = f(); this.eT = f(); this.xL = f(); this.xR = f();
  }
  seed(seed) {
    const rng = mulberry32((seed | 0) * 2654435761 | 0);
    this.rng = rng;
    this.lang = makeLang(mulberry32((seed | 0) * 40503 + 17 | 0));
    if (!this.drone) {
      this.drone = new Drone(rng); this.noise = new Noise(rng); this.res = new ResBank(rng);
      this.arp = new Arp(rng); this.speakers = [0, 1, 2].map(i => new Speaker(i, rng));
      this.lfoW = [new Wander(rng), new Wander(rng)];
      this.dub = new Dub(rng);
      this.flute = new Flute(rng); this.bell = new Bell(rng);
    } else {
      this.arp.reseed(rng);
    }
  }
  onMsg(m) {
    if (m.type === 'seed') this.seed(m.seed);
    if (m.type === 'meter') this.mt = { st: new Float64Array(NP * 2), sum: new Float64Array(NP), act: new Float64Array(NP), nAct: new Float64Array(NP), blocks: 0 };
    if (m.values) {
      const glide = Math.max(0.03, m.glide || 0.06), blocks = glide * SR / 128;
      for (const [id, v] of Object.entries(m.values)) {
        if (id in this.S) { this.S[id] = String(v); continue; }
        const i = this.ci[id];
        if (i === undefined) continue;
        this.tgt[i] = norm(this.cont[i], v);
        if (m.snap) { this.cur[i] = this.tgt[i]; this.stp[i] = 0; }
        else this.stp[i] = (this.tgt[i] - this.cur[i]) / blocks;
      }
    }
  }
  updateParams(n) {
    const { cur, tgt, stp, off, cont, P, S } = this;
    const dt = n / SR, bs = n / 128;
    for (let i = 0; i < cur.length; i++) {
      if (stp[i] !== 0) {
        cur[i] += stp[i] * bs;
        if ((stp[i] > 0 && cur[i] >= tgt[i]) || (stp[i] < 0 && cur[i] <= tgt[i])) { cur[i] = tgt[i]; stp[i] = 0; }
      }
      off[i] = 0;
    }
    for (let q = 0; q < 2; q++) {
      const pre = 'lfo' + (q + 1), L = this.lfo[q];
      const ti = this.ci[S[pre + 'Target']];
      const rate = denorm(cont[this.ci[pre + 'Rate']], cur[this.ci[pre + 'Rate']]);
      const depth = cur[this.ci[pre + 'Depth']];
      L.ph += rate * dt;
      let wrapped = false;
      if (L.ph >= 1) { L.ph -= Math.floor(L.ph); wrapped = true; }
      const sh = S[pre + 'Shape'];
      let v;
      if (sh === 'sine') v = Math.sin(2 * Math.PI * L.ph);
      else if (sh === 'tri') v = 1 - 4 * Math.abs(L.ph - 0.5);
      else if (sh === 'smooth') v = this.lfoW[q].step(dt, rate * 2);
      else { if (wrapped) L.hold = this.rng() * 2 - 1; v = L.hold; }
      if (ti !== undefined && ti !== this.ci[pre + 'Rate'] && ti !== this.ci[pre + 'Depth']) off[ti] += v * depth * 0.5;
    }
    for (const [mi, binds] of this.macros) {       // マクロは LFO の後に効かせる（マクロ自体を LFO で揺らせる）
      const m = clamp(cur[mi] + off[mi], 0, 1) * 2 - 1;
      if (m > -1e-4 && m < 1e-4) continue;
      for (const [ti, w] of binds) off[ti] += m * w;
    }
    for (let i = 0; i < cur.length; i++) {
      P[cont[i].id] = denorm(cont[i], clamp(cur[i] + off[i], 0, 1));
    }
  }
  tap(i, sL, sR, n, g, send) {
    const mt = this.mt, P = this.P;
    const w0 = 2 * Math.PI * Math.min(P.tone, SR * 0.45) / SR, al = Math.sin(w0) / 1.41421356, cs = Math.cos(w0), a0 = 1 + al;
    const b0 = (1 - cs) / 2 / a0, b1 = (1 - cs) / a0, a1 = -2 * cs / a0, a2 = (1 - al) / a0;
    const wet = send * P.space * P.space * Math.pow(6 / P.spaceDecay, 0.35) * Math.sqrt(P.spaceDecay) * 0.6;
    const ge = g * Math.sqrt(1 + wet * wet) * 0.75;
    let z1 = mt.st[i * 2], z2 = mt.st[i * 2 + 1], e = 0;
    for (let k = 0; k < n; k++) {
      const x = (sL[k] + sR[k]) * 0.5 * ge, y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2; z2 = b0 * x - a2 * y; e += y * y;
    }
    mt.st[i * 2] = z1; mt.st[i * 2 + 1] = z2;
    e /= n; mt.sum[i] += e;
    if (e > 3e-8) { mt.act[i] += e; mt.nAct[i]++; }
  }
  process(_, outputs) {
    const out = outputs[0], oL = out[0], oR = out[1] || out[0], n = oL.length;
    if (n > this.bn) this.mk(n);
    this.updateParams(n);
    const { P, S, tL, tR, dL, dR, wL, wR, eN, eT, xL, xR, g, es, dub } = this;
    if (this.mt) this.mt.blocks++;
    const sk = S.scale + '|' + S.temper;
    if (sk !== this.scaleKey) { this.scaleKey = sk; this.ratios = scaleRatios(S.scale, S.temper); }
    const ratios = this.ratios;
    // 基音は対数領域でなめらかに追う
    const lt = Math.log2(55) + (P.root + P.fine / 100) / 12;
    this.lf0 += (lt - this.lf0) * (1 - Math.exp(-n / SR / 0.08));
    const f0 = Math.pow(2, this.lf0);

    dL.fill(0); dR.fill(0); wL.fill(0); wR.fill(0); eN.fill(0); eT.fill(0); xL.fill(0); xR.fill(0);
    let t, e;
    // ダブ卓：各部の消し (mute) とエコーへの放り込み (thr) を進める
    const act = this.act;
    act[0] = P.droneLevel > 0.03; act[1] = P.noiseLevel > 0.03; act[2] = P.resLevel > 0.03;
    act[3] = P.arpLevel > 0.03; act[4] = P.voiceLevel > 0.03; act[5] = P.fluteLevel > 0.03; act[6] = P.bellLevel > 0.03;
    dub.step(P.dub, n / SR, act);

    t = P.droneLevel * P.droneLevel * dub.mute[0]; e = P.droneEcho * P.droneEcho + dub.thr[0];
    if (t > 1e-6 || g.drone > 1e-6) {
      tL.fill(0); tR.fill(0);
      this.drone.render(P, S, f0 * Math.pow(2, P.dronePitch / 12), n, tL, tR);
      this.phD.process(P, n, tL, tR);
      mixTo(n, tL, tR, g.drone, t, dL, dR, 0.35, wL, wR, es[0], e, xL, xR);
      if (this.mt) this.tap(0, tL, tR, n, t, 0.35);
    }
    g.drone = t; es[0] = e;

    // 雑音は直接音が零でも、共鳴へ送るために回す
    t = P.noiseLevel * P.noiseLevel * dub.mute[1]; e = P.noiseEcho * P.noiseEcho + dub.thr[1];
    if (t > 1e-6 || g.noise > 1e-6 || (P.noiseRes > 0.001 && P.resLevel > 0.001)) {
      tL.fill(0); tR.fill(0);
      this.noise.render(P, S, f0, ratios, n, tL, tR, eN);
      this.phN.process(P, n, tL, tR);
      mixTo(n, tL, tR, g.noise, t, dL, dR, 0.12, wL, wR, es[1], e, xL, xR);
      if (this.mt) this.tap(1, tL, tR, n, t, 0.12);
    }
    g.noise = t; es[1] = e;

    t = P.arpLevel * P.arpLevel * dub.mute[3]; e = P.arpEcho * P.arpEcho + dub.thr[3];
    if (t > 1e-6 || g.arp > 1e-6) {
      tL.fill(0); tR.fill(0);
      this.arp.render(P, S, f0, ratios, n, tL, tR, eT);
      mixTo(n, tL, tR, g.arp, t, dL, dR, 0.9, wL, wR, es[3], e, xL, xR);
      if (this.mt) this.tap(3, tL, tR, n, t, 0.9);
    }
    g.arp = t; es[3] = e;

    t = P.voiceLevel * P.voiceLevel * dub.mute[4]; e = P.voiceEcho * P.voiceEcho + dub.thr[4];
    if (t > 1e-6 || g.voice > 1e-6) {
      tL.fill(0); tR.fill(0);
      const cnt = +S.voiceCount;
      for (const sp of this.speakers) sp.render(P, f0, ratios, this.lang, n, tL, tR, eT, cnt);
      const far = P.voiceFar, dry = 1 - 0.7 * far;
      mixTo(n, tL, tR, g.voice * dry, t * dry, dL, dR, (0.4 + 1.0 * far) / dry, wL, wR, es[4], e, xL, xR);
      if (this.mt) this.tap(4, tL, tR, n, t * dry, (0.4 + 1.0 * far) / dry);
    }
    g.voice = t; es[4] = e;

    for (const [key, i, part] of [['flute', 5, this.flute], ['bell', 6, this.bell]]) {
      const lv = P[key + 'Level'], far = P[key + 'Far'], dry = 1 - 0.7 * far;
      t = lv * lv * dub.mute[i]; e = P[key + 'Echo'] * P[key + 'Echo'] + dub.thr[i];
      if (t > 1e-6 || g[key] > 1e-6) {
        tL.fill(0); tR.fill(0);
        part.render(P, f0, ratios, n, tL, tR, eT);
        mixTo(n, tL, tR, g[key] * dry, t * dry, dL, dR, (0.4 + 1.0 * far) / dry, wL, wR, es[i], e, xL, xR);
        if (this.mt) this.tap(i, tL, tR, n, t * dry, (0.4 + 1.0 * far) / dry);
      }
      g[key] = t; es[i] = e;
    }

    // 声・反復・笛・鐘の共鳴送りは、それぞれの音量に従わせる
    t = P.resLevel * P.resLevel * dub.mute[2]; e = P.resEcho * P.resEcho + dub.thr[2];
    if (t > 1e-6 || g.res > 1e-6) {
      tL.fill(0); tR.fill(0);
      this.res.render(P, f0, ratios, n, eN, eT, tL, tR);
      mixTo(n, tL, tR, g.res, t, dL, dR, 0.7, wL, wR, es[2], e, xL, xR);
      if (this.mt) this.tap(2, tL, tR, n, t, 0.7);
    }
    g.res = t; es[2] = e;

    // エコー。ダブを上げれば、戻りも共に上がる
    t = Math.min(1, P.echoMix + 0.45 * P.dub); t *= t;
    this.echo.process(P, n, xL, xR, dL, dR, wL, wR, g.echo, t, dub.swell * Math.max(0, 1.03 - P.echoFb));
    g.echo = t;

    t = P.space * P.space * 0.5 * Math.pow(6 / P.spaceDecay, 0.35);
    this.reverb.process(P, n, wL, wR, dL, dR, g.wet, t);
    g.wet = t;

    // 主部：広がり → 低域除去（ダブの掃引） → 低域通過 → 直流除去 → 柔らかい頭打ち
    const fc = Math.min(P.tone, SR * 0.45), w0 = 2 * Math.PI * fc / SR;
    const al = Math.sin(w0) / 1.41421356, cs = Math.cos(w0), a0 = 1 + al;
    const b0 = (1 - cs) / 2 / a0, b1 = (1 - cs) / a0, a1 = -2 * cs / a0, a2 = (1 - al) / a0;
    const bq = this.bq, dc = this.dc, mhp = this.mhp;
    const kh = 1 - Math.exp(-2 * Math.PI * 20 * Math.pow(90, dub.hp) / SR);
    const sw1 = P.width * 2, dsw = (sw1 - this.sw) / n;
    let sw = this.sw;
    for (let k = 0; k < n; k++) {
      sw += dsw;
      const mid = (dL[k] + dR[k]) * 0.5, side = (dL[k] - dR[k]) * 0.5 * sw;
      for (let ch = 0; ch < 2; ch++) {
        const o = ch * 4;
        let x = ch ? mid - side : mid + side;
        mhp[ch * 2] += (x - mhp[ch * 2]) * kh; x -= mhp[ch * 2];
        mhp[ch * 2 + 1] += (x - mhp[ch * 2 + 1]) * kh; x -= mhp[ch * 2 + 1];
        let y = b0 * x + b1 * bq[o] + b0 * bq[o + 1] - a1 * bq[o + 2] - a2 * bq[o + 3] + 1e-20;
        bq[o + 1] = bq[o]; bq[o] = x; bq[o + 3] = bq[o + 2]; bq[o + 2] = y;
        const d = y - dc[ch * 2] + 0.9975 * dc[ch * 2 + 1];
        dc[ch * 2] = y; dc[ch * 2 + 1] = d;
        y = d * 0.75;
        const ay = y < 0 ? -y : y;
        if (ay > 0.6) { const u = Math.tanh((ay - 0.6) / 0.38) * 0.38 + 0.6; y = y < 0 ? -u : u; }
        if (ch) oR[k] = y; else oL[k] = y;
      }
    }
    this.sw = sw1;
    return true;
  }
}

registerProcessor('foolsiron', FoolsIron);
