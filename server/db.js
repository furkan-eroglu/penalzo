import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, 'penalzo.db'));

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  pass TEXT NOT NULL,
  salt TEXT NOT NULL,
  display_name TEXT,
  look TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS friends(
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER,
  UNIQUE(from_id, to_id)
);
`);

const hashPass = (password, salt) => scryptSync(password, salt, 64).toString('hex');
const hashToken = (t) => createHash('sha256').update(t).digest('hex');

export function createUser(username, password) {
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return null;
  const salt = randomBytes(16).toString('hex');
  const r = db
    .prepare('INSERT INTO users(username, pass, salt, created_at) VALUES(?,?,?,?)')
    .run(username, hashPass(password, salt), salt, Date.now());
  return Number(r.lastInsertRowid);
}

export function verifyUser(username, password) {
  const u = db.prepare('SELECT id, pass, salt FROM users WHERE username=?').get(username);
  if (!u) return null;
  const a = Buffer.from(u.pass, 'hex');
  const b = Buffer.from(hashPass(password, u.salt), 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? u.id : null;
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash, user_id, created_at) VALUES(?,?,?)').run(hashToken(token), userId, Date.now());
  return token;
}

export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
}

export function userByToken(token) {
  const s = db.prepare('SELECT user_id FROM sessions WHERE token_hash=?').get(hashToken(token));
  return s ? getUser(s.user_id) : null;
}

export function getUser(id) {
  const u = db.prepare('SELECT id, username, display_name, look FROM users WHERE id=?').get(id);
  if (!u) return null;
  let look = null;
  try { look = u.look ? JSON.parse(u.look) : null; } catch {}
  return { id: u.id, username: u.username, displayName: u.display_name, look };
}

export function userByUsername(username) {
  const u = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  return u ? getUser(u.id) : null;
}

export const setName = (id, name) => db.prepare('UPDATE users SET display_name=? WHERE id=?').run(name, id);
export const setLook = (id, look) => db.prepare('UPDATE users SET look=? WHERE id=?').run(JSON.stringify(look), id);

// ---- arkadaşlar ----
export function friendRows(userId) {
  return db
    .prepare(
      `SELECT f.id, f.from_id, f.to_id, f.status, u.id AS uid, u.username, u.display_name
       FROM friends f JOIN users u ON u.id = CASE WHEN f.from_id=? THEN f.to_id ELSE f.from_id END
       WHERE f.from_id=? OR f.to_id=?`
    )
    .all(userId, userId, userId);
}

export function areFriends(a, b) {
  return !!db
    .prepare(`SELECT id FROM friends WHERE status='accepted' AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))`)
    .get(a, b, b, a);
}

// 'sent' | 'accepted' | 'exists'
export function requestFriend(from, to) {
  const row = db
    .prepare('SELECT id, from_id, status FROM friends WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)')
    .get(from, to, to, from);
  if (row) {
    if (row.status === 'pending' && row.from_id === to) {
      db.prepare(`UPDATE friends SET status='accepted' WHERE id=?`).run(row.id);
      return 'accepted';
    }
    return 'exists';
  }
  db.prepare(`INSERT INTO friends(from_id, to_id, status, created_at) VALUES(?,?, 'pending', ?)`).run(from, to, Date.now());
  return 'sent';
}

// isteği yanıtla; karşı tarafın id'sini döner
export function respondFriend(rowId, userId, accept) {
  const row = db.prepare(`SELECT id, from_id FROM friends WHERE id=? AND to_id=? AND status='pending'`).get(rowId, userId);
  if (!row) return null;
  if (accept) db.prepare(`UPDATE friends SET status='accepted' WHERE id=?`).run(row.id);
  else db.prepare('DELETE FROM friends WHERE id=?').run(row.id);
  return row.from_id;
}

export function removeFriend(a, b) {
  db.prepare('DELETE FROM friends WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)').run(a, b, b, a);
}
