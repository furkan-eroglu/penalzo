import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer } from 'ws';
import * as db from './db.js';
import { sanitizeLook, DEFAULT_LOOK } from '../shared/look.js';
import { PICK_MS, BOTH_PICKED_MS, RESULT_MS, INTRO_MS, ZONES, isGoal, rolesOf, decideWinner } from '../shared/rules.js';

const PORT = Number(process.env.PORT) || 3000;
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const PICK_GRACE_MS = 700; // ağ gecikmesi payı (süreler ve kurallar shared/rules.js içinde)

const USERNAME_RE = /^[a-z0-9_.]{3,16}$/;
const NAME_RE = /^[\p{L}\p{N} _.\-]{2,12}$/u;

// ---------------------------------------------------------------- HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json',
};

const hits = new Map(); // ip -> {n, t}
function limited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false; }
  return ++h.n > 30;
}

const guests = new Map(); // token -> {id, name, seen}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 10_000) throw new Error('too big'); }
  return s ? JSON.parse(s) : {};
}

async function handleApi(req, res, route) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST',
    });
    return res.end();
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Geçersiz istek' });
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  if (limited(ip)) return json(res, 429, { error: 'Çok fazla deneme. Biraz bekle.' });
  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'Geçersiz istek' }); }

  if (route === 'register') {
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!USERNAME_RE.test(username)) return json(res, 400, { error: 'Kullanıcı adı 3-16 karakter olmalı (harf, rakam, _ ve .)' });
    if (password.length < 6 || password.length > 72) return json(res, 400, { error: 'Şifre en az 6 karakter olmalı' });
    const id = db.createUser(username, password);
    if (!id) return json(res, 409, { error: 'Bu kullanıcı adı alınmış' });
    return json(res, 200, { token: db.createSession(id) });
  }
  if (route === 'login') {
    const username = String(body.username || '').trim().toLowerCase();
    const id = db.verifyUser(username, String(body.password || ''));
    if (!id) return json(res, 401, { error: 'Kullanıcı adı veya şifre hatalı' });
    return json(res, 200, { token: db.createSession(id) });
  }
  if (route === 'guest') {
    const token = 'g_' + randomBytes(24).toString('hex');
    guests.set(token, { id: 'g:' + randomBytes(6).toString('hex'), name: 'Misafir' + randomInt(1000, 10000), seen: Date.now() });
    return json(res, 200, { token });
  }
  if (route === 'logout') {
    const t = String(body.token || '');
    if (t.startsWith('g_')) guests.delete(t); else if (t) db.deleteSession(t);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Bulunamadı' });
}

async function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  let file = path.join(DIST, p);
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    const immutable = p.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  } catch {
    try {
      const data = await readFile(path.join(DIST, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Penalzo sunucusu çalışıyor. İstemci derlemesi (dist) bulunamadı.');
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res, req.url.slice(5).split('?')[0]).catch(() => json(res, 500, { error: 'Sunucu hatası' }));
  serveStatic(req, res);
});

// ---------------------------------------------------------------- WS
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const online = new Map(); // id -> player
const rooms = new Map(); // code -> room

const send = (p, msg) => { if (p?.ws?.readyState === 1) p.ws.send(JSON.stringify(msg)); };
const err = (p, text) => send(p, { type: 'error', text });
const uid = (dbId) => 'u:' + dbId;
const pub = (p) => ({ id: p.id, name: p.name, look: p.look, guest: p.guest });
const meMsg = (p) => ({ type: 'me', me: { ...pub(p), username: p.username, needsName: !p.guest && !p.named } });

function friendsMsg(p) {
  const out = { type: 'friends', friends: [], incoming: [], outgoing: [] };
  for (const r of db.friendRows(p.dbId)) {
    const o = { id: uid(r.uid), rowId: r.id, name: r.display_name || r.username, username: r.username };
    if (r.status === 'accepted') {
      const op = online.get(o.id);
      out.friends.push({ ...o, online: !!op, inGame: !!op?.room });
    } else if (r.to_id === p.dbId) out.incoming.push(o);
    else out.outgoing.push(o);
  }
  out.friends.sort((a, b) => b.online - a.online || a.name.localeCompare(b.name, 'tr'));
  return out;
}
const pushFriends = (id) => { const p = online.get(id); if (p && !p.guest) send(p, friendsMsg(p)); };
function notifyFriends(p) {
  if (p.guest) return;
  for (const r of db.friendRows(p.dbId)) if (r.status === 'accepted') pushFriends(uid(r.uid));
}

// ---- odalar
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const roomMsg = (room) => ({
  type: 'room', code: room.code, hostId: room.hostId, state: room.state,
  players: room.players.map((id) => pub(online.get(id))),
});
const broadcast = (room, msg) => room.players.forEach((id) => send(online.get(id), msg));

function leaveRoom(p, silent) {
  const room = p.room && rooms.get(p.room);
  p.room = null;
  if (!room) return;
  const other = room.players.find((id) => id !== p.id);
  if (room.state === 'playing' && other) endMatch(room, other, 'left');
  room.players = room.players.filter((id) => id !== p.id);
  if (!silent) send(p, { type: 'roomLeft' });
  if (!room.players.length) {
    clearTimeout(room.match?.timer);
    rooms.delete(room.code);
  } else {
    room.hostId = room.players[0];
    broadcast(room, roomMsg(room));
  }
  notifyFriends(p);
}

// ---- maç
function startMatch(room) {
  const [a, b] = room.players;
  const order = randomInt(2) ? [a, b] : [b, a];
  room.state = 'playing';
  room.match = { order, kicks: { [a]: [], [b]: [] }, k: 0, picks: {}, phase: 'intro', timer: null };
  broadcast(room, { type: 'matchStart', order, players: room.players.map((id) => pub(online.get(id))), introMs: INTRO_MS });
  room.match.timer = setTimeout(() => startRound(room), INTRO_MS);
}

function startRound(room) {
  const m = room.match;
  if (!m) return;
  m.picks = {};
  m.phase = 'pick';
  ({ shooter: m.shooter, keeper: m.keeper } = rolesOf(m.order, m.k));
  broadcast(room, { type: 'round', k: m.k, shooterId: m.shooter, keeperId: m.keeper, pickMs: PICK_MS });
  m.timer = setTimeout(() => resolveRound(room), PICK_MS + PICK_GRACE_MS);
}

function registerPick(room, id, zone) {
  const mt = room.match;
  if (!mt || mt.phase !== 'pick' || id in mt.picks) return false;
  mt.picks[id] = zone;
  if (Object.keys(mt.picks).length === 2) {
    clearTimeout(mt.timer);
    mt.timer = setTimeout(() => resolveRound(room), BOTH_PICKED_MS);
  }
  return true;
}

function resolveRound(room) {
  const m = room.match;
  if (!m || m.phase !== 'pick') return;
  clearTimeout(m.timer);
  m.phase = 'anim';
  const shot = m.picks[m.shooter] ?? 0; // seçmeyen ortayı seçmiş sayılır
  const dive = m.picks[m.keeper] ?? 0;
  const goal = isGoal(shot, dive);
  m.kicks[m.shooter].push(goal);
  broadcast(room, {
    type: 'result', k: m.k, shooterId: m.shooter, keeperId: m.keeper, shot, dive, goal,
    rx: Math.random(), ry: Math.random(), kicks: m.kicks,
  });
  m.k++;
  const [a, b] = m.order;
  const w = decideWinner(m.kicks[a], m.kicks[b], m.k);
  m.timer = setTimeout(() => (w ? endMatch(room, w === 'a' ? a : b, 'score') : startRound(room)), RESULT_MS);
}

function endMatch(room, winnerId, reason) {
  const m = room.match;
  if (!m) return;
  clearTimeout(m.timer);
  room.match = null;
  room.state = 'lobby';
  broadcast(room, { type: 'matchEnd', winnerId, reason, kicks: m.kicks });
}

// ---- mesajlar
const handlers = {
  setName(p, m) {
    if (p.guest) return;
    const name = String(m.name || '').trim().replace(/\s+/g, ' ');
    if (!NAME_RE.test(name)) return err(p, 'Oyun içi ad 2-12 karakter olmalı');
    db.setName(p.dbId, name);
    p.name = name;
    p.named = true;
    send(p, meMsg(p));
    notifyFriends(p);
  },
  setLook(p, m) {
    p.look = sanitizeLook(m.look);
    if (!p.guest) db.setLook(p.dbId, p.look);
    send(p, meMsg(p));
    const room = p.room && rooms.get(p.room);
    if (room) broadcast(room, roomMsg(room));
  },
  createRoom(p) {
    leaveRoom(p, true);
    const room = { code: newCode(), hostId: p.id, players: [p.id], state: 'lobby', match: null };
    rooms.set(room.code, room);
    p.room = room.code;
    send(p, roomMsg(room));
    notifyFriends(p);
  },
  joinRoom(p, m) {
    const code = String(m.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return err(p, 'Oda bulunamadı');
    if (room.players.includes(p.id)) return send(p, roomMsg(room));
    if (room.players.length >= 2) return err(p, 'Oda dolu');
    if (room.state !== 'lobby') return err(p, 'Bu odada maç devam ediyor');
    leaveRoom(p, true);
    room.players.push(p.id);
    p.room = code;
    broadcast(room, roomMsg(room));
    notifyFriends(p);
  },
  leaveRoom(p) { leaveRoom(p); },
  start(p) {
    const room = p.room && rooms.get(p.room);
    if (!room || room.hostId !== p.id || room.state !== 'lobby') return;
    if (room.players.length < 2) return err(p, 'Rakibin gelmesini bekle');
    startMatch(room);
  },
  pick(p, m) {
    const room = p.room && rooms.get(p.room);
    const mt = room?.match;
    if (!mt || mt.phase !== 'pick' || m.k !== mt.k) return;
    if (!ZONES.includes(m.zone)) return;
    if (registerPick(room, p.id, m.zone)) send(p, { type: 'picked', k: mt.k, zone: m.zone });
  },
  invite(p, m) {
    if (p.guest) return;
    const room = p.room && rooms.get(p.room);
    const target = online.get(String(m.friendId));
    if (!room || room.state !== 'lobby') return;
    if (!target || target.guest || !db.areFriends(p.dbId, target.dbId)) return err(p, 'Arkadaşın çevrimiçi değil');
    if (target.room) return err(p, `${target.name} şu an başka bir odada`);
    send(target, { type: 'invited', from: { id: p.id, name: p.name }, code: room.code });
    send(p, { type: 'info', text: `${target.name} davet edildi` });
  },
  inviteDecline(p, m) {
    const target = online.get(String(m.toId));
    if (target) send(target, { type: 'info', text: `${p.name} daveti reddetti` });
  },
  friendAdd(p, m) {
    if (p.guest) return;
    const username = String(m.username || '').trim().toLowerCase();
    const u = db.userByUsername(username);
    if (!u) return err(p, 'Bu kullanıcı adıyla kimse bulunamadı');
    if (u.id === p.dbId) return err(p, 'Kendini ekleyemezsin');
    const r = db.requestFriend(p.dbId, u.id);
    if (r === 'exists') return err(p, 'Zaten arkadaşsınız ya da istek gönderilmiş');
    send(p, { type: 'info', text: r === 'accepted' ? 'Artık arkadaşsınız!' : 'Arkadaşlık isteği gönderildi' });
    send(p, friendsMsg(p));
    pushFriends(uid(u.id));
    const t = online.get(uid(u.id));
    if (t && r === 'sent') send(t, { type: 'info', text: `${p.name} sana arkadaşlık isteği gönderdi` });
  },
  friendRespond(p, m) {
    if (p.guest) return;
    const other = db.respondFriend(Number(m.rowId), p.dbId, !!m.accept);
    if (other == null) return;
    send(p, friendsMsg(p));
    pushFriends(uid(other));
    if (m.accept) send(online.get(uid(other)), { type: 'info', text: `${p.name} arkadaşlık isteğini kabul etti` });
  },
  friendRemove(p, m) {
    if (p.guest) return;
    const other = Number(String(m.id || '').slice(2));
    if (!other) return;
    db.removeFriend(p.dbId, other);
    send(p, friendsMsg(p));
    pushFriends(uid(other));
  },
};

function authenticate(ws, token) {
  let p;
  if (typeof token !== 'string') return null;
  if (token.startsWith('g_')) {
    const g = guests.get(token);
    if (!g) return null;
    g.seen = Date.now();
    p = { id: g.id, guest: true, name: g.name, username: null, named: true, look: sanitizeLook(DEFAULT_LOOK) };
  } else {
    const u = db.userByToken(token);
    if (!u) return null;
    p = {
      id: uid(u.id), dbId: u.id, guest: false, name: u.displayName || u.username, username: u.username,
      named: !!u.displayName, look: sanitizeLook(u.look || DEFAULT_LOOK),
    };
  }
  const old = online.get(p.id);
  if (old) {
    send(old, { type: 'kicked' });
    leaveRoom(old, true);
    old.ws.player = null;
    old.ws.close();
  }
  p.ws = ws;
  p.room = null;
  online.set(p.id, p);
  return p;
}

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'auth') {
      if (ws.player) return;
      const p = authenticate(ws, m.token);
      if (!p) return ws.send(JSON.stringify({ type: 'authFail' }));
      ws.player = p;
      send(p, meMsg(p));
      if (!p.guest) { send(p, friendsMsg(p)); notifyFriends(p); }
      return;
    }
    const p = ws.player;
    if (!p) return;
    try { handlers[m.type]?.(p, m); } catch (e) { console.error('handler', m.type, e); }
  });
  ws.on('close', () => {
    const p = ws.player;
    if (!p) return;
    leaveRoom(p, true);
    if (online.get(p.id) === p) online.delete(p.id);
    notifyFriends(p);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [t, g] of guests) if (!online.has(g.id) && now - g.seen > 24 * 3600_000) guests.delete(t);
}, 20_000);

server.listen(PORT, () => console.log(`Penalzo sunucusu http://localhost:${PORT} adresinde çalışıyor`));
