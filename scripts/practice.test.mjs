// Çevrimdışı antrenman motorunun testleri (sunucu mesaj biçimi ve kurallar): node --test scripts/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPractice } from '../client/src/practice.js';
import { ZONES, isGoal, rolesOf, decideWinner } from '../shared/rules.js';

const FAST = { introMs: 1, pickMs: 25, bothPickedMs: 1, resultMs: 1, botMinMs: 0, botMaxMs: 6 };
const me = { id: 'u:1', name: 'Test', look: {} };

// Bir maçı sonuna kadar oynatır. chooser(round) -> bölge ya da null (seçme)
function playMatch(chooser, extra = {}) {
  return new Promise((resolve, reject) => {
    const log = [];
    let engine;
    const emit = (msg) => {
      log.push(msg);
      if (msg.type === 'round') {
        const zone = chooser(msg);
        if (zone != null) {
          engine.pick(msg.k, zone);
          if (extra.double) engine.pick(msg.k, zone); // ikinci seçim yok sayılmalı
          if (extra.stale) engine.pick(msg.k + 7, 1); // yanlış tur yok sayılmalı
          if (extra.bad) engine.pick(msg.k, 5); // geçersiz bölge yok sayılmalı
        }
      }
      if (msg.type === 'matchEnd') resolve({ log, engine });
    };
    engine = createPractice({ me, emit, timing: FAST });
    setTimeout(() => reject(new Error('maç zamanında bitmedi')), 8000);
    engine.start();
  });
}

test('maç mesajları sunucudakiyle aynı sırada ve biçimde gelir', async () => {
  const { log, engine } = await playMatch(() => 0);
  assert.equal(log[0].type, 'matchStart');
  assert.equal(log[0].players.length, 2);
  assert.deepEqual([...log[0].order].sort(), [engine.ids.me, engine.ids.bot].sort());
  assert.equal(log.at(-1).type, 'matchEnd');
  const rounds = log.filter((m) => m.type === 'round');
  const results = log.filter((m) => m.type === 'result');
  assert.equal(rounds.length, results.length);
  rounds.forEach((r, i) => {
    assert.equal(r.k, i);
    const { shooter, keeper } = rolesOf(log[0].order, i);
    assert.equal(r.shooterId, shooter);
    assert.equal(r.keeperId, keeper);
  });
});

test('gol kuralı, seçmeyen oyuncu ortayı seçmiş sayılır, sonuç tutarlıdır', async () => {
  for (let run = 0; run < 15; run++) {
    // oyuncu bazen hiç seçmez
    const { log } = await playMatch((r) => (r.k % 3 === 2 ? null : ZONES[(r.k + run) % 3]));
    for (const res of log.filter((m) => m.type === 'result')) {
      assert.equal(res.goal, isGoal(res.shot, res.dive));
      assert.ok(ZONES.includes(res.shot) && ZONES.includes(res.dive));
      assert.ok(res.rx >= 0 && res.rx < 1 && res.ry >= 0 && res.ry < 1);
      if (res.k % 3 === 2) { // oyuncu seçmedi
        const humanZone = res.shooterId === me.id ? res.shot : res.dive;
        assert.equal(humanZone, 0);
      }
    }
  }
});

test('maç, sonuç kesinleştiği ilk atışta biter ve kazanan doğrudur', async () => {
  for (let run = 0; run < 25; run++) {
    const { log } = await playMatch((r) => ZONES[(r.k * 7 + run) % 3]);
    const results = log.filter((m) => m.type === 'result');
    const end = log.at(-1);
    const [a, b] = log[0].order;
    results.forEach((res, i) => {
      const w = decideWinner(res.kicks[a], res.kicks[b], i + 1);
      if (i < results.length - 1) assert.equal(w, null, 'maç erken bitmedi, sonuç belli olmadan sürdü');
      else assert.ok(w, 'son atıştan sonra sonuç kesinleşmiş olmalı');
    });
    const last = results.at(-1).kicks;
    const sa = last[a].filter(Boolean).length, sb = last[b].filter(Boolean).length;
    assert.notEqual(sa, sb);
    assert.equal(end.winnerId, sa > sb ? a : b);
    assert.equal(end.reason, 'score');
  }
});

test('mesajlardaki atış listeleri kopyadır (sonradan değişmez)', async () => {
  const { log } = await playMatch(() => 1);
  const results = log.filter((m) => m.type === 'result');
  assert.notEqual(results[0].kicks, results.at(-1).kicks);
  const [a, b] = log[0].order;
  assert.equal(results[0].kicks[a].length + results[0].kicks[b].length, 1);
});

test('çift seçim, yanlış tur ve geçersiz bölge yok sayılır', async () => {
  const { log } = await playMatch((r) => (r.k % 2 ? 1 : -1), { double: true, stale: true, bad: true });
  const rounds = log.filter((m) => m.type === 'round').length;
  assert.equal(log.filter((m) => m.type === 'picked').length, rounds); // tur başına tek onay
});

test('stop() sonrası hiçbir mesaj gelmez', async () => {
  const log = [];
  const engine = createPractice({ me, emit: (m) => log.push(m), timing: FAST });
  engine.start();
  engine.stop();
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(log.map((m) => m.type), ['matchStart']);
});
