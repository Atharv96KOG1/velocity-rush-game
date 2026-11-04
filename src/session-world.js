import * as THREE from 'three';
import { THEMES, CARS, carById, tuneSpec } from './data.js';
import { Track } from './track.js';
import { Car } from './car.js';
import { AIDriver } from './ai.js';
import { readControls } from './input.js';
import { makeEnvMap, makeSky, makeLights, makeLabel, rng, smoothstep, addTrees, addRocks, addBuildings, canvasTex, makeMountains } from './env.js';
import { ChaseCam, collideCars, Smoke } from './common.js';
import { HUD, Minimap } from './hud.js';
import { EngineSound, beep } from './audio.js';
import { save, persist } from './save.js';
import { fmtTime, fxHud } from './session-race.js';
import { Sparks, Rings, Trail } from './fx.js';
import { PowerSystem } from './powers.js';
import { StyleTracker } from './style.js';
import { unlock, count } from './achieve.js';

const HALF = 1000;           // world spans -1000..1000 on x and z
const WATER = -9;
const ROAD_LIFT = 0.25;

export function terrainHeight(x, z) {
  const flat = smoothstep(170, 430, Math.hypot(x, z));
  const h = 16 * Math.sin(x * 0.0042 + 0.5) * Math.cos(z * 0.0037 - 0.3)
    + 7 * Math.sin(x * 0.011 + 1.3) * Math.sin(z * 0.0093 + 0.7)
    + 2.2 * Math.sin(x * 0.031) * Math.cos(z * 0.027);
  const edge = smoothstep(820, 990, Math.max(Math.abs(x), Math.abs(z))) * 40;
  return h * flat + 0.4 * (1 - flat) + edge;
}

// Roads never dip below the water: they become causeways.
export const roadHeight = (x, z) => Math.max(terrainHeight(x, z), WATER + 1.2);

function ringPoints() {
  const pts = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    const r = 640 + Math.sin(a * 3) * 80 + Math.cos(a * 5) * 35;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

const ROADS = [
  { id: 'ring', name: 'Coast Highway', closed: true, width: 18, points: ringPoints() },
  { id: 'ns', name: 'Central Ave', closed: false, width: 16, points: [[30, -760], [0, -450], [-40, -250], [0, -80], [0, 80], [40, 250], [-20, 450], [20, 760]] },
  { id: 'ew', name: 'Sunset Blvd', closed: false, width: 16, points: [[-760, 20], [-450, -30], [-250, 30], [-80, 0], [80, 0], [250, -40], [450, 30], [760, -10]] },
  { id: 'hill', name: 'Ridge Run', closed: true, width: 13, points: [[160, 250], [240, 170], [340, 190], [410, 260], [380, 340], [430, 410], [320, 420], [250, 350], [170, 370]] },
  { id: 'link', name: 'Ridge Link', closed: false, width: 13, points: [[250, -38], [262, 60], [245, 130], [225, 175]] },
];

const TRAPS = [
  { road: 'ring', at: 0.1, kmh: 190 }, { road: 'ring', at: 0.42, kmh: 190 }, { road: 'ring', at: 0.74, kmh: 190 },
  { road: 'ns', at: 0.28, kmh: 160 }, { road: 'ew', at: 0.7, kmh: 160 }, { road: 'hill', at: 0.55, kmh: 120 },
];

const SPRINTS = [
  { name: 'Coastline Dash', road: 'ring', at: 0.2, len: 900, avg: 40 },
  { name: 'Downtown Run', road: 'ns', at: 0.05, len: 600, avg: 34 },
  { name: 'Sunset Sprint', road: 'ew', at: 0.95, len: 600, dir: -1, avg: 34 },
  { name: 'Ridge Challenge', road: 'hill', at: 0.0, len: 0.97, avg: 27 },
];

/** Open-world free roam: coins, speed traps, checkpoint sprints and highway traffic. */
export class WorldSession {
  constructor(game, cfg) {
    this.game = game;
    this.cfg = cfg;
    this.pausable = true;
    this.over = false;
    const th = THEMES.day;
    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xcfe3f5, 250, 1300);
    const sky = makeSky(th.skyTop, th.skyBottom);
    scene.add(sky);
    scene.environment = makeEnvMap(game.renderer, sky);
    scene.environmentIntensity = 0.55;
    this.lights = makeLights(scene, th);
    scene.add(makeMountains(0x4b6b4a, 0xcfe3f5, 1700, 40));
    this.bloomStrength = 0.3;

    this.buildTerrain();
    this.roads = ROADS.map(r => {
      const t = new Track(r.points, { width: r.width, closed: r.closed, heightFn: roadHeight, lift: ROAD_LIFT });
      t.id = r.id; t.name = r.name;
      scene.add(t.buildMesh({ kerbs: true }));
      return t;
    });
    this.roadById = Object.fromEntries(this.roads.map(t => [t.id, t]));
    this.buildGrid();
    this.buildScenery();
    this.buildEvents();
    this.smoke = new Smoke(scene, 160);
    this.fx = { sparks: new Sparks(scene), rings: new Rings(scene) };
    this.powers = new PowerSystem(scene, {
      fx: this.fx,
      rivals: car => this.allCars.filter(o => o !== car),
      blink: (car, m) => this.blinkTarget(car, m),
      shake: (car, a) => { if (car.cam) car.cam.shake = Math.max(car.cam.shake, a); },
      onUse: (car, d) => { if (car.isHuman) { this.hud.msg(`${d.icon} ${d.name.toUpperCase()}!`, 1.4, car.player); car.cam.shake = 0.5; } },
    });

    // Players start on Central Ave just south of downtown, heading north.
    const ns = this.roadById.ns, si = Math.round(ns.N * 0.36);
    this.humans = cfg.humans.map((h, i) => {
      const car = new Car(tuneSpec(carById(h.car), h.tune), { name: h.name, human: true, player: i, color: h.color ?? carById(h.car).color });
      const side = (i - (cfg.humans.length - 1) / 2) * 5;
      const x = ns.px[si] - ns.tz[si] * side, z = ns.pz[si] + ns.tx[si] * side;
      car.place(x, z, Math.atan2(ns.tx[si], ns.tz[si]), roadHeight(x, z) + ROAD_LIFT);
      car.cam = new ChaseCam(car, terrainHeight);
      car.engine = new EngineSound();
      car.sprint = null;
      car.trapCool = 0;
      car.prevBtn = { cam: false, reset: false, power: false };
      car.trail = new Trail(scene);
      scene.add(car.mesh);
      return car;
    });

    // Highway traffic loops the ring road.
    const ring = this.roadById.ring;
    this.traffic = [];
    for (let k = 0; k < 9; k++) {
      const spec = CARS[k % CARS.length];
      const car = new Car(spec, { name: 'Traffic', color: new THREE.Color().setHSL(Math.random(), 0.15, 0.35 + Math.random() * 0.4).getHex() });
      const i = Math.round((k / 9) * ring.N);
      const lane = k % 2 ? -4 : 4;
      const dir = k % 2 ? 0 : Math.PI;
      const x = ring.px[i] - ring.tz[i] * lane, z = ring.pz[i] + ring.tx[i] * lane;
      car.place(x, z, Math.atan2(ring.tx[i], ring.tz[i]) + dir, roadHeight(x, z) + ROAD_LIFT);
      car.trackIndex = i;
      car.ai = new AIDriver(car, ring, 0.5 + Math.random() * 0.1);
      car.ai.lane = lane;
      car.ai.laneTimer = Infinity;
      car.ai.noDodge = true;
      car.reverse = dir !== 0;
      scene.add(car.mesh);
      this.traffic.push(car);
    }
    this.allCars = [...this.humans, ...this.traffic];
    this.humans.forEach((h, i) => this.powers.attach(h, cfg.humans[i].power ?? 'turbo'));
    for (const c of this.traffic) this.powers.attach(c, 'turbo');

    this.views = this.humans.map((h, i) => ({
      camera: h.cam.camera,
      rect: this.humans.length === 1 ? [0, 0, 1, 1] : i === 0 ? [0, 0.5, 1, 0.5] : [0, 0, 1, 0.5],
    }));
    this.minimap = new Minimap(this.roads, 210, [-HALF, HALF, -HALF, HALF]);
    this.hud = new HUD(this.humans.length, {
      minimap: this.minimap,
      hint: 'Explore! Gold rings = coins · Red gates = speed traps · Green beacons = sprint races · E super power · ESC pause',
    });
    this.hud.msg('OPEN WORLD TOUR', 3);
    this.style = new StyleTracker(this.hud, this.humans, {
      overtakes: false,
      onEvent: (h, label, st) => {
        if (label === 'NEAR MISS') count('nearMiss', 'nearMiss25', 25);
        if (st.mult >= 5) unlock('combo5');
      },
    });
  }

  // ---------- World building ----------

  buildTerrain() {
    const seg = 250, size = HALF * 2;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color(), r = rng(3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = terrainHeight(x, z);
      pos.setY(i, h);
      const n = r() * 0.06;
      if (h < WATER + 1.5) c.setRGB(0.76 + n, 0.7 + n, 0.5);
      else if (h > 26) c.setRGB(0.5 + n, 0.48 + n, 0.45 + n);
      else c.setRGB(0.24 + n, 0.47 + n + (h / 120), 0.18 + n);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    terrain.receiveShadow = true;
    this.scene.add(terrain);

    const water = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size * 2),
      new THREE.MeshStandardMaterial({ color: 0x2477b3, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.85 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER;
    this.scene.add(water);
  }

  // Spatial hash over every road sample for fast "which road am I on" queries.
  buildGrid() {
    this.cell = 24;
    this.grid = new Map();
    this.roads.forEach((t, ri) => {
      for (let i = 0; i < t.N; i++) {
        const k = this.key(Math.floor(t.px[i] / this.cell), Math.floor(t.pz[i] / this.cell));
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, list = []);
        list.push(ri, i);
      }
    });
  }

  key(cx, cz) { return cx * 10007 + cz; }

  roadAt(x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = null, bd = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = this.grid.get(this.key(cx + a, cz + b));
      if (!list) continue;
      for (let k = 0; k < list.length; k += 2) {
        const t = this.roads[list[k]], i = list[k + 1];
        const dx = x - t.px[i], dz = z - t.pz[i], d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = { t, i }; }
      }
    }
    if (best) best.d = Math.sqrt(bd);
    return best;
  }

  buildScenery() {
    const g = new THREE.Group(), r = rng(99);
    const free = (x, z, clear) => {
      const q = this.roadAt(x, z);
      return !(q && q.d < q.t.width / 2 + clear) && terrainHeight(x, z) > WATER + 1;
    };
    const trees = [], rocks = [], blocks = [];
    for (let k = 0; trees.length < 2600 && k < 12000; k++) {
      const x = (r() - 0.5) * 1900, z = (r() - 0.5) * 1900;
      if (Math.hypot(x, z) < 330 || !free(x, z, 6)) continue;
      trees.push({ x, y: terrainHeight(x, z) - 0.3, z, ry: r() * 6.28, s: 0.7 + r() * 0.9 });
    }
    for (let k = 0; rocks.length < 220 && k < 3000; k++) {
      const x = (r() - 0.5) * 1900, z = (r() - 0.5) * 1900;
      if (!free(x, z, 5)) continue;
      rocks.push({ x, y: terrainHeight(x, z), z, ry: r() * 6.28, sx: 1.5 + r() * 4, sy: 1 + r() * 3, sz: 1.5 + r() * 4 });
    }
    // Downtown: a block grid around the central crossroads.
    for (let gx = -260; gx <= 260; gx += 40) for (let gz = -260; gz <= 260; gz += 40) {
      if (r() < 0.25) continue;
      const x = gx + (r() - 0.5) * 8, z = gz + (r() - 0.5) * 8;
      if (!free(x, z, 14) || Math.hypot(x, z) > 300) continue;
      const tall = 1 - Math.hypot(x, z) / 320;
      blocks.push({ x, y: terrainHeight(x, z) - 0.5, z, sx: 16 + r() * 10, sy: 12 + r() * 70 * tall + 6, sz: 16 + r() * 10 });
    }
    // Static colliders: tree trunks are circles, buildings are axis-aligned boxes.
    this.solids = new Map();
    const addSolid = (o, x0, z0, x1, z1) => {
      for (let cx = Math.floor(x0 / this.cell); cx <= Math.floor(x1 / this.cell); cx++)
        for (let cz = Math.floor(z0 / this.cell); cz <= Math.floor(z1 / this.cell); cz++) {
          const k = this.key(cx, cz);
          if (!this.solids.has(k)) this.solids.set(k, []);
          this.solids.get(k).push(o);
        }
    };
    for (const t of trees) addSolid({ x: t.x, z: t.z, r: 0.5 * t.s }, t.x, t.z, t.x, t.z);
    for (const b of blocks) {
      const o = { x: b.x, z: b.z, hx: b.sx / 2, hz: b.sz / 2 };
      addSolid(o, b.x - o.hx, b.z - o.hz, b.x + o.hx, b.z + o.hz);
    }
    addTrees(g, trees);
    addRocks(g, rocks, 0x7d7a74);
    addBuildings(g, blocks, false);
    this.scene.add(g);
  }

  roadPoint(road, i, lat = 0) {
    const t = this.roadById[road] ?? road, j = t.wrap(i);
    const x = t.px[j] - t.tz[j] * lat, z = t.pz[j] + t.tx[j] * lat;
    return new THREE.Vector3(x, roadHeight(x, z) + ROAD_LIFT, z);
  }

  buildEvents() {
    const r = rng(2024), scene = this.scene;
    const gold = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xff9f1c, emissiveIntensity: 0.7, metalness: 0.8, roughness: 0.25 });
    const coinGeo = new THREE.TorusGeometry(1.1, 0.32, 10, 24);

    // Coins: mostly on roads, some hidden off-road.
    this.coins = [];
    const total = this.roads.reduce((s, t) => s + t.N, 0);
    for (let k = 0; k < 45; k++) {
      let p;
      if (k < 34) {
        let pick = r() * total, t = this.roads[0];
        for (const tr of this.roads) { if (pick < tr.N) { t = tr; break; } pick -= tr.N; }
        p = this.roadPoint(t, Math.floor(r() * t.N), (r() - 0.5) * t.width * 0.6);
      } else {
        let x, z;
        do { x = (r() - 0.5) * 1700; z = (r() - 0.5) * 1700; } while (terrainHeight(x, z) < WATER + 1);
        p = new THREE.Vector3(x, terrainHeight(x, z), z);
      }
      p.y += 1.6;
      const id = 'coin' + k, got = save.world.coins.includes(id);
      const m = new THREE.Mesh(coinGeo, gold);
      m.position.copy(p);
      m.visible = !got;
      m.castShadow = true;
      scene.add(m);
      this.coins.push({ id, pos: p, mesh: m, got });
    }

    // Speed traps: a gantry across the road.
    this.traps = TRAPS.map((d, k) => {
      const t = this.roadById[d.road], i = Math.round(d.at * (t.N - 1));
      const p = this.roadPoint(t, i);
      const gate = this.gantry(t, i, 0xff2e63, `SPEED TRAP ${d.kmh}`);
      scene.add(gate);
      return { id: 'trap' + k, ...d, t, i, pos: p, best: save.world.traps['trap' + k] ?? 0 };
    });

    // Sprint start beacons.
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    this.sprints = SPRINTS.map((d, k) => {
      const t = this.roadById[d.road], start = Math.round(d.at * (t.N - 1));
      const len = d.len < 1 ? Math.round(d.len * t.N) : d.len;
      const dir = d.dir ?? 1;
      const pos = this.roadPoint(t, start);
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 80, 24, 1, true), beaconMat);
      beacon.position.copy(pos).add(new THREE.Vector3(0, 40, 0));
      scene.add(beacon);
      const label = makeLabel(d.name, '#3ddc84');
      label.scale.set(16, 4, 1);
      label.position.copy(pos).add(new THREE.Vector3(0, 9, 0));
      scene.add(label);
      // Checkpoints every ~100m along the road.
      const cps = [];
      for (let s = 50; s < len; s += 50) cps.push(t.wrap(start + dir * s));
      cps.push(t.wrap(start + dir * len));
      const target = (len * t.seg) / d.avg;
      return { id: 'sprint' + k, ...d, t, start, dir, pos, cps, target, best: save.world.sprints['sprint' + k] ?? null, beacon, armed: true };
    });

    // Shared checkpoint ring, moved to the active checkpoint.
    this.cpRings = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(10, 0.5, 8, 40),
        new THREE.MeshBasicMaterial({ color: 0x08d9d6, transparent: true, opacity: 0.85 }));
      m.visible = false;
      scene.add(m);
      return m;
    });
  }

  gantry(t, i, color, text) {
    const g = new THREE.Group(), p = this.roadPoint(t, i);
    g.position.copy(p);
    g.rotation.y = Math.atan2(t.tx[i], t.tz[i]);
    const W = t.width / 2 + 2;
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2d36, metalness: 0.6, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), mat);
      post.position.set(s * W, 4.5 - ROAD_LIFT, 0);
      post.castShadow = true;
      g.add(post);
    }
    const tex = canvasTex(512, 64, (c, w, h) => {
      c.fillStyle = '#' + new THREE.Color(color).getHexString(); c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff'; c.font = 'italic 900 40px Orbitron, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, w / 2, h / 2 + 2);
    }, false);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 1, 1.6, 0.5),
      new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6 }));
    banner.position.y = 8.5;
    g.add(banner);
    return g;
  }

  // ---------- Simulation ----------

  update(dt) {
    for (const car of this.allCars) {
      let c;
      if (car.isHuman) c = readControls(car.player, this.humans.length === 1);
      else {
        car.trackIndex = car.ai.track.nearest(car.pos.x, car.pos.z, car.trackIndex);
        c = car.reverse ? this.reverseDrive(car, dt) : car.ai.control(dt, this.allCars);
      }
      car.input = c;
      if (car.isHuman) {
        if (c.power && !car.prevBtn.power && this.powers.use(car)) count('powers', 'powers25', 25);
        car.prevBtn.power = c.power;
      }
      car.update(dt, c);
      this.ground(car, dt);
      if (!car.isHuman) {
        if (car.speed < 1.5) car.stuck += dt; else car.stuck = 0;
        if (car.stuck > 3) this.respawn(car);
      }
    }
    this.powers.update(dt);
    collideCars(this.allCars, (a, b, x, y, z, v) => {
      this.fx.sparks.emit(x, y, z, Math.min(40, v * 3), 0xffc46b, 7, 3);
      for (const c of [a, b]) if (c.cam) c.cam.shake = Math.max(c.cam.shake, Math.min(1, v / 15));
    });
    this.style.update(dt, this.allCars);
    for (const h of this.humans) this.events(h, dt);
  }

  // Traffic in the opposite direction: steer at a point behind on the spline.
  reverseDrive(car, dt) {
    const t = car.ai.track, look = Math.round((8 + Math.max(0, car.fwdSpeed) * 0.4) / t.seg);
    const ti = t.wrap(car.trackIndex - look), lane = car.ai.lane;
    const tx = t.px[ti] - t.tz[ti] * lane, tz = t.pz[ti] + t.tx[ti] * lane;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const dx = tx - car.pos.x, dz = tz - car.pos.z;
    const ang = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
    const target = car.spec.maxSpeed * 0.45;
    return { throttle: car.fwdSpeed < target ? 1 : 0, brake: car.fwdSpeed > target + 4 ? 0.5 : 0, steer: Math.max(-1, Math.min(1, -ang * 2.4)), hand: false, nitro: false };
  }

  blinkTarget(car, metres) {
    const q = this.roadAt(car.pos.x, car.pos.z);
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    if (q && q.d < q.t.width) {
      const t = q.t, dir = fx * t.tx[q.i] + fz * t.tz[q.i] >= 0 ? 1 : -1;
      const i = t.wrap(q.i + dir * Math.round(metres / t.seg));
      const p = this.roadPoint(t, i);
      return { x: p.x, y: p.y, z: p.z, yaw: Math.atan2(t.tx[i], t.tz[i]) + (dir < 0 ? Math.PI : 0) };
    }
    // Off-road: straight ahead, clamped to the island.
    const lim = HALF - 20;
    const x = Math.max(-lim, Math.min(lim, car.pos.x + fx * metres)), z = Math.max(-lim, Math.min(lim, car.pos.z + fz * metres));
    return { x, y: terrainHeight(x, z), z, yaw: car.yaw };
  }

  respawn(car) {
    const t = car.ai.track, i = car.trackIndex, lane = car.ai.lane;
    const p = this.roadPoint(t, i, lane);
    car.place(p.x, p.z, Math.atan2(t.tx[i], t.tz[i]) + (car.reverse ? Math.PI : 0), p.y);
    car.stuck = 0;
  }

  ground(car, dt) {
    const x = car.pos.x, z = car.pos.z;
    const q = this.roadAt(x, z);
    const onRoad = q && q.d < q.t.width / 2 + 0.6;
    const th = terrainHeight(x, z);
    let y;
    if (onRoad) { y = roadHeight(x, z) + ROAD_LIFT; car.surface = 1; }
    else if (th < WATER) { y = Math.max(th, WATER - 0.7); car.surface = 0.25; }
    else { y = th; car.surface = 0.8; }
    car.pos.y += (y - car.pos.y) * Math.min(1, dt * 25);

    // Tilt to the slope under the car.
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), hf = onRoad ? roadHeight : terrainHeight;
    const front = hf(x + fx * 2, z + fz * 2), back = hf(x - fx * 2, z - fz * 2);
    const right = hf(x - fz * 1.2, z + fx * 1.2), left = hf(x + fz * 1.2, z - fx * 1.2);
    car.pitch = -Math.atan2(front - back, 4);
    car.roll = Math.atan2(right - left, 2.4);

    // Gravity along slopes.
    const slope = (front - back) / 4;
    const g = 9.8 * slope * dt;
    car.vx -= fx * g; car.vz -= fz * g;

    this.collideSolids(car);
    const lim = HALF - 15;
    if (Math.abs(car.pos.x) > lim) { car.pos.x = Math.sign(car.pos.x) * lim; car.vx *= -0.3; }
    if (Math.abs(car.pos.z) > lim) { car.pos.z = Math.sign(car.pos.z) * lim; car.vz *= -0.3; }
  }

  collideSolids(car) {
    if (car.ghost > 0) return;
    const R = 1.4, list = this.solids.get(this.key(Math.floor(car.pos.x / this.cell), Math.floor(car.pos.z / this.cell)));
    if (!list) return;
    for (const o of list) {
      let nx, nz, pen;
      if (o.r !== undefined) {
        const dx = car.pos.x - o.x, dz = car.pos.z - o.z, d = Math.hypot(dx, dz);
        if (d >= o.r + R || d < 1e-4) continue;
        nx = dx / d; nz = dz / d; pen = o.r + R - d;
      } else {
        const cx = Math.max(o.x - o.hx, Math.min(o.x + o.hx, car.pos.x)), cz = Math.max(o.z - o.hz, Math.min(o.z + o.hz, car.pos.z));
        const dx = car.pos.x - cx, dz = car.pos.z - cz, d = Math.hypot(dx, dz);
        if (d >= R) continue;
        if (d < 1e-4) { nx = Math.sign(car.pos.x - o.x) || 1; nz = 0; pen = R; }
        else { nx = dx / d; nz = dz / d; pen = R - d; }
      }
      car.pos.x += nx * pen; car.pos.z += nz * pen;
      const vn = car.vx * nx + car.vz * nz;
      if (vn < 0) {
        car.vx -= nx * vn * 1.4; car.vz -= nz * vn * 1.4;
        car.vx *= 0.8; car.vz *= 0.8;
        if (-vn > 4) {
          this.fx.sparks.emit(car.pos.x - nx * R, car.pos.y + 0.6, car.pos.z - nz * R, Math.min(40, -vn * 2), 0xffc46b, 7, 3);
          if (car.cam) car.cam.shake = Math.max(car.cam.shake, Math.min(1, -vn / 15));
        }
      }
    }
  }

  events(h, dt) {
    const p = h.pos;
    for (const c of this.coins) {
      if (c.got) continue;
      if (Math.abs(c.pos.x - p.x) < 4 && Math.abs(c.pos.z - p.z) < 4 && Math.abs(c.pos.y - p.y) < 6) {
        c.got = true;
        c.mesh.visible = false;
        save.world.coins.push(c.id);
        save.credits += 50;
        persist();
        beep(1320, 0.12, 'triangle');
        this.hud.msg(`+50 CR · COIN ${save.world.coins.length}/${this.coins.length}`, 1.8, h.player, '#ffd166');
        if (save.world.coins.length >= this.coins.length) unlock('coins45');
      }
    }

    h.trapCool -= dt;
    if (h.trapCool <= 0) {
      for (const tr of this.traps) {
        if (Math.hypot(tr.pos.x - p.x, tr.pos.z - p.z) > tr.t.width / 2 + 2) continue;
        h.trapCool = 2;
        const kmh = h.kmh, first = tr.best < tr.kmh && kmh >= tr.kmh;
        if (kmh > tr.best) { tr.best = kmh; save.world.traps[tr.id] = kmh; }
        if (first) { save.credits += 300; this.hud.msg(`SPEED TRAP ${kmh} KM/H ★ +300 CR`, 3, h.player, '#3ddc84'); beep(990, 0.3, 'triangle'); }
        else this.hud.msg(`SPEED TRAP ${kmh} KM/H${kmh >= tr.kmh ? ' ★' : ` · NEED ${tr.kmh}`}`, 2.5, h.player, kmh >= tr.kmh ? '#3ddc84' : '#ff6fa8');
        persist();
      }
    }

    const s = h.sprint;
    if (s) {
      s.time += dt;
      const cp = s.def.cps[s.next], cx = s.def.t.px[cp], cz = s.def.t.pz[cp];
      if (Math.hypot(cx - p.x, cz - p.z) < s.def.t.width / 2 + 4) {
        s.next++;
        beep(1000, 0.08);
        if (s.next >= s.def.cps.length) this.endSprint(h, true);
      } else if (s.time > s.def.target + 8) {
        this.endSprint(h, false);
      }
    } else {
      for (const sp of this.sprints) {
        const d = Math.hypot(sp.pos.x - p.x, sp.pos.z - p.z);
        if (!sp.armed) { if (d > 25) sp.armed = true; continue; }
        if (d < 6 && !this.humans.some(o => o.sprint?.def === sp)) {
          sp.armed = false;
          h.sprint = { def: sp, next: 0, time: 0 };
          this.hud.center('GO!', 1, h.player);
          this.hud.msg(`${sp.name.toUpperCase()} · BEAT ${fmtTime(sp.target)}`, 3, h.player, '#3ddc84');
          beep(880, 0.4);
        }
      }
    }
  }

  endSprint(h, completed) {
    const s = h.sprint, d = s.def;
    h.sprint = null;
    if (!completed) {
      this.hud.msg('SPRINT FAILED · OUT OF TIME', 3, h.player, '#ff2e63');
      return;
    }
    const win = s.time <= d.target;
    const firstWin = win && !(d.best != null && d.best <= d.target);
    if (d.best == null || s.time < d.best) { d.best = s.time; save.world.sprints[d.id] = s.time; }
    if (firstWin) save.credits += 800;
    persist();
    this.hud.center(win ? 'WIN!' : 'TOO SLOW', 2, h.player);
    this.hud.msg(`${fmtTime(s.time)}${firstWin ? ' · +800 CR' : ''}${win ? '' : ` · TARGET ${fmtTime(d.target)}`}`, 4, h.player, win ? '#3ddc84' : '#ff6fa8');
    beep(win ? 1200 : 300, 0.5, 'triangle');
  }

  // ---------- Presentation ----------

  frame(dt) {
    this.t = (this.t ?? 0) + dt;
    for (const car of this.allCars) { car.syncMesh(); this.smoke.fromCar(car); }
    this.smoke.update(dt);
    this.fx.sparks.update(dt);
    this.fx.rings.update(dt);
    this.powers.frame(dt, this.t);
    for (const h of this.humans) h.trail.update(h, h.nitroOn || h.turbo > 0 ? 1 : Math.max(0, (h.fwdSpeed - 30) / 40));
    this.hud.tick(dt);
    for (const c of this.coins) if (!c.got) c.mesh.rotation.y = this.t * 2;

    this.cpRings.forEach(r => { r.visible = false; });
    this.humans.forEach((h, i) => {
      const c = readControls(h.player, this.humans.length === 1);
      if (c.cam && !h.prevBtn.cam) h.cam.cycle();
      if (c.reset && !h.prevBtn.reset) this.resetHuman(h);
      h.prevBtn.cam = c.cam; h.prevBtn.reset = c.reset;
      h.cam.update(dt);
      if (h.kmh >= 300) unlock('speed300');
      h.engine.update(Math.abs(h.fwdSpeed) / h.spec.maxSpeed, h.input?.throttle ?? 0, h.nitroOn);

      if (h.sprint) {
        const s = h.sprint, cp = s.def.cps[s.next], t = s.def.t, ring = this.cpRings[i];
        ring.visible = true;
        ring.position.copy(this.roadPoint(t, cp)).add(new THREE.Vector3(0, 5, 0));
        ring.rotation.set(0, Math.atan2(t.tx[cp], t.tz[cp]), 0);
      }
      this.hud.set(i, this.hudFor(h));
    });
    this.lights.follow(this.humans[0].pos);
    const p1 = this.humans[0];
    this.post = { ...this.post, speed: Math.min(1, Math.max(0, (p1.kmh - 150) / 170) + (p1.nitroOn ? 0.25 : 0) + (p1.turbo > 0 ? 0.45 : 0)) };

    const markers = [];
    for (const c of this.coins) if (!c.got) markers.push({ x: c.pos.x, z: c.pos.z, r: 2.5, color: '#ffd166' });
    for (const t of this.traps) markers.push({ x: t.pos.x, z: t.pos.z, r: 3.5, color: t.best >= t.kmh ? '#3ddc84' : '#ff2e63' });
    for (const s of this.sprints) markers.push({ x: s.pos.x, z: s.pos.z, r: 5, color: '#3ddc84' });
    for (const c of this.traffic) markers.push({ x: c.pos.x, z: c.pos.z, r: 2, color: '#888' });
    this.humans.forEach((h, i) => {
      if (h.sprint) {
        const cp = h.sprint.def.cps[h.sprint.next], t = h.sprint.def.t;
        markers.push({ x: t.px[cp], z: t.pz[cp], r: 5, color: '#08d9d6' });
      }
      markers.push({ x: h.pos.x, z: h.pos.z, yaw: h.yaw, r: 8, color: i ? '#ffd166' : '#08d9d6' });
    });
    this.minimap.draw(markers);
  }

  resetHuman(h) {
    const q = this.roadAt(h.pos.x, h.pos.z);
    let t, i;
    if (q) ({ t, i } = q);
    else {
      // Far from any road: snap to the closest sample of any road.
      let bd = Infinity;
      for (const r of this.roads) {
        const j = r.nearest(h.pos.x, h.pos.z);
        if (r.dist < bd) { bd = r.dist; t = r; i = j; }
      }
    }
    const p = this.roadPoint(t, i);
    const fwd = Math.atan2(t.tx[i], t.tz[i]);
    const keep = Math.cos(h.yaw - fwd) >= 0 ? fwd : fwd + Math.PI;
    h.place(p.x, p.z, keep, p.y);
  }

  hudFor(h) {
    const w = save.world;
    const traps = this.traps.filter(t => t.best >= t.kmh).length;
    const sprints = this.sprints.filter(s => s.best != null && s.best <= s.target).length;
    const lines = [`COINS   ${w.coins.length}/${this.coins.length}`, `TRAPS   ${traps}/${this.traps.length}`, `SPRINTS ${sprints}/${this.sprints.length}`, `CR      ${save.credits.toLocaleString()}`];
    let pos = '<small>FREE ROAM</small>';
    const q = this.roadAt(h.pos.x, h.pos.z);
    if (q && q.d < q.t.width) pos = `<small>${q.t.name.toUpperCase()}</small>`;
    let drift = '';
    if (h.sprint) {
      const s = h.sprint, left = s.def.target - s.time;
      drift = `${s.def.name.toUpperCase()}\nCP ${s.next}/${s.def.cps.length}\n${left >= 0 ? fmtTime(left) : '+' + fmtTime(-left)}`;
    } else if (h.driftCombo > 150) drift = `DRIFT +${Math.round(h.driftCombo)}`;
    return { pos, info: lines.join('\n'), drift, kmh: h.kmh, boost: h.boost, nitro: h.nitroOn, ...fxHud(h) };
  }

  dispose() {
    this.scene.environment?.dispose();
    for (const h of this.humans) h.engine.stop();
    this.hud.dispose();
    this.smoke.dispose();
    this.scene.traverse(o => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) { m.map?.dispose(); m.dispose(); }
    });
  }
}
