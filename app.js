// FoolsIron 操作面：画面の組み立て、プリセット、タイマー、発音部との受け渡し
import { PARAMS, SECTIONS, FACTORY, BY_ID, norm, denorm, defaults, sanitize, format } from './params.js';

const $ = id => document.getElementById(id);
const KEY = { state: 'foolsiron.state', presets: 'foolsiron.presets', settings: 'foolsiron.settings' };
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

const settings = Object.assign({ vol: 70, morph: 15, timer: 0 }, store.get(KEY.settings, {}));
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

/* ---------- 画面の組み立て ---------- */
const ctl = {};

function buildPanels() {
  const root = $('panels');
  for (const sec of SECTIONS) {
    const box = document.createElement('details');
    box.open = !!sec.open;
    const sum = document.createElement('summary');
    sum.textContent = sec.label;
    box.appendChild(sum);
    for (const p of PARAMS.filter(x => x.sec === sec.id)) {
      const row = document.createElement('div');
      row.className = 'row';
      const lab = document.createElement('label');
      lab.textContent = p.label; lab.htmlFor = 'p_' + p.id;
      row.appendChild(lab);
      let input;
      if (p.type === 'sel') {
        input = document.createElement('select');
        for (const o of p.opts) input.add(new Option(o.label, o.k));
        input.onchange = () => setParam(p.id, input.value);
        row.appendChild(input);
      } else {
        input = document.createElement('input');
        input.type = 'range';
        if (p.step) { input.min = p.min; input.max = p.max; input.step = p.step; }
        else { input.min = 0; input.max = 1000; input.step = 1; }
        const out = document.createElement('output');
        input.oninput = () => setParam(p.id, p.step ? +input.value : denorm(p, input.value / 1000));
        row.appendChild(input); row.appendChild(out);
        ctl[p.id + ':out'] = out;
      }
      input.id = 'p_' + p.id;
      ctl[p.id] = input;
      box.appendChild(row);
    }
    root.appendChild(box);
  }
}

function showParam(id) {
  const p = BY_ID[id], v = state.params[id], input = ctl[id];
  if (p.type === 'sel') input.value = v;
  else {
    input.value = p.step ? v : Math.round(norm(p, v) * 1000);
    ctl[id + ':out'].textContent = format(p, v);
  }
}

function setParam(id, v) {
  state.params[id] = v;
  if (BY_ID[id].type !== 'sel') ctl[id + ':out'].textContent = format(BY_ID[id], v);
  post({ values: { [id]: v }, glide: 0.06 });
  touch();
}

/* ---------- 状態とプリセット ---------- */
let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(KEY.state, { name: state.name, seed: state.seed, p: diff(state.params), src: state.src, dirty: state.dirty }), 300);
}
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
  $('dirty').textContent = state.dirty && state.src !== 'x' ? '変更あり' : '';
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
function saveSettings() { store.set(KEY.settings, settings); }
$('vol').value = settings.vol; $('volOut').textContent = settings.vol;
$('vol').oninput = () => {
  settings.vol = +$('vol').value; $('volOut').textContent = settings.vol;
  if (vol) vol.gain.setTargetAtTime(volGain(), ctx.currentTime, 0.05);
  saveSettings();
};
$('timer').value = settings.timer;
$('timer').onchange = () => { settings.timer = +$('timer').value; saveSettings(); armTimer(); tick(); };
$('morph').value = settings.morph;
$('morph').onchange = () => { settings.morph = +$('morph').value; saveSettings(); };
$('play').onclick = () => { if (ctx) stop(); else start(); };

/* ---------- 起動 ---------- */
buildPanels();
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
