// Poz tabanlı prosedürel animasyon sistemi.
// f = öne, o = dışa (yana açma), t = burgu. L = sol, R = sağ.
export const KEYS = [
  'hx', 'hy', 'hz', 'hrx', 'hry', 'hrz', 'gnd',
  'sx', 'sy', 'sz', 'nx', 'ny', 'nz',
  'aLf', 'aLo', 'aLt', 'eL', 'aRf', 'aRo', 'aRt', 'eR',
  'lLf', 'lLo', 'lLt', 'kL', 'fL', 'lRf', 'lRo', 'lRt', 'kR', 'fR',
];

export function P(o = {}) {
  const p = {};
  for (const k of KEYS) p[k] = o[k] ?? (k === 'gnd' ? 1 : 0);
  return p;
}

export function lerpPose(a, b, t, out = {}) {
  for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

const SWAP = [['aLf', 'aRf'], ['aLo', 'aRo'], ['aLt', 'aRt'], ['eL', 'eR'], ['lLf', 'lRf'], ['lLo', 'lRo'], ['lLt', 'lRt'], ['kL', 'kR'], ['fL', 'fR']];
const NEG = ['hx', 'hry', 'hrz', 'sy', 'sz', 'ny', 'nz'];
export function mirror(p) {
  const q = { ...p };
  for (const [a, b] of SWAP) { q[a] = p[b]; q[b] = p[a]; }
  for (const k of NEG) q[k] = -p[k];
  return q;
}

export const ease = {
  lin: (t) => t,
  io: (t) => t * t * (3 - 2 * t),
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => t * t,
};
export const clamp01 = (t) => Math.min(1, Math.max(0, t));

// keys: [{t, p, e?}] -> (time) => pose
export function clip(keys) {
  const out = P();
  return (t) => {
    if (t <= keys[0].t) return keys[0].p;
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i].t) {
        const a = keys[i - 1], b = keys[i];
        return lerpPose(a.p, b.p, (b.e || ease.io)((t - a.t) / (b.t - a.t)), out);
      }
    }
    return keys[keys.length - 1].p;
  };
}

// sayısal anahtar kareler: [[t, v], ...]
export function kf(t, keys, e = ease.io) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      return a[1] + (b[1] - a[1]) * e((t - a[0]) / (b[0] - a[0]));
    }
  }
  return keys[keys.length - 1][1];
}

const S = Math.sin, C = Math.cos;

// ------------------------------------------------------------ duruşlar
const STAND = P({ aLo: 0.13, aRo: 0.13, eL: 0.22, eR: 0.22, aLf: 0.04, aRf: 0.04 });

export function idle(seed = 0) {
  const p = P();
  return (t) => {
    t += seed;
    Object.assign(p, STAND);
    const b = S(t * 1.7);
    p.sx = 0.015 * b;
    p.aLo = 0.13 + 0.02 * b; p.aRo = 0.13 + 0.02 * b;
    p.hrz = 0.025 * S(t * 0.7); p.sz = -0.03 * S(t * 0.7);
    p.ny = 0.12 * S(t * 0.45); p.nx = 0.03 * S(t * 0.9);
    p.eL = 0.25 + 0.05 * S(t * 0.9); p.eR = 0.25 + 0.05 * S(t * 0.9 + 1);
    return p;
  };
}

// şut öncesi: kollar yanda, topa odaklı
export function shooterReady() {
  const p = P();
  return (t) => {
    Object.assign(p, STAND);
    const b = S(t * 1.8);
    p.aLo = 0.12 + 0.015 * b; p.aRo = 0.12 + 0.015 * b;
    p.eL = 0.18; p.eR = 0.18; p.aLf = 0.03; p.aRf = 0.03;
    p.sx = 0.05 + 0.012 * b;
    p.hrz = 0.025 * S(t * 0.9); p.sz = -0.025 * S(t * 0.9);
    p.lLo = 0.07; p.lRo = 0.07;
    p.nx = 0.06;
    return p;
  };
}

export function keeperReady() {
  const p = P();
  return (t) => {
    const b = S(t * 5.2) * 0.5 + 0.5;
    const k = 0.75 + 0.18 * b;
    const lf = 0.48 + 0.1 * b;
    p.lLf = lf; p.lRf = lf; p.kL = k; p.kR = k; p.fL = lf - k; p.fR = lf - k;
    p.lLo = 0.36; p.lRo = 0.36;
    p.sx = 0.34; p.nx = -0.28;
    p.aLf = 0.55; p.aRf = 0.55; p.aLo = 0.78 + 0.08 * S(t * 2.6); p.aRo = 0.78 + 0.08 * S(t * 2.6 + 0.6);
    p.eL = 0.55; p.eR = 0.55;
    p.hx = 0.05 * S(t * 2.1); p.sz = 0.03 * S(t * 2.1);
    p.gnd = 1; p.hy = 0;
    return p;
  };
}

export function run(phaseAt) {
  const p = P();
  return (t) => {
    const f = phaseAt(t);
    const s = S(f), c = C(f);
    p.lLf = 0.8 * s + 0.12; p.lRf = -0.8 * s + 0.12;
    p.kL = 0.3 + 1.05 * Math.max(0, c); p.kR = 0.3 + 1.05 * Math.max(0, -c);
    p.fL = s < 0 ? 0.35 : -0.1; p.fR = s > 0 ? 0.35 : -0.1;
    p.aLf = -0.75 * s; p.aRf = 0.75 * s; p.eL = 1.35; p.eR = 1.35; p.aLo = 0.16; p.aRo = 0.16;
    p.sx = 0.2; p.sy = 0.14 * s; p.hry = -0.08 * s;
    p.hy = 0.03 * Math.abs(c);
    return p;
  };
}

// sağ ayakla vuruş; t=0 basma anı, KICK_HIT anında topa temas
export const KICK_HIT = 0.14;
export const kick = clip([
  { t: 0, p: P({ lLf: 0.5, kL: 0.35, fL: -0.1, lRf: -0.8, kR: 1.6, fR: 0.5, aLo: 1.15, aLf: 0.25, eL: 0.3, aRf: -0.75, aRo: 0.35, eR: 0.5, sx: 0.1, sy: -0.38, hry: 0.22 }) },
  { t: KICK_HIT, e: ease.in, p: P({ lLf: -0.02, kL: 0.28, lRf: 0.55, kR: 0.18, fR: 0.6, aLo: 0.95, aLf: 0.55, eL: 0.35, aRf: -0.55, aRo: 0.5, eR: 0.4, sx: 0.26, sy: 0.18, hry: -0.14 }) },
  { t: 0.32, e: ease.out, p: P({ lLf: -0.32, kL: 0.1, fL: 0.35, lRf: 1.35, kR: 0.22, fR: 0.45, aLo: 0.55, aLf: 0.95, eL: 0.5, aRf: -0.7, aRo: 0.7, eR: 0.3, sx: 0.3, sy: 0.48, hry: -0.25, hy: 0.05 }) },
  { t: 0.6, p: P({ lLf: -0.1, kL: 0.15, lRf: 0.55, kR: 0.55, aLo: 0.3, aLf: 0.3, eL: 0.5, aRf: -0.2, aRo: 0.3, eR: 0.5, sx: 0.16, sy: 0.15 }) },
  { t: 0.95, p: P({ ...STAND, sx: 0.05, lLf: 0.12, lRf: -0.1, kR: 0.1 }) },
]);

// kutlama: zıplayarak yumruk sallama
export function celebrate(seed = 0) {
  const p = P();
  return (t) => {
    t += seed;
    const j = S(t * 6.2);
    const up = Math.max(0, j), dn = Math.max(0, -j);
    p.hy = 0.26 * up;
    p.kL = 0.55 * dn + 0.1 * up; p.kR = 0.55 * dn + 0.35 * up;
    p.lLf = 0.3 * dn; p.lRf = 0.3 * dn + 0.2 * up; p.fL = -0.25 * dn + 0.5 * up; p.fR = -0.25 * dn + 0.5 * up;
    p.aLo = 2.55 + 0.15 * S(t * 12.4); p.aRo = 2.55 - 0.15 * S(t * 12.4);
    p.aLf = -0.15; p.aRf = -0.15;
    p.eL = 0.5 + 0.4 * dn; p.eR = 0.5 + 0.4 * dn;
    p.nx = -0.3; p.sx = -0.08 + 0.12 * dn; p.hry = 0.25 * S(t * 1.55); p.ny = 0.2 * S(t * 3.1);
    p.lLo = 0.12; p.lRo = 0.12;
    return p;
  };
}

// tek seferlik yumruk (kaleci kurtarışı / kısa sevinç)
export function fistPump() {
  const p = P();
  return (t) => {
    const b = S(t * 9) * 0.5 + 0.5;
    Object.assign(p, STAND);
    p.aRf = 1.5; p.aRo = 0.35; p.eR = 1.9 - 0.7 * b; p.aLf = 0.4; p.eL = 1.5; p.aLo = 0.3;
    p.kL = 0.3; p.kR = 0.3; p.lLf = 0.2; p.lRf = 0.2; p.fL = -0.1; p.fR = -0.1; p.lLo = 0.2; p.lRo = 0.2;
    p.sx = 0.1; p.nx = -0.2;
    return p;
  };
}

// üzüntü: eller başta, baş önde
export function sad(seed = 0) {
  const p = P();
  return (t) => {
    t += seed;
    p.sx = 0.38 + 0.03 * S(t * 1.4); p.nx = 0.55; p.ny = 0.22 * S(t * 1.9);
    p.aLf = 2.25; p.aRf = 2.25; p.aLo = 0.55; p.aRo = 0.55; p.eL = 2.25; p.eR = 2.25; p.aLt = 0.5; p.aRt = 0.5;
    p.lLf = 0.22; p.lRf = 0.22; p.kL = 0.35; p.kR = 0.35; p.fL = -0.13; p.fR = -0.13; p.lLo = 0.1; p.lRo = 0.1;
    p.hrz = 0.04 * S(t * 0.8);
    return p;
  };
}

// maç sonu: kupayı iki eliyle havaya kaldırıp zıplama
export function trophyLift() {
  const p = P();
  return (t) => {
    const j = S(t * 5.4);
    const up = Math.max(0, j), dn = Math.max(0, -j);
    p.hy = 0.2 * up;
    p.kL = 0.5 * dn + 0.12 * up; p.kR = 0.5 * dn + 0.3 * up;
    p.lLf = 0.28 * dn; p.lRf = 0.28 * dn + 0.15 * up; p.fL = -0.22 * dn + 0.45 * up; p.fR = -0.22 * dn + 0.45 * up;
    p.lLo = 0.13; p.lRo = 0.13;
    p.aLo = 3.42; p.aRo = 3.42; p.aLf = -0.1; p.aRf = -0.1;
    p.eL = 0.12 + 0.3 * dn; p.eR = 0.12 + 0.3 * dn;
    p.nx = -0.38; p.sx = -0.06 + 0.1 * dn;
    p.hry = 0.18 * S(t * 1.35); p.sz = 0.05 * S(t * 2.7);
    return p;
  };
}

// maç sonu: yere oturmuş, dizler karında, eller yüzde, hıçkırarak ağlama
export function sitCry() {
  const p = P();
  return (t) => {
    const sob = Math.pow(Math.max(0, S(t * 7.5)), 2) * (0.6 + 0.4 * S(t * 1.1));
    p.gnd = 0; p.hy = -0.705 + 0.008 * sob;
    p.lLf = 2.48; p.lRf = 2.52; p.kL = 2.04; p.kR = 2.08; p.fL = 0.44; p.fR = 0.44; p.lLo = 0.16; p.lRo = 0.16;
    p.sx = 0.5 + 0.05 * sob; p.sz = 0.02 * S(t * 15) * sob;
    p.nx = 0.5 + 0.06 * sob; p.ny = 0.05 * S(t * 0.9);
    p.aLf = 1.3; p.aRf = 1.3; p.aLo = 0.05; p.aRo = 0.05; p.aLt = -0.6; p.aRt = -0.6;
    p.eL = 2.35 - 0.05 * sob; p.eR = 2.35 - 0.05 * sob;
    return p;
  };
}

// baş önde, kollar sarkık
export function dejected() {
  const p = P();
  return (t) => {
    const sob = Math.max(0, S(t * 2.2)) * 0.04;
    p.sx = 0.42 + sob; p.nx = 0.7; p.ny = 0.3 * S(t * 1.3) * Math.max(0, S(t * 0.45));
    p.aLf = 0.3; p.aRf = 0.3; p.aLo = 0.06; p.aRo = 0.06; p.eL = 0.15; p.eR = 0.15;
    p.lLf = 0.2; p.lRf = 0.2; p.kL = 0.32; p.kR = 0.32; p.fL = -0.12; p.fR = -0.12; p.lLo = 0.08; p.lRo = 0.08;
    p.hrz = 0.03 * S(t * 0.7); p.sz = 0.04 * S(t * 0.7);
    return p;
  };
}

// omuzlar düşük, eller belde (gol yiyen kaleci / hafif hayal kırıklığı)
export function slump() {
  const p = P();
  return (t) => {
    Object.assign(p, STAND);
    p.sx = 0.25; p.nx = 0.5; p.ny = 0.15 * S(t * 1.6);
    p.aLo = 0.5; p.aRo = 0.5; p.eL = 1.3; p.eR = 1.3; p.aLt = -0.9; p.aRt = -0.9; p.aLf = -0.2; p.aRf = -0.2;
    return p;
  };
}

// ---- kaleci hamleleri (karakterin soluna = +x; sağ için mirror)
const DIVE_ANT = P({ lLf: 0.75, lRf: 0.75, kL: 1.25, kR: 1.25, fL: -0.5, fR: -0.5, lLo: 0.4, lRo: 0.3, sx: 0.4, sz: -0.12, aLf: 0.5, aRf: 0.5, aLo: 0.5, aRo: 0.5, eL: 0.8, eR: 0.8, nx: -0.25, hx: 0.1 });
const DIVE_PUSH = P({ gnd: 0, lLf: 0.25, kL: 0.5, lRf: 0.05, kR: 0.15, fR: 0.5, lRo: 0.1, sx: 0.1, sz: -0.1, aLo: 1.9, aRo: 1.4, aLf: 0.2, aRf: 0.4, eL: 0.4, eR: 0.7, nx: -0.15 });
const DIVE_REACH = P({ gnd: 0, aLo: 2.95, aRo: 2.7, aLf: 0.25, aRf: 0.3, eL: 0.06, eR: 0.3, lLf: -0.12, kL: 0.2, lLo: 0.1, lRf: 0.4, kR: 0.75, lRo: 0.12, fL: 0.6, fR: 0.5, nz: 0.2, nx: -0.1, sz: -0.08 });
const DIVE_LAND = P({ gnd: 0, aLo: 2.8, aRo: 2.3, aLf: 0.3, aRf: 0.55, eL: 0.35, eR: 0.7, lLf: 0.1, kL: 0.4, lRf: 0.55, kR: 1.0, lRo: 0.1, fL: 0.5, fR: 0.4, nz: 0.1, nx: 0.1 });
export const diveClip = clip([
  { t: -0.2, p: DIVE_ANT },
  { t: 0.0, p: DIVE_ANT },
  { t: 0.16, e: ease.in, p: DIVE_PUSH },
  { t: 0.5, e: ease.out, p: DIVE_REACH },
  { t: 0.62, p: DIVE_REACH },
  { t: 1.0, p: DIVE_LAND },
]);

// ortada kalma: gövdeyi büyüt
const SET = P({ lLf: 0.4, lRf: 0.4, kL: 0.65, kR: 0.65, fL: -0.25, fR: -0.25, lLo: 0.42, lRo: 0.42, sx: 0.18, aLo: 1.25, aRo: 1.25, aLf: 0.3, aRf: 0.3, eL: 0.5, eR: 0.5, nx: -0.15 });
const CATCH = P({ lLf: 0.3, lRf: 0.3, kL: 0.5, kR: 0.5, fL: -0.2, fR: -0.2, lLo: 0.25, lRo: 0.25, sx: 0.22, aLf: 1.05, aRf: 1.05, aLo: 0.05, aRo: 0.05, aLt: 0.35, aRt: 0.35, eL: 1.25, eR: 1.25, nx: 0.2 });
const HOLD = P({ lLo: 0.12, lRo: 0.12, sx: 0.05, aLf: 0.75, aRf: 0.75, aLo: 0.02, aRo: 0.02, aLt: 0.4, aRt: 0.4, eL: 1.7, eR: 1.7, nx: 0.05 });
export const stayClip = clip([{ t: -0.2, p: DIVE_ANT }, { t: 0.0, p: SET }, { t: 0.3, p: SET }]);
export const catchClip = clip([
  { t: -0.2, p: SET }, { t: 0.0, p: SET }, { t: 0.42, p: CATCH }, { t: 0.62, p: CATCH },
  { t: 1.1, p: HOLD }, { t: 9, p: HOLD },
]);
