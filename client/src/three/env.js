import * as THREE from 'three';

export const GOAL_W = 7.32, GOAL_H = 2.44, ZONE_W = GOAL_W / 3;
export const SPOT_Z = 11, BALL_R = 0.11;
const NET_TOP = 0.9, NET_BOTTOM = 2.0;
export const netBackZ = (y) => -(NET_TOP + (1 - Math.min(1, Math.max(0, y / GOAL_H))) * (NET_BOTTOM - NET_TOP));

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...opts.repeat); }
  t.anisotropy = opts.aniso ?? 8;
  return t;
}

function rnd(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ------------------------------------------------------------ top
export function makeBall() {
  const W = 1024, H = 512;
  const tex = canvasTex(W, H, (g) => {
    const phi = (1 + Math.sqrt(5)) / 2;
    const verts = [];
    for (const a of [-1, 1]) for (const b of [-phi, phi]) verts.push([0, a, b], [a, b, 0], [b, 0, a]);
    const V = verts.map((v) => new THREE.Vector3(...v).normalize());
    const ico = new THREE.IcosahedronGeometry(1, 0).attributes.position;
    const F = [];
    for (let i = 0; i < ico.count; i += 3) {
      F.push(new THREE.Vector3(
        ico.getX(i) + ico.getX(i + 1) + ico.getX(i + 2),
        ico.getY(i) + ico.getY(i + 1) + ico.getY(i + 2),
        ico.getZ(i) + ico.getZ(i + 1) + ico.getZ(i + 2)).normalize());
    }
    const img = g.createImageData(W, H);
    const d = img.data;
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let y = 0; y < H; y++) {
      const th = ((y + 0.5) / H) * Math.PI;
      const st = Math.sin(th), ct = Math.cos(th);
      for (let x = 0; x < W; x++) {
        const ph = ((x + 0.5) / W) * Math.PI * 2;
        const px = st * Math.cos(ph), py = ct, pz = st * Math.sin(ph);
        let dv = -1, f1 = -1, f2 = -1;
        for (const v of V) { const q = v.x * px + v.y * py + v.z * pz; if (q > dv) dv = q; }
        for (const f of F) { const q = f.x * px + f.y * py + f.z * pz; if (q > f1) { f2 = f1; f1 = q; } else if (q > f2) f2 = q; }
        const e = dv * 0.9742 - f1; // >0 beşgen
        const black = ss(-0.004, 0.004, e);
        const seam = Math.max(1 - ss(0.003, 0.008, Math.abs(e)), 1 - ss(0.003, 0.008, f1 - f2));
        let c = 244 - seam * 95;
        c = c * (1 - black) + 24 * black;
        const i = (y * W + x) * 4;
        d[i] = c; d[i + 1] = c; d[i + 2] = c + 3; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 40, 28),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0 })
  );
  ball.castShadow = true;
  return ball;
}

// ------------------------------------------------------------ saha + stadyum
export function buildEnvironment(scene) {
  const out = {};

  // gökyüzü
  scene.background = canvasTex(4, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#030712'); gr.addColorStop(0.45, '#0a1530'); gr.addColorStop(0.62, '#1b3160'); gr.addColorStop(1, '#1b3160');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0x12244a, 70, 190);

  // çim
  const grass = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2e9440'; g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#277f36'; g.fillRect(0, h / 2, w, h / 2);
    const r = rnd(7);
    for (let i = 0; i < 22000; i++) {
      const x = r() * w, y = r() * h, l = 2 + r() * 5;
      g.strokeStyle = r() > 0.5 ? 'rgba(190,255,170,.07)' : 'rgba(0,40,10,.09)';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 2, y - l); g.stroke();
    }
  }, { repeat: [15, 12], aniso: 16 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 120), new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 20);
  ground.receiveShadow = true;
  scene.add(ground);

  // çizgiler
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8f0e8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true });
  const lines = new THREE.Group();
  const line = (x1, z1, x2, z2, w = 0.12) => {
    const len = Math.hypot(x2 - x1, z2 - z1) + w;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 === x2 ? w : len, x1 === x2 ? len : w), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x1 + x2) / 2, 0.006, (z1 + z2) / 2);
    lines.add(m);
  };
  line(-34, 0, 34, 0);
  line(-20.16, 0, -20.16, 16.5); line(20.16, 0, 20.16, 16.5); line(-20.16, 16.5, 20.16, 16.5);
  line(-9.16, 0, -9.16, 5.5); line(9.16, 0, 9.16, 5.5); line(-9.16, 5.5, 9.16, 5.5);
  line(-34, 0, -34, 60); line(34, 0, 34, 60);
  const spot = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), lineMat);
  spot.rotation.x = -Math.PI / 2; spot.position.set(0, 0.006, SPOT_Z);
  lines.add(spot);
  const a0 = Math.acos(5.5 / 9.15);
  const arc = new THREE.Mesh(new THREE.RingGeometry(9.15 - 0.06, 9.15 + 0.06, 48, 1, -Math.PI / 2 - a0, a0 * 2), lineMat);
  arc.rotation.x = -Math.PI / 2; arc.position.set(0, 0.006, SPOT_Z);
  lines.add(arc);
  scene.add(lines);

  // ---- kale
  const goal = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.1 });
  const PR = 0.06;
  const tube = (ax, ay, az, bx, by, bz, r = PR, mat = postMat) => {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 14), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true;
    goal.add(m);
    return m;
  };
  const hw = GOAL_W / 2 + PR;
  tube(-hw, 0, 0, -hw, GOAL_H + PR, 0); tube(hw, 0, 0, hw, GOAL_H + PR, 0);
  tube(-hw - PR, GOAL_H + PR, 0, hw + PR, GOAL_H + PR, 0);
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(PR, 12, 10), postMat);
    c.position.set(s * hw, GOAL_H + PR, 0); goal.add(c);
  }
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.5 });
  for (const s of [-1, 1]) {
    tube(s * hw, GOAL_H, 0, s * hw, GOAL_H, -NET_TOP, 0.025, frameMat);
    tube(s * hw, GOAL_H, -NET_TOP, s * hw, 0, -NET_BOTTOM, 0.025, frameMat);
    tube(s * hw, 0.025, 0, s * hw, 0.025, -NET_BOTTOM, 0.025, frameMat);
  }
  tube(-hw, GOAL_H, -NET_TOP, hw, GOAL_H, -NET_TOP, 0.025, frameMat);
  tube(-hw, 0.025, -NET_BOTTOM, hw, 0.025, -NET_BOTTOM, 0.025, frameMat);

  const netTex = canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 5;
    g.strokeRect(0, 0, w, h);
  }, { repeat: [1, 1], aniso: 16 });
  const netMat = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
  const CELL = 0.13;
  const quad = (pts, uvs) => {
    const g = new THREE.BufferGeometry();
    const idx = pts.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat().map((v) => v / CELL), 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, netMat);
    m.renderOrder = 2;
    net.add(m);
  };
  const net = new THREE.Group();
  const slope = Math.hypot(GOAL_H, NET_BOTTOM - NET_TOP);
  quad([[-hw, GOAL_H, 0], [hw, GOAL_H, 0], [hw, GOAL_H, -NET_TOP], [-hw, GOAL_H, -NET_TOP]], [[0, 0], [hw * 2, 0], [hw * 2, NET_TOP], [0, NET_TOP]]);
  quad([[-hw, GOAL_H, -NET_TOP], [hw, GOAL_H, -NET_TOP], [hw, 0, -NET_BOTTOM], [-hw, 0, -NET_BOTTOM]], [[0, 0], [hw * 2, 0], [hw * 2, slope], [0, slope]]);
  for (const s of [-1, 1]) {
    quad([[s * hw, 0, 0], [s * hw, GOAL_H, 0], [s * hw, GOAL_H, -NET_TOP], [s * hw, 0, -NET_BOTTOM]], [[0, 0], [0, GOAL_H], [NET_TOP, GOAL_H], [NET_BOTTOM, 0]]);
  }
  goal.add(net);
  scene.add(goal);
  out.net = net;

  // ---- reklam panoları
  const adColors = [['#c8ff2e', '#07101f'], ['#07101f', '#c8ff2e'], ['#ffffff', '#0b3b8f'], ['#e11d48', '#ffffff'], ['#0ea5e9', '#06121f']];
  const adWords = ['PENALZO', 'PENALTY DUEL', 'PENALZO', 'PENALTY DUEL', 'PENALZO'];
  const adMats = adColors.map(([bg, fg], i) => new THREE.MeshBasicMaterial({
    map: canvasTex(512, 64, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = fg; g.font = 'italic 900 46px "Bebas Neue", Impact, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(adWords[i], w * 0.25, h / 2 + 3, w * 0.44); g.fillText(adWords[i], w * 0.75, h / 2 + 3, w * 0.44);
    }),
  }));
  out.adMats = adMats; out.adWords = adWords; out.adColors = adColors;
  const boards = new THREE.Group();
  for (let i = -9; i <= 9; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.9, 0.15), adMats[(i + 20) % adMats.length]);
    b.position.set(i * 4.5, 0.45, -6.5);
    boards.add(b);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(7.9, 1.0, 0.15), adMats[(i + 2) % adMats.length]);
    b.position.set(s * 40, 0.5, -2 + i * 8);
    b.rotation.y = -s * Math.PI / 2;
    boards.add(b);
  }
  scene.add(boards);

  // ---- tribünler
  const crowd = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#0c1424'; g.fillRect(0, 0, w, h);
    const r = rnd(42);
    const shirts = ['#e11d48', '#f8fafc', '#1d4ed8', '#facc15', '#16a34a', '#0f172a', '#f97316', '#94a3b8', '#e2e8f0', '#be123c'];
    const skins = ['#e8b48e', '#c98d62', '#8d5a3b', '#f1c9a5'];
    for (let row = 0; row < 16; row++) {
      const y = row * 16 + 4;
      g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(0, y + 13, w, 2);
      for (let x = 0; x < w; x += 10) {
        if (r() < 0.08) continue;
        const cx = x + 5 + (r() - 0.5) * 3;
        g.fillStyle = shirts[Math.floor(r() * shirts.length)];
        g.fillRect(cx - 4, y + 6, 8, 9);
        g.fillStyle = skins[Math.floor(r() * skins.length)];
        g.beginPath(); g.arc(cx, y + 3.5, 3, 0, 7); g.fill();
      }
    }
  }, { repeat: [14, 2.4], aniso: 4 });
  const crowdMat = new THREE.MeshBasicMaterial({ map: crowd, color: 0x9aa7bd });
  const stand = (w, x, z, ry) => {
    const g = new THREE.Group();
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, 30), crowdMat);
    s.rotation.x = -Math.PI / 2 + 0.6;
    s.position.set(0, 9.4, -12.3);
    g.add(s);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.2), new THREE.MeshBasicMaterial({ color: 0x0b1220 }));
    wall.position.set(0, 0.6, 0.05);
    g.add(wall);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, 16), new THREE.MeshBasicMaterial({ color: 0x070c18 }));
    roof.position.set(0, 21.5, -19);
    roof.rotation.x = 0.12;
    g.add(roof);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    scene.add(g);
  };
  stand(170, 0, -8.5, 0);
  stand(150, -42, 30, Math.PI / 2);
  stand(150, 42, 30, -Math.PI / 2);

  // ---- projektörler
  const glow = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(235,245,255,.75)');
    gr.addColorStop(0.5, 'rgba(180,210,255,.18)'); gr.addColorStop(1, 'rgba(160,200,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const glowMat = new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true });
  for (const [x, y, z] of [[-30, 27, -34], [30, 27, -34], [-58, 27, 6], [58, 27, 6]]) {
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(glowMat);
      s.position.set(x + (i - 2) * 2.2, y, z);
      s.scale.setScalar(9);
      scene.add(s);
    }
    const pole = new THREE.Mesh(new THREE.BoxGeometry(11, 2.2, 0.4), new THREE.MeshBasicMaterial({ color: 0x1f2937 }));
    pole.position.set(x, y, z - 0.5);
    scene.add(pole);
  }

  // ---- ışıklar
  scene.add(new THREE.HemisphereLight(0xc9dcff, 0x2f6b3a, 1.15));
  const key = new THREE.DirectionalLight(0xfff3dc, 2.5);
  key.position.set(-14, 30, 30);
  key.target.position.set(0, 0, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -11; sc.right = 11; sc.top = 14; sc.bottom = -12; sc.near = 5; sc.far = 90;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
  key.shadow.radius = 5;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xbcd4ff, 1.3);
  rim.position.set(18, 22, -24);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.75);
  fill.position.set(16, 12, 26);
  scene.add(fill);

  return out;
}
