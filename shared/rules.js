// Maç kuralları ve süreleri. Çok oyunculu sunucu ve çevrimdışı antrenman aynı kodu kullanır,
// böylece iki mod arasında kural farkı oluşamaz.

export const KICKS = 5; // oyuncu başına normal atış
export const ZONES = [-1, 0, 1]; // sol, orta, sağ
export const PICK_MS = 5000; // seçim süresi
export const BOTH_PICKED_MS = 650; // iki oyuncu da seçince kısa bekleme
export const RESULT_MS = 6200; // şut animasyonunun süresi
export const INTRO_MS = 2800; // maç başı tanıtım

// Şutör ve kaleci farklı bölgeyi seçtiyse gol, aynısını seçtiyse kurtarış.
export const isGoal = (shot, dive) => shot !== dive;

// k. atışı (0'dan başlar) kimin çektiği. order = [ilk atan, ikinci atan]
export function rolesOf(order, k) {
  return { shooter: order[k % 2], keeper: order[(k + 1) % 2] };
}

const count = (kicks) => kicks.filter(Boolean).length;

/**
 * Maç bitti mi? kicksA / kicksB: iki oyuncunun şut sonuçları (true = gol), taken: şimdiye kadar atılan toplam şut.
 * - İlk 5'er atışta geride olan oyuncu kalan atışlarının hepsini atsa bile yetişemiyorsa maç biter.
 * - Sonrası seri penaltı: her iki oyuncu da aynı sayıda attığında fark varsa maç biter.
 * Dönüş: kazanan için 'a' | 'b', henüz belli değilse null.
 */
export function decideWinner(kicksA, kicksB, taken) {
  const sa = count(kicksA);
  const sb = count(kicksB);
  const ra = Math.max(0, KICKS - kicksA.length);
  const rb = Math.max(0, KICKS - kicksB.length);
  const done = taken < KICKS * 2 ? sa > sb + rb || sb > sa + ra : taken % 2 === 0 && sa !== sb;
  return done ? (sa > sb ? 'a' : 'b') : null;
}
