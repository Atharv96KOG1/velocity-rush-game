// Online play. One player hosts a room; everyone connects to the host, which relays
// messages (star topology). Three transports carry the same messages:
//  - direct: WebRTC data channels via PeerJS (lowest latency, but strict NATs and
//    office/school/mobile networks can block it)
//  - cloud:  a public MQTT broker over secure WebSockets, used automatically when a
//    direct connection can't be made
//  - lan:    the WebSocket relay in serve.py, for players on the same network

const PEER_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const MQTT_URL = 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js';
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const TOPIC = 'velocity-rush-game/v1/';
const DIRECT_TIMEOUT = 9000;
const PREFIX = 'velocity-rush-room-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 6;

const loading = {};
function loadScript(url, global) {
  if (window[global]) return Promise.resolve();
  return loading[url] ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => { delete loading[url]; reject(new Error('Could not load the networking library. Are you online?')); };
    document.head.appendChild(s);
  });
}
const loadPeer = () => loadScript(PEER_URL, 'Peer');

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
    ws.onclose = () => {
      for (const c of this.conns.values()) { c.open = false; c.emit('close'); }
      if (!this.destroyed) this.emit('closed');
    };
  }
  out(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  reconnect() {}
  destroy() { this.destroyed = true; this.ws.close(); }
}

// ---------- Cloud relay transport (MQTT over WSS) ----------
// Topics per room: <base>/host (retained "up" while the host is online),
// <base>/h/<cid> client -> host, <base>/c/<cid> host -> client.

async function mqttConnect(will) {
  await loadScript(MQTT_URL, 'mqtt');
  let last;
  for (const url of BROKERS) {
    try {
      return await new Promise((resolve, reject) => {
        const c = window.mqtt.connect(url, { will, connectTimeout: 6000, reconnectPeriod: 2000, clean: true, keepalive: 20 });
        const t = setTimeout(() => { c.end(true); reject(new Error('timeout')); }, 7000);
        c.once('connect', () => { clearTimeout(t); resolve(c); });
        c.once('error', e => { clearTimeout(t); c.end(true); reject(e); });
      });
    } catch (e) { last = e; }
  }
  throw new Error(`Cloud relay not reachable (${last?.message ?? 'blocked'}).`);
}

const text = buf => (typeof buf === 'string' ? buf : new TextDecoder().decode(buf));
const pub = (client, topic, data, opts) => client.publish(topic, typeof data === 'string' ? data : JSON.stringify(data), opts);

class CloudHostPeer extends Emitter {
  constructor(client, code) {
    super();
    const base = this.base = TOPIC + code;
    this.client = client;
    this.conns = new Map();
    client.subscribe(base + '/h/+', { qos: 0 });
    pub(client, base + '/host', 'up', { retain: true, qos: 1 });
    client.on('message', (topic, buf) => {
      const cid = topic.slice(topic.lastIndexOf('/') + 1);
      let m;
      try { m = JSON.parse(text(buf)); } catch { return; }
      let c = this.conns.get(cid);
      if (m.t === 'bye') {
        if (c) { this.conns.delete(cid); c.open = false; c.emit('close'); }
        return;
      }
      if (!c) {
        if (m.t !== 'hello') return;
        c = new FakeConn(d => pub(client, base + '/c/' + cid, d));
        this.conns.set(cid, c);
        this.emit('connection', c);
      }
      c.emit('data', m);
    });
  }
  destroy() {
    pub(this.client, this.base + '/host', '', { retain: true, qos: 1 });
    setTimeout(() => this.client.end(), 300);
  }
}

// Messages relayed by the host to every other client.
const RELAY = new Set(['s', 'pw', 'wk', 'sw', 'box', 'use', 'hz', 'mh', 'mt', 'bust', 'ob']);

export class NetHost extends Emitter {
  /** Internet room: listens for direct (WebRTC) and cloud-relay joins under the same code. */
  static async create(me) {
    let code = makeCode(), peer = null, cloud = null;
    try {
      await loadPeer();
      for (let tries = 0; tries < 4 && !peer; tries++) {
        try {
          peer = await new Promise((resolve, reject) => {
            const p = new window.Peer(PREFIX + code);
            const t = setTimeout(() => { p.destroy(); reject(new Error('timeout')); }, 8000);
            p.once('open', () => { clearTimeout(t); resolve(p); });
            p.once('error', e => { clearTimeout(t); p.destroy(); reject(e); });
          });
        } catch (e) {
          if (e.type !== 'unavailable-id') break;
          code = makeCode();
        }
      }
    } catch { /* direct connections unavailable; the cloud relay may still work */ }
    const openCloud = () => mqttConnect({ topic: TOPIC + code + '/host', payload: '', retain: true, qos: 1 })
      .then(client => new CloudHostPeer(client, code));
    if (peer) {
      const host = new NetHost(peer, code, me);
      // The cloud relay attaches in the background so creating a room never waits on it.
      openCloud().then(cloud => { if (host.closed) cloud.destroy(); else { host.addPeer(cloud); host.emit('lobby'); } }).catch(() => {});
      return host;
    }
    try {
      cloud = await openCloud();
    } catch {
      throw new Error('Could not create a room: your network blocks both direct and relay connections.');
    }
    const host = new NetHost(cloud, code, me);
    host.transport = 'cloud';
    return host;
  }

  get relayReady() { return this.peers.some(p => p instanceof CloudHostPeer); }

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
    this.players = [{ id: 'p0', name: cleanName(me.name), car: me.car, power: me.power, paint: me.paint, host: true }];
    this.settings = null;
    this.conns = new Map();
    this.nextId = 1;
    this.inRace = false;
    this.peers = [];
    this.addPeer(peer);
  }

  addPeer(peer) {
    this.peers.push(peer);
    peer.on('connection', conn => this.accept(conn));
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect?.(); });
    // The LAN relay going away means the room is gone.
    peer.on('closed', () => this.emit('closed'));
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
        this.players.push({ id, name: cleanName(msg.name), car: msg.car, power: msg.power, paint: msg.paint });
        conn.send({ t: 'welcome', id, code: this.code });
        this.syncLobby();
        return;
      }
      if (!conn.pid) return;
      msg.from = conn.pid;
      if (msg.t === 'me') {
        const p = this.players.find(x => x.id === conn.pid);
        if (p) { p.car = msg.car; p.power = msg.power; p.paint = msg.paint; }
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
  close() { this.closed = true; this.broadcast({ t: 'closed' }); setTimeout(() => this.peers.forEach(p => p.destroy()), 200); }
}

export class NetClient extends Emitter {
  /** Local relay (when served by serve.py), then a direct connection, then the cloud relay. */
  static async join(code, me, status = () => {}) {
    code = code.trim().toUpperCase();
    if (location.protocol === 'http:') {
      try {
        status('Looking for the room on this network…');
        return await NetClient.joinRelay(code, me);
      } catch (e) {
        if (e.fatal) throw e;
      }
    }
    let direct;
    try {
      status('Connecting directly…');
      return await NetClient.joinP2P(code, me);
    } catch (e) {
      if (e.fatal) throw e;
      direct = e;
    }
    try {
      status('Direct connection blocked. Connecting through the cloud relay…');
      return await NetClient.joinCloud(code, me);
    } catch (e) {
      if (e.fatal) throw e;
      throw new Error(`${e.message} (Direct: ${direct.message})`);
    }
  }

  static async joinCloud(code, me) {
    const cid = Math.random().toString(36).slice(2, 10);
    const base = TOPIC + code, up = base + '/h/' + cid;
    const client = await mqttConnect({ topic: up, payload: JSON.stringify({ t: 'bye' }), qos: 0, retain: false });
    return new Promise((resolve, reject) => {
      let done = false, hostSeen = false;
      const conn = new FakeConn(d => pub(client, up, d), () => { pub(client, up, { t: 'bye' }); setTimeout(() => client.end(), 200); });
      const peer = { destroy: () => conn.close(), on() {} };
      const fail = (err, fatal = false) => { if (done) return; done = true; client.end(true); err.fatal = fatal; reject(err); };
      setTimeout(() => fail(new Error(hostSeen ? 'The host did not answer.' : `Room ${code} not found.`)), 8000);
      client.on('message', (topic, buf) => {
        const body = text(buf);
        if (topic === base + '/host') {
          if (body === 'up' && !hostSeen) {
            hostSeen = true;
            conn.send({ t: 'hello', name: me.name, car: me.car, power: me.power, paint: me.paint });
          } else if (body !== 'up' && done && conn.open) { conn.open = false; conn.emit('close'); }
          return;
        }
        let d;
        try { d = JSON.parse(body); } catch { return; }
        if (!done && d.t === 'welcome') {
          done = true;
          const c = new NetClient(peer, conn, code, d.id);
          c.transport = 'cloud';
          resolve(c);
        } else if (!done && d.t === 'reject') fail(new Error(d.reason), true);
        else if (done) conn.emit('data', d);
      });
      client.subscribe([base + '/c/' + cid, base + '/host'], { qos: 0 });
    });
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
        else if (m.op === 'joined') { joined = true; conn.send({ t: 'hello', name: me.name, car: me.car, power: me.power, paint: me.paint }); }
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
      const timer = setTimeout(() => fail(new Error('Direct connection timed out.')), DIRECT_TIMEOUT);
      peer.on('error', e => fail(new Error(e.type === 'peer-unavailable' ? `Room ${code} not found.` : `Network error (${e.type ?? e.message})`)));
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        conn.on('open', () => conn.send({ t: 'hello', name: me.name, car: me.car, power: me.power, paint: me.paint }));
        conn.on('data', msg => {
          if (done) return;
          if (msg.t === 'welcome') {
            done = true;
            clearTimeout(timer);
            resolve(new NetClient(peer, conn, code, msg.id));
          } else if (msg.t === 'reject') {
            clearTimeout(timer);
            const err = new Error(msg.reason);
            err.fatal = true;
            fail(err);
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
  updateMe(me) { this.send({ t: 'me', car: me.car, power: me.power, paint: me.paint }); }
  close() { this.peer.destroy(); }
}
