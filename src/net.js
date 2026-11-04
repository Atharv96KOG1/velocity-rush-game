// Online play over WebRTC data channels (PeerJS). One player hosts a room; everyone
// connects to the host, which relays messages (star topology). PeerJS's public
// broker is only used to set up connections; race traffic goes peer-to-peer.

const PEER_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'velocity-rush-room-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 6;

let loading = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve();
  return loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEER_URL;
    s.onload = resolve;
    s.onerror = () => { loading = null; reject(new Error('Could not load the networking library. Are you online?')); };
    document.head.appendChild(s);
  });
}

const makeCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const cleanName = n => String(n ?? 'Racer').replace(/[^\w \-]/g, '').trim().slice(0, 12) || 'Racer';

class Emitter {
  constructor() { this.handlers = {}; }
  on(type, fn) {
    (this.handlers[type] ??= []).push(fn);
    return () => { this.handlers[type] = this.handlers[type].filter(f => f !== fn); };
  }
  emit(type, ...args) { for (const f of [...(this.handlers[type] ?? [])]) f(...args); }
}

// ---------- LAN relay transport ----------
// serve.py exposes a WebSocket relay at /relay. These adapters mimic the small part
// of the PeerJS Peer/DataConnection API that NetHost and NetClient use.

export const relayUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/relay`;

class FakeConn extends Emitter {
  constructor(sendFn, closeFn) { super(); this.open = true; this.sendFn = sendFn; this.closeFn = closeFn; }
  send(d) { if (this.open) this.sendFn(d); }
  close() { if (!this.open) return; this.open = false; this.closeFn?.(); this.emit('close'); }
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
    const t = setTimeout(() => { ws.close(); reject(new Error('Local server not reachable.')); }, 4000);
    ws.onopen = () => { clearTimeout(t); resolve(ws); };
    ws.onerror = () => { clearTimeout(t); reject(new Error('Local server not reachable. Start the game with python3 serve.py.')); };
  });
}

/** Relay "peer" for a host: emits 'connection' with a FakeConn for every client. */
class RelayHostPeer extends Emitter {
  constructor(ws) {
    super();
    this.ws = ws;
    this.conns = new Map();
    this.destroyed = false;
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.op === 'peer') {
        const conn = new FakeConn(d => this.out({ op: 'to', cid: m.cid, d }));
        this.conns.set(m.cid, conn);
        this.emit('connection', conn);
      } else if (m.op === 'from') this.conns.get(m.cid)?.emit('data', m.d);
      else if (m.op === 'gone') {
        const c = this.conns.get(m.cid);
        this.conns.delete(m.cid);
        if (c) { c.open = false; c.emit('close'); }
      }
    };
    ws.onclose = () => { for (const c of this.conns.values()) { c.open = false; c.emit('close'); } };
  }
  out(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  reconnect() {}
  destroy() { this.destroyed = true; this.ws.close(); }
}

// Messages relayed by the host to every other client.
const RELAY = new Set(['s', 'pw']);

export class NetHost extends Emitter {
  static async create(me) {
    await loadPeer();
    for (let tries = 0; tries < 4; tries++) {
      const code = makeCode();
      try {
        const peer = await new Promise((resolve, reject) => {
          const p = new window.Peer(PREFIX + code);
          p.once('open', () => resolve(p));
          p.once('error', e => { p.destroy(); reject(e); });
        });
        return new NetHost(peer, code, me);
      } catch (e) {
        if (e.type !== 'unavailable-id') throw new Error(`Could not create room (${e.type ?? e.message})`);
      }
    }
    throw new Error('Could not create a room. Try again.');
  }

  static async createRelay(me) {
    const ws = await openSocket(relayUrl());
    const code = await new Promise((resolve, reject) => {
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.op === 'hosted') resolve(m.code); };
      ws.onclose = () => reject(new Error('Local server closed the connection.'));
      ws.send(JSON.stringify({ op: 'host' }));
    });
    const host = new NetHost(new RelayHostPeer(ws), code, me);
    host.transport = 'lan';
    return host;
  }

  constructor(peer, code, me) {
    super();
    this.role = 'host';
    this.transport = 'p2p';
    this.peer = peer;
    this.code = code;
    this.localId = 'p0';
    this.players = [{ id: 'p0', name: cleanName(me.name), car: me.car, power: me.power, host: true }];
    this.settings = null;
    this.conns = new Map();
    this.nextId = 1;
    this.inRace = false;
    peer.on('connection', conn => this.accept(conn));
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  }

  accept(conn) {
    conn.on('data', msg => {
      if (msg.t === 'hello') {
        if (this.players.length >= MAX_PLAYERS || this.inRace) {
          conn.send({ t: 'reject', reason: this.inRace ? 'A race is in progress. Try again in a moment.' : 'Room is full.' });
          setTimeout(() => conn.close(), 400);
          return;
        }
        const id = 'p' + this.nextId++;
        conn.pid = id;
        this.conns.set(id, conn);
        this.players.push({ id, name: cleanName(msg.name), car: msg.car, power: msg.power });
        conn.send({ t: 'welcome', id, code: this.code });
        this.syncLobby();
        return;
      }
      if (!conn.pid) return;
      msg.from = conn.pid;
      if (msg.t === 'me') {
        const p = this.players.find(x => x.id === conn.pid);
        if (p) { p.car = msg.car; p.power = msg.power; }
        this.syncLobby();
        return;
      }
      if (RELAY.has(msg.t)) this.sendExcept(conn.pid, msg);
      this.emit('msg', msg);
    });
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
  }

  drop(conn) {
    if (!conn.pid || !this.conns.has(conn.pid)) return;
    this.conns.delete(conn.pid);
    this.players = this.players.filter(p => p.id !== conn.pid);
    this.broadcast({ t: 'left', id: conn.pid });
    this.emit('msg', { t: 'left', id: conn.pid });
    this.syncLobby();
  }

  broadcast(msg) { for (const c of this.conns.values()) if (c.open) c.send(msg); }
  sendExcept(id, msg) { for (const [k, c] of this.conns) if (k !== id && c.open) c.send(msg); }
  send(msg) { this.broadcast(msg); }

  syncLobby() {
    this.broadcast({ t: 'lobby', players: this.players, settings: this.settings });
    this.emit('lobby');
  }

  setSettings(s) { this.settings = s; this.syncLobby(); }
  updateMe(me) { Object.assign(this.players[0], me); this.syncLobby(); }
  close() { this.broadcast({ t: 'closed' }); setTimeout(() => this.peer.destroy(), 200); }
}

export class NetClient extends Emitter {
  /** Try the local relay first (if this page came from serve.py), then peer-to-peer. */
  static async join(code, me) {
    code = code.trim().toUpperCase();
    try {
      return await NetClient.joinRelay(code, me);
    } catch (e) {
      if (e.fatal) throw e;
    }
    return NetClient.joinP2P(code, me);
  }

  static async joinRelay(code, me) {
    const ws = await openSocket(relayUrl());
    return new Promise((resolve, reject) => {
      const conn = new FakeConn(d => ws.readyState === 1 && ws.send(JSON.stringify({ op: 'up', d })), () => ws.close());
      const peer = { destroy: () => ws.close(), on() {} };
      let joined = false, done = false;
      const fail = (err, fatal = false) => { if (done) return; done = true; ws.close(); err.fatal = fatal; reject(err); };
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.op === 'error') fail(new Error(m.reason));
        else if (m.op === 'joined') { joined = true; conn.send({ t: 'hello', name: me.name, car: me.car, power: me.power }); }
        else if (m.op === 'closed') { conn.open = false; conn.emit('close'); }
        else if (m.op === 'data') {
          const d = m.d;
          if (!done && d.t === 'welcome') {
            done = true;
            const c = new NetClient(peer, conn, code, d.id);
            c.transport = 'lan';
            resolve(c);
          } else if (!done && d.t === 'reject') fail(new Error(d.reason), true);
          else conn.emit('data', d);
        }
      };
      ws.onclose = () => { if (!done) fail(new Error('Local server closed the connection.')); else if (conn.open) { conn.open = false; conn.emit('close'); } };
      ws.send(JSON.stringify({ op: 'join', code }));
      setTimeout(() => { if (!done) fail(new Error(joined ? 'Host did not answer.' : 'Room not found on the local server.'), joined); }, 6000);
    });
  }

  static async joinP2P(code, me) {
    await loadPeer();
    return new Promise((resolve, reject) => {
      const peer = new window.Peer();
      let done = false;
      const fail = err => {
        if (done) return;
        done = true;
        peer.destroy();
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error('Connection timed out. Check the room code, or your network may block peer-to-peer connections.')), 15000);
      peer.on('error', e => fail(new Error(e.type === 'peer-unavailable' ? `Room ${code} not found.` : `Network error (${e.type ?? e.message})`)));
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        conn.on('open', () => conn.send({ t: 'hello', name: me.name, car: me.car, power: me.power }));
        conn.on('data', msg => {
          if (done) return;
          if (msg.t === 'welcome') {
            done = true;
            clearTimeout(timer);
            resolve(new NetClient(peer, conn, code, msg.id));
          } else if (msg.t === 'reject') {
            clearTimeout(timer);
            fail(new Error(msg.reason));
          }
        });
      });
    });
  }

  constructor(peer, conn, code, id) {
    super();
    this.role = 'client';
    this.transport = 'p2p';
    this.peer = peer;
    this.conn = conn;
    this.code = code;
    this.localId = id;
    this.players = [];
    this.settings = null;
    conn.on('data', msg => {
      if (msg.t === 'lobby') {
        this.players = msg.players;
        this.settings = msg.settings;
        this.emit('lobby');
        return;
      }
      if (msg.t === 'closed') { this.emit('closed'); return; }
      this.emit('msg', msg);
    });
    conn.on('close', () => this.emit('closed'));
  }

  send(msg) { if (this.conn.open) this.conn.send(msg); }
  updateMe(me) { this.send({ t: 'me', car: me.car, power: me.power }); }
  close() { this.peer.destroy(); }
}
