// Uçtan uca sunucu testi: node scripts/e2e.mjs  (sunucu 3000 portunda çalışıyor olmalı)
const BASE = process.env.BASE || 'http://localhost:3000';
const post = async (p, b) => {
  const r = await fetch(`${BASE}/api/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
  return { status: r.status, ...(await r.json()) };
};
const assert = (c, m) => { if (!c) { console.error('✗ ' + m); process.exit(1); } console.log('✓ ' + m); };

function client(token) {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws');
  const c = { ws, log: [], waiters: [], me: null };
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'me') c.me = m.me;
    c.log.push(m);
    c.waiters = c.waiters.filter((w) => !(w.f(m) && (w.res(m), true)));
    c.onmsg?.(m);
  };
  c.send = (type, d = {}) => ws.send(JSON.stringify({ type, ...d }));
  c.wait = (f, ms = 15000) => new Promise((res, rej) => {
    const hit = c.log.find(f);
    if (hit && !c.strict) return res(hit);
    c.waiters.push({ f, res });
    setTimeout(() => rej(new Error('timeout')), ms);
  });
  c.next = (type, ms) => { const n = c.log.length; return c.wait((m) => m.type === type && c.log.indexOf(m) >= n, ms); };
  return c;
}

const id = Math.random().toString(36).slice(2, 8);
const ua = 'ta_' + id, ub = 'tb_' + id;

let r = await post('register', { username: 'x', password: '123456' });
assert(r.status === 400, 'kısa kullanıcı adı reddedildi');
r = await post('register', { username: ua, password: '123' });
assert(r.status === 400, 'kısa şifre reddedildi');
const ta = (await post('register', { username: ua, password: 'secret1' })).token;
const tb = (await post('register', { username: ub, password: 'secret2' })).token;
assert(ta && tb, 'iki hesap oluşturuldu');
r = await post('register', { username: ua, password: 'secret1' });
assert(r.status === 409, 'aynı kullanıcı adı reddedildi');
r = await post('login', { username: ua, password: 'yanlis' });
assert(r.status === 401, 'yanlış şifre reddedildi');
r = await post('login', { username: ua.toUpperCase(), password: 'secret1' });
assert(r.token, 'giriş yapıldı');

const A = client(ta), B = client(tb);
await A.wait((m) => m.type === 'me'); await B.wait((m) => m.type === 'me');
assert(A.me.needsName && !A.me.guest, 'yeni hesap oyun içi ad istiyor');
A.send('setName', { name: 'Ayşe' }); B.send('setName', { name: 'Burak' });
await A.wait((m) => m.type === 'me' && !m.me.needsName); await B.wait((m) => m.type === 'me' && !m.me.needsName);
assert(A.me.name === 'Ayşe', 'oyun içi ad kaydedildi');

A.send('setLook', { look: { number: 7, hair: 5, player: { jersey: '#2563eb' }, keeper: { gloves: 'bozuk' } } });
await A.wait((m) => m.type === 'me' && m.me.look.number === 7);
assert(A.me.look.player.jersey === '#2563eb' && A.me.look.keeper.gloves === '#22c55e', 'görünüm kaydedildi ve doğrulandı');

// arkadaşlık
A.send('friendAdd', { username: ub });
const req = await B.wait((m) => m.type === 'friends' && m.incoming.length === 1);
assert(req.incoming[0].name === 'Ayşe', 'arkadaşlık isteği ulaştı');
B.send('friendRespond', { rowId: req.incoming[0].rowId, accept: true });
const fl = await A.wait((m) => m.type === 'friends' && m.friends.length === 1);
assert(fl.friends[0].online && fl.friends[0].name === 'Burak', 'arkadaş listesi güncellendi (çevrimiçi)');

// oda + davet
A.send('createRoom');
const room = await A.wait((m) => m.type === 'room');
assert(/^[A-Z0-9]{5}$/.test(room.code), 'oda kuruldu: ' + room.code);
A.send('start');
await A.wait((m) => m.type === 'error');
assert(true, 'tek kişiyle maç başlamıyor');
A.send('invite', { friendId: B.me.id });
const inv = await B.wait((m) => m.type === 'invited');
assert(inv.code === room.code && inv.from.name === 'Ayşe', 'davet bildirimi ulaştı');
B.send('joinRoom', { code: inv.code });
await A.wait((m) => m.type === 'room' && m.players.length === 2);
assert(true, 'davetle odaya katılındı');

// misafir
const tg = (await post('guest')).token;
const G = client(tg);
await G.wait((m) => m.type === 'me');
assert(G.me.guest && /^Misafir\d{4}$/.test(G.me.name), 'misafir girişi: ' + G.me.name);
G.send('joinRoom', { code: room.code });
const full = await G.wait((m) => m.type === 'error');
assert(full.text === 'Oda dolu', 'dolu odaya girilemiyor');
G.send('friendAdd', { username: ua });
G.ws.close();

// maç
B.send('start');
A.send('start');
const ms = await A.wait((m) => m.type === 'matchStart');
assert(ms.order.length === 2, 'maç başladı (yalnızca kurucu başlatabildi)');
const t0 = Date.now();
let rounds = 0;
const zones = [-1, 0, 1];
for (const c of [A, B]) c.onmsg = (m) => {
  if (m.type !== 'round') return;
  // A hep rastgele seçer; B bazen hiç seçmez (süre dolunca orta sayılmalı)
  if (c === A || m.k % 3 !== 2) setTimeout(() => c.send('pick', { k: m.k, zone: zones[Math.floor(Math.random() * 3)] }), 200);
};
const results = [];
A.onmsg2 = null;
const origA = A.onmsg;
A.onmsg = (m) => {
  origA(m);
  if (m.type === 'result') { results.push(m); rounds++; process.stdout.write(m.goal ? 'G' : 'x'); }
};
const end = await A.wait((m) => m.type === 'matchEnd', 400000);
console.log('');
const sc = Object.values(end.kicks).map((k) => k.filter(Boolean).length);
const lens = Object.values(end.kicks).map((k) => k.length);
assert(results.every((x) => x.goal === (x.shot !== x.dive)), 'gol kuralı: farklı bölge = gol, aynı bölge = kurtarış');
assert(results.every((x, i) => x.k % 3 !== 2 || [x.shot, x.dive].includes(0)), 'seçmeyen oyuncu ortayı seçmiş sayıldı');
assert(results.every((x, i) => i === 0 || x.shooterId !== results[i - 1].shooterId), 'atışlar sırayla yapıldı');
// sonuç kesinleştiği ilk anda bitmeli (ne erken ne geç)
const decided = (n) => {
  const sc2 = {}, len = {};
  for (const x of results.slice(0, n)) { sc2[x.shooterId] = (sc2[x.shooterId] || 0) + (x.goal ? 1 : 0); len[x.shooterId] = (len[x.shooterId] || 0) + 1; }
  const [p, q] = ms.order;
  const sp = sc2[p] || 0, sq = sc2[q] || 0, rp = Math.max(0, 5 - (len[p] || 0)), rq = Math.max(0, 5 - (len[q] || 0));
  return n < 10 ? sp > sq + rq || sq > sp + rp : n % 2 === 0 && sp !== sq;
};
assert(decided(rounds), `maç sonuç kesinleşince bitti (${lens.join('-')} atış, toplam ${rounds})`);
assert(![...Array(rounds).keys()].slice(1).some((n) => decided(n)), 'sonuç kesinleşmeden önce bitmedi, kesinleştikten sonra da devam etmedi');
assert(sc[0] !== sc[1], `skor ${sc[0]}-${sc[1]}, beraberlik yok`);
const wid = end.winnerId;
assert(end.kicks[wid].filter(Boolean).length === Math.max(...sc), 'kazanan doğru');
if (lens[0] > 5) {
  const ids = Object.keys(end.kicks);
  const at5 = ids.map((i) => end.kicks[i].slice(0, 5).filter(Boolean).length);
  assert(at5[0] === at5[1], `5'er atış sonunda eşitlik (${at5[0]}-${at5[1]}) → seri penaltıya gidildi`);
}
console.log(`süre: ${((Date.now() - t0) / 1000).toFixed(0)} sn`);

// rakip ayrılınca hükmen galibiyet
A.send('start');
await A.next('matchStart');
B.ws.close();
const left = await A.next('matchEnd');
assert(left.reason === 'left' && left.winnerId === A.me.id, 'rakip ayrılınca kalan oyuncu kazandı');
const off = await A.wait((m) => m.type === 'friends' && m.friends[0] && !m.friends[0].online && A.log.indexOf(m) > A.log.indexOf(left) - 5);
assert(!off.friends[0].online, 'arkadaş çevrimdışı göründü');
A.ws.close();
console.log('\nTÜM TESTLER GEÇTİ');
process.exit(0);
