import { CARS, TRACKS, STORY, CHALLENGES, DIFFICULTY, carById } from './data.js';
import { save, persist } from './save.js';
import { RaceSession, fmtTime, TEAM_SIZE, TEAM_COLORS, FFA_COLORS } from './session-race.js';
import { NetHost, NetClient, MAX_PLAYERS } from './net.js';
import { AI_NAMES, WEATHER, PAINTS, ACHIEVEMENTS, UPGRADES, dailyChallenge, tuneSpec } from './data.js';
import { unlock } from './achieve.js';

const paintOf = id => save.paint?.[id] ?? carById(id).color;
const tuneOf = id => save.upgrades?.[id] ?? null;
// The LAN relay only exists when the game is served by serve.py on this machine or network.
const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(location.hostname);
const hex = c => '#' + c.toString(16).padStart(6, '0');
import { WorldSession } from './session-world.js';
import { initAudio, beep } from './audio.js';
import { music } from './music.js';
import { PhotoMode } from './photo.js';
import { toast } from './achieve.js';
import { POWERS, powerById } from './powers.js';

const el = html => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FORMAT_LABEL = { '1v1': '1 VS 1', '2v2': '2 VS 2', '3v3': '3 VS 3', ffa: '6-CAR FFA' };
const TYPE_LABEL = { race: 'Race', timeTrial: 'Time Trial', drift: 'Drift', knockout: 'Knockout' };

function goalLine(g, cfg) {
  if (!g) return '';
  switch (g.type) {
    case 'position': return `Finish in position ${g.value}.`;
    case 'teamWin': return 'Your team (Blue) must score more points than Red. Points: 1st = most, last = 1.';
    case 'drift': return `Score ${g.value.toLocaleString()} drift points.`;
    case 'time': return `Average ${Math.round(g.avg * 3.6)} km/h over ${cfg.laps} lap${cfg.laps > 1 ? 's' : ''}.`;
    case 'survive': return 'Avoid last place each lap. Be the last car standing.';
  }
  return '';
}

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    const unlock = () => { initAudio(); music.start(); };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
    this.root.addEventListener('click', e => { if (e.target.closest('button')) beep(520, 0.05, 'triangle', 0.12); });
  }

  flashNote(text) { toast('AUDIO', text); }

  /** focus: false for overlays shown mid-race, where a held driving key (Space, Enter) would press the button. */
  mount(html, { focus = true } = {}) {
    this.root.innerHTML = '';
    const node = el(html);
    this.root.appendChild(node);
    node.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => this[b.dataset.go](); });
    if (focus) node.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
    else document.activeElement?.blur?.();
    return node;
  }

  mountOverlay(html) { return this.mount(html, { focus: false }); }

  credits() { return `<div class="credits">◆ ${save.credits.toLocaleString()} CR</div>`; }

  toMenu() {
    this.pauseOpen = false;
    if (this.game.session !== this.game.menu) this.game.backToMenu();
    this.game.menu.showCar(save.car, paintOf(save.car));
  }

  // ---------- Main ----------

  showMain() {
    this.toMenu();
    const chapter = Math.min(save.story + 1, STORY.length);
    this.mount(`<div class="screen">${this.credits()}
      <div class="title">VELOCITY<br>RUSH</div>
      <div class="subtitle">Street · Circuit · Open World</div>
      <div class="whatsnew">NEW · ☄️ Meteor Storm · 🍄 Mega Car · ⚡ Lightning · 🎁 Weapons · 🤸 Flips (F) · 🚨 Police</div>
      <div class="version">v${document.querySelector('meta[name=version]')?.content ?? 'dev'}</div>
      <div class="menu">
        <button class="btn primary" data-go="showStory">Story Mode<small>${save.story >= STORY.length ? 'Completed — replay any chapter' : `Chapter ${chapter} of ${STORY.length}`}</small></button>
        <button class="btn" data-go="showQuick">Quick Race<small>1v1 · 2v2 · 3v3 · 6-car free-for-all vs AI</small></button>
        <button class="btn" data-go="showLocal">Local Multiplayer<small>2 players, split-screen, same keyboard or gamepads</small></button>
        <button class="btn alt" data-go="showOnline">Online Multiplayer<small>Up to ${MAX_PLAYERS} players over the internet · room codes</small></button>
        <button class="btn" data-go="showChallenges">Challenges<small>Time trial · Drift · Knockout</small></button>
        <button class="btn alt" data-go="showWorld">Open World Tour<small>Free roam, coins, speed traps, sprint races</small></button>
        <button class="btn" data-go="showGarage">Garage<small>Buy and choose your car</small></button>
        <button class="btn alt" data-go="showPowers">Super Powers<small>Equipped: ${powerById(save.power).icon} ${powerById(save.power).name} · ${save.powers.length}/${POWERS.length} unlocked</small></button>
        <button class="btn" data-go="showAchievements">Achievements<small>${Object.keys(save.ach).length}/${ACHIEVEMENTS.length} unlocked</small></button>
        <button class="btn" data-go="showControls">Controls</button>
      </div></div>`);
  }

  // ---------- Race setup (quick race and local multiplayer) ----------

  showQuick() { this.showSetup(1); }
  showLocal() { this.showSetup(2); }

  showSetup(humans) {
    this.toMenu();
    const st = this.setupState ??= { track: 'harbor', format: '1v1', laps: 3, diff: 'normal', coop: false, mode: 'race', p2car: save.owned[0], powers: 'on', p2power: save.powers[0], weather: 'clear', police: 'off', items: 'on', chaos: 'off' };
    if (!save.owned.includes(st.p2car)) st.p2car = save.owned[0];
    if (!save.powers.includes(st.p2power)) st.p2power = save.powers[0];
    if (humans === 1 || st.format === '1v1') st.coop = false;
    const chips = (key, opts, fmt = v => v, disabled = () => false) => opts.map(v =>
      `<button class="chip ${st[key] === v ? 'on' : ''}" data-k="${key}" data-v="${v}" ${disabled(v) ? 'disabled' : ''}>${fmt(v)}</button>`).join('');

    const node = this.mount(`<div class="screen">${this.credits()}
      <div class="h2">${humans === 2 ? 'LOCAL MULTIPLAYER' : 'QUICK RACE'}</div>
      <div class="desc">${humans === 2 ? 'Split-screen. P1 uses WASD, P2 uses the arrow keys. Gamepads map to players in connection order.' : 'Race the AI on any circuit, solo or with AI teammates.'}</div>
      <div class="label">Track</div>
      <div class="cards" style="max-width:820px;margin-top:0">${Object.entries(TRACKS).map(([id, t]) => `
        <button class="card ${st.track === id ? 'sel' : ''}" data-track="${id}"><h3>${t.name}</h3><p>${t.desc}</p></button>`).join('')}</div>
      <div class="label">Mode</div>
      <div class="chips">${chips('mode', ['race', 'knockout'], v => TYPE_LABEL[v])}</div>
      <div class="label">Format</div>
      <div class="chips">${chips('format', ['1v1', '2v2', '3v3', 'ffa'], v => FORMAT_LABEL[v], v => st.mode === 'knockout' && v !== 'ffa')}</div>
      ${humans === 2 ? `<div class="label">Players</div>
        <div class="chips">
          <button class="chip ${!st.coop ? 'on' : ''}" data-coop="0">Rivals (opposite teams)</button>
          <button class="chip ${st.coop ? 'on' : ''}" data-coop="1" ${st.format === '1v1' || st.format === 'ffa' ? 'disabled' : ''}>Co-op (same team)</button>
        </div>
        <div class="label">P2 Car</div>
        <div class="chips">${save.owned.map(id => `<button class="chip ${st.p2car === id ? 'on' : ''}" data-k="p2car" data-v="${id}"><span class="swatch" style="background:#${carById(id).color.toString(16).padStart(6, '0')}"></span>${carById(id).name}</button>`).join('')}</div>` : ''}
      <div class="label">Weather</div>
      <div class="chips">${chips('weather', Object.keys(WEATHER), v => `${WEATHER[v].icon} ${WEATHER[v].label}`)}</div>
      <div class="label">Super Powers</div>
      <div class="chips">${chips('powers', ['on', 'off'], v => v === 'on' ? `ON · ${powerById(save.power).icon} ${powerById(save.power).name}` : 'OFF')}</div>
      <div class="label">Mystery Boxes & Weapons</div>
      <div class="chips">${chips('items', ['on', 'off'], v => v === 'on' ? '🎁 ON' : 'OFF')}</div>
      <div class="label">Police</div>
      <div class="chips">${chips('police', ['off', 'on'], v => v === 'on' ? '🚨 COPS CHASE YOU' : 'NO POLICE')}</div>
      <div class="label">Chaos Mode</div>
      <div class="chips">${chips('chaos', ['off', 'on'], v => v === 'on' ? '☄️ METEOR STORM' : 'OFF')}</div>
      ${humans === 2 && st.powers === 'on' ? `<div class="label">P2 Power</div><div class="chips">${save.powers.map(id => `<button class="chip ${st.p2power === id ? 'on' : ''}" data-k="p2power" data-v="${id}">${powerById(id).icon} ${powerById(id).name}</button>`).join('')}</div>` : ''}
      ${st.mode === 'race' ? `<div class="label">Laps</div><div class="chips">${chips('laps', [1, 2, 3, 5])}</div>` : ''}
      <div class="label">AI Difficulty</div>
      <div class="chips">${chips('diff', ['easy', 'normal', 'hard'], v => v.toUpperCase())}</div>
      <div class="row">
        <button class="btn primary inline" data-start>Start Race</button>
        <button class="btn inline" data-go="showMain">Back</button>
      </div></div>`);

    node.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      const v = b.dataset.v;
      st[b.dataset.k] = b.dataset.k === 'laps' ? Number(v) : v;
      if (st.mode === 'knockout') st.format = 'ffa';
      this.showSetup(humans);
    });
    node.querySelectorAll('[data-track]').forEach(b => b.onclick = () => { st.track = b.dataset.track; this.showSetup(humans); });
    node.querySelectorAll('[data-coop]').forEach(b => b.onclick = () => { st.coop = b.dataset.coop === '1'; this.showSetup(humans); });
    node.querySelector('[data-start]').onclick = () => {
      const players = humans === 2
        ? [{ car: save.car, name: 'P1', power: save.power, color: paintOf(save.car), tune: tuneOf(save.car) }, { car: st.p2car, name: 'P2', power: st.p2power, color: paintOf(st.p2car), tune: tuneOf(st.p2car) }]
        : [{ car: save.car, name: 'YOU', power: save.power, color: paintOf(save.car), tune: tuneOf(save.car) }];
      this.startRace({
        title: humans === 2 ? 'Local Multiplayer' : 'Quick Race',
        type: st.mode, track: st.track, format: st.format,
        laps: st.mode === 'knockout' ? 6 : st.laps,
        difficulty: DIFFICULTY[st.diff], humans: players, coop: st.coop, powers: st.powers === 'on', weather: st.weather, police: st.police === 'on', items: (st.items ?? 'on') === 'on', chaos: st.chaos === 'on',
      });
    };
  }

  startRace(cfg) {
    this.root.innerHTML = '';
    this.pauseOpen = false;
    this.game.setSession(new RaceSession(this.game, cfg));
  }

  // ---------- Online ----------

  me() { return { name: save.name ?? 'Racer', car: save.car, power: save.power, paint: paintOf(save.car), color: paintOf(save.car), tune: tuneOf(save.car) }; }

  showOnline(error = '') {
    this.toMenu();
    if (this.net) this.leaveNet();
    const node = this.mount(`<div class="screen">${this.credits()}
      <div class="h2">ONLINE MULTIPLAYER</div>
      <div class="desc">Host a room and share the 5-letter code, or join a friend's room. The host's browser runs the AI and decides results. If an internet room won't connect (strict school or office networks), use a local-network room.</div>
      <div class="label">Your name</div>
      <input class="field" data-name maxlength="12" value="${esc(save.name ?? 'Racer')}">
      <div class="desc" style="margin-top:8px">Car: ${carById(save.car).name} · Power: ${powerById(save.power).icon} ${powerById(save.power).name} <span style="opacity:.7">(change in Garage / Super Powers)</span></div>
      <div class="menu">
        <button class="btn primary" data-host="p2p">Host Online Room<small>Internet, peer-to-peer · you pick the track and rules</small></button>
        ${LOCAL_HOST ? `<button class="btn" data-host="lan">Host on Local Network<small>Via this computer's serve.py · friends open ${esc(location.host)}</small></button>` : ''}
      </div>
      <div class="label">Join with a code</div>
      <div class="row" style="margin-top:0">
        <input class="field code" data-code maxlength="5" placeholder="ABCDE" autocomplete="off" spellcheck="false">
        <button class="btn inline" data-join>Join</button>
      </div>
      <div class="net-status ${error ? 'err' : ''}" data-status>${esc(error)}</div>
      <div class="row"><button class="btn inline" data-go="showMain">Back</button></div></div>`);
    const status = node.querySelector('[data-status]');
    const nameIn = node.querySelector('[data-name]'), codeIn = node.querySelector('[data-code]');
    const saveName = () => { save.name = nameIn.value.replace(/[^\w \-]/g, '').trim().slice(0, 12) || 'Racer'; persist(); };
    // One connection attempt at a time: a double Enter or click would open two rooms/joins.
    const busy = (msg) => { this.connecting = true; status.className = 'net-status'; status.textContent = msg; node.querySelectorAll('button, input').forEach(b => { b.disabled = true; }); };
    const fail = e => { this.connecting = false; this.showOnline(e.message ?? String(e)); };
    node.querySelectorAll('[data-host]').forEach(b => b.onclick = async () => {
      if (this.connecting) return;
      saveName();
      busy('Creating room…');
      try { this.attachNet(await (b.dataset.host === 'lan' ? NetHost.createRelay(this.me()) : NetHost.create(this.me()))); } catch (e) { fail(e); }
    });
    const join = async () => {
      if (this.connecting) return;
      saveName();
      const code = codeIn.value.trim().toUpperCase();
      if (code.length !== 5) { status.className = 'net-status err'; status.textContent = 'Enter the 5-character room code.'; return; }
      busy(`Joining room ${code}…`);
      try { this.attachNet(await NetClient.join(code, this.me(), msg => { status.textContent = msg; })); } catch (e) { fail(e); }
    };
    node.querySelector('[data-join]').onclick = join;
    codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  }

  attachNet(net) {
    this.connecting = false;
    if (this.net) this.leaveNet();
    this.net = net;
    if (net.role === 'host') {
      net.setSettings(this.netSettings ??= { track: 'harbor', mode: 'race', format: 'ffa', laps: 3, diff: 'normal', powers: true, fill: true, weather: 'clear', items: true, police: false, chaos: false });
    }
    this.netOff = [
      net.on('lobby', () => { if (this.inLobby) this.showLobby(); }),
      net.on('msg', m => { if (m.t === 'start') this.startOnline(m); else if (m.t === 'lobbyBack' && !this.inLobby) this.showLobby(); }),
      net.on('closed', () => this.netLost('The host closed the room.')),
    ];
    this.showLobby();
  }

  leaveNet() {
    this.netOff?.forEach(f => f());
    this.net?.close();
    this.net = null;
    this.inLobby = false;
  }

  netLost(reason) {
    if (!this.net) return;
    this.leaveNet();
    this.showOnline(reason);
  }

  showLobby() {
    const net = this.net;
    if (!net) return;
    this.toMenu();
    this.inLobby = true;
    const host = net.role === 'host';
    const st = net.settings ?? {};
    const players = net.players;
    // More players than a team format holds: switch to free-for-all instead of dropping someone.
    if (host && TEAM_SIZE[st.format] && players.length > TEAM_SIZE[st.format] * 2) {
      this.netSettings = { ...st, format: 'ffa' };
      net.setSettings(this.netSettings);
      return;
    }
    const slots = this.slotsFor(st, players.length);
    const chips = (key, opts, fmt = v => v, disabled = () => false) => opts.map(v =>
      `<button class="chip ${st[key] === v ? 'on' : ''}" data-k="${key}" data-v="${v}" ${!host || disabled(v) ? 'disabled' : ''}>${fmt(v)}</button>`).join('');
    const tooMany = f => TEAM_SIZE[f] && players.length > TEAM_SIZE[f] * 2;
    const node = this.mount(`<div class="screen full">${this.credits()}
      <div class="h2">LOBBY</div>
      <div class="room-code">ROOM <b>${net.code}</b> <button class="chip" data-copy>Copy</button> <span class="tag">${{ lan: 'LOCAL NETWORK · ' + esc(location.host), cloud: 'INTERNET · CLOUD RELAY', p2p: net.role === 'host' ? (net.relayReady ? 'INTERNET · DIRECT + RELAY' : 'INTERNET · DIRECT') : 'INTERNET · DIRECT' }[net.transport]}</span></div>
      <div class="desc">${host ? 'Share this code with friends. Start when everyone is in.' : 'Waiting for the host to start the race…'}</div>
      <div class="label">Players ${players.length}/${MAX_PLAYERS}</div>
      <div class="players">${players.map(p => `<div class="player ${p.id === net.localId ? 'me' : ''}">
        <span class="swatch" style="background:${hex(p.paint ?? carById(p.car).color)}"></span>
        <b>${esc(p.name)}</b>${p.host ? ' <span class="tag">HOST</span>' : ''}${p.id === net.localId ? ' <span class="tag good">YOU</span>' : ''}
        <span class="pmeta">${carById(p.car).name} · ${powerById(p.power).icon}</span></div>`).join('')}</div>
      <div class="label">Track</div>
      <div class="chips">${chips('track', Object.keys(TRACKS), v => TRACKS[v].name)}</div>
      <div class="label">Mode</div>
      <div class="chips">${chips('mode', ['race', 'knockout'], v => TYPE_LABEL[v])}</div>
      <div class="label">Format</div>
      <div class="chips">${chips('format', ['1v1', '2v2', '3v3', 'ffa'], v => FORMAT_LABEL[v], v => (st.mode === 'knockout' && v !== 'ffa') || tooMany(v))}</div>
      ${st.mode === 'race' ? `<div class="label">Laps</div><div class="chips">${chips('laps', [1, 2, 3, 5])}</div>` : ''}
      <div class="label">AI</div>
      <div class="chips">${chips('fill', [true, false], v => v ? 'Fill empty slots with AI' : 'Players only', v => !v && TEAM_SIZE[st.format])}${chips('diff', ['easy', 'normal', 'hard'], v => v.toUpperCase())}</div>
      <div class="label">Weather</div>
      <div class="chips">${chips('weather', Object.keys(WEATHER), v => `${WEATHER[v].icon} ${WEATHER[v].label}`)}</div>
      <div class="label">Super Powers</div>
      <div class="chips">${chips('powers', [true, false], v => v ? 'ON' : 'OFF')}</div>
      <div class="label">Mystery Boxes & Weapons</div>
      <div class="chips">${chips('items', [true, false], v => v ? '🎁 ON' : 'OFF')}</div>
      <div class="label">Police</div>
      <div class="chips">${chips('police', [false, true], v => v ? '🚨 COPS ON' : 'NO POLICE')}</div>
      <div class="label">Chaos Mode</div>
      <div class="chips">${chips('chaos', [false, true], v => v ? '☄️ METEOR STORM' : 'OFF')}</div>
      <div class="desc" style="margin-top:14px">${slots.total} cars on the grid${slots.ai ? ` (${slots.ai} AI)` : ''}.</div>
      <div class="row">
        ${host ? `<button class="btn primary inline" data-start ${slots.total < 2 || slots.ai < 0 ? 'disabled' : ''}>Start Race</button>` : ''}
        <button class="btn inline" data-leave>Leave Room</button>
      </div></div>`);
    node.querySelector('[data-copy]').onclick = () => navigator.clipboard?.writeText(net.code);
    node.querySelector('[data-leave]').onclick = () => { this.leaveNet(); this.showOnline(); };
    if (!host) return;
    node.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      const k = b.dataset.k, raw = b.dataset.v;
      const v = k === 'laps' ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw;
      const next = { ...st, [k]: v };
      if (next.mode === 'knockout') next.format = 'ffa';
      if (TEAM_SIZE[next.format]) next.fill = true;
      this.netSettings = next;
      net.setSettings(next);
    });
    node.querySelector('[data-start]').onclick = () => {
      const msg = { t: 'start', settings: st, entries: this.buildEntries(st, net.players), seed: Math.random() };
      net.inRace = true;
      net.send(msg);
      this.startOnline(msg);
    };
  }

  slotsFor(st, playerCount) {
    if (TEAM_SIZE[st.format]) return { total: TEAM_SIZE[st.format] * 2, ai: TEAM_SIZE[st.format] * 2 - playerCount };
    const total = st.fill ? Math.max(6, playerCount) : playerCount;
    return { total, ai: total - playerCount };
  }

  // Host only: decide the full grid so every client builds identical cars.
  buildEntries(st, players) {
    const names = [...AI_NAMES].sort(() => Math.random() - 0.5);
    const rnd = a => a[Math.floor(Math.random() * a.length)];
    const ai = (team, color) => ({ id: 'ai' + names.length, kind: 'ai', name: names.pop(), car: rnd(CARS).id, color, team, power: rnd(POWERS).id });
    const human = (p, team) => ({ id: p.id, kind: 'player', name: p.name, car: p.car, color: p.paint, team, power: p.power });
    const n = TEAM_SIZE[st.format];
    if (n) {
      const A = [], B = [];
      players.forEach((p, i) => (i % 2 ? B : A).push(human(p, i % 2 ? 'B' : 'A')));
      while (A.length < n) A.push(ai('A', TEAM_COLORS.A[A.length]));
      while (B.length < n) B.push(ai('B', TEAM_COLORS.B[B.length]));
      const out = [];
      for (let k = 0; k < n; k++) out.push(B[k], A[k]);
      return out;
    }
    const { ai: aiCount } = this.slotsFor(st, players.length);
    const out = players.map(p => human(p, null));
    for (let k = 0; k < aiCount; k++) out.splice(Math.min(out.length, k * 2), 0, ai(null, FFA_COLORS[k]));
    return out;
  }

  startOnline(msg) {
    const st = msg.settings;
    this.inLobby = false;
    this.lastOnline = msg;
    this.startRace({
      title: 'Online Race', type: st.mode, track: st.track, format: st.format,
      laps: st.mode === 'knockout' ? 6 : st.laps, difficulty: DIFFICULTY[st.diff], powers: st.powers, weather: st.weather ?? 'clear',
      items: st.items ?? true, police: !!st.police, chaos: !!st.chaos,
      humans: [this.me()], entries: msg.entries, net: this.net,
    });
  }

  // ---------- Story ----------

  showStory() {
    this.toMenu();
    const node = this.mount(`<div class="screen full">${this.credits()}
      <div class="h2">STORY MODE</div>
      <div class="desc">Rise from street rookie to king of Velocity. Each chapter unlocks the next.</div>
      <div class="cards">${STORY.map((s, i) => {
        const locked = i > save.story, done = i < save.story;
        return `<button class="card ${locked ? 'locked' : ''} ${done ? 'done' : ''}" data-i="${i}" ${locked ? 'disabled' : ''}>
          <span class="tag ${done ? 'good' : ''}">CH ${i + 1}${done ? ' ✓' : locked ? ' 🔒' : ''}</span><span class="tag">${TYPE_LABEL[s.type]}${s.format && s.type === 'race' ? ' · ' + FORMAT_LABEL[s.format] : ''}</span>
          <h3 style="margin-top:8px">${s.title}</h3><p>${TRACKS[s.track].name}</p><div class="meta">◆ ${s.reward.toLocaleString()} CR</div></button>`;
      }).join('')}</div>
      <div class="row"><button class="btn inline" data-go="showMain">Back</button></div></div>`);
    node.querySelectorAll('[data-i]').forEach(b => b.onclick = () => this.briefing(Number(b.dataset.i)));
  }

  briefing(i) {
    const s = STORY[i];
    const node = this.mount(`<div class="overlay"><div class="modal">
      <div class="tag">CHAPTER ${i + 1} · ${TRACKS[s.track].name.toUpperCase()}</div>
      <div class="h2" style="margin-top:10px">${s.title}</div>
      <div class="speaker">${s.speaker}</div>
      <div class="quote">“${s.text}”</div>
      <div class="goal">🎯 ${goalLine(s.goal, s)}${s.police ? '<br>🚨 Police will hunt you. Don\'t get pinned, or you\'re BUSTED.' : ''}<br>◆ Reward ${s.reward.toLocaleString()} CR${s.type === 'race' || s.type === 'knockout' ? `<br>${powerById(save.power).icon} Super powers ON — rivals have them too. Press E.` : ''}</div>
      <div class="row"><button class="btn primary inline" data-start>Start</button><button class="btn inline" data-go="showStory">Back</button></div>
    </div></div>`);
    node.querySelector('[data-start]').onclick = () => this.startRace(this.eventCfg(s, { storyIndex: i, title: `Chapter ${i + 1}: ${s.title}` }));
  }

  eventCfg(s, extra) {
    return {
      type: s.type, track: s.track, format: s.format ?? 'ffa', laps: s.laps, difficulty: s.difficulty ?? 1,
      goal: s.goal, reward: s.reward, rival: s.rival, weather: s.weather ?? 'clear', police: !!s.police, chaos: !!s.chaos,
      humans: [{ car: save.car, name: 'YOU', power: save.power, color: paintOf(save.car), tune: tuneOf(save.car) }],
      powers: s.type === 'race' || s.type === 'knockout', ...extra,
    };
  }

  // ---------- Challenges ----------

  showChallenges() {
    this.toMenu();
    const node = this.mount(`<div class="screen full">${this.credits()}
      <div class="h2">CHALLENGES</div>
      <div class="desc">One-off tests of skill. Rewards pay out on first completion; replay anytime to improve your best.</div>
      <div class="cards">${(() => {
        const d = dailyChallenge(), done = save.daily === d.day;
        return `<button class="card daily ${done ? 'done' : ''}" data-daily>
          <span class="tag ${done ? 'good' : ''}">${done ? 'DAILY · DONE ✓' : 'DAILY CHALLENGE'}</span><span class="tag">${WEATHER[d.weather].icon} ${WEATHER[d.weather].label}</span>
          <h3 style="margin-top:8px">${TYPE_LABEL[d.type]} · ${TRACKS[d.track].name}</h3><p>${d.desc} A new challenge every day.</p>
          <div class="meta">${done ? 'Come back tomorrow' : `◆ ${d.reward.toLocaleString()} CR`}</div></button>`;
      })()}${CHALLENGES.map(c => {
        const rec = save.challenges[c.id];
        return `<button class="card ${rec?.done ? 'done' : ''}" data-id="${c.id}">
          <span class="tag ${rec?.done ? 'good' : ''}">${rec?.done ? 'COMPLETE ✓' : TYPE_LABEL[c.type].toUpperCase()}</span>
          <h3 style="margin-top:8px">${c.title}</h3><p>${c.desc}<br>${TRACKS[c.track].name}</p>
          <div class="meta">${rec?.best ? 'Best: ' + rec.best + ' · ' : ''}◆ ${c.reward.toLocaleString()} CR</div></button>`;
      }).join('')}</div>
      <div class="row"><button class="btn inline" data-go="showMain">Back</button></div></div>`);
    node.querySelector('[data-daily]').onclick = () => {
      const d = dailyChallenge();
      this.startRace(this.eventCfg({ ...d, reward: save.daily === d.day ? 0 : d.reward }, { dailyDay: d.day, title: d.title }));
    };
    node.querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
      const c = CHALLENGES.find(x => x.id === b.dataset.id);
      this.startRace(this.eventCfg(c, { challengeId: c.id, title: c.title }));
    });
  }

  // ---------- Open world ----------

  showWorld() {
    this.toMenu();
    const w = save.world;
    const node = this.mount(`<div class="screen">${this.credits()}
      <div class="h2">OPEN WORLD TOUR</div>
      <div class="desc">A 2 km × 2 km island: downtown, a coastal highway, ridge roads and lakes. Collect coins, hit speed traps and win sprint races for credits. Progress is saved.</div>
      <div class="label">Progress</div>
      <div class="desc" style="color:var(--text);font-size:19px">Coins ${w.coins.length}/45 · Speed traps tried ${Object.keys(w.traps).length}/6 · Sprints finished ${Object.keys(w.sprints).length}/4</div>
      <div class="menu">
        <button class="btn primary" data-n="1">Drive Solo<small>Your car: ${carById(save.car).name}</small></button>
        <button class="btn" data-n="2">Two Player Cruise<small>Split-screen free roam</small></button>
        <button class="btn" data-go="showMain">Back</button>
      </div></div>`);
    node.querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
      const n = Number(b.dataset.n);
      const p2car = this.setupState?.p2car && save.owned.includes(this.setupState.p2car) ? this.setupState.p2car : save.owned[0];
      const p2power = this.setupState?.p2power && save.powers.includes(this.setupState.p2power) ? this.setupState.p2power : save.powers[0];
      const humans = n === 2
        ? [{ car: save.car, name: 'P1', power: save.power, color: paintOf(save.car), tune: tuneOf(save.car) }, { car: p2car, name: 'P2', power: p2power, color: paintOf(p2car), tune: tuneOf(p2car) }]
        : [{ car: save.car, name: 'YOU', power: save.power, color: paintOf(save.car), tune: tuneOf(save.car) }];
      this.root.innerHTML = '';
      this.pauseOpen = false;
      this.game.setSession(new WorldSession(this.game, { humans, world: true }));
    });
  }

  // ---------- Garage ----------

  showGarage(previewId = save.car) {
    this.toMenu();
    this.game.menu.showCar(previewId, paintOf(previewId));
    const max = { maxSpeed: 75, accel: 30, handling: 3.1, grip: 8 };
    const node = this.mount(`<div class="screen">${this.credits()}
      <div class="h2">GARAGE</div>
      <div class="desc">Click a car to preview it. Earn credits from story, challenges, races and the open world.</div>
      <div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr));max-width:560px">${CARS.map(c => {
        const owned = save.owned.includes(c.id), sel = save.car === c.id;
        const t = tuneSpec(c, tuneOf(c.id));
        const stat = (label, k) => `<div class="stat">${label}<div class="bar"><i style="width:${Math.min(100, Math.round((t[k] / max[k]) * 100))}%"></i></div></div>`;
        const lv = k => tuneOf(c.id)?.[k] ?? 0;
        const ups = owned ? `<div class="label" style="margin:12px 0 4px">Upgrades</div>${Object.entries(UPGRADES).map(([k, u]) => `<div class="upg" title="${u.desc}">
          <span>${u.icon} ${u.name}</span><span class="pips">${'●'.repeat(lv(k))}${'○'.repeat(3 - lv(k))}</span>
          ${lv(k) < 3 ? `<button class="chip" data-up="${c.id}:${k}" ${save.credits < u.prices[lv(k)] ? 'disabled' : ''}>◆ ${u.prices[lv(k)].toLocaleString()}</button>` : '<span class="tag good">MAX</span>'}</div>`).join('')}` : '';
        return `<div class="card ${previewId === c.id ? 'sel' : ''}" data-car="${c.id}">
          <h3><span class="swatch" style="background:${hex(paintOf(c.id))}"></span>${c.name}</h3><p>${c.desc}</p>
          ${stat('Top speed', 'maxSpeed')}${stat('Accel', 'accel')}${stat('Handling', 'handling')}${stat('Grip', 'grip')}
          <div class="row" style="margin-top:12px">${sel ? '<span class="tag good">SELECTED</span>'
            : owned ? `<button class="chip" data-select="${c.id}">Select</button>`
            : `<button class="chip" data-buy="${c.id}" ${save.credits < c.price ? 'disabled' : ''}>Buy ◆ ${c.price.toLocaleString()}</button>`}</div>
          ${ups}
          ${owned ? `<div class="label" style="margin:12px 0 0">Paint</div><div class="paints">${[c.color, ...PAINTS.filter(p => p !== c.color)].map(p =>
            `<button class="paint ${paintOf(c.id) === p ? 'on' : ''}" style="background:${hex(p)}" data-paint="${c.id}:${p}" title="${hex(p)}"></button>`).join('')}</div>` : ''}</div>`;
      }).join('')}</div>
      <div class="row"><button class="btn inline" data-go="showMain">Back</button></div></div>`);
    node.querySelectorAll('[data-car]').forEach(c => c.onclick = e => { if (!e.target.closest('button')) this.showGarage(c.dataset.car); });
    node.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
      const [id, k] = b.dataset.up.split(':');
      const cur = save.upgrades[id] ??= { engine: 0, grip: 0, nitro: 0 };
      const price = UPGRADES[k].prices[cur[k] ?? 0];
      if ((cur[k] ?? 0) >= 3 || save.credits < price) return;
      save.credits -= price;
      cur[k] = (cur[k] ?? 0) + 1;
      persist();
      beep(1200, 0.25, 'triangle');
      this.showGarage(id);
    });
    node.querySelectorAll('[data-paint]').forEach(b => b.onclick = () => {
      const [id, col] = b.dataset.paint.split(':');
      save.paint[id] = Number(col);
      persist();
      this.showGarage(id);
    });
    node.querySelectorAll('[data-select]').forEach(b => b.onclick = () => { save.car = b.dataset.select; persist(); this.showGarage(save.car); });
    node.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => {
      const c = carById(b.dataset.buy);
      if (save.credits < c.price) return;
      save.credits -= c.price;
      save.owned.push(c.id);
      save.car = c.id;
      persist();
      beep(1200, 0.3, 'triangle');
      this.showGarage(c.id);
    });
  }

  // ---------- Super powers ----------

  showPowers() {
    this.toMenu();
    const node = this.mount(`<div class="screen full">${this.credits()}
      <div class="h2">SUPER POWERS</div>
      <div class="desc">Unlock powers with credits and equip one. In races press <kbd>E</kbd> (P2: <kbd>Enter</kbd>, gamepad LB) when the meter is full. Drifting charges it twice as fast. AI rivals carry random powers too.</div>
      <div class="cards">${POWERS.map(p => {
        const owned = save.powers.includes(p.id), eq = save.power === p.id;
        const col = '#' + p.color.toString(16).padStart(6, '0');
        return `<div class="card power-card ${eq ? 'sel' : ''} ${owned ? '' : 'locked-soft'}" style="border-top-color:${col}">
          <div class="icon">${p.icon}</div><h3 style="color:${col}">${p.name}</h3><p>${p.desc}</p>
          <div class="meta" style="color:var(--muted)">Recharge ${p.cooldown}s</div>
          <div class="row" style="margin-top:12px">${eq ? '<span class="tag good">EQUIPPED</span>'
            : owned ? `<button class="chip" data-equip="${p.id}">Equip</button>`
            : `<button class="chip" data-unlock="${p.id}" ${save.credits < p.price ? 'disabled' : ''}>Unlock ◆ ${p.price.toLocaleString()}</button>`}</div></div>`;
      }).join('')}</div>
      <div class="row"><button class="btn inline" data-go="showMain">Back</button></div></div>`);
    node.querySelectorAll('[data-equip]').forEach(b => b.onclick = () => { save.power = b.dataset.equip; persist(); this.showPowers(); });
    node.querySelectorAll('[data-unlock]').forEach(b => b.onclick = () => {
      const p = powerById(b.dataset.unlock);
      if (save.credits < p.price) return;
      save.credits -= p.price;
      save.powers.push(p.id);
      save.power = p.id;
      persist();
      beep(1200, 0.3, 'triangle');
      this.showPowers();
    });
  }

  // ---------- Photo mode ----------

  photo() {
    const s = this.game.session;
    if (this.photoMode || !s.humans || s.cfg?.net || s.over) return;
    const pm = this.photoMode = new PhotoMode(this.game, () => { this.photoMode = null; this.root.innerHTML = ''; });
    const render = () => {
      const node = this.mountOverlay(`<div class="photo-bar">
        <span class="tag">📷 PHOTO MODE</span><span class="photo-hint">Drag to orbit · scroll to zoom</span>
        ${pm.looks.map((l, i) => `<button class="chip ${pm.look === i ? 'on' : ''}" data-look="${i}">${l}</button>`).join('')}
        <button class="btn primary inline" data-save>Save Photo</button>
        <button class="btn inline" data-exit>Exit</button></div>`);
      node.querySelectorAll('[data-look]').forEach(b => b.onclick = () => { pm.setLook(Number(b.dataset.look)); render(); });
      node.querySelector('[data-save]').onclick = () => { pm.save(); toast('PHOTO SAVED', 'Check your downloads folder'); };
      node.querySelector('[data-exit]').onclick = () => pm.exit();
    };
    render();
  }

  // ---------- Achievements ----------

  showAchievements() {
    this.toMenu();
    this.mount(`<div class="screen full">${this.credits()}
      <div class="h2">ACHIEVEMENTS</div>
      <div class="desc">${Object.keys(save.ach).length} of ${ACHIEVEMENTS.length} unlocked. Each one pays credits the moment you earn it.</div>
      <div class="cards">${ACHIEVEMENTS.map(a => `<div class="card ach ${save.ach[a.id] ? 'done' : 'lockedach'}" style="cursor:default">
        <div class="icon">${a.icon}</div><div><h3>${a.name}</h3><p>${a.desc}</p>
        <div class="meta">${save.ach[a.id] ? 'UNLOCKED ✓' : `◆ ${a.reward.toLocaleString()} CR`}</div></div></div>`).join('')}</div>
      <div class="desc" style="margin-top:16px">Near misses: ${save.stats.nearMiss ?? 0} · Powers used: ${save.stats.powers ?? 0}</div>
      <div class="row"><button class="btn inline" data-go="showMain">Back</button></div></div>`);
  }

  // ---------- Controls ----------

  showControls() {
    this.toMenu();
    this.mount(`<div class="screen full">
      <div class="h2">CONTROLS</div>
      <table class="keys">
        <tr><th>Action</th><th>Player 1 / Solo</th><th>Player 2</th><th>Gamepad</th></tr>
        <tr><td>Accelerate</td><td><kbd>W</kbd> (solo: <kbd>↑</kbd> too)</td><td><kbd>↑</kbd></td><td>RT</td></tr>
        <tr><td>Brake / Reverse</td><td><kbd>S</kbd></td><td><kbd>↓</kbd></td><td>LT</td></tr>
        <tr><td>Steer</td><td><kbd>A</kbd> <kbd>D</kbd></td><td><kbd>←</kbd> <kbd>→</kbd></td><td>Left stick</td></tr>
        <tr><td>Handbrake / Drift</td><td><kbd>Space</kbd></td><td><kbd>/</kbd> or <kbd>R-Ctrl</kbd></td><td>A</td></tr>
        <tr><td>Nitro (double-tap: shockwave)</td><td><kbd>L-Shift</kbd></td><td><kbd>R-Shift</kbd></td><td>X</td></tr>
        <tr><td>Jump</td><td><kbd>F</kbd></td><td><kbd>;</kbd></td><td>B</td></tr>
        <tr><td>Air tricks</td><td><kbd>W</kbd>/<kbd>S</kbd> flip · <kbd>A</kbd>/<kbd>D</kbd> spin · <kbd>Space</kbd>+<kbd>A</kbd>/<kbd>D</kbd> roll</td><td>Arrows · <kbd>/</kbd>+arrows</td><td>Stick</td></tr>
        <tr><td>Use item</td><td><kbd>X</kbd></td><td><kbd>'</kbd></td><td>Y</td></tr>
        <tr><td>Reset to road</td><td><kbd>R</kbd></td><td><kbd>Backspace</kbd></td><td>Start</td></tr>
        <tr><td>Camera</td><td><kbd>C</kbd></td><td><kbd>.</kbd></td><td>RB</td></tr>
        <tr><td>Super power</td><td><kbd>E</kbd></td><td><kbd>Enter</kbd></td><td>LB</td></tr>
        <tr><td>Rewind (hold)</td><td><kbd>Q</kbd></td><td></td><td>Back</td></tr>
        <tr><td>Photo mode</td><td><kbd>P</kbd> or pause menu</td><td></td><td></td></tr>
        <tr><td>Music on / off</td><td colspan="3"><kbd>M</kbd></td></tr>
        <tr><td>Pause</td><td colspan="3"><kbd>Esc</kbd></td></tr>
      </table>
      <div class="desc" style="margin-top:20px">Drifting fills the nitro bar. Driving flat out on tarmac trickles it too. Off-road slows you down.<br>
        Air tricks: jump with F or launch off a ramp, rotate with the keys, and land wheels-down. Land crooked and you crash.<br>
        Mystery boxes: drive through a <b>?</b> box for a missile, mine, oil slick, bubble shield or rocket boost, then press X.<br>
        Style points: tuck in behind a car to slipstream, pass close to cars for near misses, overtake and chain drifts. Landing tricks within 3 seconds builds a combo up to x5.</div>
      <div class="row"><button class="btn inline" data-go="showMain">Back</button></div></div>`);
  }

  // ---------- In-game overlays ----------

  togglePause() {
    if (this.photoMode) { this.photoMode.exit(); return; }
    const g = this.game;
    const s = g.session;
    if (this.pauseOpen) { g.paused = false; this.pauseOpen = false; this.root.innerHTML = ''; return; }
    this.pauseOpen = true;
    g.paused = !s.cfg?.net; // an online race keeps running for everyone else
    const node = this.mountOverlay(`<div class="overlay"><div class="modal">
      <div class="h2">PAUSED</div>
      <div class="menu" style="width:100%">
        <button class="btn primary" data-a="resume">Resume</button>
        ${s.cfg?.net ? '' : '<button class="btn" data-a="photo">Photo Mode<small>Free camera, filters, save PNG</small></button>'}
        ${s.cfg?.world || s.cfg?.net ? '' : '<button class="btn" data-a="restart">Restart</button>'}
        <button class="btn" data-a="quit">${s.cfg?.net ? 'Leave Online Race' : 'Quit to Menu'}</button>
      </div></div></div>`);
    node.querySelector('[data-a=resume]').onclick = () => this.togglePause();
    node.querySelector('[data-a=photo]')?.addEventListener('click', () => { this.pauseOpen = false; this.game.paused = false; this.photo(); });
    node.querySelector('[data-a=restart]')?.addEventListener('click', () => this.startRace(s.cfg));
    node.querySelector('[data-a=quit]').onclick = () => {
      this.pauseOpen = false;
      if (s.cfg?.net) { this.leaveNet(); this.showOnline(); } else this.showMain();
    };
  }

  showResults(res, cfg) {
    this.pauseOpen = false;
    // Challenge and daily rewards pay out once; replays still earn style credits.
    const repeat = (cfg.challengeId && save.challenges[cfg.challengeId]?.done) || (cfg.dailyDay && save.daily === cfg.dailyDay);
    if (repeat && res.success && cfg.reward) res.credits = Math.max(0, res.credits - cfg.reward);
    // Rewards and progression.
    let unlocked = '';
    save.credits += res.credits;
    if (res.success && cfg.storyIndex === STORY.length - 1) unlock('story');
    if (res.success && cfg.dailyDay && save.daily !== cfg.dailyDay) { save.daily = cfg.dailyDay; unlock('daily'); }
    if (res.success && cfg.storyIndex != null && cfg.storyIndex === save.story) {
      save.story++;
      unlocked = save.story < STORY.length ? `Chapter ${save.story + 1} unlocked!` : 'Story complete. You own Velocity.';
    }
    if (cfg.challengeId) {
      const rec = save.challenges[cfg.challengeId] ??= { done: false, best: null };
      if (res.success) rec.done = true;
      if (res.type === 'drift' && (!rec.bestN || res.p1Drift > rec.bestN)) { rec.bestN = res.p1Drift; rec.best = res.p1Drift.toLocaleString() + ' pts'; }
      if (res.type === 'timeTrial' && res.p1Time && (!rec.bestN || res.p1Time < rec.bestN)) { rec.bestN = res.p1Time; rec.best = fmtTime(res.p1Time); }
    }
    persist();

    const showTeams = !!res.teams;
    const rows = res.rows.map(r => `<tr class="${r.human ? 'me' : ''}">
      <td>${r.pos}</td>
      <td>${r.team ? `<span class="swatch" style="background:var(--team${r.team})"></span>` : ''}${esc(r.name)}</td>
      <td>${r.status}</td><td>${fmtTime(r.best)}</td>${res.type === 'drift' ? `<td>${r.drift.toLocaleString()}</td>` : ''}</tr>`).join('');
    const next = cfg.storyIndex != null && res.success && cfg.storyIndex + 1 < STORY.length;
    const online = !!cfg.net;

    const node = this.mountOverlay(`<div class="overlay"><div class="modal">
      <div class="tag">${esc(cfg.title ?? 'Race')} · ${res.track}</div>
      <div class="result-head ${res.success ? 'win' : 'lose'}" style="margin-top:8px">${res.head}</div>
      ${res.goalText ? `<div class="goal">🎯 ${res.goalText}</div>` : ''}
      ${showTeams ? `<div class="teamscore"><div style="background:var(--teamA)">BLUE ${res.teams.A}</div><div style="background:var(--teamB)">${res.teams.B} RED</div></div>` : ''}
      <table class="results"><tr><th>#</th><th>Driver</th><th>Time</th><th>Best lap</th>${res.type === 'drift' ? '<th>Drift</th>' : ''}</tr>${rows}</table>
      ${res.style ? `<div class="goal">🔥 Style ${res.style.toLocaleString()} pts → +${res.styleCredits.toLocaleString()} CR${res.ghostSaved ? '<br>👻 New best run saved as your ghost' : ''}</div>` : res.ghostSaved ? '<div class="goal">👻 New best run saved as your ghost</div>' : ''}
      <div class="goal">◆ +${res.credits.toLocaleString()} CR earned · Balance ${save.credits.toLocaleString()} CR${unlocked ? `<br>⭐ ${unlocked}` : ''}</div>
      <div class="row">
        ${next ? '<button class="btn primary inline" data-a="next">Next Chapter</button>' : ''}
        ${online ? `<button class="btn primary inline" data-a="lobby">${this.net?.role === 'host' ? 'Back to Lobby' : 'Lobby (host starts next race)'}</button>
          <button class="btn inline" data-a="leave">Leave Room</button>` : `
        <button class="btn ${next ? '' : 'primary'} inline" data-a="retry">Race Again</button>
        <button class="btn inline" data-a="menu">Menu</button>`}
      </div></div></div>`);
    if (online) {
      node.querySelector('[data-a=lobby]').onclick = () => {
        if (!this.net) return this.showOnline('Disconnected from the room.');
        if (this.net.role === 'host') { this.net.inRace = false; this.net.send({ t: 'lobbyBack' }); }
        this.showLobby();
      };
      node.querySelector('[data-a=leave]').onclick = () => { this.leaveNet(); this.showOnline(); };
      return;
    }
    node.querySelector('[data-a=retry]').onclick = () => this.startRace(cfg);
    node.querySelector('[data-a=menu]').onclick = () => (cfg.storyIndex != null ? this.showStory() : cfg.challengeId ? this.showChallenges() : this.showMain());
    node.querySelector('[data-a=next]')?.addEventListener('click', () => this.briefing(cfg.storyIndex + 1));
  }
}
