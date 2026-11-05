import * as THREE from 'three';
import { canvasTex } from './env.js';
import { makeShield } from './fx.js';
import { beep } from './audio.js';

export const ITEMS = {
  missile: { icon: '🚀', name: 'Homing Missile', color: '#ff4d4d' },
  mine: { icon: '💣', name: 'Mine', color: '#ff2e63' },
  oil: { icon: '🛢️', name: 'Oil Slick', color: '#b388ff' },
  bubble: { icon: '🫧', name: 'Bubble Shield', color: '#5bc0ff' },
  rocket: { icon: '🔥', name: 'Rocket Boost', color: '#ffb703' },
  mega: { icon: '🍄', name: 'Mega Car', color: '#3ddc84' },
  lightning: { icon: '⚡', name: 'Lightning', color: '#fff275' },
};

const MEGA_TIME = 7;
const TINY_TIME = 4.5;

// Leaders get defensive items, cars at the back get weapons and speed.
const ODDS = {
  front: { mine: 3, oil: 3, bubble: 3, missile: 1, rocket: 0, mega: 0, lightning: 0 },
  mid: { missile: 3, mine: 2, oil: 2, bubble: 1, rocket: 2, mega: 1, lightning: 0.5 },
  back: { missile: 4, rocket: 3, bubble: 1, mine: 1, oil: 0, mega: 2, lightning: 1.5 },
};

const RESPAWN = 4;
const MISSILE_SPEED = 95;

function roll(odds) {
  const total = Object.values(odds).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [k, w] of Object.entries(odds)) { if ((r -= w) < 0) return k; }
  return 'rocket';
}

/** Mystery boxes on the track and the weapons they hand out. */
export class Items {
  constructor(s, action) {
    this.s = s;
    this.action = action;
    const t = s.track, scene = s.scene;

    const tex = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#000'; g.lineWidth = 10; g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = '#000'; g.font = '900 92px Orbitron, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', w / 2, h / 2 + 6);
    }, false);
    this.boxMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.4, transparent: true, opacity: 0.9, roughness: 0.3 });
    const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);

    // Rows of three boxes spread around the lap, clear of ramps and boost pads.
    this.boxes = [];
    const busy = [...s.pads.map(p => p.i), ...action.ramps.map(r => r.i), ...action.obstacles.map(o => o.i), 0];
    const clear = i => busy.every(b => Math.min(Math.abs(b - i), t.N - Math.abs(b - i)) > 25);
    for (let k = 0; k < 4; k++) {
      let i = Math.round((t.N * (k + 0.55)) / 4);
      for (let tries = 0; tries < 20 && !clear(i); tries++) i = t.wrap(i + 12);
      for (const f of [-0.3, 0, 0.3]) {
        const lat = f * t.width;
        const m = new THREE.Mesh(geo, this.boxMat);
        m.position.set(t.px[i] - t.tz[i] * lat, 1.3, t.pz[i] + t.tx[i] * lat);
        m.castShadow = true;
        scene.add(m);
        this.boxes.push({ m, down: 0, phase: Math.random() * 6 });
      }
    }

    this.missiles = [];
    this.hazards = [];
    this.bolts = [];
    this.flash = new THREE.PointLight(0xffa040, 0, 45, 1.5);
    scene.add(this.flash);
    this.keys = new Map();
    this.seq = 0;
    for (const c of s.cars) c.item = null;
  }

  // Online: each client handles pickups, hits and item use for the cars it owns,
  // and tells the others through the host.
  send(m) { this.s.net?.send(m); }

  // ---------- Pickups ----------

  give(car) {
    const n = this.s.cars.length, band = car.position <= 1 ? 'front' : car.position > n * 0.6 ? 'back' : 'mid';
    car.item = roll(ODDS[band]);
    car.itemAge = 0;
    if (car.isHuman) {
      const d = ITEMS[car.item];
      this.s.hud.popup(car.player, `GOT ${d.icon} ${d.name.toUpperCase()}`, d.color);
      beep(1200, 0.08, 'triangle', 0.15);
      setTimeout(() => beep(1600, 0.1, 'triangle', 0.15), 80);
    }
  }

  // ---------- Using items ----------

  use(car, net = null) {
    const s = this.s, id = net ? net.item : car.item;
    if (!id) return;
    car.item = null;
    const uid = net ? net.uid : `${car.id ?? 'p'}-${this.seq++}`;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    let target = null;
    if (id === 'missile') target = net ? s.byId?.get(net.tid) ?? null : this.targetFor(car);
    const drop = net ? { x: net.x, z: net.z } : { x: car.pos.x - fx * 4, z: car.pos.z - fz * 4 };
    if (!net) this.send({ t: 'use', id: car.id, item: id, uid, tid: target?.id ?? null, x: drop.x, z: drop.z });
    if (id === 'missile') {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.4, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.6, roughness: 0.3 }));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 10).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3030).multiplyScalar(4), toneMapped: false }));
      tip.position.z = 0.95;
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(6), toneMapped: false }));
      glow.position.z = -0.8;
      g.add(body, tip, glow);
      g.position.set(car.pos.x + fx * 3, car.pos.y + 1.1, car.pos.z + fz * 3);
      s.scene.add(g);
      this.missiles.push({ uid, g, owner: car, target, dir: new THREE.Vector3(fx, 0, fz), life: 5 });
      if (target?.isHuman) s.hud.msg('🚀 MISSILE INCOMING!', 1.5, target.player, '#ff4d4d');
      beep(200, 0.4, 'sawtooth', 0.2);
    } else if (id === 'mine' || id === 'oil') {
      const p = new THREE.Vector3(drop.x, 0, drop.z);
      let m;
      if (id === 'mine') {
        m = new THREE.Group();
        m.add(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.35, 16), new THREE.MeshStandardMaterial({ color: 0x23252c, metalness: 0.7, roughness: 0.4 })));
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2030).multiplyScalar(5), toneMapped: false }));
        light.position.y = 0.25;
        m.add(light);
        m.light = light;
        m.position.set(p.x, 0.2, p.z);
      } else {
        m = new THREE.Mesh(new THREE.CircleGeometry(3.2, 28).rotateX(-Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
        m.position.set(p.x, 0.08, p.z);
      }
      s.scene.add(m);
      this.hazards.push({ uid, id, m, pos: p, owner: car, armed: 0.6, life: id === 'mine' ? 40 : 25, hit: new Map() });
      beep(id === 'mine' ? 300 : 180, 0.15, 'square', 0.15);
    } else if (id === 'bubble') {
      car.shield = 6;
      this.ensureShield(car);
      if (car.isHuman && !net) s.style.event(car, 'BUBBLE SHIELD', 50, '#5bc0ff');
      beep(800, 0.2, 'sine', 0.2);
    } else if (id === 'mega') {
      car.mega = MEGA_TIME;
      s.fx.rings.emit(car.pos.x, car.pos.y, car.pos.z, 0x3ddc84, 12, 0.5);
      if (car.isHuman && !net) { s.style.event(car, 'MEGA CAR!', 150, '#3ddc84'); s.hud.center('MEGA!', 1, car.player); car.cam.shake = 0.8; }
      beep(110, 0.25, 'square', 0.25); setTimeout(() => beep(220, 0.25, 'square', 0.25), 150); setTimeout(() => beep(440, 0.4, 'square', 0.25), 300);
    } else if (id === 'lightning') {
      // Strikes every rival ahead of the user. Each client shrinks only the cars it owns.
      for (const o of s.cars) {
        if (o === car || o.eliminated || (car.team && o.team === car.team) || o.progress <= car.progress) continue;
        this.bolt(o);
        if (!o.remote && !(o.shield > 0) && !(o.mega > 0)) {
          o.tiny = TINY_TIME;
          o.vx *= 0.5; o.vz *= 0.5;
          if (o.isHuman) s.hud.center('ZAPPED!', 1, o.player);
        }
      }
      this.flash.position.set(car.pos.x, 30, car.pos.z);
      this.flash.intensity = 3000;
      if (car.isHuman && !net) s.style.event(car, 'LIGHTNING STRIKE', 300, '#fff275');
      beep(60, 1.2, 'sawtooth', 0.4);
    } else if (id === 'rocket') {
      car.shockNitro = 2.6;
      s.fx.rings.emit(car.pos.x - fx * 2, car.pos.y, car.pos.z - fz * 2, 0xffb703, 14, 0.45);
      s.fx.sparks.emit(car.pos.x - fx * 2.5, car.pos.y + 0.5, car.pos.z - fz * 2.5, 60, 0xffb703, 10, 2);
      if (car.isHuman && !net) { s.style.event(car, 'ROCKET BOOST', 80, '#ffb703'); car.cam.shake = 0.6; }
      beep(90, 0.5, 'sawtooth', 0.3);
    }
  }

  ensureShield(car) {
    if (car.shieldMesh) return;
    car.shieldMesh = makeShield();
    car.mesh.add(car.shieldMesh);
  }

  /** The car directly ahead in the race, or the nearest car if you're leading. */
  targetFor(car) {
    const live = this.s.cars.filter(o => o !== car && !o.eliminated && o.wreck <= 0 && (!car.team || o.team !== car.team));
    const ahead = live.filter(o => o.progress > car.progress).sort((a, b) => a.progress - b.progress)[0];
    if (ahead && (ahead.progress - car.progress) * this.s.track.seg < 300) return ahead;
    return live.sort((a, b) => Math.hypot(a.pos.x - car.pos.x, a.pos.z - car.pos.z) - Math.hypot(b.pos.x - car.pos.x, b.pos.z - car.pos.z))[0] ?? null;
  }

  explode(p, color = 0xff8c42) {
    const s = this.s;
    s.fx.sparks.emit(p.x, p.y + 0.5, p.z, 140, color, 16, 9);
    s.fx.rings.emit(p.x, p.y, p.z, 0xffd166, 12, 0.5);
    this.action.debris.burst(p, 8, 0x333333);
    for (let k = 0; k < 8; k++) s.smoke.emit(p.x, p.y + 0.5, p.z, 2.2);
    this.flash.position.set(p.x, p.y + 2, p.z);
    this.flash.intensity = 900;
    beep(50, 0.7, 'sawtooth', 0.35);
  }

  /** A hit: shields soak it, otherwise the car is wrecked. */
  /** Jagged bolt from the sky onto a car, fading out over half a second. */
  bolt(car) {
    const pts = [];
    let x = car.pos.x + (Math.random() - 0.5) * 6, z = car.pos.z + (Math.random() - 0.5) * 6;
    for (let y = 60; y > 0; y -= 6) {
      pts.push(new THREE.Vector3(x, y, z));
      x += (car.pos.x - x) * 0.25 + (Math.random() - 0.5) * 4;
      z += (car.pos.z - z) * 0.25 + (Math.random() - 0.5) * 4;
    }
    pts.push(new THREE.Vector3(car.pos.x, car.pos.y + 1, car.pos.z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: new THREE.Color(0xd8f0ff).multiplyScalar(6), toneMapped: false, transparent: true }));
    this.s.scene.add(line);
    this.bolts.push({ line, life: 0.5 });
    this.s.fx.sparks.emit(car.pos.x, car.pos.y + 1, car.pos.z, 50, 0xbfe6ff, 8, 6);
  }

  strike(victim, owner, label) {
    const s = this.s;
    if (victim.mega > 0) return;
    if (victim.shield > 0) {
      victim.shield = 0;
      if (victim.isHuman) s.hud.popup(victim.player, 'SHIELD BLOCKED', '#5bc0ff');
      return;
    }
    if (owner?.isHuman && owner !== victim) s.style.event(owner, label, 250, '#ff4d4d');
    this.action.wreck(victim, owner === victim ? null : owner);
  }

  // ---------- Simulation ----------

  update(dt) {
    const s = this.s, cars = s.cars.filter(c => !c.eliminated);
    if (!s.powers) for (const c of cars) c.shield = Math.max(0, (c.shield ?? 0) - dt);

    const owned = cars.filter(c => !c.remote);
    this.boxes.forEach((b, bi) => {
      if (b.down > 0) { b.down -= dt; return; }
      for (const c of owned) {
        if (c.wreck > 0 || c.pos.y > 3) continue;
        if (Math.abs(c.pos.x - b.m.position.x) < 2.2 && Math.abs(c.pos.z - b.m.position.z) < 2.2) {
          b.down = RESPAWN;
          this.send({ t: 'box', b: bi });
          s.fx.sparks.emit(b.m.position.x, 1.3, b.m.position.z, 40, new THREE.Color().setHSL(Math.random(), 1, 0.6).getHex(), 7, 4);
          if (!c.item) this.give(c);
          break;
        }
      }
    });

    // Using items: players press the item key, the AI picks its moment.
    for (const c of owned) {
      if (!c.item || c.wreck > 0 || s.state !== 'race') continue;
      c.itemAge += dt;
      if (c.isHuman) {
        const pressed = !!c.rawInput?.item, was = this.keys.get(c);
        this.keys.set(c, pressed);
        if (pressed && !was) this.use(c);
      } else if (this.aiWants(c)) this.use(c);
    }

    for (const m of this.missiles) {
      m.life -= dt;
      const t = m.target;
      if (t && !t.eliminated && t.wreck <= 0) {
        const want = new THREE.Vector3(t.pos.x - m.g.position.x, 0, t.pos.z - m.g.position.z).normalize();
        m.dir.lerp(want, Math.min(1, dt * 5)).normalize();
      }
      m.g.position.addScaledVector(m.dir, MISSILE_SPEED * dt);
      m.g.position.y = 1.1;
      m.g.rotation.y = Math.atan2(m.dir.x, m.dir.z);
      if (Math.random() < 0.7) s.smoke.emit(m.g.position.x - m.dir.x * 1.2, 0.9, m.g.position.z - m.dir.z * 1.2, 0.7);
      for (const c of owned) {
        if (c === m.owner || c.wreck > 0) continue;
        if (Math.hypot(c.pos.x - m.g.position.x, c.pos.z - m.g.position.z) < 2.6) {
          this.explode(m.g.position);
          this.strike(c, m.owner, 'MISSILE HIT');
          this.send({ t: 'mh', uid: m.uid });
          m.hit = true;
          break;
        }
      }
      if (!m.hit && m.life <= 0) this.explode(m.g.position, 0xff6b35);
      if (m.hit || m.life <= 0) { m.done = true; s.scene.remove(m.g); }
    }
    this.missiles = this.missiles.filter(m => !m.done);

    for (const h of this.hazards) {
      h.life -= dt;
      h.armed -= dt;
      for (const c of owned) {
        if (c.wreck > 0 || c.air || (h.armed > 0 && c === h.owner)) continue;
        const d = Math.hypot(c.pos.x - h.pos.x, c.pos.z - h.pos.z);
        if (h.id === 'mine' && d < 2.6) {
          this.explode(h.pos, 0xff2e63);
          this.strike(c, h.owner, 'MINE HIT');
          this.send({ t: 'hz', uid: h.uid });
          h.life = 0;
          break;
        }
        if (h.id === 'oil' && d < 3.4 && !(h.hit.get(c) > 0) && c.shield <= 0) {
          h.hit.set(c, 2);
          c.spinOut = 1;
          c.vx *= 0.55; c.vz *= 0.55;
          if (c.isHuman) s.hud.center('SPUN OUT', 1, c.player);
          if (h.owner?.isHuman && h.owner !== c) s.style.event(h.owner, 'OIL HIT', 150, '#b388ff');
          beep(240, 0.3, 'sine', 0.15);
        }
      }
      for (const [c, t] of h.hit) h.hit.set(c, t - dt);
      if (h.life <= 0) s.scene.remove(h.m);
    }
    this.hazards = this.hazards.filter(h => h.life > 0);

    for (const c of cars) {
      c.mega = Math.max(0, (c.mega ?? 0) - dt);
      c.tiny = Math.max(0, (c.tiny ?? 0) - dt);
    }

    // Spin-outs: the car whips round twice and loses grip for a second.
    for (const c of cars) {
      if (!(c.spinOut > 0)) continue;
      c.spinOut -= dt;
      c.visYaw = (1 - Math.max(0, c.spinOut)) * Math.PI * 4;
      if (c.spinOut <= 0) c.visYaw = 0;
    }
  }

  onNet(m) {
    const s = this.s;
    if (m.t === 'box') { const b = this.boxes[m.b]; if (b) b.down = RESPAWN; return; }
    if (m.t === 'use') { const car = s.byId?.get(m.id); if (car) this.use(car, m); return; }
    if (m.t === 'mh') {
      const mi = this.missiles.find(x => x.uid === m.uid);
      if (mi) { this.explode(mi.g.position); mi.hit = true; mi.life = 0; }
      return;
    }
    if (m.t === 'hz') {
      const h = this.hazards.find(x => x.uid === m.uid);
      if (h) { this.explode(h.pos, 0xff2e63); h.life = 0; }
    }
  }

  aiWants(c) {
    if (c.itemAge < 1.5 || Math.random() > 0.02) return false;
    const s = this.s, cars = s.cars.filter(o => o !== c && !o.eliminated && o.wreck <= 0);
    const behind = cars.some(o => o.progress < c.progress && (c.progress - o.progress) * s.track.seg < 35);
    switch (c.item) {
      case 'missile': { const t = this.targetFor(c); return !!t && Math.hypot(t.pos.x - c.pos.x, t.pos.z - c.pos.z) < 160; }
      case 'mine': case 'oil': return behind;
      case 'bubble': return this.missiles.some(m => m.target === c) || c.itemAge > 12;
      case 'mega': return cars.some(o => Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z) < 30) || c.itemAge > 8;
      case 'lightning': return cars.some(o => o.progress > c.progress);
      default: return (c.ai?.bend ?? 1) < 0.1;
    }
  }

  // ---------- Presentation ----------

  frame(dt) {
    const s = this.s, t = performance.now() / 1000;
    this.boxMat.emissive.setHSL((t * 0.25) % 1, 0.9, 0.55);
    for (const b of this.boxes) {
      b.m.visible = b.down <= 0;
      b.m.rotation.set(t * 1.3 + b.phase, t * 1.7 + b.phase, 0);
      b.m.position.y = 1.3 + Math.sin(t * 2.5 + b.phase) * 0.25;
    }
    for (const h of this.hazards) if (h.m.light) h.m.light.visible = Math.floor(t * 4) % 2 === 0;
    this.flash.intensity *= Math.exp(-dt * 7);
    for (const b of this.bolts) {
      b.life -= dt;
      b.line.material.opacity = Math.max(0, b.life * 2) * (Math.random() < 0.3 ? 0.3 : 1);
      if (b.life <= 0) { s.scene.remove(b.line); b.line.geometry.dispose(); b.line.material.dispose(); }
    }
    this.bolts = this.bolts.filter(b => b.life > 0);
    // Mega cars swell to giant size; zapped cars shrink. Scale eases so it reads as growth.
    for (const c of [...s.cars, ...this.action.cops]) {
      const want = c.mega > 0 ? 2.3 : c.tiny > 0 ? 0.5 : 1;
      const k = c.mesh.scale.x + (want - c.mesh.scale.x) * Math.min(1, dt * 6);
      c.mesh.scale.setScalar(k);
    }
    for (const c of s.cars) if (c.shieldMesh && !s.powers) c.shieldMesh.visible = c.shield > 0;
  }

  hud(h) {
    if (!h.item) return { icon: '', name: 'NO ITEM', ready: false };
    const d = ITEMS[h.item];
    return { icon: d.icon, name: `${d.name.toUpperCase()} [${h.player === 1 ? "'" : 'X'}]`, ready: true, color: d.color };
  }

  dispose() {
    for (const m of this.missiles) this.s.scene.remove(m.g);
  }
}
