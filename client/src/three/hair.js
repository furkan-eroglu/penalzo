import * as THREE from 'three';

// Saçlar: kafatasını saran, saç çizgisi (alın, şakak, favori, kulak arkası, ense)
// olan ve tel dokulu bir kabuk üzerine kurulu. Stil = kalınlık fonksiyonu + ek parçalar.
export const HAIR_NAMES = ['Kısa', 'Sıfır', 'Yana Taralı', 'Dikenli', 'Mohawk', 'Afro', 'Topuz', 'Uzun', 'At Kuyruğu', 'Kıvırcık'];

const R = 0.135;
const SK = [0.93 * R, 1.06 * R, 0.98 * R];
const skullR = (x, y, z) => 1 / Math.sqrt((x / SK[0]) ** 2 + (y / SK[1]) ** 2 + (z / SK[2]) ** 2);
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, w) => Math.exp(-((x / w) ** 2));
const hash = (i, j, k) => { const h = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return h - Math.floor(h); };
// yumuşak 3B değer gürültüsü, -1..1
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = ss(0, 1, x - xi), v = ss(0, 1, y - yi), w = ss(0, 1, z - zi);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}

// saç çizgisi: |azimut| (0 = ön, π = arka) -> yükseklik açısı
const HL = [[0, 0.66], [0.45, 0.63], [0.82, 0.5], [1.12, -0.12], [1.36, 0.1], [1.66, 0.14], [1.95, -0.38], [Math.PI, -0.5]];
function hairline(a) {
  a = Math.abs(a);
  for (let i = 1; i < HL.length; i++) {
    if (a <= HL[i][0]) return HL[i - 1][1] + (HL[i][1] - HL[i - 1][1]) * ss(HL[i - 1][0], HL[i][0], a);
  }
  return HL[HL.length - 1][1];
}

let strandTex;
export function hairTexture() {
  if (strandTex) return strandTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d2d2d2';
  g.fillRect(0, 0, 256, 256);
  let s = 11;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 900; i++) {
    const x = r() * 256, v = Math.floor(150 + r() * 105);
    g.strokeStyle = `rgba(${v},${v},${v},${0.35 + r() * 0.5})`;
    g.lineWidth = 0.5 + r() * 1.3;
    g.beginPath();
    g.moveTo(x, -4);
    g.bezierCurveTo(x + (r() - 0.5) * 9, 80, x + (r() - 0.5) * 9, 170, x + (r() - 0.5) * 5, 260);
    g.stroke();
  }
  strandTex = new THREE.CanvasTexture(c);
  strandTex.colorSpace = THREE.SRGBColorSpace;
  strandTex.wrapS = strandTex.wrapT = THREE.RepeatWrapping;
  strandTex.anisotropy = 8;
  return strandTex;
}

// thick(a, e, x, y, z) -> metre; a azimut, e yükseklik açısı, (x,y,z) birim yön
function shell(thick, mat, o = {}) {
  const [sw, sh] = o.seg || [72, 46];
  const g = new THREE.SphereGeometry(1, sw, sh);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(x, z);
    let e = Math.asin(Math.max(-1, Math.min(1, y)));
    const h = hairline(a) + (o.lift || 0);
    const m = e - h;
    if (m < 0) { // saç çizgisinin altı: kenara topla (pürüzsüz kenar)
      e = h;
      const ce = Math.cos(e);
      x = Math.sin(a) * ce; y = Math.sin(e); z = Math.cos(a) * ce;
    }
    const rs = skullR(x, y, z);
    const t = Math.max(0, thick(a, e, x, y, z)) * ss(0, o.edge ?? 0.2, Math.max(0, m));
    const r = o.sink ? rs - 0.005 + t : rs + 0.0025 + t; // sink: ince yerler kafa derisinin altında kalır
    pos.setXYZ(i, x * r, y * r, z * r);
    uv.setXY(i, uv.getX(i) * (o.uRep || 10), uv.getY(i) * (o.vRep || 2.5));
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  return mesh;
}

function part(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// uca doğru incelen, eğri boyunca giden tutam
function lock(points, radius, profile, mat) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const T = 28, RS = 12;
  const g = new THREE.TubeGeometry(curve, T, radius, RS, false);
  const pos = g.attributes.position, uv = g.attributes.uv;
  const c = new THREE.Vector3();
  for (let i = 0; i <= T; i++) {
    curve.getPointAt(i / T, c);
    const f = profile(i / T);
    for (let j = 0; j <= RS; j++) {
      const k = i * (RS + 1) + j;
      pos.setXYZ(k, c.x + (pos.getX(k) - c.x) * f, c.y + (pos.getY(k) - c.y) * f, c.z + (pos.getZ(k) - c.z) * f);
      uv.setXY(k, (j / RS) * 2, (i / T) * 1.5);
    }
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

// omuzlara inen uzun saç perdesi
function curtain(mat) {
  const A0 = 0.98, COLS = 44, ROWS = 12;
  const P = [], UV = [], I = [];
  for (let c = 0; c <= COLS; c++) {
    const s = c / COLS;
    const a = A0 + s * (Math.PI * 2 - A0 * 2); // yanlardan arkaya dolanır
    const aa = a > Math.PI ? a - Math.PI * 2 : a;
    const e0 = Math.max(hairline(aa), -0.12) + 0.2;
    const dx = Math.sin(a) * Math.cos(e0), dy = Math.sin(e0), dz = Math.cos(a) * Math.cos(e0);
    const r0 = skullR(dx, dy, dz) + 0.014;
    const back = 0.5 - 0.5 * Math.cos(s * Math.PI * 2); // 0 önde, 1 tam arkada
    const end = -0.13 - 0.1 * back;
    const side = ss(0, 0.1, s) * ss(0, 0.1, 1 - s);
    for (let j = 0; j <= ROWS; j++) {
      const k = j / ROWS;
      const y = dy * r0 + (end - dy * r0) * k * (0.45 + 0.55 * side);
      const top = Math.hypot(dx, dz) * r0;
      const rr = top + (0.118 + 0.012 * back - top) * ss(0, 0.5, k) + 0.006 * Math.sin(s * 34 + k * 3) * k - 0.02 * k * k * (1 - side);
      P.push(Math.sin(a) * rr * 0.96, y, Math.cos(a) * rr - 0.012 * k);
      UV.push(s * 7, k * 1.4);
      if (c < COLS && j < ROWS) {
        const p = c * (ROWS + 1) + j, q = p + ROWS + 1;
        I.push(p, q, p + 1, p + 1, q, q + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

const top = (e) => ss(0.15, 1.15, e);

export function buildHair(style, mat, buzzMat) {
  const g = new THREE.Group();
  switch (style) {
    case 0: // kısa, yanlar daha kısa, üst dokulu
      g.add(shell((a, e, x, y, z) => 0.007 + 0.024 * top(e) + 0.012 * gauss(a, 0.75) * ss(0.35, 0.75, e) + 0.004 * noise(x * 16, y * 16, z * 16) * top(e), mat));
      break;
    case 1: // sıfır
      g.add(shell(() => 0.002, buzzMat, { uRep: 10, vRep: 3 }));
      break;
    case 2: // yana taralı: sağda ayrım çizgisi, önde kabarık perçem
      g.add(shell((a, e) => {
        const sweep = 0.55 + 0.45 * ss(-0.95, 0.5, a);
        const quiff = 0.034 * gauss(a - 0.2, 0.55) * gauss(e - 0.72, 0.3);
        const groove = 1 - 0.8 * gauss(a + 0.62, 0.09) * ss(0.45, 0.8, e);
        return (0.008 + 0.03 * top(e) * sweep + quiff) * groove;
      }, mat));
      break;
    case 3: { // dikenli
      g.add(shell((a, e) => 0.008 + 0.018 * top(e), mat));
      const up = new THREE.Vector3(0, 1, 0);
      let s = 5;
      const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < 58; i++) {
        const k = (i + 0.5) / 58;
        const th = Math.acos(1 - k * 0.8), ph = i * 2.39996;
        const d = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph) - 0.12).normalize();
        const a = Math.atan2(d.x, d.z), e = Math.asin(d.y);
        if (e - hairline(a) < 0.16) continue;
        const h = 0.05 + r() * 0.035;
        const rs = skullR(d.x, d.y, d.z) + 0.012;
        const tip = d.clone().add(new THREE.Vector3((r() - 0.5) * 0.5, 0.25, 0.3 + (r() - 0.5) * 0.4)).normalize();
        const sp = part(new THREE.ConeGeometry(0.019, h, 7), mat, d.x * rs + tip.x * h * 0.42, d.y * rs + tip.y * h * 0.42, d.z * rs + tip.z * h * 0.42);
        sp.quaternion.setFromUnitVectors(up, tip);
        g.add(sp);
      }
      break;
    }
    case 4: // mohawk: yanlar sıfır, ortada şerit
      g.add(shell(() => 0.002, buzzMat, { uRep: 10, vRep: 3 }));
      g.add(shell((a, e, x, y, z) => 0.052 * gauss(x, 0.14) * (0.86 + 0.14 * Math.abs(Math.sin(Math.atan2(y, z) * 9))) * ss(-0.75, -0.2, e + (z > 0 ? 0.6 : 0)), mat, { sink: true, seg: [96, 56], edge: 0.12 }));
      break;
    case 5: // afro
      g.add(shell((a, e, x, y, z) => {
        const lump = noise(x * 9, y * 9, z * 9) + 0.5 * noise(x * 19, y * 19, z * 19);
        const face = 1 - 0.55 * gauss(a, 0.85) * (1 - ss(0.55, 0.95, e));
        return 0.088 * (0.72 + 0.28 * ss(-0.5, 0.6, e)) * face * (1 + 0.17 * lump);
      }, mat, { seg: [96, 60], edge: 0.3, uRep: 14, vRep: 6 }));
      break;
    case 6: { // topuz
      g.add(shell((a, e) => 0.006 + 0.004 * top(e), mat, { uRep: 8 }));
      const bun = part(new THREE.SphereGeometry(0.052, 20, 14), mat, 0, R * 1.0, -R * 0.66);
      bun.scale.set(1, 0.9, 1);
      g.add(bun);
      const band = part(new THREE.TorusGeometry(0.03, 0.007, 8, 18), mat, 0, R * 0.86, -R * 0.52);
      band.rotation.x = 0.95;
      g.add(band);
      break;
    }
    case 7: // uzun
      g.add(shell((a, e) => 0.011 + 0.018 * top(e) + 0.006 * gauss(a, 0.9) * ss(0.3, 0.7, e), mat));
      g.add(curtain(mat));
      break;
    case 8: { // at kuyruğu
      g.add(shell((a, e) => 0.006 + 0.005 * top(e), mat, { uRep: 8 }));
      g.add(lock([[0, 0.075, -0.118], [0, 0.085, -0.175], [0, 0.03, -0.222], [0, -0.07, -0.215], [0, -0.16, -0.19]], 0.036, (u) => 0.55 + 0.75 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5) - 0.95 * u * u, mat));
      const band = part(new THREE.TorusGeometry(0.024, 0.008, 8, 16), mat, 0, 0.08, -0.14);
      g.add(band);
      break;
    }
    default: // kıvırcık
      g.add(shell((a, e, x, y, z) => {
        const curl = noise(x * 24, y * 24, z * 24) + 0.6 * noise(x * 41 + 3, y * 41, z * 41);
        return (0.024 + 0.016 * top(e)) * (1 + 0.5 * curl);
      }, mat, { seg: [110, 70], edge: 0.16, uRep: 16, vRep: 8 }));
  }
  return g;
}
