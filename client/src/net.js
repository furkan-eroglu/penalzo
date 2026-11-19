const BASE = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');

// Çevrimdışı sürüm (vite build --mode offline): sunucu yoktur, yalnızca antrenman modu açıktır.
export const hasServer = !import.meta.env.VITE_OFFLINE_ONLY;

export async function api(path, body) {
  let r;
  try {
    r = await fetch(`${BASE}/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new Error('Sunucuya ulaşılamadı. Çevrimdışı oynayabilirsin.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Bir hata oluştu');
  return j;
}

function wsUrl() {
  if (BASE) return BASE.replace(/^http/, 'ws') + '/ws';
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}

// Otomatik yeniden bağlanan soket
export class Socket {
  constructor() {
    this.handlers = {};
    this.token = null;
    this.ws = null;
    this.onState = () => {};
  }
  on(type, fn) { this.handlers[type] = fn; }
  open(token) {
    this.token = token;
    this._connect();
  }
  close() {
    this.token = null;
    clearTimeout(this._retry);
    this.ws?.close();
    this.ws = null;
  }
  send(type, data = {}) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type, ...data }));
  }
  _connect() {
    clearTimeout(this._retry);
    if (!this.token) return;
    const ws = (this.ws = new WebSocket(wsUrl()));
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: this.token }));
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this.handlers[m.type]?.(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.token) return;
      this.onState(false);
      this._retry = setTimeout(() => this._connect(), 1800);
    };
  }
}
