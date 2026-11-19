// Tamamı sentezlenen sesler (dosya yok).
let ctx, master, noiseBuf, ambient;
let muted = false;

function ensure() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return true;
}

// Uygulama arka plana geçince (ya da sekme gizlenince) tüm ses dursun
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend();
  else ctx.resume();
});

export function unlock() {
  if (!ensure()) return;
  if (ctx.state === 'suspended') ctx.resume();
}
export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.9;
}
export const isMuted = () => muted;

function noise(freq, q, gainPts, dur, type = 'bandpass') {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  for (const [at, v] of gainPts) g.gain.linearRampToValueAtTime(v, t + at);
  src.connect(f).connect(g).connect(master);
  src.start(t); src.stop(t + dur);
}
function tone(freq, dur, vol, type = 'sine', slideTo) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  click() { tone(520, 0.07, 0.12, 'triangle', 760); },
  tick() { tone(880, 0.06, 0.1, 'square'); },
  select() { tone(660, 0.12, 0.16, 'triangle', 990); },
  whistle() {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    for (const f of [2750, 2920]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 38;
      const lg = ctx.createGain(); lg.gain.value = 70;
      lfo.connect(lg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.1, t + 0.03);
      g.gain.setValueAtTime(0.1, t + 0.38); g.gain.linearRampToValueAtTime(0.0001, t + 0.46);
      o.connect(g).connect(master);
      o.start(t); lfo.start(t); o.stop(t + 0.5); lfo.stop(t + 0.5);
    }
  },
  kick() {
    tone(170, 0.16, 0.7, 'sine', 45);
    noise(1800, 0.7, [[0.005, 0.35], [0.07, 0.0001]], 0.1);
  },
  goal() {
    noise(900, 0.5, [[0.25, 0.55], [1.6, 0.4], [4.2, 0.0001]], 4.4);
    noise(2200, 0.8, [[0.3, 0.22], [1.4, 0.15], [3.8, 0.0001]], 4);
    noise(300, 0.4, [[0.02, 0.3], [0.25, 0.0001]], 0.3, 'lowpass'); // file
  },
  save() {
    tone(120, 0.12, 0.5, 'sine', 60);
    noise(500, 0.6, [[0.2, 0.3], [0.9, 0.2], [2.4, 0.0001]], 2.6);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.35, 0.16, 'triangle'), i * 130));
    noise(1000, 0.5, [[0.3, 0.4], [2.5, 0.3], [5, 0.0001]], 5.2);
  },
  lose() {
    [392, 349, 294].forEach((f, i) => setTimeout(() => tone(f, 0.45, 0.14, 'triangle'), i * 220));
  },
};

// stadyum uğultusu
export function ambience(on) {
  if (!ensure()) return;
  if (on && !ambient) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 650; f.Q.value = 0.45;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    g.gain.linearRampToValueAtTime(0.085, ctx.currentTime + 1.2);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23;
    const lg = ctx.createGain(); lg.gain.value = 0.03;
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(master);
    src.start(); lfo.start();
    ambient = { src, g, lfo };
  } else if (!on && ambient) {
    const a = ambient; ambient = null;
    a.g.gain.cancelScheduledValues(ctx.currentTime);
    a.g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    setTimeout(() => { a.src.stop(); a.lfo.stop(); }, 700);
  }
}
