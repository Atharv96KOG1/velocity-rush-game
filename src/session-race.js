import * as THREE from 'three';
import { TRACKS, THEMES, CARS, AI_NAMES, carById, PAYOUT, tuneSpec } from './data.js';
import { Track } from './track.js';
import { Car } from './car.js';
import { AIDriver } from './ai.js';
import { readControls, IDLE } from './input.js';
import { canvasTex, makeEnvMap, makeSky, makeLights, buildCircuitScenery, makeLabel, groundMesh } from './env.js';
import { ChaseCam, collideCars, Smoke, hideNearCameras, disposeScene } from './common.js';
import { HUD, Minimap } from './hud.js';
import { EngineSound, beep } from './audio.js';
import { Sparks, Rings, Trail } from './fx.js';
import { PowerSystem, POWERS } from './powers.js';
import { StyleTracker } from './style.js';
import { weatherTheme, fogRange, Rain } from './weather.js';
import { GhostRecorder, GhostPlayer, loadGhost } from './ghost.js';
import { unlock, count } from './achieve.js';
import { Rewind, REWINDS } from './rewind.js';
import { Action } from './action.js';
import { Items } from './items.js';
import { MeteorStorm } from './chaos.js';

const TEAM_COLORS = { A: [0x3a86ff, 0x4cc9f0, 0x4361ee], B: [0xff006e, 0xf72585, 0xff5d8f] };
const FFA_COLORS = [0xffbe0b, 0x8338ec, 0x06d6a0, 0xfb5607, 0xe5e5e5, 0x118ab2];
export const TEAM_SIZE = { '1v1': 1, '2v2': 2, '3v3': 3 };
export { TEAM_COLORS, FFA_COLORS };
const NET_RATE = 1 / 20;
// State flag bits sent over the network.
const F = { nitro: 1, turbo: 2, shield: 4, ghost: 8, stun: 16, brake: 32, drift: 64, shock: 128, pad: 256, mega: 512, tiny: 1024 };

export const fmtTime = t => {
  if (t == null || !isFinite(t)) return '—';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

/**
 * One circuit event. cfg:
 *  { track, type: race|timeTrial|drift|knockout, format: 1v1|2v2|3v3|ffa, laps, difficulty,
 *    humans: [{ car, name }], coop, goal, reward, rival, title, storyIndex, challengeId,
 *    net, entries: [{ id, kind: player|ai, name, car, color, team, power }] (online only) }
 */
export class RaceSession {
  constructor(game, cfg) {
    this.game = game;
    this.cfg = cfg;
    this.pausable = true;
    this.over = false;
    const def = TRACKS[cfg.track];
    const weather = this.weather = cfg.weather ?? 'clear';
    const th = weatherTheme(THEMES[def.theme], weather);
    this.theme = th;
    this.solo = cfg.type === 'timeTrial' || cfg.type === 'drift';
    this.net = cfg.net ?? null;
    this.authority = !this.net || this.net.role === 'host';
    this.netT = 0;
    this.teamMode = !this.solo && !!TEAM_SIZE[cfg.format];

    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.Fog(th.fog, ...fogRange(weather, th.night));
    const sky = makeSky(th.skyTop, th.skyBottom, th.night);
    scene.add(sky);
    scene.environment = makeEnvMap(game.renderer, sky);
    scene.environmentIntensity = th.night ? 1.2 : 0.55;
    this.lights = makeLights(scene, th);
    this.bloomStrength = th.night ? 0.95 : 0.35;
    scene.add(groundMesh(th));

    const track = this.track = new Track(def.points, { width: def.width });
    scene.add(track.buildMesh({ walls: true, wallGap: 3.5, night: th.night, wet: weather === 'rain' }));
    scene.add(track.startGate());

    // Boost pads: glowing chevrons that scroll toward the driver.
    this.padTex = canvasTex(64, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(8,217,214,.35)';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#7ff6ff';
      g.lineWidth = 9;
      for (let y = -20; y < h; y += 42) { g.beginPath(); g.moveTo(6, y + 30); g.lineTo(w / 2, y); g.lineTo(w - 6, y + 30); g.stroke(); }
    });
    this.padTex.repeat.set(1, 2);
    this.pads = track.boostPads(4);
    for (const p of this.pads) scene.add(track.padMesh(p, this.padTex));
    scene.add(buildCircuitScenery(track, th));
    this.smoke = new Smoke(scene);
    if (weather === 'rain') this.rain = new Rain(scene, this.lights.hemi);
    else if (th.scenery === 'snow') this.rain = new Rain(scene, this.lights.hemi, 2200, { snow: true });
    this.fx = { sparks: new Sparks(scene), rings: new Rings(scene) };
    this.powers = cfg.powers ? new PowerSystem(scene, {
      fx: this.fx,
      rivals: car => this.cars.filter(o => o !== car && (!car.team || o.team !== car.team)),
      owns: car => !car.remote,
      blink: (car, m) => this.blinkTarget(car, m),
      shake: (car, a) => { if (car.cam) car.cam.shake = Math.max(car.cam.shake, a); },
      onUse: (car, d) => {
        if (car.isHuman) { this.hud.msg(`${d.icon} ${d.name.toUpperCase()}!`, 1.4, car.player, '#' + new THREE.Color(d.color).getHexString()); car.cam.shake = Math.max(car.cam.shake, 0.5); }
        else if (this.humans.some(h => Math.hypot(h.pos.x - car.pos.x, h.pos.z - car.pos.z) < 60)) this.hud.msg(`${car.name} used ${d.name}`, 1.4);
      },
    }) : null;

    this.cars = [];
    this.humans = [];
    this.setupCars();

    if (weather === 'rain') for (const c of this.cars) c.gripMul = 0.82;
    else if (th.scenery === 'snow') for (const c of this.cars) c.gripMul = 0.86;

    // Ghost of the best run in solo events.
    if (this.solo && this.humans.length === 1 && !this.net) {
      this.recorder = new GhostRecorder();
      const best = loadGhost(cfg.track, cfg.laps, cfg.type);
      if (best) this.ghost = new GhostPlayer(scene, best);
    }

    this.views = this.humans.map((h, i) => ({
      camera: h.cam.camera,
      rect: this.humans.length === 1 ? [0, 0, 1, 1] : i === 0 ? [0, 0.5, 1, 0.5] : [0, 0, 1, 0.5],
    }));
    this.humans.forEach((h, i) => {
      h.cam.camera.layers.enableAll();
      h.cam.camera.layers.disable(10 + i);
    });

    this.minimap = new Minimap([track], 190);
    this.hud = new HUD(this.humans.length, {
      team: this.teamMode, minimap: this.minimap,
      hint: this.humans.length === 2
        ? 'P1: WASD · Space drift · L-Shift nitro · F jump · X item · E power    |    P2: Arrows · / drift · R-Shift nitro · ; jump · \' item · Enter power'
        : 'W/↑ gas · S/↓ brake · A D steer · SPACE drift · SHIFT nitro (2× shockwave) · F jump (air: W/S flip, A/D spin, SPACE+A/D roll) · X item · E power · Q rewind · ESC pause',
    });

    this.rank();
    this.style = new StyleTracker(this.hud, this.humans, {
      overtakes: !this.solo,
      onEvent: (h, label, st) => {
        if (label === 'NEAR MISS') count('nearMiss', 'nearMiss25', 25);
        if (st.mult >= 5) unlock('combo5');
      },
    });
    if (this.ghost) this.hud.msg(`👻 GHOST: YOUR BEST ${fmtTime(this.ghost.data.time)}`, 4);
    if (weather === 'rain') this.hud.msg('🌧️ WET TRACK · LESS GRIP', 3);
    else if (th.scenery === 'snow') this.hud.msg('❄️ ICY TRACK · LESS GRIP', 3);

    // Ramps, obstacles, takedowns, shockwave nitro, police and the countdown flyby.
    // Online, every client runs it for the cars it owns and syncs events through the host.
    this.action = new Action(this);
    // Mystery boxes and weapons, on by default in offline races.
    if (this.action && !this.solo && (cfg.items ?? true)) this.items = new Items(this, this.action);
    // Chaos mode: meteors rain onto the track.
    if (cfg.chaos && !this.solo) this.meteors = new MeteorStorm(this, this.action);

    // Rewind: offline only (online races can't roll back other players), not in knockout.
    if (!this.net && cfg.type !== 'knockout') this.rewind = new Rewind(this);

    this.state = 'countdown';
    this.clock = 3.6;
    this.lastCount = 4;
    this.time = 0;
    this.koLap = 1;
    this.elimCount = 0;
    this.dnf = null;
    this.prevButtons = this.humans.map(() => ({ cam: false, reset: false }));
    this.rank();

    if (this.net) {
      this.unsub = [
        this.net.on('msg', m => this.onNet(m)),
        this.net.on('closed', () => this.hostLost()),
      ];
    }
  }

  setupCars() {
    if (this.cfg.entries) return this.setupOnline();
    const { cfg, track } = this;
    const humanCfg = cfg.humans;
    const entries = [];
    const names = [...AI_NAMES].sort(() => Math.random() - 0.5).filter(n => n !== cfg.rival);
    let rivalUsed = !cfg.rival;
    const ai = (team, color) => {
      const name = rivalUsed ? names.pop() : cfg.rival;
      rivalUsed = true;
      return { human: -1, team, color, name };
    };

    if (this.solo) {
      humanCfg.forEach((h, i) => entries.push({ human: i, team: null }));
    } else if (this.teamMode) {
      const n = TEAM_SIZE[cfg.format];
      const A = [], B = [];
      humanCfg.forEach((h, i) => ((i === 1 && (!cfg.coop || n === 1)) ? B : A).push({ human: i, team: i === 1 && (!cfg.coop || n === 1) ? 'B' : 'A' }));
      while (A.length < n) A.push(ai('A', TEAM_COLORS.A[A.length]));
      while (B.length < n) B.push(ai('B', TEAM_COLORS.B[B.length]));
      // Interleave the teams on the grid: B, A, B, A...
      for (let k = 0; k < n; k++) entries.push(B[k], A[k]);
    } else {
      const total = 6, aiCount = total - humanCfg.length;
      const ais = Array.from({ length: aiCount }, (_, k) => ai(null, FFA_COLORS[k]));
      const humansE = humanCfg.map((h, i) => ({ human: i, team: null }));
      const mid = Math.floor(aiCount / 2) + 1;
      entries.push(...ais.slice(0, mid), ...humansE, ...ais.slice(mid));
    }

    entries.forEach((e, k) => {
      let car;
      if (e.human >= 0) {
        const h = humanCfg[e.human];
        const spec = tuneSpec(carById(h.car), h.tune);
        car = new Car(spec, { name: h.name, team: e.team, human: true, player: e.human, color: h.color ?? spec.color });
      } else {
        const spec = CARS[Math.floor(Math.random() * CARS.length)];
        car = new Car(spec, { name: e.name, team: e.team, color: e.color });
      }
      const skill = car.isHuman ? 0.7 : (cfg.difficulty ?? 0.95) * (0.96 + Math.random() * 0.06) + (e.name === cfg.rival ? 0.03 : 0);
      this.addCar(car, k, entries.length, skill);
    });
    this.humans = this.cars.filter(c => c.isHuman).sort((a, b) => a.player - b.player);
    this.players = this.humans;
    for (const car of this.cars) {
      car.trail = new Trail(this.scene, this.theme.night ? 0xff1a3c : 0xff4060);
      if (this.powers) this.powers.attach(car, car.isHuman ? (cfg.humans[car.player].power ?? 'turbo') : POWERS[Math.floor(Math.random() * POWERS.length)].id);
    }
  }

  // Online: the host decides the full grid; every client builds it identically.
  setupOnline() {
    const { cfg, net } = this;
    cfg.entries.forEach((e, k) => {
      const local = e.id === net.localId;
      const car = new Car(local ? tuneSpec(carById(e.car), cfg.humans[0].tune) : carById(e.car), { name: e.name, team: e.team, human: local, player: local ? 0 : -1, color: e.color ?? carById(e.car).color });
      car.id = e.id;
      car.netPlayer = e.kind === 'player';
      car.remote = !local && !(e.kind === 'ai' && this.authority);
      this.addCar(car, k, cfg.entries.length, (cfg.difficulty ?? 0.95) * (0.97 + (k % 3) * 0.02));
    });
    this.humans = this.cars.filter(c => c.isHuman);
    this.players = this.cars.filter(c => c.netPlayer);
    this.byId = new Map(this.cars.map(c => [c.id, c]));
    cfg.entries.forEach((e, k) => {
      const car = this.cars[k];
      car.trail = new Trail(this.scene, this.theme.night ? 0xff1a3c : 0xff4060);
      if (this.powers) this.powers.attach(car, e.power ?? 'turbo');
    });
  }

  addCar(car, k, total, skill) {
    const { cfg, track } = this;
    const rowGap = Math.max(1, Math.round(9 / track.seg));
    {
      const e = { name: car.name };
      const idx = track.wrap(-4 - Math.floor(k / 2) * rowGap);
      const side = this.solo ? (k - (total - 1) / 2) * 5 : (k % 2 ? 1 : -1) * track.width * 0.22;
      const x = track.px[idx] - track.tz[idx] * side, z = track.pz[idx] + track.tx[idx] * side;
      car.place(x, z, Math.atan2(track.tx[idx], track.tz[idx]));
      car.trackIndex = track.nearest(x, z);
      car.progress = car.trackIndex;
      car.ai = new AIDriver(car, track, car.isHuman ? 0.7 : skill);

      const labelColor = car.team === 'A' ? '#6fb1ff' : car.team === 'B' ? '#ff6fa8' : '#ffffff';
      const label = makeLabel(car.name, car.netPlayer && !car.isHuman ? '#ffd166' : labelColor, true);
      label.position.y = 2.6;
      if (car.isHuman) label.layers.set(10 + car.player);
      car.mesh.add(label);

      this.scene.add(car.mesh);
      this.cars.push(car);
      if (car.isHuman) {
        car.cam = new ChaseCam(car);
        car.prevPower = false;
        car.engine = new EngineSound();
        if (this.theme.night) {
          const spot = new THREE.SpotLight(0xfff2d0, 400, 120, 0.55, 0.5, 1.4);
          spot.position.set(0, 1, 1.8);
          spot.target.position.set(0, 0, 20);
          car.mesh.add(spot, spot.target);
        }
      }
    }
  }

  // ---------- Networking ----------

  packState(c) {
    let f = 0;
    if (c.nitroOn) f |= F.nitro;
    if (c.turbo > 0) f |= F.turbo;
    if (c.shield > 0) f |= F.shield;
    if (c.ghost > 0) f |= F.ghost;
    if (c.stun > 0) f |= F.stun;
    if (c.braking) f |= F.brake;
    if (c.drifting) f |= F.drift;
    if (c.shockNitro > 0) f |= F.shock;
    if (c.padBoost > 0) f |= F.pad;
    if (c.mega > 0) f |= F.mega;
    if (c.tiny > 0) f |= F.tiny;
    const r = v => Math.round(v * 100) / 100;
    return [c.id, r(c.pos.x), r(c.pos.z), r(c.yaw), r(c.vx), r(c.vz), r(c.fwdSpeed), r(c.latSpeed), r(c.steerVis),
      c.lap, c.trackIndex, r(c.boost), f, c.finished ? r(c.finishTime) : -1, Math.round(c.driftScore), c.bestLap == null ? -1 : r(c.bestLap),
      r(c.pos.y), r(c.pitch), r(c.roll), r(c.visYaw)];
  }

  onNet(m) {
    switch (m.t) {
      case 's':
        for (const a of m.c) {
          const car = this.byId.get(a[0]);
          if (!car || !car.remote) continue;
          const [, x, z, yaw, vx, vz, fwd, lat, steer, lap, ti, boost, f, fin, drift, best, y = 0, pitch = 0, roll = 0, visYaw = 0] = a;
          car.net = { x, z, yaw, vx, vz, y, at: performance.now() / 1000 };
          car.pitch = pitch; car.roll = roll; car.visYaw = visYaw;
          car.shockNitro = f & F.shock ? 0.3 : 0; car.padBoost = f & F.pad ? 0.3 : 0;
          car.mega = f & F.mega ? 0.3 : 0; car.tiny = f & F.tiny ? 0.3 : 0;
          car.fwdSpeed = fwd; car.latSpeed = lat; car.steerVis = steer; car.boost = boost;
          car.nitroOn = !!(f & F.nitro); car.braking = !!(f & F.brake); car.drifting = !!(f & F.drift);
          car.turbo = f & F.turbo ? 0.3 : 0; car.shield = f & F.shield ? 0.3 : 0;
          car.ghost = f & F.ghost ? 0.3 : 0; car.stun = f & F.stun ? 0.3 : 0;
          car.lap = lap; car.trackIndex = ti; car.progress = lap * this.track.N + ti;
          car.driftScore = drift;
          car.bestLap = best < 0 ? null : best;
          if (fin >= 0 && !car.finished) { car.finished = true; car.finishTime = fin; }
        }
        break;
      case 'wk': case 'sw': case 'box': case 'use': case 'hz': case 'mh': case 'mt': case 'bust': case 'ob':
        this.action?.onNet(m);
        this.items?.onNet(m);
        this.meteors?.onNet(m);
        break;
      case 'pw': {
        const car = this.byId.get(m.id);
        if (car && car.remote && this.powers) this.powers.use(car, true);
        break;
      }
      case 'elim': {
        const car = this.byId.get(m.id);
        if (car && !car.eliminated) this.eliminate(car);
        break;
      }
      case 'end':
        if (this.state === 'race') this.endIn(m.delay, true);
        break;
      case 'left': {
        const car = this.byId.get(m.id);
        if (!car || car.left) break;
        car.left = true;
        car.eliminated = true;
        car.elimOrder = 0;
        car.mesh.visible = false;
        car.trail.mat.uniforms.strength.value = 0;
        this.hud.msg(`${car.name} LEFT THE RACE`, 3, null, '#ff6fa8');
        break;
      }
    }
  }

  hostLost() {
    if (this.over || this.disposed) return;
    const net = this.net;
    this.over = true;
    this.state = 'done';
    this.hud.center('HOST LEFT', 4);
    // Only act if this race and this connection are still current (the player may have moved on).
    setTimeout(() => { if (this.game.ui.net === net && this.game.session === this) this.game.ui.netLost('The host closed the room.'); }, 2500);
  }

  // Remote cars glide toward their last known state, extrapolated by velocity.
  followNet(car, dt) {
    const n = car.net;
    if (!n) return;
    const age = Math.min(0.25, performance.now() / 1000 - n.at);
    const tx = n.x + n.vx * age, tz = n.z + n.vz * age;
    const dx = tx - car.pos.x, dz = tz - car.pos.z;
    if (dx * dx + dz * dz > 400) { car.pos.x = tx; car.pos.z = tz; }
    else {
      const k = 1 - Math.exp(-dt * 14);
      car.pos.x += dx * k; car.pos.z += dz * k;
    }
    car.pos.y += ((n.y ?? 0) - car.pos.y) * (1 - Math.exp(-dt * 16));
    let dy = n.yaw - car.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    car.yaw += dy * (1 - Math.exp(-dt * 14));
    car.vx = n.vx; car.vz = n.vz;
    car.spin += (car.fwdSpeed * dt) / 0.38;
  }

  sendState(dt) {
    this.netT += dt;
    if (this.netT < NET_RATE) return;
    this.netT = 0;
    const mine = [...this.cars, ...(this.authority ? this.action?.cops ?? [] : [])].filter(c => !c.remote && !c.left);
    if (mine.length) this.net.send({ t: 's', c: mine.map(c => this.packState(c)) });
  }

  blinkTarget(car, metres) {
    const t = this.track, i = t.wrap(car.trackIndex + Math.round(metres / t.seg));
    t.measure(car.pos.x, car.pos.z, car.trackIndex);
    const lat = Math.max(-t.width * 0.3, Math.min(t.width * 0.3, t.lat));
    return { x: t.px[i] - t.tz[i] * lat, y: 0, z: t.pz[i] + t.tx[i] * lat, yaw: Math.atan2(t.tx[i], t.tz[i]) };
  }

  // ---------- Simulation (fixed step) ----------

  update(dt) {
    if (this.rewind?.active) return;
    if (this.action) dt *= this.action.timeScale;
    const counting = this.state === 'countdown';
    if (counting) {
      this.clock -= dt;
      const n = Math.ceil(this.clock);
      if (n !== this.lastCount && n <= 3) {
        this.lastCount = n;
        if (n > 0) { this.hud.center(String(n), 1); beep(440, 0.18); }
      }
      if (this.clock <= 0) {
        this.state = 'race';
        this.hud.center('GO!', 1);
        beep(880, 0.45);
      }
    } else if (this.state !== 'done') {
      this.time += dt;
    }

    for (const car of this.cars) {
      if (car.eliminated) continue;
      if (car.wreck > 0) continue;
      if (car.remote) { this.followNet(car, dt); continue; }
      let c;
      if (counting) c = IDLE;
      else if (car.isHuman && !car.finished && this.state !== 'done') c = readControls(car.player, this.humans.length === 1);
      else c = car.ai.control(dt, this.cars);
      if (this.action) c = this.action.filter(car, c);
      car.input = c;
      if (this.powers && !counting && this.state !== 'done') {
        if (car.isHuman && !car.finished) {
          if (c.power && !car.prevPower && this.powers.use(car)) {
            this.net?.send({ t: 'pw', id: car.id });
            count('powers', 'powers25', 25);
          }
          car.prevPower = c.power;
        } else {
          const ahead = this.cars.filter(o => o !== car && (!car.team || o.team !== car.team) && !o.eliminated
            && o.progress > car.progress && o.progress - car.progress < 50).length;
          if (this.powers.aiUse(car, { straight: (car.ai.bend ?? 1) < 0.12, rivalsAhead: ahead })) this.net?.send({ t: 'pw', id: car.id });
        }
      }
      car.update(dt, c);
      this.constrain(car);
      this.action?.air(car, dt);
      if (!car.isHuman || car.finished) this.unstick(car, dt, counting);
    }
    this.action?.update(dt, counting);
    this.items?.update(dt);
    this.meteors?.update(dt);
    this.powers?.update(dt);
    const solid = [...this.cars, ...(this.action?.cops ?? [])].filter(c => !c.eliminated && !(c.wreck > 0) && !c.air);
    collideCars(solid, (a, b, x, y, z, v) => {
      this.fx.sparks.emit(x, y, z, Math.min(40, v * 3), 0xffc46b, 7, 3);
      for (const c of [a, b]) if (c.cam) c.cam.shake = Math.max(c.cam.shake, Math.min(1, v / 15));
      this.action?.onHit(a, b, v);
    });
    this.rank();
    if (this.rewind && this.state === 'race') this.rewind.record(dt);
    this.style.update(dt, this.action ? [...this.cars, ...this.action.cops] : this.cars, this.state === 'race');
    if (this.recorder && this.state === 'race' && !this.humans[0].finished) this.recorder.record(this.time, this.humans[0]);
    this.rubberBand();
    if (this.cfg.type === 'knockout' && this.authority) this.knockout();
    this.checkEnd(dt);
  }

  constrain(car) {
    const t = this.track;
    const i = t.nearest(car.pos.x, car.pos.z, car.trackIndex);
    const W = t.width / 2, lat = t.lat, lim = W + 3.5 - 1.1;
    car.surface = Math.abs(lat) <= W + 1.4 ? 1 : 0.55;
    if (Math.abs(lat) > lim) {
      const s = Math.sign(lat), rx = -t.tz[i] * s, rz = t.tx[i] * s;
      const pen = Math.abs(lat) - lim;
      car.pos.x -= rx * pen;
      car.pos.z -= rz * pen;
      const vn = car.vx * rx + car.vz * rz;
      if (vn > 0) this.action?.onWall(car, vn);
      if (vn > 4 && Math.random() < 0.5) {
        this.fx.sparks.emit(car.pos.x + rx * 1.1, car.pos.y + 0.5, car.pos.z + rz * 1.1, Math.min(30, vn * 2), 0xffd27a, 6, 3);
        if (car.cam) car.cam.shake = Math.max(car.cam.shake, Math.min(0.8, vn / 20));
      }
      if (vn > 0) {
        car.vx -= rx * vn * 1.35;
        car.vz -= rz * vn * 1.35;
        car.vx *= 0.99; car.vz *= 0.99;
      }
    }
    for (const p of this.pads) {
      const di = Math.abs(i - p.i);
      if (Math.min(di, t.N - di) <= 2 && Math.abs(lat - p.lat) < 2.6) {
        if (car.padBoost < 0.2 && car.isHuman) { beep(1300, 0.12, 'triangle', 0.15); if (car.cam) car.cam.shake = Math.max(car.cam.shake, 0.3); }
        car.padBoost = 1.1;
      }
    }
    const prev = car.trackIndex, N = t.N;
    if (prev > N * 0.75 && i < N * 0.25) this.crossLine(car);
    else if (prev < N * 0.25 && i > N * 0.75) car.lap--;
    car.trackIndex = i;
    car.progress = car.lap * N + i;
  }

  crossLine(car) {
    car.lap++;
    if (this.state === 'countdown') return;
    if (car.lap >= 2) {
      const lt = this.time - car.lapStart;
      if (car.bestLap == null || lt < car.bestLap) car.bestLap = lt;
      if (car.isHuman && !car.finished && car.lap <= this.cfg.laps) {
        this.hud.msg(`LAP ${car.lap - 1}  ${fmtTime(lt)}`, 2.5, car.player);
        if (car.lap === this.cfg.laps) this.hud.msg('FINAL LAP', 2.5, car.player, '#ffd166');
      }
    }
    car.lapStart = this.time;
    if (car.lap > this.cfg.laps && this.cfg.type !== 'knockout' && !car.finished && this.state === 'race') {
      car.finished = true;
      car.finishTime = this.time;
      this.rank();
      if (car.isHuman) {
        this.hud.center(this.solo ? 'FINISH' : `P${car.position}`, 3, car.player);
        beep(1200, 0.4, 'triangle');
      }
    }
  }

  unstick(car, dt, counting) {
    if (counting || car.speed > 2 || car.wreck > 0 || car.busted > 0) { car.stuck = 0; return; }
    car.stuck += dt;
    if (car.stuck > 2.5) this.resetCar(car);
  }

  resetCar(car) {
    const t = this.track, i = t.wrap(car.trackIndex);
    car.place(t.px[i], t.pz[i], Math.atan2(t.tx[i], t.tz[i]));
    car.stuck = 0;
    car.trail?.reset();
    car.air = false;
    car.vy = 0;
    car.roll = car.pitch = car.visYaw = 0;
  }

  rank() {
    const act = this.cars.filter(c => !c.eliminated);
    act.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
    const out = this.cars.filter(c => c.eliminated).sort((a, b) => b.elimOrder - a.elimOrder);
    this.order = [...act, ...out];
    this.order.forEach((c, k) => { c.position = k + 1; });
  }

  // Gentle catch-up so races stay close; never applied in solo modes.
  rubberBand() {
    if (this.solo) return;
    const lead = Math.max(...this.players.map(h => h.progress));
    for (const c of this.cars) {
      if (c.isHuman || c.remote || c.netPlayer) continue;
      const gap = (c.progress - lead) * this.track.seg;
      c.ai.rubber = gap < -150 ? 1.06 : gap > 200 ? 0.95 : 1;
    }
  }

  knockout() {
    const act = this.order.filter(c => !c.eliminated);
    const leader = act[0];
    if (!leader || leader.lap <= this.koLap) return;
    this.koLap = leader.lap;
    if (leader.lap < 2 || act.length <= 1) return;
    const out = act[act.length - 1];
    this.net?.send({ t: 'elim', id: out.id });
    this.eliminate(out);
  }

  eliminate(out) {
    const left = this.cars.filter(c => !c.eliminated).length;
    out.eliminated = true;
    out.elimOrder = ++this.elimCount;
    out.mesh.visible = false;
    out.trail.mat.uniforms.strength.value = 0;
    this.fx.rings.emit(out.pos.x, out.pos.y, out.pos.z, 0xff2e63, 14, 0.6);
    this.fx.sparks.emit(out.pos.x, out.pos.y + 1, out.pos.z, 150, 0xff6b35, 16, 9);
    for (let k = 0; k < 14; k++) this.smoke.emit(out.pos.x, out.pos.y, out.pos.z, 2);
    this.hud.msg(`${out.name} ELIMINATED · ${left - 1} LEFT`, 3, null, '#ff2e63');
    beep(220, 0.4, 'sawtooth');
    this.rank();
  }

  checkEnd(dt) {
    if (this.state === 'finishing') {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.finish();
      return;
    }
    if (this.state !== 'race') return;
    const humansDone = this.players.every(h => h.finished || h.eliminated);
    if (this.cfg.type === 'knockout') {
      const left = this.cars.filter(c => !c.eliminated).length;
      if (left <= 1 || humansDone) this.endIn(2.5);
      return;
    }
    if (humansDone) { this.endIn(2.5); return; }
    if (this.order[0].finished) {
      if (this.dnf == null) {
        // Everyone still racing gets a fixed window to cross the line.
        this.dnf = 30;
        this.hud.msg(`${this.order[0].name.toUpperCase()} FINISHED · 30s TO CROSS THE LINE`, 3, null, '#ffd166');
      }
      this.dnf = Math.max(0, this.dnf - dt);
      if (this.dnf <= 0) this.endIn(0.5);
    }
  }

  endIn(t, fromHost = false) {
    // Online, only the host decides when the race is over.
    if (!this.authority && !fromHost) return;
    if (this.net && this.authority) this.net.send({ t: 'end', delay: t });
    this.state = 'finishing';
    this.endTimer = t;
  }

  finish() {
    this.state = 'done';
    this.over = true;
    const res = this.results();
    const p1 = this.humans[0];
    if (this.recorder && p1.finished) {
      res.ghostSaved = this.recorder.saveIfBest(this.cfg.track, this.cfg.laps, this.cfg.type, p1.finishTime, p1.color);
    }
    this.game.ui.showResults(res, this.cfg);
  }

  results() {
    this.rank();
    const cfg = this.cfg, n = this.cars.length;
    const rows = this.order.map(c => ({
      name: c.name + (c.netPlayer && !c.isHuman ? ' 🌐' : ''), team: c.team, pos: c.position, human: c.isHuman,
      time: c.finished ? c.finishTime : null, best: c.bestLap, drift: Math.round(c.driftScore),
      status: c.eliminated ? 'OUT' : c.finished ? fmtTime(c.finishTime) : cfg.type === 'knockout' ? 'SURVIVED' : 'DNF',
    }));
    let teams = null;
    if (this.teamMode) {
      teams = { A: 0, B: 0 };
      for (const c of this.cars) teams[c.team] += n - c.position + 1;
    }
    const p1 = this.humans[0];
    const mine = p1.team ?? 'A', other = mine === 'A' ? 'B' : 'A';
    const teamWon = teams && teams[mine] > teams[other];
    const best = Math.min(...this.humans.map(h => h.position));
    const g = cfg.goal;
    let success = true, goalText = '';
    if (g) {
      switch (g.type) {
        case 'position': success = p1.position <= g.value && !p1.eliminated; goalText = `Finish P${g.value}`; break;
        case 'teamWin': success = teamWon; goalText = 'Blue team wins on points'; break;
        case 'drift': success = p1.driftScore >= g.value; goalText = `${g.value.toLocaleString()} drift points — you scored ${Math.round(p1.driftScore).toLocaleString()}`; break;
        case 'time': {
          const target = (this.track.length * cfg.laps) / g.avg;
          success = p1.finished && p1.finishTime <= target;
          goalText = `Beat ${fmtTime(target)} — you ran ${fmtTime(p1.finished ? p1.finishTime : null)}`;
          break;
        }
        case 'survive': success = !p1.eliminated && p1.position === 1; goalText = 'Be the last car standing'; break;
      }
    }
    // Achievements for this result.
    const won = !this.solo && !p1.eliminated && p1.position === 1 && (cfg.type !== 'race' || p1.finished);
    if (won) {
      unlock('firstWin');
      if (cfg.type === 'knockout') unlock('koWin');
      if (this.net) unlock('onlineWin');
      if (this.weather === 'rain') unlock('rainWin');
    }
    if (p1.driftScore >= 10000) unlock('drift10k');

    const style = this.style.total(p1), styleCredits = Math.min(1500, Math.round(style / 40));
    let credits;
    if (g) credits = success ? cfg.reward : 0;
    else credits = this.solo ? 150 : (PAYOUT[best - 1] ?? 40) + (teamWon ? 250 : 0);

    let head;
    if (g) head = success ? 'OBJECTIVE COMPLETE' : 'OBJECTIVE FAILED';
    else if (teams && cfg.format === '1v1' && !this.net && this.humans.length === 1) head = p1.position === 1 ? 'YOU WIN THE DUEL' : 'DUEL LOST';
    else if (teams) head = teams.A === teams.B ? 'DRAW' : (teams.A > teams.B ? 'BLUE TEAM WINS' : 'RED TEAM WINS');
    else if (this.net && !this.solo) head = this.order[0].isHuman ? 'YOU WIN!' : `${this.order[0].name.toUpperCase()} WINS · YOU P${best}`;
    else if (this.humans.length === 2 && !this.solo) head = `${this.humans.find(h => h.position === best).name} WINS THE DUEL`;
    else head = this.solo ? 'RUN COMPLETE' : `YOU FINISHED P${best}`;

    return {
      head, success: g ? success : (teams ? teams[mine] >= teams[other] : best === 1), goalText, rows, teams, credits,
      track: TRACKS[cfg.track].name, solo: this.solo, type: cfg.type,
      p1Time: p1.finished ? p1.finishTime : null, p1Drift: Math.round(p1.driftScore),
      style, styleCredits, credits: credits + styleCredits,
    };
  }

  // ---------- Per-frame presentation ----------

  frame(dt) {
    for (const car of this.cars) {
      if (car.eliminated || car.wreck > 0) continue;
      car.syncMesh();
      this.smoke.fromCar(car);
    }
    if (this.rain) {
      this.rain.update(dt, this.humans[0].cam.camera.position);
      for (const car of this.cars) {
        if (car.eliminated || car.speed < 18 || Math.random() > 0.15) continue;
        const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
        this.smoke.emit(car.pos.x - fx * 2.4, car.pos.y - 0.2, car.pos.z - fz * 2.4, 0.45);
      }
    }
    this.ghost?.update(this.time);
    this.padTex.offset.y = (this.padTex.offset.y - dt * 1.6) % 1;
    this.smoke.update(dt);
    this.fx.sparks.update(dt);
    this.fx.rings.update(dt);
    this.t = (this.t ?? 0) + dt;
    this.powers?.frame(dt, this.t);
    for (const car of this.cars) {
      if (car.wreck > 0) car.trail.mat.uniforms.strength.value *= 0.85;
      if (car.eliminated || car.wreck > 0) continue;
      const fast = car.nitroOn || car.turbo > 0 ? 1 : Math.max(0, (car.fwdSpeed - 30) / 30);
      car.trail.update(car, Math.min(1, fast * (this.theme.night ? 1 : 0.6)));
    }
    this.hud.tick(dt);
    if (this.net && this.state !== 'done') this.sendState(dt);

    if (this.rewind) {
      const held = this.state === 'race' && readControls(0, this.humans.length === 1).rewind;
      const was = this.rewind.active;
      if (this.rewind.step(held, dt)) {
        for (const car of this.cars) car.syncMesh();
        if (!was) { this.hud.msg(`◀◀ REWIND · ${this.rewind.left} LEFT`, 1.5, null, '#a0c4ff'); beep(300, 0.3, 'sine', 0.2); }
      } else if (held && !was && this.rewind.left === 0) this.hud.msg('NO REWINDS LEFT', 1);
      this.post = { ...this.post, rewind: this.rewind.active };
    }

    this.humans.forEach((h, i) => {
      // Knocked out: spectate whoever is leading instead of an empty, frozen view.
      if (h.eliminated && this.state !== 'done') {
        const lead = this.order.find(c => !c.eliminated);
        if (lead && h.cam.car !== lead) { h.cam.car = lead; h.cam.ready = false; }
      }
      const c = readControls(h.player, this.humans.length === 1);
      const prev = this.prevButtons[i];
      if (c.cam && !prev.cam) h.cam.cycle();
      if (c.reset && !prev.reset && this.state === 'race' && !h.finished) this.resetCar(h);
      prev.cam = c.cam; prev.reset = c.reset;

      h.cam.update(dt);
      // Crossed the line while others race on: a slow victory orbit around your car.
      if (h.finished && !h.eliminated && this.state !== 'done') {
        const t = this.time - h.finishTime, cam = h.cam.camera, a = h.yaw + Math.PI * 0.75 + t * 0.35;
        cam.position.set(h.pos.x + Math.sin(a) * 9, h.pos.y + 3.2, h.pos.z + Math.cos(a) * 9);
        cam.lookAt(h.pos.x, h.pos.y + 1, h.pos.z);
      }
      if (h.kmh >= 300) unlock('speed300');
      h.engine.update(Math.abs(h.fwdSpeed) / h.spec.maxSpeed, h.input?.throttle ?? 0, h.nitroOn);
      this.hud.set(i, this.hudFor(h));
    });
    this.action?.frame(dt);
    this.items?.frame(dt);
    this.meteors?.frame(dt);
    hideNearCameras([...this.cars, ...(this.action?.cops ?? [])], this.humans.map(h => h.cam.camera));
    this.action?.blinkCars(dt);
    this.lights.follow(this.humans[0].pos);
    const p1 = this.humans[0];
    this.post = { ...this.post, speed: Math.min(1, Math.max(0, (p1.kmh - 150) / 170) + (p1.nitroOn ? 0.25 : 0) + (p1.turbo > 0 ? 0.45 : 0) + (p1.padBoost > 0 ? 0.3 : 0) + (p1.shockNitro > 0 ? 0.6 : 0)) };

    if (this.teamMode) {
      const n = this.cars.length, pts = { A: 0, B: 0 };
      for (const c of this.cars) pts[c.team] += n - c.position + 1;
      this.hud.setTeams(pts.A, pts.B);
    }

    this.minimap.draw([
      ...this.cars.filter(c => !c.eliminated && !c.isHuman).map(c => ({ x: c.pos.x, z: c.pos.z, r: c.netPlayer ? 5 : 3.5, color: c.netPlayer && !c.team ? '#ffd166' : c.team === 'A' ? '#6fb1ff' : c.team === 'B' ? '#ff6fa8' : '#' + new THREE.Color(c.color).getHexString() })),
      ...(this.action?.markers() ?? []),
      ...(this.meteors?.markers() ?? []),
      ...this.humans.map((c, i) => ({ x: c.pos.x, z: c.pos.z, yaw: c.yaw, r: 7, color: i ? '#ffd166' : '#08d9d6' })),
    ]);
  }

  hudFor(h) {
    const cfg = this.cfg, lap = Math.max(1, Math.min(h.lap, cfg.laps));
    const cur = this.state === 'countdown' ? 0 : this.time - h.lapStart;
    const lines = [];
    let pos;
    if (cfg.type === 'knockout') {
      const left = this.cars.filter(c => !c.eliminated).length;
      pos = h.eliminated ? 'OUT' : `${h.position}<small>/${left}</small>`;
      lines.push(`${left} CARS LEFT`);
      if (!h.eliminated && h.position === left && left > 1) lines.push('⚠ DANGER ZONE');
    } else {
      pos = this.solo ? `LAP ${lap}<small>/${cfg.laps}</small>` : `${h.position}<small>/${this.cars.length}</small>`;
      if (!this.solo) lines.push(`LAP ${lap}/${cfg.laps}`);
    }
    lines.push(`TIME ${fmtTime(h.finished ? h.finishTime : this.time)}`);
    if (cfg.type !== 'knockout') lines.push(`LAP  ${fmtTime(h.finished ? null : cur)}`);
    if (h.bestLap) lines.push(`BEST ${fmtTime(h.bestLap)}`);
    if (cfg.goal?.type === 'time') lines.push(`TARGET ${fmtTime((this.track.length * cfg.laps) / cfg.goal.avg)}`);
    if (this.dnf != null && !h.finished) lines.push(`⏱ ${Math.ceil(this.dnf)}s LEFT`);
    if (this.action) lines.push(...this.action.hudLines(h));
    if (this.rewind && h.player === 0) lines.push(`◀◀ Q  ${'●'.repeat(this.rewind.left)}${'○'.repeat(REWINDS - this.rewind.left)}`);

    let drift = '';
    if (cfg.type === 'drift' || cfg.goal?.type === 'drift') {
      drift = `DRIFT ${Math.round(h.driftScore).toLocaleString()}${cfg.goal ? ' / ' + cfg.goal.value.toLocaleString() : ''}`;
      if (h.driftCombo > 50) drift += `\n+${Math.round(h.driftCombo)}`;
    } else if (h.driftCombo > 150) {
      drift = `DRIFT +${Math.round(h.driftCombo)}`;
    }
    let banner = '';
    if (this.state !== 'done') {
      if (h.eliminated) banner = `💀 ELIMINATED · SPECTATING ${(h.cam.car?.name ?? '').toUpperCase()}`;
      else if (h.finished && !this.solo) banner = `🏁 FINISHED P${h.position}${this.dnf != null && this.state === 'race' ? ` · RESULTS IN ${Math.ceil(this.dnf)}s` : ' · WAITING FOR OTHERS'}`;
      else if (this.dnf != null && this.state === 'race') banner = `⏱ ${Math.ceil(this.dnf)}s TO FINISH`;
    }
    return { pos, info: lines.join('\n'), drift, kmh: h.kmh, boost: h.boost, nitro: h.nitroOn, ...fxHud(h), item: this.items?.hud(h), banner };
  }

  dispose() {
    this.disposed = true;
    this.items?.dispose();
    this.action?.dispose();
    this.scene.environment?.dispose();
    this.unsub?.forEach(f => f());
    for (const h of this.humans) h.engine.stop();
    this.hud.dispose();
    this.smoke.dispose();
    disposeScene(this.scene);
  }
}

/** Shared HUD extras: speed lines, colour vignette and the power widget. */
export function fxHud(h) {
  const rush = Math.min(1, Math.max(0, (Math.abs(h.fwdSpeed) - h.spec.maxSpeed * 0.75) / (h.spec.maxSpeed * 0.5)) + (h.nitroOn ? 0.4 : 0) + (h.turbo > 0 ? 0.7 : 0));
  const tint = h.stun > 0 ? 'rgba(8,217,214,.55)' : h.shield > 0 ? 'rgba(91,192,255,.35)' : h.ghost > 0 ? 'rgba(179,136,255,.4)' : h.turbo > 0 ? 'rgba(255,183,3,.35)' : '';
  const p = h.power && {
    icon: h.power.def.icon, name: h.power.def.name.toUpperCase(), charge: h.power.charge,
    key: h.player === 1 ? 'ENTER' : 'E', color: '#' + new THREE.Color(h.power.def.color).getHexString(),
  };
  return { rush, tint, power: p };
}
