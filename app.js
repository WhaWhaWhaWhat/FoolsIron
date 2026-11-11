// FoolsIron 操作面：画面の組み立て、プリセット、タイマー、発音部との受け渡し
import { PARAMS, MACROS, FACTORY, BY_ID, norm, denorm, defaults, sanitize, format } from './params.js';

const $ = id => document.getElementById(id);
const KEY = { state: 'foolsiron.state', presets: 'foolsiron.presets', settings: 'foolsiron.settings' };
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

const settings = Object.assign({ vol: 70, morph: 15, timer: 0, tab: 'front' }, store.get(KEY.settings, {}));
function saveSettings() { store.set(KEY.settings, settings); }
let user = store.get(KEY.presets, []).filter(p => p && typeof p.name === 'string');
// 現在の状態。src は選択中のプリセット（'f:番号' 内蔵 / 'u:番号' 自作 / 'x' どちらでもない）
let state = { name: '', seed: 1, params: defaults(), src: 'x', dirty: false };

/* ---------- 既定値との差分だけを持つ、小さな保存形式 ---------- */
function diff(params) {
  const d = defaults(), o = {};
  for (const p of PARAMS) {
    const v = params[p.id];
    if (p.type === 'sel') { if (v !== d[p.id]) o[p.id] = v; }
    else if (Math.abs(v - d[p.id]) > 1e-9) o[p.id] = +v.toPrecision(4);
  }
  return o;
}
function encode(s) {
  const bytes = new TextEncoder().encode(JSON.stringify({ n: s.name, s: s.seed, p: diff(s.params) }));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(text) {
  let code = text.trim();
  const i = code.indexOf('#p=');
  if (i >= 0) code = code.slice(i + 3);
  code = code.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(code), bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  const o = JSON.parse(new TextDecoder().decode(bytes));
  if (!o || typeof o !== 'object' || typeof o.p !== 'object') throw new Error('形式が違う');
  return { name: String(o.n || '無名').slice(0, 40), seed: (o.s | 0) || 1, p: o.p };
}

/* ---------- 発音部 ---------- */
let ctx = null, node = null, fade = null, vol = null;
let fadeInEnd = 0, endAt = null, ticker = null, stopping = false;

const post = m => { if (node) node.port.postMessage(m); };
const volGain = () => { const v = settings.vol / 100; return v * v; };

async function start() {
  if (ctx || stopping) return;
  $('play').disabled = true;
  try {
    ctx = new AudioContext({ latencyHint: 'playback' });
    await ctx.audioWorklet.addModule('engine.js');
    node = new AudioWorkletNode(ctx, 'foolsiron', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    fade = ctx.createGain(); vol = ctx.createGain();
    vol.gain.value = volGain();
    fade.gain.setValueAtTime(0, ctx.currentTime);
    fade.gain.linearRampToValueAtTime(1, ctx.currentTime + 3);
    fadeInEnd = ctx.currentTime + 3;
    node.connect(fade); fade.connect(vol); vol.connect(ctx.destination);   // 消灯試験の結果に従い、直接出力とする
    post({ type: 'seed', seed: state.seed });
    post({ values: state.params, snap: true });
    await ctx.resume();
    armTimer();
    ticker = setInterval(tick, 1000);
    $('play').textContent = '止める';
    $('play').classList.add('on');
    tick();
  } catch (e) {
    $('status').textContent = '開始に失敗した: ' + e.message;
    if (ctx) ctx.close();
    ctx = node = null;
  }
  $('play').disabled = false;
}

function shutdown() {
  clearInterval(ticker);
  if (ctx) ctx.close();
  ctx = node = fade = vol = null; endAt = null; stopping = false;
  $('play').textContent = '鳴らす';
  $('play').classList.remove('on');
  $('play').disabled = false;
  $('status').textContent = '停止中';
}

function stop() {
  if (!ctx || stopping) return;
  stopping = true;
  $('play').disabled = true;
  const t = ctx.currentTime;
  if (fade.gain.cancelAndHoldAtTime) fade.gain.cancelAndHoldAtTime(t); else fade.gain.cancelScheduledValues(t);
  fade.gain.setTargetAtTime(0, t, 0.35);
  setTimeout(shutdown, 1600);
}

// タイマーは音の時計の上に予約する。裏でこの頁の処理が間引かれても、絞りは遅れない
function armTimer() {
  if (!ctx || stopping) return;
  const min = settings.timer;
  const t = Math.max(ctx.currentTime, fadeInEnd);
  if (fade.gain.cancelAndHoldAtTime) fade.gain.cancelAndHoldAtTime(t); else fade.gain.cancelScheduledValues(t);
  fade.gain.linearRampToValueAtTime(1, t + 1);
  endAt = null;
  if (min > 0) {
    const total = min * 60, f = Math.min(300, total / 3);
    endAt = t + total;
    fade.gain.setValueAtTime(1, endAt - f);
    fade.gain.linearRampToValueAtTime(0, endAt);
  }
}

function tick() {
  if (!ctx || stopping) return;
  if (endAt != null && ctx.currentTime >= endAt) { shutdown(); $('status').textContent = 'タイマー満了。停止した'; return; }
  let s = '鳴動中';
  if (endAt != null) {
    const r = Math.max(0, Math.round(endAt - ctx.currentTime));
    s += '　残り ' + Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0');
  }
  if (ctx.state !== 'running') s += '　（一時停止: ' + ctx.state + '）';
  $('status').textContent = s;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ctx && !stopping) { if (ctx.state !== 'running') ctx.resume(); tick(); }
});

/* ---------- 部品：つまみ・選択・XY パッド ---------- */
const shown = {};                       // 項目 → その値を映す描画関数の列（同じ項目を複数の場所に置ける）
function bind(id, fn) { (shown[id] || (shown[id] = [])).push(fn); }
function showParam(id) { const v = state.params[id]; for (const f of shown[id] || []) f(v); }
function setParam(id, v) {
  state.params[id] = v;
  showParam(id);
  post({ values: { [id]: v }, glide: 0.06 });
  touch();
}

const SVGNS = 'http://www.w3.org/2000/svg';
const ARC = 2 * Math.PI * 15, SWEEP = ARC * 0.75;
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function svg(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

// 縦に引いて回す。二度叩きで既定値へ戻る。車輪・矢印キーにも応じる
function makeKnob(p, label, big, bare) {
  const k = el('div', 'knob' + (big ? ' big' : '') + (bare ? ' bare' : ''));
  k.tabIndex = 0;
  k.setAttribute('role', 'slider'); k.setAttribute('aria-label', label);
  const g = svg('svg', { viewBox: '0 0 40 40' });
  g.appendChild(svg('circle', { class: 'trk', cx: 20, cy: 20, r: 15, 'stroke-dasharray': SWEEP + ' ' + ARC, transform: 'rotate(135 20 20)' }));
  const arc = svg('circle', { class: 'arc', cx: 20, cy: 20, r: 15, transform: 'rotate(135 20 20)' });
  g.appendChild(arc);
  g.appendChild(svg('circle', { class: 'cap', cx: 20, cy: 20, r: 10.5 }));
  const ptr = svg('line', { class: 'ptr', x1: 20, y1: 11, x2: 20, y2: 15.5 });
  g.appendChild(ptr);
  const kv = el('div', 'kv');
  k.appendChild(g); if (!bare) k.appendChild(el('div', 'kl', label)); k.appendChild(kv);
  const bi = p.min < 0 && p.max > 0;

  const draw = v => {
    const t = norm(p, v);
    if (bi) {
      const z = norm(p, 0), a = Math.min(t, z), len = Math.abs(t - z);
      arc.setAttribute('stroke-dasharray', Math.max(0.01, len * SWEEP) + ' ' + ARC);
      arc.setAttribute('stroke-dashoffset', -a * SWEEP);
    } else {
      arc.setAttribute('stroke-dasharray', Math.max(0.01, t * SWEEP) + ' ' + ARC);
    }
    ptr.setAttribute('transform', 'rotate(' + (270 * t - 135) + ' 20 20)');
    kv.textContent = format(p, v);
    k.setAttribute('aria-valuetext', kv.textContent);
  };
  bind(p.id, draw);

  const put = t => {
    t = Math.min(1, Math.max(0, t));
    let v = denorm(p, t);
    if (p.step) v = Math.round(v / p.step) * p.step;
    if (bi && Math.abs(v) < (p.max - p.min) * 0.012) v = 0;       // 中央に軽く吸い付く
    if (v !== state.params[p.id]) setParam(p.id, v);
  };
  let y0 = 0, t0 = 0, lastDown = 0, drag = false;
  k.addEventListener('pointerdown', e => {
    const now = performance.now();
    if (now - lastDown < 320) { setParam(p.id, p.def); lastDown = 0; return; }
    lastDown = now;
    drag = true; y0 = e.clientY; t0 = norm(p, state.params[p.id]);
    k.setPointerCapture(e.pointerId);
    e.preventDefault(); k.focus({ preventScroll: true });
  });
  k.addEventListener('pointermove', e => { if (drag) put(t0 + (y0 - e.clientY) / (e.shiftKey ? 640 : 170)); });
  const end = () => { drag = false; };
  k.addEventListener('pointerup', end); k.addEventListener('pointercancel', end);
  k.addEventListener('wheel', e => {
    e.preventDefault();
    const d = p.step ? p.step / (p.max - p.min) : 0.02;
    put(norm(p, state.params[p.id]) + (e.deltaY < 0 ? d : -d));
  }, { passive: false });
  k.addEventListener('keydown', e => {
    const d = p.step ? p.step / (p.max - p.min) : (e.shiftKey ? 0.002 : 0.01);
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') put(norm(p, state.params[p.id]) + d);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') put(norm(p, state.params[p.id]) - d);
    else if (e.key === 'Home' || e.key === 'Delete') setParam(p.id, p.def);
    else return;
    e.preventDefault();
  });
  return k;
}

// 縦フェーダー。つまみと同じく、触れた位置からの引き幅で動く（触れただけでは跳ばぬ）
function makeFader(p, label, out) {
  const f = el('div', 'fader');
  f.tabIndex = 0;
  f.setAttribute('role', 'slider'); f.setAttribute('aria-label', label); f.setAttribute('aria-orientation', 'vertical');
  const fill = el('div', 'fill'), cap = el('div', 'cap');
  f.appendChild(fill); f.appendChild(cap);
  bind(p.id, v => {
    const t = norm(p, v);
    fill.style.height = t * 100 + '%'; cap.style.bottom = t * 100 + '%';
    out.textContent = format(p, v);
    f.setAttribute('aria-valuetext', out.textContent);
  });
  const put = t => { const v = denorm(p, Math.min(1, Math.max(0, t))); if (v !== state.params[p.id]) setParam(p.id, v); };
  let y0 = 0, t0 = 0, lastDown = 0, drag = false;
  f.addEventListener('pointerdown', e => {
    const now = performance.now();
    if (now - lastDown < 320) { setParam(p.id, p.def); lastDown = 0; return; }
    lastDown = now;
    drag = true; y0 = e.clientY; t0 = norm(p, state.params[p.id]);
    f.setPointerCapture(e.pointerId);
    e.preventDefault(); f.focus({ preventScroll: true });
  });
  f.addEventListener('pointermove', e => { if (drag) put(t0 + (y0 - e.clientY) / (e.shiftKey ? 560 : 140)); });
  const end = () => { drag = false; };
  f.addEventListener('pointerup', end); f.addEventListener('pointercancel', end);
  f.addEventListener('wheel', e => { e.preventDefault(); put(norm(p, state.params[p.id]) + (e.deltaY < 0 ? 0.02 : -0.02)); }, { passive: false });
  f.addEventListener('keydown', e => {
    const d = e.shiftKey ? 0.002 : 0.01;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') put(norm(p, state.params[p.id]) + d);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') put(norm(p, state.params[p.id]) - d);
    else if (e.key === 'Home' || e.key === 'Delete') setParam(p.id, p.def);
    else return;
    e.preventDefault();
  });
  return f;
}

function makeSelect(p, label) {
  const c = el('div', 'cell');
  const s = document.createElement('select');
  s.setAttribute('aria-label', label);
  for (const o of p.opts) s.add(new Option(o.label, o.k));
  s.onchange = () => setParam(p.id, s.value);
  bind(p.id, v => { s.value = v; });
  c.appendChild(s); c.appendChild(el('div', 'kl', label));
  return c;
}

// 横＝明暗、縦＝動静。二度叩きで中央へ
function makePad(mx, my) {
  const px = BY_ID[mx.id], py = BY_ID[my.id];
  const pad = el('div', 'pad'), dot = el('div', 'dot'), val = el('span', 'v');
  pad.appendChild(el('span', 'l', mx.lo)); pad.appendChild(el('span', 'r', mx.hi));
  pad.appendChild(el('span', 't', my.hi)); pad.appendChild(el('span', 'b', my.lo));
  pad.appendChild(val); pad.appendChild(dot);
  const draw = () => {
    const x = state.params[mx.id], y = state.params[my.id];
    dot.style.left = (x + 1) * 50 + '%'; dot.style.top = (1 - y) * 50 + '%';
    val.textContent = mx.label + ' ' + format(px, x) + '　' + my.label + ' ' + format(py, y);
  };
  bind(mx.id, draw); bind(my.id, draw);
  const snap = v => Math.abs(v) < 0.04 ? 0 : Math.round(v * 100) / 100;
  const at = e => {
    const r = pad.getBoundingClientRect();
    const x = snap(Math.min(1, Math.max(-1, (e.clientX - r.left) / r.width * 2 - 1)));
    const y = snap(Math.min(1, Math.max(-1, 1 - (e.clientY - r.top) / r.height * 2)));
    state.params[mx.id] = x; state.params[my.id] = y;
    draw();
    post({ values: { [mx.id]: x, [my.id]: y }, glide: 0.1 });
    touch();
  };
  let drag = false, lastDown = 0;
  pad.addEventListener('pointerdown', e => {
    const now = performance.now();
    if (now - lastDown < 320) { lastDown = 0; drag = false; setParam(mx.id, 0); setParam(my.id, 0); return; }
    lastDown = now; drag = true; pad.setPointerCapture(e.pointerId); e.preventDefault(); at(e);
  });
  pad.addEventListener('pointermove', e => { if (drag) at(e); });
  const end = () => { drag = false; };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  return pad;
}

/* ---------- 画面の組み立て：表・各部・庫 ---------- */
const LEVELS = ['droneLevel', 'noiseLevel', 'resLevel', 'arpLevel', 'voiceLevel'];
// 表の下段：各部の音量（縦フェーダー）と高低（つまみ）
const PARTS = [['droneLevel', 'dronePitch'], ['noiseLevel', 'noisePitch'], ['resLevel', 'resPitch'], ['arpLevel', 'arpCenter'], ['voiceLevel', 'voicePitch']];
const secIds = sec => PARAMS.filter(p => p.sec === sec).map(p => p.id);
const TABS = [
  { id: 'front', label: '表' },
  { id: 'drone', label: 'ドローン', ids: ['droneLevel', ...secIds('drone')] },
  { id: 'noise', label: 'ノイズ', ids: ['noiseLevel', ...secIds('noise')] },
  { id: 'res',   label: 'RES', ids: ['resLevel', ...secIds('res')] },
  { id: 'arp',   label: 'ARP', ids: ['arpLevel', ...secIds('arp')] },
  { id: 'voice', label: '声',   ids: ['voiceLevel', ...secIds('voice')] },
  { id: 'field', label: '場',   ids: [...secIds('main').filter(i => !LEVELS.includes(i)), ...secIds('tune')] },
  { id: 'lfo',   label: 'LFO',  ids: [...secIds('lfo1'), ...secIds('lfo2')] },
  { id: 'lib',   label: 'プリセット' },
];

function showTab(id) {
  for (const t of TABS) {
    $('f_' + t.id).classList.toggle('on', t.id === id);
    $('t_' + t.id).classList.toggle('on', t.id === id);
  }
  settings.tab = id; saveSettings();
}

function buildFaces() {
  const tabs = $('tabs'), faces = $('faces');
  for (const t of TABS) {
    const b = el('button', '', t.label);
    b.id = 't_' + t.id; b.onclick = () => showTab(t.id);
    tabs.appendChild(b);
    const f = el('div', 'face' + (t.ids ? ' grid' : ''));
    f.id = 'f_' + t.id;
    faces.appendChild(f);
    if (!t.ids) continue;
    for (const id of t.ids) {
      const p = BY_ID[id];
      let label = LEVELS.includes(id) ? '音量' : p.label;
      if (p.sec === 'lfo1' || p.sec === 'lfo2') label = p.sec.slice(3) + ' ' + label;
      if (p.type === 'sel') f.appendChild(makeSelect(p, label));
      else { const c = el('div', 'cell'); c.appendChild(makeKnob(p, label)); f.appendChild(c); }
    }
  }
  // 表：XY パッド、大つまみ四つ、各部の音量
  const front = $('f_front'), M = Object.fromEntries(MACROS.map(m => [m.id, m]));
  front.appendChild(makePad(M.mxLight, M.mxMotion));
  const mac = el('div', 'macros');
  for (const id of ['mxDist', 'mxWeight', 'mxDense', 'mxPresence']) mac.appendChild(makeKnob(BY_ID[id], M[id].label, true));
  front.appendChild(mac);
  const lev = el('div', 'levels');
  for (const [lv, pt] of PARTS) {
    const name = BY_ID[lv].label, part = el('div', 'part'), head = el('div', 'ph'), out = el('span', 'kv');
    head.appendChild(el('span', 'kl', name)); head.appendChild(out);
    part.appendChild(head);
    part.appendChild(makeFader(BY_ID[lv], name + 'の音量', out));
    part.appendChild(makeKnob(BY_ID[pt], name + 'の高低', false, true));
    lev.appendChild(part);
  }
  front.appendChild(lev);
  // 庫：プリセットの出し入れと、切替の作法
  const lib = $('f_lib');
  lib.innerHTML = `
    <button id="save">保存</button><button id="del">削除</button>
    <button id="share">書き出し</button><button id="load">読み込み</button>
    <div class="wide"><label>シード</label><span id="seed" class="val"></span><button id="reseed">振り直す</button></div>
    <div class="wide"><label>マクロ</label><span class="val note">表のパッドと大つまみ</span><button id="zero">中央へ戻す</button></div>
    <p class="note wide">表の下段は、縦の棒が各部の音量、つまみが高低。つまみは縦に引いて回す。二度叩くと既定値へ戻る。上辺の秒数は「モーフ」、プリセットを切り替える際にかける時間である。自作のプリセットはこの端末に保存される。別の端末へは「書き出し」で渡す。</p>
    <div class="wide"><a href="test.html">消灯再生試験</a></div>`;
}

buildFaces();
showTab(TABS.some(t => t.id === settings.tab) ? settings.tab : 'front');

/* ---------- 状態とプリセット ---------- */
let saveTimer = 0;
function flush() {
  clearTimeout(saveTimer);
  store.set(KEY.state, { name: state.name, seed: state.seed, p: diff(state.params), src: state.src, dirty: state.dirty });
}
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); }
addEventListener('pagehide', flush);     // 動かした直後に頁を閉じても失わぬように
function touch() {
  if (!state.dirty) { state.dirty = true; showHead(); }
  persist();
}

function showHead() {
  const sel = $('preset');
  sel.textContent = '';
  if (state.src === 'x') sel.add(new Option(state.name + '（未保存）', 'x'));
  const g1 = document.createElement('optgroup'); g1.label = '内蔵';
  FACTORY.forEach((p, i) => g1.appendChild(new Option(p.name, 'f:' + i)));
  sel.appendChild(g1);
  if (user.length) {
    const g2 = document.createElement('optgroup'); g2.label = '自作';
    user.forEach((p, i) => g2.appendChild(new Option(p.name, 'u:' + i)));
    sel.appendChild(g2);
  }
  sel.value = state.src;
  $('dirty').classList.toggle('on', state.dirty && state.src !== 'x');
  $('del').disabled = !state.src.startsWith('u:');
  $('seed').textContent = state.seed;
}

// プリセットを当てる。鳴動中なら「移ろい」の秒数をかけて渡る
function apply(p, src, glide) {
  const seedChanged = p.seed !== state.seed;
  state = { name: p.name, seed: p.seed, params: sanitize(p.p), src, dirty: false };
  for (const q of PARAMS) showParam(q.id);
  if (seedChanged) post({ type: 'seed', seed: state.seed });
  post({ values: state.params, glide: Math.max(0.06, glide) });
  showHead(); persist();
}

function findSrc(v) {
  const [k, i] = v.split(':');
  return k === 'f' ? FACTORY[+i] : k === 'u' ? user[+i] : null;
}

$('preset').onchange = () => {
  const p = findSrc($('preset').value);
  if (p) apply(p, $('preset').value, settings.morph);
};

$('save').onclick = () => {
  let name = prompt('プリセットの名', state.name || '無題');
  if (name == null) return;
  name = name.trim().slice(0, 40);
  if (!name) return;
  if (FACTORY.some(p => p.name === name)) name += '（改）';
  const entry = { name, seed: state.seed, p: diff(state.params) };
  let i = user.findIndex(p => p.name === name);
  if (i >= 0) { if (!confirm('「' + name + '」を上書きする')) return; user[i] = entry; }
  else { user.push(entry); i = user.length - 1; }
  store.set(KEY.presets, user);
  state.name = name; state.src = 'u:' + i; state.dirty = false;
  showHead(); persist();
};

$('del').onclick = () => {
  if (!state.src.startsWith('u:')) return;
  const i = +state.src.slice(2);
  if (!confirm('「' + user[i].name + '」を削除する')) return;
  user.splice(i, 1);
  store.set(KEY.presets, user);
  state.src = 'x'; state.dirty = false;
  showHead(); persist();
};

$('zero').onclick = () => {
  const values = {};
  for (const m of MACROS) { state.params[m.id] = 0; values[m.id] = 0; showParam(m.id); }
  post({ values, glide: 1.5 });
  touch();
};

$('reseed').onclick = () => {
  state.seed = 1 + Math.floor(Math.random() * 99999);
  post({ type: 'seed', seed: state.seed });
  $('seed').textContent = state.seed;
  touch();
};

/* ---------- 書き出し・読み込み ---------- */
const dlg = $('dlg');
let dlgMode = '';
$('share').onclick = () => {
  dlgMode = 'share';
  $('dlgTitle').textContent = '書き出し';
  $('dlgNote').textContent = 'このリンクを別の端末で開くか、「読み込み」に貼ると、いまの設定が再現される。';
  $('dlgText').value = location.origin + location.pathname + '#p=' + encode(state);
  $('dlgText').readOnly = true;
  $('dlgOk').textContent = '写す';
  dlg.showModal();
  $('dlgText').select();
};
$('load').onclick = () => {
  dlgMode = 'load';
  $('dlgTitle').textContent = '読み込み';
  $('dlgNote').textContent = '書き出したリンク、またはその符号を貼る。';
  $('dlgText').value = '';
  $('dlgText').readOnly = false;
  $('dlgOk').textContent = '読み込む';
  dlg.showModal();
};
$('dlgOk').onclick = async () => {
  if (dlgMode === 'share') {
    try { await navigator.clipboard.writeText($('dlgText').value); $('dlgNote').textContent = '写した。'; }
    catch (e) { $('dlgText').select(); $('dlgNote').textContent = '自動では写せなかった。選択された文字列を手で写すこと。'; }
  } else {
    try { apply(decode($('dlgText').value), 'x', settings.morph); dlg.close(); }
    catch (e) { $('dlgNote').textContent = '読めなかった。リンクが欠けていないか確かめること。'; }
  }
};
$('dlgClose').onclick = () => dlg.close();

/* ---------- 音量・タイマー・移ろい ---------- */
$('vol').value = settings.vol;
$('vol').oninput = () => {
  settings.vol = +$('vol').value;
  if (vol) vol.gain.setTargetAtTime(volGain(), ctx.currentTime, 0.05);
  saveSettings();
};
$('timer').value = settings.timer;
$('timer').onchange = () => { settings.timer = +$('timer').value; saveSettings(); armTimer(); tick(); };
$('morph').value = settings.morph;
$('morph').onchange = () => { settings.morph = +$('morph').value; saveSettings(); };
$('play').onclick = () => { if (ctx) stop(); else start(); };

/* ---------- 起動 ---------- */
(function boot() {
  if (location.hash.startsWith('#p=')) {
    try {
      apply(decode(location.hash), 'x', 0);
      history.replaceState(null, '', location.pathname);
      return;
    } catch (e) { /* 壊れたリンクは無視して通常起動 */ }
  }
  const last = store.get(KEY.state, null);
  if (last && last.p) {
    let src = typeof last.src === 'string' && findSrc(last.src) && findSrc(last.src).name === last.name ? last.src : 'x';
    apply({ name: String(last.name || '無題'), seed: (last.seed | 0) || 1, p: last.p }, src, 0);
    if (last.dirty && src !== 'x') { state.dirty = true; showHead(); }
  } else {
    apply(FACTORY[0], 'f:0', 0);
  }
})();
