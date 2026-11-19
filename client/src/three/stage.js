import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Character } from './character.js';
import { buildEnvironment, makeBall, GOAL_H, ZONE_W, SPOT_Z, BALL_R, netBackZ } from './env.js';
import * as A from './anim.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const SOLO_Z = 6.5;
const CAMS = {
  menu: { pos: [0, 1.25, SOLO_Z + 4.1], tgt: [0, 0.95, SOLO_Z], fov: 34, halfW: 0.95, dist: 4.1 },
  editor: { pos: [0, 1.3, SOLO_Z + 4.9], tgt: [0, 0.36, SOLO_Z], fov: 34, halfW: 0.9, dist: 4.9 },
  room: { pos: [0, 1.3, SOLO_Z + 5.2], tgt: [0, 0.85, SOLO_Z], fov: 34, halfW: 1.4, dist: 5.2 },
  end: { pos: [0, 1.3, SOLO_Z + 5.0], tgt: [0, 0.95, SOLO_Z], fov: 34, halfW: 1.4, dist: 5.0 },
  match: { pos: [0, 4.7, 19.2], tgt: [0, 0.9, 6], fov: 30, halfW: 4.7, dist: 19.2 },
};

const SH_START = V3(-0.85, 0, 13.2), SH_PLANT = V3(-0.13, 0, 11.2);
const SH_HEAD0 = Math.atan2(SH_PLANT.x - SH_START.x, SH_PLANT.z - SH_START.z);
const T_WAIT = 0.55, T_RUN = 1.0, T_PLANT = T_WAIT + T_RUN, T_HIT = T_PLANT + A.KICK_HIT, FLY = 0.56, T_ARR = T_HIT + FLY;

export class Stage {
  constructor(canvas) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.12;

    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);
    this.env = buildEnvironment(this.scene);

    this.ball = makeBall();
    this.scene.add(this.ball);
    this.ballV = V3(0, 0, 0);
    this.ballMode = 'still';

    this.chars = [new Character(), new Character()];
    for (const c of this.chars) this.scene.add(c.root);

    // kale bölgeleri
    this.zones = [];
    this.zoneGroup = new THREE.Group();
    for (const z of [-1, 0, 1]) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(ZONE_W - 0.1, GOAL_H - 0.08),
        new THREE.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0, depthWrite: false, fog: false })
      );
      m.position.set(z * ZONE_W, GOAL_H / 2, 0.03);
      m.userData.zone = z;
      m.renderOrder = 3;
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(m.geometry),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false })
      );
      edge.renderOrder = 4;
      m.add(edge);
      this.zoneGroup.add(m);
      this.zones.push(m);
    }
    this.scene.add(this.zoneGroup);
    this.zonesOn = false;
    this.selected = null;
    this.ray = new THREE.Raycaster();

    this._buildConfetti();
    this._buildTrophy();

    this.mode = 'menu';
    this.camPos = V3(...CAMS.menu.pos);
    this.camTgt = V3(...CAMS.menu.tgt);
    this.soloRot = 0; this.soloRotTarget = 0;
    this.shake = 0;
    this.kick = null;
    this.time = 0;
    this._tmp = V3(0, 0, 0); this._tmp2 = V3(0, 0, 0);
    this._last = performance.now();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this._layout();
    this._cam(true);
    r.setAnimationLoop((now) => this._tick(now));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this._fov();
  }

  _fov() {
    const c = CAMS[this.mode];
    const need = 2 * Math.atan(c.halfW / c.dist / this.camera.aspect) * 180 / Math.PI;
    this.fovTarget = Math.min(82, Math.max(c.fov, need));
  }

  _cam(snap) {
    const c = CAMS[this.mode];
    this.goalPos = V3(...c.pos); this.goalTgt = V3(...c.tgt);
    this._fov();
    if (snap) {
      this.camPos.copy(this.goalPos); this.camTgt.copy(this.goalTgt);
      this.camera.fov = this.fovTarget;
      this.camera.updateProjectionMatrix();
    }
  }

  setMode(mode, snap = true) {
    this.mode = mode;
    this.kick = null;
    this.confetti.visible = mode === 'end';
    this.trophy.visible = mode === 'end';
    this.tears.visible = mode === 'end';
    this.showZones(false);
    this.env.net.scale.z = 1;
    this._layout();
    this._cam(snap);
  }

  _layout() {
    const [a, b] = this.chars;
    const m = this.mode;
    if (m === 'menu' || m === 'editor') {
      a.root.visible = true; b.root.visible = false;
      a.root.position.set(0, 0, SOLO_Z); a.root.rotation.set(0, this.soloRot, 0);
      this._ballStill(0.48, SOLO_Z + 0.2);
    } else if (m === 'room' || m === 'end') {
      a.root.position.set(-0.56, 0, SOLO_Z); a.root.rotation.set(0, 0.22, 0);
      b.root.position.set(0.56, 0, SOLO_Z); b.root.rotation.set(0, -0.22, 0);
      this._ballStill(0, SOLO_Z + 0.55);
    }
  }

  _ballStill(x, z) {
    this.ballMode = 'still';
    this.ball.visible = true;
    this.ball.position.set(x, BALL_R, z);
    this.ballV.set(0, 0, 0);
  }

  // ------------------------------------------------ menü / düzenleme
  setSolo(look, kit, name) {
    const c = this.chars[0];
    c.setLook(look, kit, name);
    if (!this._soloIdle) { c.play(A.idle(), 0.25); this._soloIdle = true; }
  }
  rotateSolo(d) { this.soloRotTarget += d; }
  faceSolo(back) {
    const turns = Math.round(this.soloRotTarget / (Math.PI * 2));
    this.soloRotTarget = turns * Math.PI * 2 + (back ? Math.PI : 0);
  }

  // ------------------------------------------------ oda
  setPair(a, b) {
    const [c0, c1] = this.chars;
    this._soloIdle = false;
    c0.root.visible = !!a; c1.root.visible = !!b;
    if (a) { c0.setLook(a.look, 'player', a.name); if (this._pairA !== a.id) c0.play(A.idle(1), 0.2); }
    if (b) { c1.setLook(b.look, 'player', b.name); if (this._pairB !== b.id) c1.play(A.idle(4), 0.2); }
    this._pairA = a?.id; this._pairB = b?.id;
  }

  // ------------------------------------------------ maç
  matchSetup(shooter, keeper) {
    const [sh, kp] = this.chars;
    this._soloIdle = false; this._pairA = this._pairB = null;
    this.kick = null;
    sh.root.visible = kp.root.visible = true;
    sh.setLook(shooter.look, 'player', shooter.name);
    kp.setLook(keeper.look, 'keeper', keeper.name);
    sh.root.position.copy(SH_START); sh.root.rotation.set(0, SH_HEAD0, 0);
    kp.root.position.set(0, 0, 0.35); kp.root.rotation.set(0, 0, 0);
    sh.play(A.shooterReady(), 0);
    kp.play(A.keeperReady(), 0);
    this._ballStill(0, SPOT_Z);
    this.ball.rotation.set(0.4, 0.3, 0);
    this.env.net.scale.z = 1;
    this.selectZone(null);
    this._cam(true);
  }

  showZones(v) { this.zonesOn = v; if (!v) this.selected = null; }
  selectZone(z) { this.selected = z; }

  pickZone(clientX, clientY) {
    if (!this.zonesOn) return null;
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.intersectObjects(this.zones, false)[0];
    return hit ? hit.object.userData.zone : null;
  }

  playKick(o) {
    this.kick = { ...o, t: 0, phase: -Math.PI * 2.5 };
  }

  _updateKick(dt) {
    const k = this.kick;
    const [sh, kp] = this.chars;
    k.t += dt;
    const t = k.t;

    // ---- şutör
    if (!k.running && t >= T_WAIT) {
      k.running = true;
      sh.play(A.run(() => k.phase), 0.14);
    }
    if (k.running && !k.planted) {
      const u = A.clamp01((t - T_WAIT) / T_RUN);
      const e = Math.pow(u, 1.35);
      k.phase = Math.PI / 2 - Math.PI * 2 * 1.5 * (1 - e);
      sh.root.position.lerpVectors(SH_START, SH_PLANT, e);
      sh.root.rotation.y = SH_HEAD0 + (Math.PI - SH_HEAD0) * A.ease.io(A.clamp01((u - 0.55) / 0.45));
      if (t >= T_PLANT) {
        k.planted = true;
        sh.root.position.copy(SH_PLANT); sh.root.rotation.y = Math.PI;
        sh.play(A.kick, 0.06);
      }
    }
    if (k.planted && t < T_PLANT + 0.5) sh.root.position.z = SH_PLANT.z - 0.22 * A.ease.out((t - T_PLANT) / 0.5);

    // ---- kaleci
    const tau = t - T_HIT;
    if (!k.kpStarted && tau >= -0.2) {
      k.kpStarted = true;
      const base = k.dive === 0 ? (k.shot === 0 ? A.catchClip : A.stayClip) : A.diveClip;
      const fn = k.dive < 0 ? (tt) => A.mirror(base(tt - 0.2)) : (tt) => base(tt - 0.2);
      kp.play(fn, 0.14);
    }
    if (k.dive !== 0 && tau >= 0) {
      const d = k.dive;
      kp.root.position.x = d * A.kf(tau, [[0, 0], [0.16, 0.22], [0.5, 0.98], [1.0, 1.72], [1.5, 1.95]], A.ease.lin);
      kp.root.position.y = A.kf(tau, [[0, 0], [0.16, 0.1], [0.42, 0.55], [0.6, 0.56], [1.0, 0.2]]);
      kp.root.rotation.z = -d * A.kf(tau, [[0, 0], [0.16, 0.3], [0.5, 1.18], [1.0, 1.5], [1.35, 1.57]]);
    }

    // ---- top
    if (!k.hit && t >= T_HIT) {
      k.hit = true;
      this.ballMode = 'fly';
      k.from = this.ball.position.clone();
      k.to = k.goal
        ? V3(k.shot * ZONE_W + (k.rx - 0.5) * 1.5, 0.45 + k.ry * 1.55, -0.1)
        : V3(k.dive * 2.9, 1.25, 0.45);
      if (k.goal && k.shot === 0) k.to.x = (k.rx - 0.5) * 1.2;
      k.onContact?.();
    }
    if (this.ballMode === 'fly') {
      const u = A.clamp01((t - T_HIT) / FLY);
      const tgt = this._tmp.copy(k.to);
      if (!k.goal) tgt.lerp(kp.handsMid(this._tmp2), A.ease.io(u));
      this.ball.position.lerpVectors(k.from, tgt, u);
      this.ball.position.y += (0.3 + k.to.y * 0.12) * 4 * u * (1 - u);
      this.ball.rotation.x -= dt * 22; this.ball.rotation.z += dt * 5;
      if (u >= 1) {
        const dir = k.to.clone().sub(k.from).normalize();
        if (k.goal) {
          this.ballMode = 'phys';
          this.ballV.copy(dir).multiplyScalar(13);
          this.shake = 0.5;
        } else if (k.dive === 0) {
          this.ballMode = 'held';
        } else {
          this.ballMode = 'phys';
          this.ballV.set(k.dive * (3.5 + k.rx * 2), 2.4 + k.ry, 4.5 + k.rx * 2);
          this.shake = 0.25;
        }
        k.arrived = t;
        k.onArrive?.();
      }
    }
    if (this.ballMode === 'held') {
      kp.handsMid(this.ball.position);
      this.ball.position.z += 0.06;
    }

    // ---- tepkiler
    if (k.arrived != null && !k.reacted && t >= k.arrived + 0.12) {
      k.reacted = true;
      sh.play(k.goal ? A.celebrate() : A.sad(), 0.3);
      if (k.dive === 0 && k.goal) kp.play(A.slump(), 0.5);
    }

    // kamera hafif ileri
    const push = A.ease.io(A.clamp01((t - T_WAIT) / 1.8));
    const c = CAMS.match;
    this.goalPos.set(c.pos[0], c.pos[1] - 0.25 * push, c.pos[2] - 1.3 * push);
    this.goalTgt.set(c.tgt[0], c.tgt[1] + 0.25 * push, c.tgt[2] - 1.2 * push);
  }

  _updateBall(dt) {
    if (this.ballMode !== 'phys') return;
    const p = this.ball.position, v = this.ballV;
    v.y -= 9.8 * dt;
    p.addScaledVector(v, dt);
    const sp = v.length();
    this.ball.rotation.x += v.z * dt / BALL_R * 0.5; this.ball.rotation.z -= v.x * dt / BALL_R * 0.5;
    if (p.y < BALL_R) {
      p.y = BALL_R;
      v.y = Math.abs(v.y) > 0.6 ? -v.y * 0.5 : 0;
      const f = Math.pow(0.25, dt);
      v.x *= f; v.z *= f;
    }
    if (p.z < 0 && Math.abs(p.x) < 3.72) { // kalenin içi: file
      const zb = netBackZ(p.y) + BALL_R;
      if (p.z < zb) {
        p.z = zb;
        if (v.z < -1) this.netHit = this.time;
        v.z *= -0.06; v.x *= 0.3; v.y *= 0.5;
      }
      if (Math.abs(p.x) > 3.55) { p.x = Math.sign(p.x) * 3.55; v.x *= -0.1; }
      if (p.y > GOAL_H - 0.15) { p.y = GOAL_H - 0.15; v.y = -Math.abs(v.y) * 0.2; }
    }
    if (sp < 0.05 && p.y <= BALL_R + 0.001) this.ballMode = 'still';
  }

  // ------------------------------------------------ maç sonu
  showEnd(winner, loser) {
    this.setMode('end');
    const [a, b] = this.chars;
    a.root.visible = b.root.visible = true;
    a.root.rotation.z = b.root.rotation.z = 0;
    a.setLook(winner.look, 'player', winner.name);
    b.setLook(loser.look, 'player', loser.name);
    a.play(A.trophyLift(), 0);
    b.play(A.sitCry(), 0);
    a.root.rotation.y = 0.12;
    b.root.position.set(0.62, 0, SOLO_Z + 0.15);
    b.root.rotation.y = -0.5;
    b.head.add(this.tears);
    this.ball.visible = false;
    this._pairA = this._pairB = null;
    this._resetConfetti();
  }

  _buildTrophy() {
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc533, metalness: 1, roughness: 0.2, envMapIntensity: 4 });
    const t = (this.trophy = new THREE.Group());
    const prof = [[0, 0], [0.07, 0], [0.072, 0.022], [0.048, 0.034], [0.024, 0.055], [0.016, 0.1], [0.022, 0.125], [0.05, 0.15], [0.082, 0.2], [0.098, 0.26], [0.104, 0.33], [0.096, 0.33], [0.088, 0.265], [0.07, 0.205], [0, 0.17]];
    const cup = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 36), gold);
    cup.castShadow = true;
    t.add(cup);
    for (const s of [1, -1]) {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 8, 20, Math.PI), gold);
      h.position.set(s * 0.094, 0.26, 0);
      h.rotation.z = -s * Math.PI / 2;
      h.castShadow = true;
      t.add(h);
    }
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.07, 0.035, 24), new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.35 }));
    base.position.y = -0.016;
    t.add(base);
    t.visible = false;
    this.scene.add(t);

    // gözyaşları (kaybedenin başına bağlanır)
    this.tears = new THREE.Group();
    const tm = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.1, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), tm);
      d.scale.set(1, 1.5, 1);
      this.tears.add(d);
    }
    this.tears.visible = false;
  }
  _updateEnd() {
    const w = this.chars[0];
    w.handsMid(this.trophy.position);
    this.trophy.position.y -= 0.11;
    this.trophy.rotation.set(0.05 * Math.sin(this.time * 2.7), w.root.rotation.y + w.cur.hry, -0.08 * Math.sin(this.time * 2.7));
    this.tears.children.forEach((d, i) => {
      const u = (this.time * 0.9 + i * 0.25) % 1;
      const side = i % 2 ? 1 : -1;
      d.position.set(side * (0.055 + 0.01 * u), -0.01 - 0.16 * u * u, 0.118 + 0.03 * u);
      d.scale.setScalar(u < 0.1 ? u * 10 : 1 - 0.5 * u);
      d.scale.y *= 1.5;
    });
  }

  _buildConfetti() {
    const N = 170;
    const mesh = (this.confetti = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.06, 0.035),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false }),
      N
    ));
    mesh.frustumCulled = false;
    mesh.visible = false;
    const cols = [0xc8ff2e, 0xffffff, 0x38bdf8, 0xf43f5e, 0xfacc15, 0xa78bfa];
    this.conf = [];
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      mesh.setColorAt(i, c.set(cols[i % cols.length]));
      this.conf.push({ p: V3(0, 0, 0), v: V3(0, 0, 0), r: V3(0, 0, 0), w: V3(0, 0, 0) });
    }
    this._dummy = new THREE.Object3D();
    this.scene.add(mesh);
    this._resetConfetti();
  }
  _resetConfetti() {
    for (const f of this.conf) this._spawn(f, true);
  }
  _spawn(f, initial) {
    f.p.set((Math.random() - 0.5) * 4.4, initial ? Math.random() * 4 + 1 : 3.4 + Math.random(), SOLO_Z - 1.2 + Math.random() * 3.2);
    f.v.set((Math.random() - 0.5) * 0.5, -0.7 - Math.random() * 0.7, 0);
    f.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    f.w.set(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3);
  }
  _updateConfetti(dt) {
    const d = this._dummy;
    this.conf.forEach((f, i) => {
      f.p.addScaledVector(f.v, dt);
      f.p.x += Math.sin(this.time * 2 + i) * dt * 0.3;
      f.r.addScaledVector(f.w, dt);
      if (f.p.y < 0) this._spawn(f, false);
      d.position.copy(f.p); d.rotation.set(f.r.x, f.r.y, f.r.z);
      d.updateMatrix();
      this.confetti.setMatrixAt(i, d.matrix);
    });
    this.confetti.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------ döngü
  _tick(now) {
    const dt = Math.max(0, Math.min(0.05, (now - this._last) / 1000));
    this._last = now;
    this.time += dt;
    const m = this.mode;

    if (m === 'menu' || m === 'editor') {
      this.soloRot += (this.soloRotTarget - this.soloRot) * Math.min(1, dt * 9);
      this.chars[0].root.rotation.y = this.soloRot;
    }
    if (m === 'match' && this.kick) this._updateKick(dt);
    this._updateBall(dt);
    for (const c of this.chars) if (c.root.visible) c.update(dt);
    if (m === 'end') this._updateEnd();
    if (m === 'end') this._updateConfetti(dt);

    // file sarsıntısı
    if (this.netHit != null) {
      const s = this.time - this.netHit;
      this.env.net.scale.z = 1 + 0.16 * Math.exp(-3.5 * s) * Math.cos(s * 15);
      if (s > 2.5) { this.netHit = null; this.env.net.scale.z = 1; }
    }

    // bölgeler
    for (const z of this.zones) {
      const sel = this.selected === z.userData.zone;
      const tgtO = this.zonesOn ? (sel ? 0.66 : 0.3) : 0;
      const mat = z.material;
      mat.opacity += (tgtO - mat.opacity) * Math.min(1, dt * 12);
      mat.color.lerp(this._c || (this._c = new THREE.Color()), 0).lerp(sel ? WHITE : GREY, Math.min(1, dt * 14));
      z.children[0].material.opacity = Math.min(1, mat.opacity * 2.2);
      z.visible = mat.opacity > 0.004;
    }

    // kamera
    const kd = Math.min(1, dt * 4.5);
    this.camPos.lerp(this.goalPos, kd); this.camTgt.lerp(this.goalTgt, kd);
    if (Math.abs(this.camera.fov - this.fovTarget) > 0.01) {
      this.camera.fov += (this.fovTarget - this.camera.fov) * kd;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(this.camPos);
    if (this.shake > 0.001) {
      this.shake *= Math.pow(0.02, dt);
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.25;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.25;
    }
    this.camera.lookAt(this.camTgt);
    this.renderer.render(this.scene, this.camera);
  }
}

const WHITE = new THREE.Color(0xffffff), GREY = new THREE.Color(0x9aa3ad);
