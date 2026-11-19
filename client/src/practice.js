// Çevrimdışı antrenman: sunucu olmadan botla oynanan maç.
// Sunucudaki maç motoruyla aynı kuralları (shared/rules.js) ve aynı mesaj biçimlerini kullanır;
// ekran kodu mesajların sunucudan mı yoksa buradan mı geldiğini ayırt etmez.
import { sanitizeLook } from '../../shared/look.js';
import { ZONES, PICK_MS, BOTH_PICKED_MS, RESULT_MS, INTRO_MS, isGoal, rolesOf, decideWinner } from '../../shared/rules.js';

export const ME_ID = 'local';
export const BOT_ID = 'bot';

const BOT_COLORS = ['#2563eb', '#16a34a', '#f97316', '#8b5cf6', '#111827', '#14b8a6', '#facc15', '#ffffff'];

export function randomBotLook(rand = Math.random) {
  const color = () => BOT_COLORS[Math.floor(rand() * BOT_COLORS.length)];
  return sanitizeLook({
    number: 1 + Math.floor(rand() * 99),
    hair: Math.floor(rand() * 10),
    player: { jersey: color(), shorts: color(), socks: color(), boots: color() },
    keeper: { jersey: color(), shorts: '#111827', socks: color(), boots: color(), gloves: color() },
  });
}

/**
 * @param {object}   o
 * @param {object}   o.me     { id?, name, look }  - oyuncu
 * @param {function} o.emit   sunucu mesajıyla aynı biçimde mesaj alır
 * @param {object}   [o.timing]  testlerde süreleri kısaltmak için
 * @param {function} [o.rand]    0..1 arası rastgele sayı üreteci
 */
export function createPractice({ me, emit, timing = {}, rand = Math.random }) {
  const T = {
    introMs: INTRO_MS, pickMs: PICK_MS, bothPickedMs: BOTH_PICKED_MS, resultMs: RESULT_MS,
    botMinMs: 700, botMaxMs: 3300, ...timing,
  };
  const meId = me.id || ME_ID;
  const players = [
    { id: meId, name: me.name, look: me.look, guest: true },
    { id: BOT_ID, name: 'Bot', look: randomBotLook(rand), guest: true },
  ];
  const timers = new Set();
  let m = null; // çalışan maç
  let stopped = false;

  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); if (!stopped) fn(); }, ms);
    timers.add(t);
    return t;
  };
  const copyKicks = () => ({ [meId]: [...m.kicks[meId]], [BOT_ID]: [...m.kicks[BOT_ID]] });

  function startRound() {
    m.picks = {};
    m.phase = 'pick';
    const { shooter, keeper } = rolesOf(m.order, m.k);
    m.shooter = shooter;
    m.keeper = keeper;
    const round = m.k;
    emit({ type: 'round', k: round, shooterId: shooter, keeperId: keeper, pickMs: T.pickMs });
    m.timer = later(resolve, T.pickMs);
    later(() => { if (m && m.k === round) register(BOT_ID, ZONES[Math.floor(rand() * ZONES.length)]); },
      T.botMinMs + rand() * (T.botMaxMs - T.botMinMs));
  }

  function register(id, zone) {
    if (!m || m.phase !== 'pick' || id in m.picks) return false;
    m.picks[id] = zone;
    if (Object.keys(m.picks).length === 2) {
      clearTimeout(m.timer);
      timers.delete(m.timer);
      m.timer = later(resolve, T.bothPickedMs);
    }
    return true;
  }

  function resolve() {
    if (!m || m.phase !== 'pick') return;
    m.phase = 'anim';
    const shot = m.picks[m.shooter] ?? 0; // seçmeyen ortayı seçmiş sayılır
    const dive = m.picks[m.keeper] ?? 0;
    const goal = isGoal(shot, dive);
    m.kicks[m.shooter].push(goal);
    emit({
      type: 'result', k: m.k, shooterId: m.shooter, keeperId: m.keeper, shot, dive, goal,
      rx: rand(), ry: rand(), kicks: copyKicks(),
    });
    m.k++;
    const [a, b] = m.order;
    const w = decideWinner(m.kicks[a], m.kicks[b], m.k);
    m.timer = later(() => (w ? finish(w === 'a' ? a : b) : startRound()), T.resultMs);
  }

  function finish(winnerId) {
    const kicks = copyKicks();
    m = null;
    emit({ type: 'matchEnd', winnerId, reason: 'score', kicks });
  }

  return {
    ids: { me: meId, bot: BOT_ID },
    start() {
      const order = rand() < 0.5 ? [meId, BOT_ID] : [BOT_ID, meId];
      m = { order, kicks: { [meId]: [], [BOT_ID]: [] }, k: 0, picks: {}, phase: 'intro', timer: null };
      emit({ type: 'matchStart', order, players, introMs: T.introMs });
      later(startRound, T.introMs);
    },
    // oyuncunun seçimi; kabul edilirse sunucudaki gibi 'picked' onayı gider
    pick(k, zone) {
      if (!m || m.phase !== 'pick' || k !== m.k || !ZONES.includes(zone)) return;
      if (register(meId, zone)) emit({ type: 'picked', k: m.k, zone });
    },
    stop() {
      stopped = true;
      timers.forEach(clearTimeout);
      timers.clear();
      m = null;
    },
  };
}
