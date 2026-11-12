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

/* ---------- 雑音：白・桃・茶 ---------- */
// 帯域を移すと痩せる分の埋め合わせ。高域側は耳につくので半ばまで
const MAKEUP = (pt, c) => Math.pow(10, pt * pt * (pt < 0 ? 12 - 6 * c : 5 + 8 * c) / 20);
class Noise {
  constructor(rng) {
    this.rng = rng;
    this.b = [new Float64Array(7), new Float64Array(7)];
    this.br = [0, 0];
    this.swPh = rng(); this.swVar = 1;
    this.gL = 0; this.gR = 0; this.gE = 0;
    this.fs = [new Float64Array(4), new Float64Array(4)];     // 帯域を移す濾波の状態
    this.buf = [new Float32Array(128), new Float32Array(128)];
  }
  render(P, n, tL, tR, excN) {
    if (this.buf[0].length < n) this.buf = [new Float32Array(n), new Float32Array(n)];
    const c = P.noiseColor;
    let wW = 0, wP = 0, wB = 0;
    if (c < 0.5) { wW = Math.cos(c * Math.PI); wP = Math.sin(c * Math.PI); }
    else { wP = Math.cos((c - 0.5) * Math.PI); wB = Math.sin((c - 0.5) * Math.PI); }
    wW *= 0.35; wP *= 0.118; wB *= 2.3;       // 三色の実効値を揃える係数
    // 高低：負なら高域を削り、正なら低域を削る（いずれも 12dB/oct）
    const pt = P.noisePitch;
    const kl = 1 - Math.exp(-2 * Math.PI * (pt < 0 ? 20000 * Math.pow(0.006, -pt) : 20000) / SR);
    const kh = 1 - Math.exp(-2 * Math.PI * (pt > 0 ? 20 * Math.pow(250, pt) : 20) / SR);
    const mk = MAKEUP(pt, c);
    for (let ch = 0; ch < 2; ch++) {
      const b = this.b[ch], o = this.buf[ch];
      let br = this.br[ch];
      const fs = this.fs[ch];
      let l1 = fs[0], l2 = fs[1], h1 = fs[2], h2 = fs[3];
      let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6];
      for (let k = 0; k < n; k++) {
        const w = white();
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
        br = (br + 0.02 * w) / 1.02;
        let y = w * wW + pink * wP + br * wB;
        l1 += (y - l1) * kl; l2 += (l1 - l2) * kl; y = l2;
        h1 += (y - h1) * kh; y -= h1; h2 += (y - h2) * kh; y -= h2;
        o[k] = y * mk;
      }
      fs[0] = l1; fs[1] = l2; fs[2] = h1; fs[3] = h2;
      b[0] = b0; b[1] = b1; b[2] = b2; b[3] = b3; b[4] = b4; b[5] = b5; b[6] = b6;
      this.br[ch] = br;
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

/* ---------- 声：フォルマント合成による、意味の取れぬ発話 ---------- */
const VOW = {
  a: [750, 1200, 2500], i: [290, 2250, 2950], u: [330, 1250, 2300], e: [480, 1900, 2550],
  o: [470, 850, 2500], '@': [500, 1450, 2500], E: [600, 1700, 2500], O: [580, 950, 2500],
};
// d=長さ(秒) F=フォルマント（無ければ後続の母音） av=有声 ah=気息 af=摩擦 fr=[摩擦の中心Hz,Q] nas=鼻音 fast=速い遷移
const CONS = {
  m: { w: 1.0, p: [{ d: .07, F: [250, 1000, 2200], av: .45, nas: 1 }] },
  n: { w: 1.0, p: [{ d: .06, F: [250, 1500, 2500], av: .45, nas: 1 }] },
  r: { w: 0.9, p: [{ d: .035, F: [350, 1400, 2400], av: .5 }] },
  l: { w: 0.5, p: [{ d: .06, F: [330, 1100, 2700], av: .6 }] },
  w: { w: 0.5, p: [{ d: .06, F: [300, 700, 2300], av: .6 }] },
  y: { w: 0.5, p: [{ d: .06, F: [280, 2200, 2900], av: .6 }] },
  h: { w: 0.7, p: [{ d: .07, av: 0, ah: .6 }] },
  b: { w: 0.5, p: [{ d: .06, F: [200, 800, 2200], av: .1, fast: 1 }, { d: .008, av: .3, af: .25, fr: [700, .7] }] },
  d: { w: 0.6, p: [{ d: .055, F: [200, 1700, 2600], av: .1, fast: 1 }, { d: .008, av: .3, af: .3, fr: [4000, 1] }] },
  g: { w: 0.5, p: [{ d: .06, F: [200, 2100, 2400], av: .1, fast: 1 }, { d: .01, av: .3, af: .3, fr: [1900, 2] }] },
  p: { w: 0.3, p: [{ d: .07, F: [200, 800, 2200], av: 0, fast: 1 }, { d: .01, av: 0, af: .4, fr: [700, .7] }, { d: .03, av: 0, ah: .5 }] },
  t: { w: 0.5, p: [{ d: .07, F: [200, 1700, 2600], av: 0, fast: 1 }, { d: .012, av: 0, af: .5, fr: [4200, 1] }, { d: .03, av: 0, ah: .5 }] },
  k: { w: 0.5, p: [{ d: .075, F: [200, 2100, 2400], av: 0, fast: 1 }, { d: .015, av: 0, af: .5, fr: [1900, 2] }, { d: .035, av: 0, ah: .5 }] },
  s: { w: 0.5, p: [{ d: .1, F: [300, 1700, 2600], av: 0, af: .45, fr: [6000, 1.5] }] },
  S: { w: 0.4, p: [{ d: .1, F: [300, 2000, 2600], av: 0, af: .45, fr: [3000, 1.5] }] },
  f: { w: 0.2, p: [{ d: .08, F: [300, 1100, 2300], av: 0, af: .2, fr: [4500, .5] }] },
  z: { w: 0.2, p: [{ d: .07, F: [250, 1700, 2600], av: .5, af: .25, fr: [6000, 1.5] }] },
};

// 種から「言語」を造る。母音と子音の偏り、繰り返し現れる語彙を持たせる
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
    this.f = [500, 1500, 2500]; this.tf = [500, 1500, 2500];
    this.bwm = 1; this.tbwm = 1;
    this.av = 0; this.ah = 0; this.af = 0; this.tav = 0; this.tah = 0; this.taf = 0;
    this.fast = 0;
    this.lp = Math.log2(110); this.tlp = this.lp;
    this.A = new Float64Array(5); this.B = new Float64Array(5); this.C = new Float64Array(5);
    this.y1 = new Float64Array(5); this.y2 = new Float64Array(5);
    this.ph = rng(); this.tilt = 0;
    this.fb = [0, 0, 0, 0, 0]; this.fx1 = 0; this.fx2 = 0; this.fy1 = 0; this.fy2 = 0;   // 摩擦用の帯域通過
    this.hp = 0; this.l1 = 0; this.l2 = 0;
    this.jit = new Wander(rng); this.drift = new Wander(rng); this.pw = new Wander(rng);
    this.active = false; this.gE = 0;
  }
  setFric(fr) {
    const w0 = 2 * Math.PI * Math.min(fr[0], SR * 0.4) / SR, al = Math.sin(w0) / (2 * fr[1]), a0 = 1 + al;
    this.fb = [al / a0, 0, -al / a0, -2 * Math.cos(w0) / a0, (1 - al) / a0];
  }
  buildPhrase(P, lang) {
    const rng = this.rng, syls = [];
    const nw = 1 + Math.floor(rng() * rng() * 5);
    for (let i = 0; i < nw; i++) {
      const w = lang.words[Math.floor(rng() * rng() * lang.words.length)];
      for (const s of w) syls.push(s);
    }
    const ds = 4.5 / (P.voiceRate * this.rateMul), N = syls.length;
    let lastF = VOW.a, pm = 1;
    syls.forEach((s, i) => {
      const pos = N > 1 ? i / (N - 1) : 1, last = i === N - 1;
      pm = (1.16 - 0.3 * pos) * (1 + (rng() - 0.5) * 0.14);
      if (last && rng() < 0.2) pm *= 1.22;
      const Vf = VOW[s.v];
      if (s.c) {
        for (const q of CONS[s.c].p) {
          this.segs.push({ d: q.d * (0.5 + 0.5 * ds), F: q.F || Vf, av: q.av, ah: q.ah || 0, af: q.af || 0,
            fr: q.fr, nas: q.nas, fast: q.fast, pm });
        }
      }
      const vd = (0.1 + rng() * 0.08) * ds * (last ? 1.6 : 1);
      this.segs.push({ d: vd, F: Vf, av: 1, ah: 0, af: 0, pm });
      lastF = Vf;
      if (s.v2) { lastF = VOW[s.v2]; this.segs.push({ d: vd * 0.7, F: lastF, av: 0.95, ah: 0, af: 0, pm: pm * 0.97 }); }
      if (s.n) this.segs.push({ d: 0.07 * ds, F: [250, 1500, 2500], av: 0.4, ah: 0, af: 0, nas: 1, pm: pm * 0.95 });
    });
    this.segs.push({ d: 0.08, F: lastF, av: 0, ah: 0, af: 0, pm: pm * 0.9 });
    this.segs.push({ d: gapSec(P.voiceGap) * (0.5 + rng()), F: lastF, av: 0, ah: 0, af: 0, pm: 1, pause: true });
  }
  nextSeg(P, f0, ratios, lang) {
    if (!this.segs.length) this.buildPhrase(P, lang);
    const s = this.segs.shift();
    this.segLeft += Math.max(16, Math.round(s.d * SR));
    this.tf = s.F; this.tav = s.av; this.tah = s.ah; this.taf = s.af;
    this.tbwm = s.nas ? 3 : 1; this.fast = s.fast ? 1 : 0;
    if (s.fr) this.setFric(s.fr);
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
    if (on && !this.active) { this.active = true; this.segs.length = 0; this.segLeft = Math.floor((0.2 + this.rng() * 1.2) * SR); this.tav = this.tah = this.taf = 0; }
    const tract = P.voiceTract * this.tractMul;
    const br = P.voiceBreath, cons = P.voiceCons;
    const ktilt = 1 - Math.exp(-2 * Math.PI * 1300 / SR);
    const khp = 1 - Math.exp(-2 * Math.PI * 90 / SR);
    const far = P.voiceFar;
    const kfar = 1 - Math.exp(-2 * Math.PI * (7000 * (1 - far) * (1 - far) + 700) / SR);
    const dt = n / SR;
    const pan = clamp(this.panBase * P.voiceSpread + this.pw.step(dt, P.flucRate) * P.sway * 0.5, -1, 1);
    const gl = panL(pan), gr = panR(pan);
    const gE1 = P.voiceRes * P.voiceRes * P.voiceLevel * P.voiceLevel * 1.5, dE = (gE1 - this.gE) / n;
    let gE = this.gE;
    const jz = this.jit.step(dt, 7), dz = this.drift.step(dt, 0.4);
    const FF = [0, 0, 0, 3500, 4500], BW = [80, 100, 160, 250, 320];
    const A = this.A, B = this.B, C = this.C, y1 = this.y1, y2 = this.y2, fb = this.fb;

    for (let i = 0; i < n;) {
      const sub = Math.min(16, n - i);
      this.segLeft -= sub;
      while (this.segLeft <= 0) {
        if (!on && !this.segs.length) { this.active = false; this.tav = this.tah = this.taf = 0; this.segLeft = SR; break; }
        this.nextSeg(P, f0, ratios, lang);
      }
      const kf = 1 - Math.exp(-sub / (SR * (this.fast ? 0.012 : 0.028)));
      const ka = 1 - Math.exp(-sub / (SR * (this.fast ? 0.005 : 0.011)));
      const kp = 1 - Math.exp(-sub / (SR * 0.06));
      for (let q = 0; q < 3; q++) this.f[q] += (this.tf[q] - this.f[q]) * kf;
      this.bwm += (this.tbwm - this.bwm) * kf;
      this.av += (this.tav - this.av) * ka; this.ah += (this.tah - this.ah) * ka; this.af += (this.taf - this.af) * ka;
      this.lp += (this.tlp - this.lp) * kp;
      FF[0] = this.f[0]; FF[1] = this.f[1]; FF[2] = this.f[2];
      for (let q = 0; q < 5; q++) {
        const f = Math.min(FF[q] * tract, SR * 0.45), bw = BW[q] * (q === 1 || q === 2 ? this.bwm : 1);
        const c = -Math.exp(-2 * Math.PI * bw / SR), b = 2 * Math.exp(-Math.PI * bw / SR) * Math.cos(2 * Math.PI * f / SR);
        C[q] = c; B[q] = b; A[q] = 1 - b - c;
      }
      if (this.tav === 0 && this.tah === 0 && this.taf === 0 && this.av < 1e-5 && this.ah < 1e-5 && this.af < 1e-5) {
        i += sub; gE += dE * sub; continue;       // 沈黙の間は濾波を回さない
      }
      const dp = Math.pow(2, this.lp) * (1 + 0.012 * jz + 0.02 * dz) / SR;
      const av = this.av, gV = av * (1 - br), gN = av * br * 1.5 + this.ah * (0.3 + 0.7 * cons) * 0.4 + av * 0.015;
      const gF = this.af * cons * 0.35;
      let ph = this.ph, tilt = this.tilt, hp = this.hp, l1 = this.l1, l2 = this.l2;
      let fx1 = this.fx1, fx2 = this.fx2, fy1 = this.fy1, fy2 = this.fy2;
      for (let k = i; k < i + sub; k++) {
        ph += dp; if (ph >= 1) ph -= 1;
        let saw = 2 * ph - 1;
        if (ph < dp) { const t = ph / dp; saw -= t + t - t * t - 1; }
        else if (ph > 1 - dp) { const t = (ph - 1) / dp; saw -= t * t + t + t + 1; }
        tilt += (saw - tilt) * ktilt;
        const nz = white();
        let x = tilt * gV + nz * gN * (0.7 + 0.3 * saw);
        for (let q = 0; q < 5; q++) {
          const y = A[q] * x + B[q] * y1[q] + C[q] * y2[q] + 1e-20;
          y2[q] = y1[q]; y1[q] = y; x = y;
        }
        const fy = fb[0] * nz + fb[2] * fx2 - fb[3] * fy1 - fb[4] * fy2;
        fx2 = fx1; fx1 = nz; fy2 = fy1; fy1 = fy;
        let o = x * 0.22 + fy * gF;
        hp += (o - hp) * khp; o -= hp;
        l1 += (o - l1) * kfar; l2 += (l1 - l2) * kfar; o = l2;
        gE += dE;
        tL[k] += o * gl; tR[k] += o * gr; excT[k] += o * gE;
      }
      this.ph = ph; this.tilt = tilt; this.hp = hp; this.l1 = l1; this.l2 = l2;
      this.fx1 = fx1; this.fx2 = fx2; this.fy1 = fy1; this.fy2 = fy2;
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

/* ---------- 笛と鐘に共通の道具 ---------- */
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

/* ---------- 笛：か細い息の笛から、霧の向こうの警笛まで ---------- */
class Flute {
  constructor(rng) {
    this.rng = rng; this.segs = []; this.left = Math.floor((1 + rng() * 3) * SR);
    this.lp = Math.log2(440); this.tlp = this.lp; this.amp = 0; this.tamp = 0;
    this.ph = 0; this.chiff = 0; this.nx = 0; this.ny = 0;
    this.pan = 0; this.vph = rng(); this.vw = new Wander(rng); this.dw = new Wander(rng); this.aw = new Wander(rng);
    this.l1 = 0; this.l2 = 0; this.gE = 0; this.idx = -1;
  }
  build(P, f0, ratios) {
    const rng = this.rng, lad = ladder(f0, ratios, P.flutePitch, P.fluteRange * 1.5);
    const n = 1 + Math.floor(Math.pow(rng(), 1.4) * P.fluteNotes);
    if (this.idx < 0 || this.idx >= lad.length || rng() < 0.4) this.idx = Math.floor(rng() * lad.length);
    for (let i = 0; i < n; i++) {
      const d = P.fluteLen * (0.6 + rng() * 0.8) * (i === n - 1 ? 1.4 : 1);
      this.segs.push({ d, lp: lad[this.idx], a: 0.7 + 0.3 * rng() });
      this.idx = walk(rng, this.idx, lad.length);
      if (i < n - 1 && rng() > P.fluteGlide) this.segs.push({ d: 0.04 + 0.1 * rng(), a: 0 });   // 吹き直し
    }
    this.segs.push({ d: gapSec(P.fluteGap) * (0.5 + rng()), a: 0, pause: true });
    this.pan = (rng() * 2 - 1) * P.flutePan;
  }
  render(P, f0, ratios, n, tL, tR, excT) {
    const dt = n / SR, body = P.fluteBody;
    this.left -= n;
    while (this.left <= 0) {
      if (!this.segs.length) this.build(P, f0, ratios);
      const s = this.segs.shift();
      this.left += Math.max(n, Math.round(s.d * SR));
      this.tamp = s.a;
      if (s.a > 0) {
        this.tlp = s.lp;
        if (this.amp < 0.03) this.lp = s.lp;       // 無音からの吹き始めは滑らせない
        this.chiff = 1;
      }
    }
    this.lp += (this.tlp - this.lp) * (1 - Math.exp(-dt / (0.008 + P.fluteGlide * 0.3)));
    const rise = this.tamp > this.amp;
    const a1 = this.amp + (this.tamp - this.amp) * (1 - Math.exp(-dt / (rise ? 0.02 + 0.3 * body : 0.05 + 0.4 * body)));
    const gE1 = P.fluteRes * P.fluteRes * P.fluteLevel * P.fluteLevel;
    if (a1 < 1e-5 && this.amp < 1e-5) { this.amp = a1; this.gE = gE1; return; }
    this.vph += (4.6 + 1.2 * this.vw.step(dt, 0.5)) * dt; this.vph -= Math.floor(this.vph);
    const vib = Math.sin(2 * Math.PI * this.vph) * P.fluteVib * 0.03 + this.dw.step(dt, 0.3) * 0.004;
    const f = Math.min(Math.pow(2, this.lp + vib), SR * 0.3), inc = f / SR;
    const beta = body * 1.7 / (2 * Math.PI);
    const trem = 1 + 0.12 * this.aw.step(dt, 3) * (0.3 + P.fluteBreath);
    // 息：音高のまわりに絞った雑音。吹き始めに一瞬強まる
    this.chiff *= Math.exp(-dt / 0.06);
    const r = Math.exp(-Math.PI * (f / 5 + 60) / SR), th = 2 * Math.PI * f / SR;
    const c = r * Math.cos(th), sn = r * Math.sin(th);
    const gn = Math.sqrt(2 * (1 - r)) * P.fluteBreath * (0.9 + 2.2 * this.chiff);
    const gt = 1 - 0.45 * P.fluteBreath;
    const far = P.fluteFar, kfar = 1 - Math.exp(-2 * Math.PI * (9000 * (1 - far) * (1 - far) + 600) / SR);
    const gl = panL(this.pan) * 0.3, gr = panR(this.pan) * 0.3;
    const da = (a1 - this.amp) / n, dE = (gE1 - this.gE) / n;
    let a = this.amp, gE = this.gE, p = this.ph, nx = this.nx, ny = this.ny, l1 = this.l1, l2 = this.l2;
    for (let k = 0; k < n; k++) {
      p += inc; if (p >= 1) p -= 1;
      let x = p * TS, j = x | 0;
      const s1 = SIN[j] + (SIN[j + 1] - SIN[j]) * (x - j);
      let q = p + beta * s1; q -= Math.floor(q);            // 自己変調で倍音を足す（太さ）
      x = q * TS; j = x | 0;
      const s2 = SIN[j] + (SIN[j + 1] - SIN[j]) * (x - j);
      const t = c * nx - sn * ny + white() * gn + 1e-20;
      ny = sn * nx + c * ny; nx = t;
      a += da; gE += dE;
      let o = (s2 * gt + ny) * a * trem;
      l1 += (o - l1) * kfar; l2 += (l1 - l2) * kfar; o = l2;
      tL[k] += o * gl; tR[k] += o * gr; excT[k] += o * gE * 0.5;
    }
    this.amp = a1; this.gE = gE1; this.ph = p; this.nx = nx; this.ny = ny; this.l1 = l1; this.l2 = l2;
  }
}

/* ---------- 鐘：風鈴から、遠い寺の鐘まで ---------- */
const BELL_R = [
  [1, 2.756, 5.404, 8.933, 13.34, 18.64, 24.8],        // 棒・風鈴
  [0.5, 1, 1.183, 1.506, 2, 2.514, 3.011],             // 洋鐘
  [1, 1.48, 2.02, 2.74, 3.0, 3.76, 4.07],              // 梵鐘・銅鑼寄り
];
const BELL_A = [
  [1, 0.6, 0.35, 0.2, 0.12, 0.07, 0.04],
  [0.5, 1, 0.7, 0.5, 0.6, 0.3, 0.25],
  [1, 0.7, 0.6, 0.45, 0.4, 0.3, 0.25],
];
const BP = 10;       // 一打あたりの正弦の数：部分音七つ＋低い三つの唸り相手
class Bell {
  constructor(rng) {
    this.rng = rng; this.q = []; this.left = Math.floor((1 + rng() * 4) * SR); this.idx = -1; this.pan = 0;
    this.v = [];
    for (let i = 0; i < 6; i++) this.v.push({ on: false, inc: new Float64Array(BP), ph: new Float64Array(BP), env: new Float64Array(BP), dec: new Float64Array(BP) });
    this.m = new Float32Array(128); this.fl = [0, 0, 0, 0]; this.gE = 0;
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
    if (!v) { v = this.v[0]; for (const x of this.v) if (x.env[0] + x.env[1] < v.env[0] + v.env[1]) v = x; }
    const rng = this.rng, hard = P.bellHard;
    const x = Math.min(P.bellTimbre * 2, 1.9999), si = x | 0, fr = x - si;
    const f = Math.pow(2, lp);
    let sumsq = 0, rmin = 1e9;
    const rat = [], amp = [];
    for (let i = 0; i < 7; i++) {
      rat.push(Math.pow(2, Math.log2(BELL_R[si][i]) * (1 - fr) + Math.log2(BELL_R[si + 1][i]) * fr));
      amp.push((BELL_A[si][i] * (1 - fr) + BELL_A[si + 1][i] * fr) * Math.pow(i + 1, -1.6 * (1 - hard)));
      rmin = Math.min(rmin, rat[i]);
    }
    for (let i = 0; i < BP; i++) {
      const src = i < 7 ? i : i - 7, pair = src < 3;
      let fq = f * rat[src];
      if (i >= 7) fq *= 1 + P.bellBeat * 0.006 * (0.5 + rng());       // 唸りの相手
      const a = fq < SR * 0.45 ? amp[src] * (i >= 7 ? 0.4 : pair ? 0.75 : 1) : 0;    // 唸りは浅く。完全には打ち消さない
      v.inc[i] = fq / SR; v.ph[i] = rng(); v.env[i] = a;
      v.dec[i] = Math.exp(-LN1000 / (clamp(P.bellDecay / Math.pow(rat[src] / rmin, 0.75), 0.05, 60) * SR));
      sumsq += a * a;
    }
    const nrm = 0.28 * vel / Math.sqrt(sumsq || 1);
    for (let i = 0; i < BP; i++) v.env[i] *= nrm;
    v.on = true; v.attLen = Math.round((0.002 + (1 - hard) * 0.03) * SR); v.att = 0;
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
    for (const v of this.v) {
      if (!v.on) continue;
      m.fill(0, 0, n);
      let alive = false;
      for (let i = 0; i < BP; i++) {
        let e = v.env[i];
        if (e < 2e-5) continue;
        alive = true;
        const inc = v.inc[i], dec = v.dec[i];
        let p = v.ph[i];
        for (let k = 0; k < n; k++) {
          const x = p * TS, j = x | 0;
          m[k] += (SIN[j] + (SIN[j + 1] - SIN[j]) * (x - j)) * e;
          e *= dec; p += inc; if (p >= 1) p -= 1;
        }
        v.env[i] = e; v.ph[i] = p;
      }
      if (!alive) { v.on = false; continue; }
      for (let k = 0; k < n; k++) {
        let o = m[k];
        if (v.att < v.attLen) o *= ++v.att / v.attLen;
        tL[k] += o * v.gl; tR[k] += o * v.gr; excT[k] += o * gE;
      }
    }
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
    this.lp = [0, 0]; this.hp = [0, 0]; this.wph = 0; this.fph = 0; this.idle = true;
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
    let lpL = this.lp[0], lpR = this.lp[1], hpL = this.hp[0], hpR = this.hp[1];
    for (let k = 0; k < n; k++) {
      d += (dt - d) * kd;                         // 長さを変えると、テープのように音高が滑る
      wph += 0.55 / SR; if (wph >= 1) wph -= 1;
      fph += 6.3 / SR; if (fph >= 1) fph -= 1;
      const md = d * (1 + wow * (0.004 * SIN[(wph * TS) | 0] + 0.0007 * SIN[(fph * TS) | 0]));
      let pos = w - md; if (pos < 0) pos += N;
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
      const ol = yl * g * 0.7, or = yr * g * 0.7;
      outL[k] += ol; outR[k] += or;
      wL[k] += ol * 0.3; wR[k] += or * 0.3;
    }
    this.w = w; this.d = d; this.wph = wph; this.fph = fph;
    this.lp[0] = lpL; this.lp[1] = lpR; this.hp[0] = hpL; this.hp[1] = hpR;
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
  process(_, outputs) {
    const out = outputs[0], oL = out[0], oR = out[1] || out[0], n = oL.length;
    if (n > this.bn) this.mk(n);
    this.updateParams(n);
    const { P, S, tL, tR, dL, dR, wL, wR, eN, eT, xL, xR, g, es, dub } = this;
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
    }
    g.drone = t; es[0] = e;

    // 雑音は直接音が零でも、共鳴へ送るために回す
    t = P.noiseLevel * P.noiseLevel * dub.mute[1]; e = P.noiseEcho * P.noiseEcho + dub.thr[1];
    if (t > 1e-6 || g.noise > 1e-6 || (P.noiseRes > 0.001 && P.resLevel > 0.001)) {
      tL.fill(0); tR.fill(0);
      this.noise.render(P, n, tL, tR, eN);
      this.phN.process(P, n, tL, tR);
      mixTo(n, tL, tR, g.noise, t, dL, dR, 0.12, wL, wR, es[1], e, xL, xR);
    }
    g.noise = t; es[1] = e;

    t = P.arpLevel * P.arpLevel * dub.mute[3]; e = P.arpEcho * P.arpEcho + dub.thr[3];
    if (t > 1e-6 || g.arp > 1e-6) {
      tL.fill(0); tR.fill(0);
      this.arp.render(P, S, f0, ratios, n, tL, tR, eT);
      mixTo(n, tL, tR, g.arp, t, dL, dR, 0.9, wL, wR, es[3], e, xL, xR);
    }
    g.arp = t; es[3] = e;

    t = P.voiceLevel * P.voiceLevel * dub.mute[4]; e = P.voiceEcho * P.voiceEcho + dub.thr[4];
    if (t > 1e-6 || g.voice > 1e-6) {
      tL.fill(0); tR.fill(0);
      const cnt = +S.voiceCount;
      for (const sp of this.speakers) sp.render(P, f0, ratios, this.lang, n, tL, tR, eT, cnt);
      const far = P.voiceFar, dry = 1 - 0.7 * far;
      mixTo(n, tL, tR, g.voice * dry, t * dry, dL, dR, (0.4 + 1.0 * far) / dry, wL, wR, es[4], e, xL, xR);
    }
    g.voice = t; es[4] = e;

    for (const [key, i, part] of [['flute', 5, this.flute], ['bell', 6, this.bell]]) {
      const lv = P[key + 'Level'], far = P[key + 'Far'], dry = 1 - 0.7 * far;
      t = lv * lv * dub.mute[i]; e = P[key + 'Echo'] * P[key + 'Echo'] + dub.thr[i];
      if (t > 1e-6 || g[key] > 1e-6) {
        tL.fill(0); tR.fill(0);
        part.render(P, f0, ratios, n, tL, tR, eT);
        mixTo(n, tL, tR, g[key] * dry, t * dry, dL, dR, (0.4 + 1.0 * far) / dry, wL, wR, es[i], e, xL, xR);
      }
      g[key] = t; es[i] = e;
    }

    // 声・反復・笛・鐘の共鳴送りは、それぞれの音量に従わせる
    t = P.resLevel * P.resLevel * dub.mute[2]; e = P.resEcho * P.resEcho + dub.thr[2];
    if (t > 1e-6 || g.res > 1e-6) {
      tL.fill(0); tR.fill(0);
      this.res.render(P, f0, ratios, n, eN, eT, tL, tR);
      mixTo(n, tL, tR, g.res, t, dL, dR, 0.7, wL, wR, es[2], e, xL, xR);
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
