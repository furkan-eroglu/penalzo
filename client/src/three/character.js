import * as THREE from 'three';
import { P, lerpPose, ease, clamp01, idle } from './anim.js';
import { buildHair, hairTexture, HAIR_NAMES } from './hair.js';

const SKIN = '#e2aa84';
const HIP_Y = 0.87;
const HEAD_R = 0.135;
const FONT = '"Bebas Neue", Impact, "Arial Narrow", sans-serif';

function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function grp(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
function limb(r, len, rBottom = r) {
  // üst ucu orijinde, aşağı doğru uzanan yuvarlak uçlu uzuv
  if (rBottom === r) {
    const g = new THREE.CapsuleGeometry(r, len, 6, 16);
    g.translate(0, -len / 2, 0);
    return g;
  }
  const pts = [];
  const n = 8;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r, r * Math.cos(a))); }
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * rBottom, -len - rBottom * Math.sin(a))); }
  return new THREE.LatheGeometry(pts.reverse(), 16);
}

// ---- gövde (forma) geometrisi
const PROFILE = [[-0.11, 0.188], [0, 0.178], [0.15, 0.174], [0.3, 0.188], [0.4, 0.203], [0.455, 0.203], [0.5, 0.168], [0.535, 0.112], [0.565, 0.068]];
const T_MIN = PROFILE[0][0], T_MAX = PROFILE[PROFILE.length - 1][0];
function radiusAt(y) {
  for (let i = 1; i < PROFILE.length; i++) {
    if (y <= PROFILE[i][0]) {
      const [y0, r0] = PROFILE[i - 1], [y1, r1] = PROFILE[i];
      const t = ease.io((y - y0) / (y1 - y0));
      return r0 + (r1 - r0) * t;
    }
  }
  return PROFILE[PROFILE.length - 1][1];
}
let torsoGeo;
function getTorsoGeo() {
  if (torsoGeo) return torsoGeo;
  const pts = [];
  const n = 30;
  for (let i = 0; i <= n; i++) { const y = T_MIN + (i / n) * (T_MAX - T_MIN); pts.push(new THREE.Vector2(radiusAt(y), y)); }
  torsoGeo = new THREE.LatheGeometry(pts, 44, Math.PI / 2, Math.PI * 2);
  return torsoGeo;
}

function luminance(hex) {
  const c = new THREE.Color(hex);
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}
function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

function drawJersey(canvas, color, name, number) {
  const W = canvas.width, H = canvas.height;
  const g = canvas.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  const dark = luminance(color) > 0.55;
  const ink = dark ? '#0f172a' : '#ffffff';
  const trim = dark ? 'rgba(15,23,42,.16)' : 'rgba(255,255,255,.2)';
  // kumaş dokusu
  g.globalAlpha = 0.05;
  g.fillStyle = dark ? '#000' : '#fff';
  for (let x = 0; x < W; x += 6) g.fillRect(x, 0, 2, H);
  g.globalAlpha = 1;
  // yan paneller (u=0 ve u=.5 yanlar)
  g.fillStyle = trim;
  g.fillRect(0, 0, 26, H * 0.82); g.fillRect(W - 26, 0, 26, H * 0.82);
  g.fillRect(W / 2 - 26, 0, 52, H * 0.82);
  // yaka ve etek
  g.fillStyle = dark ? 'rgba(15,23,42,.55)' : 'rgba(255,255,255,.75)';
  g.fillRect(0, 0, W, 16);
  g.fillStyle = trim;
  g.fillRect(0, H - 14, W, 14);
  // alt gölge
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.2)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);

  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const bx = W * 0.25, fx = W * 0.75;
  // sırt: isim + numara
  g.font = `78px ${FONT}`;
  g.fillText(String(name || '').toLocaleUpperCase('tr'), bx, H * (1 - 0.76), 240);
  g.font = `232px ${FONT}`;
  g.fillText(String(number), bx, H * (1 - 0.47) + 8, 250);
  // göğüs: küçük numara
  g.font = `84px ${FONT}`;
  g.fillText(String(number), fx, H * (1 - 0.66));
}

export { HAIR_NAMES };

export class Character {
  constructor() {
    this.root = new THREE.Group();
    this.cur = P();
    this._from = P();
    this._fn = idle(Math.random() * 10);
    this._t = 0;
    this._blend = 0;
    this._hairStyle = -1;
    this._sig = '';

    const std = (color, rough = 0.75, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 512;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.wrapS = THREE.RepeatWrapping;
    this.tex.anisotropy = 8;
    const m = (this.m = {
      skin: std(SKIN, 0.62),
      jersey: std('#ffffff', 0.82, { map: this.tex }),
      cloth: std('#e11d2e', 0.82),
      shorts: std('#ffffff', 0.8),
      sock: std('#e11d2e', 0.85),
      boot: std('#111827', 0.35),
      sole: std('#1b1b1f', 0.6),
      hair: std('#2a1a12', 0.62, { map: hairTexture(), bumpMap: hairTexture(), bumpScale: 1.2, side: THREE.DoubleSide }),
      buzz: std('#7a5a48', 0.85, { map: hairTexture() }),
      glove: std('#22c55e', 0.55),
      gloveTrim: std('#f8fafc', 0.55),
      brow: std('#2a1a12', 0.9),
      dark: std('#14161c', 0.4),
      white: std('#f8fafc', 0.4),
    });

    const hips = (this.hips = grp(this.root, 0, HIP_Y, 0));
    const sp = [];
    // şort gövdesi: belde oval, aşağı doğru bacak arası vadiye incelip kaybolur (çıkıntı/kapak yok)
    for (const [r, y] of [[0.135, 0.03], [0.152, -0.02], [0.17, -0.06], [0.184, -0.1], [0.19, -0.14], [0.19, -0.19]]) sp.push(new THREE.Vector2(r, y));
    sp.push(new THREE.Vector2(0.16, -0.225), new THREE.Vector2(0.09, -0.245), new THREE.Vector2(0, -0.25));
    const pg = new THREE.LatheGeometry(sp.reverse(), 48);
    const pp = pg.attributes.position;
    const sstep = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      const w = sstep(-0.05, -0.2, y); // 0 belde, 1 en altta
      const zs = 0.6 - 0.36 * w, xs = 1.04 - 0.16 * w;
      pp.setXYZ(i, x * xs, y, z * zs);
    }
    pg.computeVertexNormals();
    add(hips, pg, m.shorts);

    const waist = add(hips, new THREE.SphereGeometry(1, 20, 14), m.shorts, 0, 0.02, 0);
    waist.scale.set(0.15, 0.07, 0.1);
    const spine = (this.spine = grp(hips, 0, 0.05, 0));
    const torso = add(spine, getTorsoGeo(), m.jersey);
    torso.scale.set(1, 1, 0.64);
    add(spine, new THREE.CylinderGeometry(0.052, 0.06, 0.1, 16), m.skin, 0, 0.59, 0);

    // baş
    const head = (this.head = grp(spine, 0, 0.725, 0));
    head.scale.setScalar(1.12);
    const skull = add(head, new THREE.SphereGeometry(HEAD_R, 32, 24), m.skin);
    skull.scale.set(0.93, 1.06, 0.98);
    for (const s of [1, -1]) {
      const ear = add(head, new THREE.SphereGeometry(0.026, 12, 10), m.skin, s * 0.124, -0.005, -0.005);
      ear.scale.set(0.5, 1, 0.75);
      const ew = add(head, new THREE.SphereGeometry(0.021, 14, 10), m.white, s * 0.046, 0.012, 0.112);
      ew.scale.set(1, 1.15, 0.5);
      const eye = add(head, new THREE.SphereGeometry(0.0125, 12, 10), m.dark, s * 0.046, 0.01, 0.122);
      eye.scale.set(1, 1.2, 0.5);
      const brow = add(head, new THREE.BoxGeometry(0.042, 0.009, 0.012), m.brow, s * 0.047, 0.05, 0.119);
      brow.rotation.z = -s * 0.12;
    }
    const nose = add(head, new THREE.SphereGeometry(0.016, 12, 10), m.skin, 0, -0.022, 0.13);
    nose.scale.set(0.9, 1.2, 1);
    const mouth = add(head, new THREE.TorusGeometry(0.026, 0.0048, 6, 14, Math.PI * 0.8), m.dark, 0, -0.05, 0.116);
    mouth.rotation.set(0.25, 0, Math.PI + Math.PI * 0.1);
    this.hairSlot = grp(head);

    // kollar
    const arm = (s) => {
      const sh = grp(spine, s * 0.228, 0.455, 0);
      add(sh, new THREE.SphereGeometry(0.074, 16, 12), m.cloth, -s * 0.012, -0.005, 0);
      add(sh, limb(0.07, 0.17, 0.066), m.cloth);
      const upper = add(sh, limb(0.052, 0.28, 0.045), m.skin);
      const el = grp(sh, 0, -0.28, 0);
      const fore = add(el, limb(0.046, 0.25, 0.037), m.skin);
      const hand = add(el, new THREE.SphereGeometry(0.05, 14, 12), m.skin, 0, -0.29, 0);
      hand.scale.set(0.82, 1.25, 0.62);
      const glove = grp(el, 0, -0.25, 0);
      const palm = add(glove, new THREE.SphereGeometry(0.072, 16, 12), m.glove, 0, -0.065, 0);
      palm.scale.set(0.95, 1.3, 0.55);
      const thumb = add(glove, new THREE.SphereGeometry(0.028, 10, 8), m.glove, s * -0.06, -0.035, 0.012);
      thumb.scale.set(0.8, 1.5, 0.8);
      add(glove, new THREE.CylinderGeometry(0.047, 0.043, 0.055, 14), m.gloveTrim, 0, 0.015, 0);
      const grip = grp(el, 0, -0.33, 0);
      return { sh, el, upper, fore, hand, glove, grip };
    };
    this.aL = arm(1); this.aR = arm(-1);

    // bacaklar
    this.soles = [];
    const leg = (s) => {
      const hp = grp(hips, s * 0.095, -0.02, 0);
      add(hp, limb(0.1, 0.172, 0.106), m.shorts, 0, -0.11, 0);
      add(hp, limb(0.08, 0.26, 0.064), m.skin, 0, -0.14, 0);
      const kn = grp(hp, 0, -0.4, 0);
      add(kn, limb(0.062, 0.38, 0.047), m.sock);
      const calf = add(kn, new THREE.SphereGeometry(0.062, 14, 12), m.sock, 0, -0.13, -0.014);
      calf.scale.set(1, 1.9, 1);
      const an = grp(kn, 0, -0.38, 0);
      const boot = add(an, new THREE.CapsuleGeometry(0.054, 0.16, 6, 14), m.boot, 0, -0.042, 0.06);
      boot.rotation.x = Math.PI / 2;
      boot.scale.set(1, 1, 0.82);
      const sole = add(an, new THREE.BoxGeometry(0.084, 0.014, 0.235), m.sole, 0, -0.083, 0.06);
      sole.castShadow = false;
      for (const z of [0.17, -0.06]) this.soles.push(grp(an, 0, -0.09, z));
      return { hp, kn, an };
    };
    this.lL = leg(1); this.lR = leg(-1);
    this._v = new THREE.Vector3();
    this.apply(this._fn(0));
  }

  setLook(look, kit = 'player', name = '') {
    const k = look[kit];
    const sig = JSON.stringify([look, kit, name]);
    if (sig === this._sig) return;
    this._sig = sig;
    const m = this.m;
    const keeper = kit === 'keeper';
    m.cloth.color.set(k.jersey);
    m.shorts.color.set(k.shorts);
    m.sock.color.set(k.socks);
    m.boot.color.set(k.boots);
    m.sole.color.set(luminance(k.boots) < 0.25 ? '#6b7280' : '#1b1b1f');
    m.hair.color.set(look.hairColor);
    m.brow.color.set(look.hairColor).multiplyScalar(0.8);
    m.buzz.color.set(SKIN).lerp(new THREE.Color(look.hairColor), 0.55);
    m.glove.color.set(look.keeper.gloves);
    m.gloveTrim.color.set(luminance(look.keeper.gloves) > 0.7 ? '#111827' : '#f8fafc');
    for (const a of [this.aL, this.aR]) {
      a.glove.visible = keeper;
      a.hand.visible = !keeper;
      a.fore.material = keeper ? m.cloth : m.skin; // kaleci uzun kollu
      a.upper.material = keeper ? m.cloth : m.skin;
    }
    this._jersey = [k.jersey, name, look.number];
    drawJersey(this.canvas, ...this._jersey);
    this.tex.needsUpdate = true;
    if (look.hair !== this._hairStyle) {
      this._hairStyle = look.hair;
      this.hairSlot.clear();
      this.hairSlot.add(buildHair(look.hair, m.hair, m.buzz));
    }
  }

  redraw() { // yazı tipi yüklenince
    if (!this._jersey) return;
    drawJersey(this.canvas, ...this._jersey);
    this.tex.needsUpdate = true;
  }

  play(fn, blend = 0.2) {
    Object.assign(this._from, this.cur);
    this._fn = fn;
    this._t = 0;
    this._b = 0;
    this._blend = blend;
  }

  // zaman dışarıdan veriliyorsa (koreografi)
  setTime(t) { this._t = t; }

  update(dt, advance = true) {
    if (advance) this._t += dt;
    this._bt = (this._bt || 0) + dt;
    const target = this._fn(this._t);
    if (this._blend > 0) {
      this._b = (this._b ?? 0) + dt;
      const w = ease.io(clamp01(this._b / this._blend));
      lerpPose(this._from, target, w, this.cur);
      if (w >= 1) { this._blend = 0; this._b = 0; }
    } else {
      this._b = 0;
      Object.assign(this.cur, target);
    }
    this.apply(this.cur);
  }

  apply(p) {
    const h = this.hips;
    h.position.set(p.hx, HIP_Y + p.hy, p.hz);
    h.rotation.set(p.hrx, p.hry, p.hrz);
    this.spine.rotation.set(p.sx, p.sy, p.sz);
    this.head.rotation.set(p.nx, p.ny, p.nz);
    this.aL.sh.rotation.set(-p.aLf, p.aLt, p.aLo);
    this.aR.sh.rotation.set(-p.aRf, -p.aRt, -p.aRo);
    this.aL.el.rotation.x = -p.eL;
    this.aR.el.rotation.x = -p.eR;
    this.lL.hp.rotation.set(-p.lLf, p.lLt, p.lLo);
    this.lR.hp.rotation.set(-p.lRf, -p.lRt, -p.lRo);
    this.lL.kn.rotation.x = p.kL;
    this.lR.kn.rotation.x = p.kR;
    this.lL.an.rotation.x = p.fL;
    this.lR.an.rotation.x = p.fR;
    if (p.gnd > 0.001) {
      this.root.updateMatrixWorld(true);
      let min = Infinity;
      for (const s of this.soles) {
        s.getWorldPosition(this._v);
        this.root.worldToLocal(this._v);
        if (this._v.y < min) min = this._v.y;
      }
      h.position.y -= min * p.gnd;
    }
  }

  // eldivenlerin orta noktası (dünya koordinatı)
  handsMid(out) {
    this.root.updateMatrixWorld(true);
    this.aL.grip.getWorldPosition(out);
    this.aR.grip.getWorldPosition(this._v);
    return out.add(this._v).multiplyScalar(0.5);
  }
}
