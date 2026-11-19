// Maç kurallarının birim testleri: node --test scripts/
import test from 'node:test';
import assert from 'node:assert/strict';
import { KICKS, ZONES, isGoal, rolesOf, decideWinner } from '../shared/rules.js';

const bits = (n, len) => Array.from({ length: len }, (_, i) => Boolean((n >> i) & 1));

test('aynı bölge kurtarış, farklı bölge gol', () => {
  for (const shot of ZONES) for (const dive of ZONES) assert.equal(isGoal(shot, dive), shot !== dive);
});

test('şutör ve kaleci sırayla değişir', () => {
  const order = ['x', 'y'];
  for (let k = 0; k < 20; k++) {
    const { shooter, keeper } = rolesOf(order, k);
    assert.equal(shooter, order[k % 2]);
    assert.notEqual(shooter, keeper);
  }
});

test('ilk 5er atışta maç, sonuç kesinleştiği ilk anda biter (tüm atış dizileri, kaba kuvvet)', () => {
  const total = KICKS * 2;
  let checked = 0;
  for (let n = 0; n < total; n++) {
    // n atış yapıldı: a = ceil(n/2), b = floor(n/2)
    const la = Math.ceil(n / 2), lb = Math.floor(n / 2);
    for (let mask = 0; mask < 1 << n; mask++) {
      const all = bits(mask, n);
      const ka = all.filter((_, i) => i % 2 === 0);
      const kb = all.filter((_, i) => i % 2 === 1);
      assert.equal(ka.length, la);
      assert.equal(kb.length, lb);
      // gerçek: kalan atışların tüm olası sonuçlarında aynı kişi önde mi bitiriyor?
      const left = total - n;
      const winners = new Set();
      for (let rest = 0; rest < 1 << left; rest++) {
        const r = bits(rest, left);
        let sa = ka.filter(Boolean).length, sb = kb.filter(Boolean).length;
        r.forEach((hit, i) => { if (hit) ((n + i) % 2 === 0 ? sa++ : sb++); });
        winners.add(sa > sb ? 'a' : sa < sb ? 'b' : 'tie');
      }
      const truth = winners.size === 1 && !winners.has('tie') ? [...winners][0] : null;
      assert.equal(decideWinner(ka, kb, n), truth, `n=${n} a=${ka} b=${kb}`);
      checked++;
    }
  }
  assert.ok(checked > 1000);
});

test('seri penaltı: çift tamamlanınca fark varsa biter, beraberlikte sürer', () => {
  for (let pairs = 0; pairs < 4; pairs++) {
    // 5er atış sonunda 3-3; seri penaltıda ikisi de gol atmaya devam ederse hâlâ eşit
    const a = [true, true, false, false, true, ...Array(pairs).fill(true)];
    const b = [true, false, true, false, true, ...Array(pairs).fill(true)];
    assert.equal(decideWinner(a, b, 10 + pairs * 2), null);
  }
  // a gol atıp b kaçırınca biter
  assert.equal(decideWinner([...Array(5).fill(true), true], [...Array(5).fill(true), false], 12), 'a');
  assert.equal(decideWinner([...Array(5).fill(true), false], [...Array(5).fill(true), true], 12), 'b');
  // çift tamamlanmadan (a attı, b henüz atmadı) bitmez
  assert.equal(decideWinner([...Array(5).fill(true), true], Array(5).fill(true), 11), null);
});
