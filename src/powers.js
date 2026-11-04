import { makeShield } from './fx.js';
import { beep } from './audio.js';

// Charge rate is 1 / cooldown per second; drifting charges 2x faster.
export const POWERS = [
  { id: 'turbo', name: 'Overdrive', icon: '⚡', color: 0xffb703, price: 0, cooldown: 14, desc: '3 seconds of massive thrust and +90 km/h top speed.' },
  { id: 'shock', name: 'Shockwave', icon: '💥', color: 0xff5d2e, price: 1500, cooldown: 16, desc: 'Blast every car within 24 m off its line.' },
  { id: 'shield', name: 'Aegis Shield', icon: '🛡️', color: 0x5bc0ff, price: 2000, cooldown: 18, desc: '5 seconds immune to hits and EMP. You bulldoze anyone you touch.' },
  { id: 'ghost', name: 'Phantom Phase', icon: '👻', color: 0xb388ff, price: 2500, cooldown: 16, desc: '4 seconds: pass through cars and keep full grip off-road.' },
  { id: 'emp', name: 'EMP Pulse', icon: '🌀', color: 0x08d9d6, price: 3500, cooldown: 20, desc: 'Stalls every rival within 110 m for 2.5 seconds.' },
  { id: 'blink', name: 'Blink', icon: '✦', color: 0xff2e63, price: 5000, cooldown: 22, desc: 'Teleport 45 m ahead along the road.' },
];

export const powerById = id => POWERS.find(p => p.id === id) ?? POWERS[0];

/**
 * Owns power charge/activation for every car in a session. Sessions supply:
 *  ctx.fx { sparks, rings }, ctx.rivals(car) -> cars, ctx.blink(car, metres) -> {x,y,z,yaw} | null,
 *  ctx.onUse(car, def), ctx.shake(car, amount)
 */
export class PowerSystem {
  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx;
    this.cars = [];
  }

  attach(car, id) {
    const def = powerById(id);
    car.power = { def, charge: 0.35, active: 0 };
    car.shield = 0; car.ghost = 0; car.stun = 0; car.turbo = 0;
    car.shieldMesh = makeShield(def.id === 'shield' ? def.color : 0x5bc0ff);
    car.mesh.add(car.shieldMesh);
    car.materials = [];
    car.mesh.traverse(o => { if (o.isMesh && o.material && !o.material.isShaderMaterial && !o.material.isSpriteMaterial) car.materials.push(o.material); });
    this.cars.push(car);
  }

  ready(car) { return car.power && car.power.charge >= 1 && !car.eliminated; }

  /** remote = the activation came over the network: skip the charge check and never move that car. */
  use(car, remote = false) {
    if (!remote && !this.ready(car)) return false;
    const owns = o => this.ctx.owns ? this.ctx.owns(o) : true;
    const p = car.power, d = p.def, { sparks, rings } = this.ctx.fx;
    const x = car.pos.x, y = car.pos.y, z = car.pos.z;
    p.charge = 0;
    switch (d.id) {
      case 'turbo':
        car.turbo = 3;
        sparks.emit(x, y + 0.5, z, 40, d.color, 10, 3);
        break;
      case 'shock':
        rings.emit(x, y, z, d.color, 24, 0.55);
        rings.emit(x, y, z, 0xffffff, 16, 0.4);
        sparks.emit(x, y + 0.5, z, 120, d.color, 22, 6);
        for (const o of this.cars) {
          if (o === car || o.eliminated || o.shield > 0 || !owns(o)) continue;
          const dx = o.pos.x - x, dz = o.pos.z - z, dist = Math.hypot(dx, dz);
          if (dist > 24 || dist < 0.01) continue;
          const f = 26 * (1 - dist / 24) + 6;
          o.vx += (dx / dist) * f; o.vz += (dz / dist) * f;
          o.yaw += (Math.random() - 0.5) * 0.9;
          this.ctx.shake?.(o, 0.8);
        }
        break;
      case 'shield':
        car.shield = 5;
        break;
      case 'ghost':
        car.ghost = 4;
        break;
      case 'emp':
        rings.emit(x, y, z, d.color, 110, 0.9);
        rings.emit(x, y, z, 0xffffff, 60, 0.6);
        for (const o of this.ctx.rivals(car)) {
          if (o.eliminated || o.shield > 0) continue;
          if (Math.hypot(o.pos.x - x, o.pos.z - z) > 110) continue;
          if (owns(o)) o.stun = 2.5;
          sparks.emit(o.pos.x, o.pos.y + 1, o.pos.z, 40, d.color, 6, 5);
        }
        break;
      case 'blink': {
        if (remote) {
          rings.emit(x, y, z, d.color, 10, 0.4);
          sparks.emit(x, y + 0.8, z, 80, d.color, 9, 4);
          break;
        }
        const t = this.ctx.blink(car, 45);
        if (!t) { p.charge = 1; return false; }
        rings.emit(x, y, z, d.color, 10, 0.4);
        sparks.emit(x, y + 0.8, z, 80, d.color, 9, 4);
        const sp = Math.max(0, car.fwdSpeed);
        car.pos.set(t.x, t.y, t.z);
        car.yaw = t.yaw;
        car.vx = Math.sin(t.yaw) * sp; car.vz = Math.cos(t.yaw) * sp;
        car.trackIndex = t.index ?? car.trackIndex;
        rings.emit(t.x, t.y, t.z, 0xffffff, 12, 0.45);
        sparks.emit(t.x, t.y + 0.8, t.z, 80, d.color, 9, 4);
        break;
      }
    }
    p.active = 0.6;
    this.ctx.onUse?.(car, d);
    if (car.isHuman) beep(d.id === 'shock' || d.id === 'emp' ? 160 : 700, 0.35, 'sawtooth', 0.3);
    return true;
  }

  /** Physics-rate update: charge and timers. */
  update(dt) {
    for (const c of this.cars) {
      if (c.eliminated) continue;
      const p = c.power;
      if (p.charge < 1) p.charge = Math.min(1, p.charge + (dt / p.def.cooldown) * (c.drifting ? 2 : 1));
      c.turbo = Math.max(0, c.turbo - dt);
      c.shield = Math.max(0, c.shield - dt);
      c.ghost = Math.max(0, c.ghost - dt);
      c.stun = Math.max(0, c.stun - dt);
      p.active = Math.max(0, p.active - dt);
    }
  }

  /** Frame-rate update: visuals. */
  frame(dt, time) {
    const { sparks } = this.ctx.fx;
    for (const c of this.cars) {
      if (c.eliminated) continue;
      c.shieldMesh.visible = c.shield > 0 && (c.shield > 1 || Math.sin(time * 30) > 0);
      c.shieldMesh.material.uniforms.time.value = time;
      const ghostA = c.ghost > 0 ? 0.35 : 1;
      if (c._ghostA !== ghostA) {
        c._ghostA = ghostA;
        for (const m of c.materials) { m.transparent = ghostA < 1; m.opacity = ghostA; m.needsUpdate = true; }
      }
      if (c.stun > 0 && Math.random() < 0.5) sparks.emit(c.pos.x + (Math.random() - 0.5) * 2, c.pos.y + 1 + Math.random(), c.pos.z + (Math.random() - 0.5) * 3, 2, 0x08d9d6, 3, 2);
      if (c.turbo > 0) {
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        if (Math.random() < 0.5) sparks.emit(c.pos.x - fx * 2.6, c.pos.y + 0.45, c.pos.z - fz * 2.6, 1, 0xffb703, 3, 1);
      }
    }
  }

  /** Simple AI policy: fire when the situation suits the power. */
  aiUse(car, ctx) {
    if (!this.ready(car) || car.isHuman && !car.finished) return false;
    if (Math.random() > 0.02) return false; // react within ~0.4 s, not instantly
    const id = car.power.def.id;
    const near = this.cars.filter(o => o !== car && !o.eliminated && Math.hypot(o.pos.x - car.pos.x, o.pos.z - car.pos.z) < 18).length;
    const ok = {
      turbo: ctx.straight,
      blink: ctx.straight,
      shock: near > 0,
      shield: near > 0,
      ghost: near > 0,
      emp: ctx.rivalsAhead > 0,
    }[id];
    return ok ? this.use(car) : false;
  }
}

