import '@fontsource/bebas-neue';
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/700.css';
import './style.css';
import { Stage } from './three/stage.js';
import { HAIR_NAMES } from './three/character.js';
import { hairThumbs } from './three/thumbs.js';
import { api, Socket, hasServer } from './net.js';
import { createPractice, ME_ID } from './practice.js';
import { sfx, unlock, ambience, setMuted, isMuted } from './audio.js';
import { BALL, GLOVE, ICON } from './icons.js';
import { DEFAULT_LOOK, sanitizeLook } from '../../shared/look.js';

// ?p=2 ile aynı tarayıcıda ikinci oyuncu test edilebilir
const NS = 'penalzo' + (new URLSearchParams(location.search).get('p') || '') + ':';
const store = {
  get: (k) => { try { return localStorage.getItem(NS + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(NS + k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(NS + k); } catch {} },
};

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = $('#ui'), sheetEl = $('#sheet'), noticeEl = $('#notice'), toastsEl = $('#toasts'), fadeEl = $('#fade');
const canvas = $('#scene');

const S = {
  me: null, screen: 'boot', room: null, match: null, sheet: null,
  friends: { friends: [], incoming: [], outgoing: [] },
  guestLookSent: false,
};
let stage;
const sock = new Socket();

// ------------------------------------------------------------ yardımcılar
function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  toastsEl.append(el);
  setTimeout(() => el.classList.add('out'), 2800);
  setTimeout(() => el.remove(), 3200);
}
async function fade(fn) {
  fadeEl.classList.add('on');
  await sleep(230);
  fn();
  await sleep(60);
  fadeEl.classList.remove('on');
}
function setScreen(name, html) {
  S.screen = name;
  ui.className = 'scr-' + name;
  ui.innerHTML = html;
}
function closeSheet() { S.sheet = null; sheetEl.innerHTML = ''; sheetEl.className = ''; }
function openSheet(name, html) {
  S.sheet = name;
  sheetEl.className = 'on';
  sheetEl.innerHTML = `<div class="sheet-bg" data-act="closeSheet"></div><div class="sheet-card">${html}</div>`;
}
const myLook = () => S.me?.look || DEFAULT_LOOK;
const reqCount = () => S.friends.incoming.length;

// ------------------------------------------------------------ giriş ekranları
function showLanding() {
  closeSheet();
  stage.setMode('menu');
  stage.setSolo(sanitizeLook(DEFAULT_LOOK), 'player', 'PENALZO');
  stage.faceSolo(false);
  setScreen('landing', `
    <div class="logo-wrap"><div class="logo">PENAL<span>ZO</span></div><div class="tagline">Kararı penaltılar versin</div></div>
    <div class="bottom">
      ${hasServer
        ? `<button class="btn primary" data-act="authOpen">Kayıt Ol / Giriş Yap</button>
           <button class="btn dark" data-act="local">Çevrimdışı oyna</button>
           <button class="btn link" data-act="guest">Misafir olarak giriş yap</button>`
        : `<button class="btn primary big" data-act="local">Oyna</button>
           <div class="hint">Çevrimdışı sürüm: botla oynayabilir ve oyuncunu düzenleyebilirsin.<br/>Çok oyunculu mod için sunucu gerekir.</div>`}
    </div>`);
}

let authTab = 'login';
function showAuth(tab = authTab) {
  authTab = tab;
  const reg = tab === 'register';
  const pw = (name, ph, ac) => `<div class="pw"><input name="${name}" type="password" placeholder="${ph}" autocomplete="${ac}" maxlength="72" required /></div>`;
  setScreen('auth', `
    <div class="panel">
      <div class="panel-head"><button class="icon-btn" data-act="landing" aria-label="Geri">${ICON.back}</button>
        <div class="seg"><button data-act="authTab" data-tab="login" class="${reg ? '' : 'on'}">Giriş Yap</button><button data-act="authTab" data-tab="register" class="${reg ? 'on' : ''}">Kayıt Ol</button></div><span class="sp"></span></div>
      <form id="authForm" novalidate>
        <label>Kullanıcı adı<input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="16" placeholder="kullanici_adi" required /></label>
        <label>Şifre${pw('password', 'En az 6 karakter', reg ? 'new-password' : 'current-password')}</label>
        ${reg ? `<label>Şifre (tekrar)${pw('password2', 'Şifreni tekrar yaz', 'new-password')}</label>` : ''}
        <button type="button" class="showpw" data-act="togglePw">${ICON.eye}<span>Şifreyi göster</span></button>
        <div class="err" id="authErr"></div>
        <button class="btn primary" type="submit">${reg ? 'Kayıt Ol' : 'Giriş Yap'}</button>
      </form>
    </div>`);
  $('#authForm').addEventListener('submit', submitAuth);
}

async function submitAuth(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const username = String(f.get('username')).trim(), password = String(f.get('password'));
  const errEl = $('#authErr');
  const fail = (t) => { errEl.textContent = t; };
  if (username.length < 3) return fail('Kullanıcı adı en az 3 karakter olmalı');
  if (password.length < 6) return fail('Şifre en az 6 karakter olmalı');
  if (authTab === 'register' && password !== f.get('password2')) return fail('Şifreler birbiriyle aynı değil');
  const btn = $('button[type=submit]', e.target);
  btn.disabled = true;
  try {
    const { token } = await api(authTab, { username, password });
    store.set('token', token);
    sock.open(token);
  } catch (ex) {
    fail(ex.message);
    btn.disabled = false;
  }
}

function showNamePick() {
  setScreen('name', `
    <div class="panel">
      <h2>Oyun içi adını seç</h2>
      <p class="muted">Bu ad formanın sırtında yazacak.</p>
      <form id="nameForm" novalidate>
        <input name="name" maxlength="12" placeholder="Örn. Furkan" autocomplete="off" required />
        <div class="err" id="nameErr"></div>
        <button class="btn primary" type="submit">Devam Et</button>
      </form>
    </div>`);
  $('#nameForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = String(new FormData(e.target).get('name')).trim();
    if (name.length < 2) return ($('#nameErr').textContent = 'En az 2 karakter olmalı');
    sock.send('setName', { name });
  });
}

// ------------------------------------------------------------ ana menü
function showMenu() {
  closeSheet();
  S.room = null;
  stage.setMode('menu');
  stage.setSolo(myLook(), 'player', S.me.name);
  stage.faceSolo(false);
  ambience(true);
  const g = S.me.guest, local = !!S.me.local;
  setScreen('menu', `
    <div class="topbar">
      <div class="who"><div class="nm">${esc(S.me.name)}</div><div class="sub">${local ? 'Çevrimdışı' : g ? 'Misafir' : '@' + esc(S.me.username)}</div></div>
      <div class="row">
        <button class="icon-btn" data-act="mute" aria-label="Ses">${isMuted() ? ICON.mute : ICON.sound}</button>
        ${g ? '' : `<button class="icon-btn" data-act="friends" aria-label="Arkadaşlar">${ICON.friends}${reqCount() ? `<i class="badge">${reqCount()}</i>` : ''}</button>`}
        ${local ? (hasServer ? `<button class="icon-btn" data-act="localExit" aria-label="Çevrimdışı moddan çık">${ICON.logout}</button>` : '') : `<button class="icon-btn" data-act="logout" aria-label="Çıkış">${ICON.logout}</button>`}
      </div>
    </div>
    <div class="logo small">PENAL<span>ZO</span></div>
    <div class="bottom">
      ${local
        ? `<button class="btn primary big" data-act="practice">Bota Karşı Oyna</button>`
        : `<button class="btn primary big" data-act="create">Oyun Kur</button>
           <div class="row2"><button class="btn" data-act="joinOpen">Oyuna Katıl</button><button class="btn" data-act="practice">Bota Karşı</button></div>`}
      <button class="btn dark" data-act="editor">${ICON.edit}Oyuncuyu Düzenle</button>
      ${local && hasServer ? `<button class="btn link" data-act="localExit">Çevrimiçi oyna</button>` : ''}
      ${local && !hasServer ? `<div class="hint">Çok oyunculu mod için sunucu bağlantısı gerekir.</div>` : ''}
    </div>`);
}

function openJoin() {
  openSheet('join', `
    <h3>Oyuna Katıl</h3>
    <p class="muted">Arkadaşının oda kodunu yaz.</p>
    <form id="joinForm" novalidate>
      <input name="code" class="code-input" maxlength="5" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="KOD" />
      <button class="btn primary" type="submit">Katıl</button>
    </form>`);
  const inp = $('#joinForm input');
  inp.addEventListener('input', () => (inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
  $('#joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (inp.value.length !== 5) return toast('Oda kodu 5 karakter olmalı', 'bad');
    sock.send('joinRoom', { code: inp.value });
  });
  setTimeout(() => inp.focus(), 50);
}

// ------------------------------------------------------------ oda
function showRoom() {
  const r = S.room;
  if (!r) return showMenu();
  if (S.sheet !== 'invite') closeSheet();
  const host = r.players.find((p) => p.id === r.hostId), other = r.players.find((p) => p.id !== r.hostId);
  if (stage.mode !== 'room') stage.setMode('room');
  stage.setPair(host, other || null);
  const amHost = r.hostId === S.me.id, full = r.players.length === 2;
  const tag = (p, cls) => p
    ? `<div class="ptag ${cls}"><b>${esc(p.name)}</b><span>${p.id === r.hostId ? 'Kurucu' : 'Rakip'}${p.id === S.me.id ? ' · Sen' : ''}</span></div>`
    : `<div class="ptag ${cls} empty"><b>Bekleniyor…</b><span>Rakip henüz gelmedi</span></div>`;
  setScreen('room', `
    <div class="topbar"><button class="icon-btn" data-act="leave" aria-label="Odadan ayrıl">${ICON.back}</button><div class="title">Özel Oda</div><span class="sp"></span></div>
    <button class="code-card" data-act="copyCode"><span class="lbl">Oda Kodu</span><span class="code">${esc(r.code)}</span><span class="cp">${ICON.copy}Kopyala</span></button>
    <div class="ptags">${tag(host, 'l')}<div class="vs-mini">VS</div>${tag(other, 'r')}</div>
    <div class="bottom">
      ${amHost
        ? `<button class="btn primary big" data-act="start" ${full ? '' : 'disabled'}>Başlat</button>`
        : `<div class="waiting">Kurucunun maçı başlatması bekleniyor…</div>`}
      <button class="btn" data-act="invite" ${S.me.guest || full ? 'disabled' : ''}>${ICON.friends}Davet Et</button>
      ${S.me.guest ? '<div class="hint">Arkadaş davet etmek için kayıt olman gerekir.</div>' : ''}
    </div>`);
}

// ------------------------------------------------------------ arkadaşlar
let friendTab = 'list';
function renderFriends() {
  if (S.sheet !== 'friends' && S.sheet !== 'invite') return;
  const F = S.friends;
  if (S.sheet === 'invite') {
    const on = F.friends.filter((f) => f.online);
    openSheet('invite', `
      <h3>Arkadaşını Davet Et</h3>
      <div class="list">${on.length
        ? on.map((f) => `<div class="li"><i class="dot on"></i><div class="li-main"><b>${esc(f.name)}</b><span>@${esc(f.username)}</span></div>
            <button class="btn sm primary" data-act="sendInvite" data-id="${esc(f.id)}" ${f.inGame ? 'disabled' : ''}>${f.inGame ? 'Odada' : 'Davet Et'}</button></div>`).join('')
        : `<div class="empty">Şu an çevrimiçi arkadaşın yok.<br/>Oda kodunu paylaşarak da davet edebilirsin.</div>`}</div>`);
    return;
  }
  const tabs = [['list', 'Arkadaşlar'], ['req', `İstekler${F.incoming.length ? ` (${F.incoming.length})` : ''}`], ['add', 'Arkadaş Ekle']];
  let body = '';
  if (friendTab === 'list') {
    body = F.friends.length
      ? F.friends.map((f) => `<div class="li"><i class="dot ${f.online ? 'on' : ''}"></i><div class="li-main"><b>${esc(f.name)}</b><span>@${esc(f.username)} · ${f.online ? 'Çevrimiçi' : 'Çevrimdışı'}</span></div>
          <button class="icon-btn sm" data-act="friendRemove" data-id="${esc(f.id)}" data-name="${esc(f.name)}" aria-label="Arkadaşı sil">${ICON.close}</button></div>`).join('')
      : `<div class="empty">Henüz arkadaşın yok.<br/>"Arkadaş Ekle" sekmesinden ekleyebilirsin.</div>`;
  } else if (friendTab === 'req') {
    body = (F.incoming.length
      ? F.incoming.map((f) => `<div class="li"><div class="li-main"><b>${esc(f.name)}</b><span>@${esc(f.username)}</span></div>
          <button class="btn sm primary" data-act="friendRespond" data-row="${f.rowId}" data-ok="1">Kabul Et</button>
          <button class="btn sm" data-act="friendRespond" data-row="${f.rowId}" data-ok="">Reddet</button></div>`).join('')
      : `<div class="empty">Bekleyen arkadaşlık isteği yok.</div>`)
      + (F.outgoing.length ? `<div class="sec">Gönderdiklerin</div>` + F.outgoing.map((f) => `<div class="li"><div class="li-main"><b>${esc(f.name)}</b><span>@${esc(f.username)} · Yanıt bekleniyor</span></div></div>`).join('') : '');
  } else {
    body = `<form id="addForm" novalidate><p class="muted">Arkadaşının kullanıcı adını yaz.</p>
      <input name="username" maxlength="16" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="kullanici_adi" />
      <button class="btn primary" type="submit">${ICON.plus}İstek Gönder</button></form>`;
  }
  openSheet('friends', `
    <h3>Arkadaşlar</h3>
    <div class="seg wide">${tabs.map(([k, t]) => `<button data-act="friendTab" data-tab="${k}" class="${friendTab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="list">${body}</div>`);
  $('#addForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = String(new FormData(e.target).get('username')).trim();
    if (!username) return;
    sock.send('friendAdd', { username });
    e.target.reset();
  });
}

// ------------------------------------------------------------ oyuncu düzenleme
const PALETTE = ['#ffffff', '#d1d5db', '#6b7280', '#111827', '#e11d2e', '#9f1239', '#f97316', '#facc15', '#c8ff2e', '#22c55e', '#166534', '#14b8a6', '#38bdf8', '#2563eb', '#1e3a8a', '#8b5cf6', '#ec4899', '#7c2d12'];
const HAIR_COLORS = ['#17100c', '#2a1a12', '#4a2c17', '#6b4423', '#8b5a2b', '#a9713a', '#c68a3c', '#dcb35c', '#e6cf8f', '#9ca3af', '#d1d5db', '#f3f4f6', '#b91c1c', '#f97316', '#2563eb', '#8b5cf6', '#ec4899', '#22c55e'];
const E = { look: null, kit: 'player', tab: 'jersey' };

function showEditor() {
  E.look = sanitizeLook(myLook());
  E.kit = 'player';
  E.tab = 'jersey';
  stage.setMode('editor', false);
  renderEditor();
}
function renderEditor() {
  const L = E.look, K = L[E.kit];
  const tabs = [['jersey', 'Forma'], ['shorts', 'Şort'], ['socks', 'Çorap'], ['boots', 'Krampon'], ...(E.kit === 'keeper' ? [['gloves', 'Eldiven']] : []), ['hair', 'Saç'], ['hairColor', 'Saç Rengi'], ['number', 'Numara']];
  if (!tabs.some(([k]) => k === E.tab)) E.tab = 'jersey';
  const sw = (colors, cur, act) => `<div class="swatches">${colors.map((c) => `<button class="sw ${c === cur ? 'on' : ''}" style="--c:${c}" data-act="${act}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div>`;
  let body;
  if (E.tab === 'hair') {
    const th = hairThumbs(L);
    body = `<div class="hair-grid">${HAIR_NAMES.map((n, i) => `<button class="hair ${L.hair === i ? 'on' : ''}" data-act="edHair" data-i="${i}" aria-label="${n}"><img src="${th[i]}" alt="" draggable="false" /><span>${n}</span></button>`).join('')}</div>`;
  } else if (E.tab === 'hairColor') {
    body = sw(HAIR_COLORS, L.hairColor, 'edHairColor');
  } else if (E.tab === 'number') {
    body = `<input id="numInput" class="num-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" enterkeyhint="done" autocomplete="off" value="${L.number}" aria-label="Forma numarası" />
      <p class="muted center">Numaraya dokun ve 1 ile 99 arasında bir sayı yaz.</p>`;
  } else {
    body = sw(PALETTE, K[E.tab], 'edColor');
  }
  setScreen('editor', `
    <div class="topbar"><button class="icon-btn" data-act="editorDone" aria-label="Geri">${ICON.back}</button>
      <div class="seg"><button data-act="edKit" data-kit="player" class="${E.kit === 'player' ? 'on' : ''}">Oyuncu</button><button data-act="edKit" data-kit="keeper" class="${E.kit === 'keeper' ? 'on' : ''}">Kaleci</button></div>
      <button class="btn sm primary" data-act="editorDone">Kaydet</button></div>
    <div class="ed-panel">
      <div class="ed-tabs">${tabs.map(([k, t]) => `<button data-act="edTab" data-tab="${k}" class="${E.tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="ed-body">${body}</div>
    </div>`);
  const num = $('#numInput');
  if (num) {
    num.addEventListener('input', () => {
      num.value = num.value.replace(/[^0-9]/g, '').replace(/^0+/, '').slice(0, 2);
      if (num.value) { L.number = Number(num.value); applyEditor(); }
    });
    num.addEventListener('focus', () => num.select());
    num.addEventListener('blur', () => (num.value = L.number));
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.blur(); });
  }
  stage.faceSolo(E.tab === 'number');
  applyEditor();
}
const applyEditor = () => stage.setSolo(E.look, E.kit, S.me.name);

// ------------------------------------------------------------ maç
const M = () => S.match;
const player = (id) => M().players.find((p) => p.id === id);
const score = (id) => (M().kicks[id] || []).filter(Boolean).length;

function boxes(id, total) {
  const k = M().kicks[id] || [];
  let h = '';
  for (let i = 0; i < total; i++) h += `<i class="${k[i] === true ? 'g' : k[i] === false ? 'm' : ''}"></i>`;
  return h;
}
function renderScore() {
  const m = M();
  if (!m || S.screen !== 'match') return;
  const total = Math.max(5, Math.ceil((m.k + 1) / 2), ...Object.values(m.kicks).map((a) => a.length));
  for (const [side, id] of [['A', m.meId], ['B', m.oppId]]) {
    const el = $('#bx' + side);
    el.innerHTML = boxes(id, total);
    el.classList.toggle('many', total > 5);
    $('#sc' + side).textContent = score(id);
  }
}

function onMatchStart(msg) {
  closeSheet();
  noticeEl.innerHTML = '';
  const meId = S.me.id, oppId = msg.order.find((id) => id !== meId);
  S.match = { players: msg.players, order: msg.order, kicks: { [meId]: [], [oppId]: [] }, k: 0, meId, oppId, picked: false, timer: null };
  const me = player(meId), opp = player(oppId);
  fade(() => {
    stage.setMode('match');
    stage.matchSetup(player(msg.order[0]), player(msg.order[1]));
    setScreen('match', `
      <div class="score">
        <div class="side"><div class="nm">${esc(me.name)}</div><div class="boxes" id="bxA"></div></div>
        <div class="total"><span id="scA">0</span><i>:</i><span id="scB">0</span></div>
        <div class="side r"><div class="nm">${esc(opp.name)}</div><div class="boxes" id="bxB"></div></div>
      </div>
      <div class="role" id="role"></div>
      <div class="banner" id="banner"></div>
      <div class="vs" id="vs"><div class="vs-n">${esc(me.name)}</div><div class="vs-x">VS</div><div class="vs-n">${esc(opp.name)}</div><div class="vs-s">5'er penaltı · En çok atan kazanır</div></div>`);
    renderScore();
  });
  sfx.whistle();
}

function setRole(html, cls = '') {
  const el = $('#role');
  if (!el) return;
  el.className = 'role ' + cls;
  el.innerHTML = html;
}

function onRound(msg) {
  const m = M();
  if (!m) return;
  m.k = msg.k;
  m.shooterId = msg.shooterId;
  m.role = msg.shooterId === m.meId ? 'shooter' : 'keeper';
  m.picked = false;
  m.myZone = null;
  if (m.pending) { m.kicks = m.pending; m.pending = null; }
  clearInterval(m.timer);
  const setup = () => {
    $('#vs')?.remove();
    $('#banner').className = 'banner';
    stage.matchSetup(player(msg.shooterId), player(msg.keeperId));
    stage.showZones(true);
    renderScore();
    const sd = msg.k >= 10 ? '<div class="sd">Seri penaltı</div>' : '';
    const sh = m.role === 'shooter';
    setRole(`${sd}<div class="ic">${sh ? BALL : GLOVE}</div>
      <div class="rt" id="roleText">${sh ? 'Şut çekmek istediğin yere dokun' : 'Kurtarış yapmak istediğin yere dokun'}</div>
      <div class="timer"><b id="tnum">5</b><div class="bar"><i id="tbar"></i></div></div>`, 'on ' + m.role);
    const end = performance.now() + msg.pickMs;
    let lastSec = 6;
    m.timer = setInterval(() => {
      const left = Math.max(0, end - performance.now());
      const sec = Math.ceil(left / 1000);
      const num = $('#tnum'), bar = $('#tbar');
      if (!num) return clearInterval(m.timer);
      num.textContent = sec;
      bar.style.transform = `scaleX(${left / msg.pickMs})`;
      if (sec !== lastSec) { lastSec = sec; if (sec <= 3 && sec > 0 && !m.picked) sfx.tick(); }
      if (left <= 0) {
        clearInterval(m.timer);
        if (!m.picked) { m.picked = true; m.myZone = 0; stage.selectZone(0); $('#roleText').textContent = 'Süre doldu — orta seçildi'; }
      }
    }, 50);
  };
  if (msg.k === 0) setup(); else fade(setup);
}

function tryPick(e) {
  const m = M();
  if (!m || m.picked || S.screen !== 'match') return;
  const zone = stage.pickZone(e.clientX, e.clientY);
  if (zone == null) return;
  m.picked = true;
  m.myZone = zone;
  stage.selectZone(zone);
  sfx.select();
  if (practiceEngine) practiceEngine.pick(m.k, zone);
  else sock.send('pick', { k: m.k, zone });
  const t = $('#roleText');
  if (t) t.textContent = 'Seçildi! Rakip bekleniyor…';
}

function onResult(msg) {
  const m = M();
  if (!m) return;
  clearInterval(m.timer);
  m.picked = true;
  m.pending = msg.kicks;
  const mine = msg.shooterId === m.meId ? msg.shot : msg.dive;
  stage.selectZone(mine);
  setRole('', '');
  setTimeout(() => stage.showZones(false), 520);
  setTimeout(() => sfx.whistle(), 150);
  stage.playKick({
    shot: msg.shot, dive: msg.dive, goal: msg.goal, rx: msg.rx, ry: msg.ry,
    onContact: () => sfx.kick(),
    onArrive: () => {
      m.kicks = msg.kicks;
      m.k = msg.k + 1;
      renderScore();
      const b = $('#banner');
      if (b) { b.textContent = msg.goal ? 'GOOOL!' : 'KURTARDI!'; b.className = 'banner on ' + (msg.goal ? 'goal' : 'save'); }
      msg.goal ? sfx.goal() : sfx.save();
      if (navigator.vibrate) navigator.vibrate(msg.goal ? [60, 40, 120] : 80);
    },
  });
}

function onMatchEnd(msg) {
  const m = M();
  if (!m) return;
  clearInterval(m.timer);
  m.kicks = msg.kicks;
  const won = msg.winnerId === m.meId;
  const winner = player(msg.winnerId), loser = m.players.find((p) => p.id !== msg.winnerId);
  const sa = score(winner.id), sb = score(loser.id);
  S.match = null;
  fade(() => {
    stage.showEnd(winner, loser);
    setScreen('end', `
      <div class="end-top">
        <div class="kazanan">Kazanan</div>
        <div class="wname" style="--n:${Math.max(4, [...winner.name].length)}">${esc(winner.name)}</div>
        <div class="final">${sa} : ${sb}</div>
        ${msg.reason === 'left' ? '<div class="note">Rakip oyundan ayrıldı</div>' : ''}
        <div class="you ${won ? 'w' : 'l'}">${won ? 'Tebrikler, kazandın!' : 'Bu sefer olmadı'}</div>
      </div>
      <div class="bottom">
        <button class="btn primary big" data-act="again">Tekrar Oyna</button>
        <button class="btn dark" data-act="leave">Ana Menü</button>
      </div>`);
    won ? sfx.win() : sfx.lose();
  });
}

// ------------------------------------------------------------ davet bildirimi
let inviteTimer;
function showInvite(msg) {
  if (S.screen === 'match') return sock.send('inviteDecline', { toId: msg.from.id });
  clearTimeout(inviteTimer);
  noticeEl.innerHTML = `<div class="invite"><div class="iv-t"><b>${esc(msg.from.name)}</b> seni maça davet ediyor</div>
    <div class="row"><button class="btn sm primary" data-act="inviteYes" data-code="${esc(msg.code)}">Kabul Et</button>
    <button class="btn sm" data-act="inviteNo" data-id="${esc(msg.from.id)}">Reddet</button></div></div>`;
  sfx.select();
  inviteTimer = setTimeout(() => (noticeEl.innerHTML = ''), 25000);
}

// ------------------------------------------------------------ çevrimdışı mod ve antrenman
// Antrenman (bota karşı) tamamen istemcide çalışır; sunucuyla aynı kurallar ve mesaj biçimleri kullanılır.
let practiceEngine = null;
function stopPractice() { practiceEngine?.stop(); practiceEngine = null; }
function startPractice() {
  stopPractice();
  practiceEngine = createPractice({ me: S.me, emit: (msg) => matchHandlers[msg.type]?.(msg) });
  practiceEngine.start();
}
function startLocal() {
  stopPractice();
  let saved = null;
  try { saved = JSON.parse(store.get('look')); } catch {}
  S.me = { id: ME_ID, name: 'Oyuncu', guest: true, username: null, local: true, look: sanitizeLook(saved) };
  S.room = null; S.match = null;
  S.friends = { friends: [], incoming: [], outgoing: [] };
  fade(showMenu);
}
function leaveLocal() {
  stopPractice();
  S.me = null; S.room = null; S.match = null;
  const token = hasServer && store.get('token');
  if (token) { fade(() => { ui.innerHTML = ''; }); sock.open(token); } else fade(showLanding);
}

// ------------------------------------------------------------ tıklamalar
const actions = {
  landing: showLanding,
  authOpen: () => showAuth('login'),
  authTab: (el) => showAuth(el.dataset.tab),
  togglePw(el) {
    const inputs = [...document.querySelectorAll('.pw input')];
    const show = inputs[0].type === 'password';
    inputs.forEach((i) => (i.type = show ? 'text' : 'password'));
    el.innerHTML = `${show ? ICON.eyeOff : ICON.eye}<span>${show ? 'Şifreyi gizle' : 'Şifreyi göster'}</span>`;
  },
  async guest(el) {
    el.disabled = true;
    try {
      const { token } = await api('guest');
      store.set('token', token);
      sock.open(token);
    } catch (ex) { toast(ex.message, 'bad'); el.disabled = false; }
  },
  logout() {
    const token = store.get('token');
    if (token) api('logout', { token }).catch(() => {});
    store.del('token');
    sock.close();
    S.me = null; S.room = null; S.match = null; S.guestLookSent = false;
    S.friends = { friends: [], incoming: [], outgoing: [] };
    ambience(false);
    showLanding();
  },
  mute(el) {
    setMuted(!isMuted());
    store.set('muted', isMuted() ? '1' : '');
    el.innerHTML = isMuted() ? ICON.mute : ICON.sound;
  },
  closeSheet,
  create: () => sock.send('createRoom'),
  practice: startPractice,
  local() { sock.close(); S.offline = false; $('#offline')?.remove(); startLocal(); },
  localExit: leaveLocal,
  joinOpen: openJoin,
  leave() {
    if (practiceEngine) { stopPractice(); fade(showMenu); }
    else if (S.room) sock.send('leaveRoom');
    else showMenu();
  },
  start: () => sock.send('start'),
  again: () => (practiceEngine ? startPractice() : S.room ? fade(showRoom) : fade(showMenu)),
  copyCode() {
    navigator.clipboard?.writeText(S.room.code).then(() => toast('Oda kodu kopyalandı'), () => toast('Kod: ' + S.room.code));
  },
  friends: () => { S.sheet = 'friends'; friendTab = reqCount() ? 'req' : 'list'; renderFriends(); },
  friendTab: (el) => { friendTab = el.dataset.tab; renderFriends(); },
  friendRespond: (el) => sock.send('friendRespond', { rowId: Number(el.dataset.row), accept: !!el.dataset.ok }),
  friendRemove(el) {
    if (el.dataset.sure) return sock.send('friendRemove', { id: el.dataset.id });
    el.dataset.sure = '1';
    el.classList.add('danger');
    toast(`${el.dataset.name} silinsin mi? Onaylamak için tekrar dokun.`);
  },
  invite: () => { S.sheet = 'invite'; renderFriends(); },
  sendInvite: (el) => { sock.send('invite', { friendId: el.dataset.id }); el.disabled = true; el.textContent = 'Gönderildi'; },
  inviteYes: (el) => { noticeEl.innerHTML = ''; sock.send('joinRoom', { code: el.dataset.code }); },
  inviteNo: (el) => { noticeEl.innerHTML = ''; sock.send('inviteDecline', { toId: el.dataset.id }); },
  editor: showEditor,
  editorDone() {
    S.me.look = E.look;
    if (S.me.guest) store.set('look', JSON.stringify(E.look));
    sock.send('setLook', { look: E.look });
    showMenu();
  },
  edKit: (el) => { E.kit = el.dataset.kit; renderEditor(); },
  edTab: (el) => { E.tab = el.dataset.tab; renderEditor(); },
  edColor: (el) => { E.look[E.kit][E.tab] = el.dataset.c; renderEditor(); },
  edHair: (el) => { E.look.hair = Number(el.dataset.i); renderEditor(); },
  edHairColor: (el) => { E.look.hairColor = el.dataset.c; renderEditor(); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  unlock();
  sfx.click();
  actions[el.dataset.act]?.(el);
});

// sahne üzerinde dokunma: bölge seçimi / karakter döndürme
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  unlock();
  if (S.screen === 'match') return tryPick(e);
  if (S.screen === 'editor' || S.screen === 'menu') { drag = e.clientX; canvas.setPointerCapture(e.pointerId); }
});
canvas.addEventListener('pointermove', (e) => {
  if (drag == null) return;
  stage.rotateSolo((e.clientX - drag) * 0.012);
  drag = e.clientX;
});
const endDrag = () => (drag = null);
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ------------------------------------------------------------ sunucu mesajları
sock.on('me', (m) => {
  const first = !S.me;
  const reconnect = !first && S.offline;
  S.offline = false;
  $('#offline')?.remove();
  S.me = m.me;
  if (m.me.guest && !S.guestLookSent) {
    S.guestLookSent = true;
    const saved = store.get('look');
    if (saved) { try { S.me.look = sanitizeLook(JSON.parse(saved)); sock.send('setLook', { look: S.me.look }); } catch {} }
  }
  if (m.me.needsName) return showNamePick();
  if (first || reconnect || ['name', 'auth', 'landing', 'boot'].includes(S.screen)) {
    if (reconnect && ['room', 'match', 'end'].includes(S.screen)) toast('Bağlantı koptu, ana menüye dönüldü', 'bad');
    S.match = null;
    return showMenu();
  }
  if (S.screen === 'menu') showMenu();
});
sock.on('authFail', () => { store.del('token'); sock.close(); S.me = null; showLanding(); });
sock.on('kicked', () => { sock.close(); store.del('token'); S.me = null; showLanding(); toast('Hesabına başka bir cihazdan giriş yapıldı', 'bad'); });
sock.on('error', (m) => toast(m.text, 'bad'));
sock.on('info', (m) => toast(m.text));
sock.on('friends', (m) => {
  S.friends = m;
  renderFriends();
  if (S.screen === 'menu' && !S.sheet) return showMenu();
  // sheet açıkken menü yeniden çizilmez: bekleyen istek rozetini yerinde güncelle
  const btn = $('[data-act=friends]');
  if (!btn) return;
  let badge = btn.querySelector('.badge');
  if (reqCount()) {
    if (!badge) { badge = document.createElement('i'); badge.className = 'badge'; btn.append(badge); }
    badge.textContent = reqCount();
  } else badge?.remove();
});
sock.on('room', (m) => {
  const had = !!S.room;
  S.room = m;
  if (S.screen === 'match' || S.screen === 'end') return;
  if (S.screen === 'room' && had) return showRoom();
  fade(showRoom);
});
sock.on('roomLeft', () => { S.room = null; fade(showMenu); });
// Maç mesajları sunucudan da (çok oyunculu) çevrimdışı motordan da aynı işleyicilere gelir.
const matchHandlers = {
  matchStart: onMatchStart,
  round: onRound,
  picked: (m) => { if (M()) stage.selectZone(m.zone); },
  result: onResult,
  matchEnd: onMatchEnd,
};
for (const [type, fn] of Object.entries(matchHandlers)) sock.on(type, fn);
sock.on('invited', showInvite);
sock.onState = () => {
  if (S.offline) return;
  S.offline = true;
  if (!$('#offline')) document.body.insertAdjacentHTML('beforeend', '<div id="offline"><div class="spin"></div>Bağlantı kuruluyor…<button class="btn dark" data-act="local">Çevrimdışı oyna</button></div>');
};

// ------------------------------------------------------------ başlat
async function boot() {
  try { await Promise.race([Promise.all([document.fonts.load('40px "Bebas Neue"'), document.fonts.load('16px Rubik')]), sleep(2500)]); } catch {}
  stage = new Stage(canvas);
  window.__penalzo = { stage, S };
  setMuted(!!store.get('muted'));
  const token = hasServer ? store.get('token') : null;
  showLanding();
  if (token) {
    ui.innerHTML = '';
    sock.open(token);
  }
  await sleep(120);
  fadeEl.classList.remove('on');
}
boot();
