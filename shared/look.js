// Oyuncu görünümü: hem sunucu hem istemci kullanır.
export const HAIR_COUNT = 10;

export const DEFAULT_LOOK = {
  number: 10,
  hair: 0,
  hairColor: '#2a1a12',
  player: { jersey: '#e11d2e', shorts: '#ffffff', socks: '#e11d2e', boots: '#111827' },
  keeper: { jersey: '#facc15', shorts: '#111827', socks: '#facc15', boots: '#ffffff', gloves: '#22c55e' },
};

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const int = (v, lo, hi, d) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
};

export function sanitizeLook(input) {
  const i = input && typeof input === 'object' ? input : {};
  const D = DEFAULT_LOOK;
  const p = i.player || {};
  const k = i.keeper || {};
  return {
    number: int(i.number, 1, 99, D.number),
    hair: int(i.hair, 0, HAIR_COUNT - 1, D.hair),
    hairColor: hex(i.hairColor, D.hairColor),
    player: {
      jersey: hex(p.jersey, D.player.jersey),
      shorts: hex(p.shorts, D.player.shorts),
      socks: hex(p.socks, hex(p.jersey, D.player.socks)),
      boots: hex(p.boots, D.player.boots),
    },
    keeper: {
      jersey: hex(k.jersey, D.keeper.jersey),
      shorts: hex(k.shorts, D.keeper.shorts),
      socks: hex(k.socks, hex(k.jersey, D.keeper.socks)),
      boots: hex(k.boots, D.keeper.boots),
      gloves: hex(k.gloves, D.keeper.gloves),
    },
  };
}
