import * as THREE from 'three';
import { beep } from './audio.js';

const WARN = 2.2;       // seconds of warning before impact
const BLAST = 6.5;      // impact radius, metres
const FALL = 0.9;       // seconds the meteor is visible falling

/**
 * Meteor Storm (Chaos mode): flaming meteors rain onto the track ahead of the
 * racers. A red circle marks each impact point; anything inside when it hits is
 * wrecked. The host (or the offline game) decides where meteors fall; every
 * client wrecks only the cars it owns.
 */
export class MeteorStorm {
  constructor(s, action) {
    this.s = s;
    this.action = action;
    this.next = 6;
    this.seq = 0;
    this.meteors = [];
    this.warnGeo = new THREE.RingGeometry(BLAST - 0.6, BLAST, 48).rotateX(-Math.PI / 2);
    this.fillGeo = new THREE.CircleGeometry(BLAST, 48).rotateX(-Math.PI / 2);
    this.rockGeo = new THREE.IcosahedronGeometry(1.6, 1);
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x3a2618, emissive: 0xff5a1a, emissiveIntensity: 2.2, roughness: 0.9, flatShading: true });
    this.light = new THREE.PointLight(0xff6a2a, 0, 60, 1.6);
    s.scene.add(this.light);
    s.hud.msg('☄️ METEOR STORM · WATCH FOR RED CIRCLES', 3.5, null, '#ff8c42');
  }

  /** Authority picks an impact point on the racing line ahead of a random racer. */
  pick() {
    const s = this.s, t = s.track;
    const live = s.cars.filter(c => !c.eliminated && !c.finished);
    if (!live.length) return null;
    const target = live[Math.floor(Math.random() * live.length)];
    const ahead = Math.round((45 + Math.random() * 60) / t.seg);
    const i = t.wrap(target.trackIndex + ahead);
    const lat = (Math.random() - 0.5) * t.width * 0.7;
    return { x: t.px[i] - t.tz[i] * lat, z: t.pz[i] + t.tx[i] * lat };
  }

  spawn(x, z, id = `m${this.seq++}`) {
    const s = this.s;
    // Decals sit just above the road; polygon offset keeps them from z-fighting with the tarmac.
    const decal = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -12 };
    const ring = new THREE.Mesh(this.warnGeo, new THREE.MeshBasicMaterial({ ...decal, color: new THREE.Color(0xff2020).multiplyScalar(3), toneMapped: false }));
    const fill = new THREE.Mesh(this.fillGeo, new THREE.MeshBasicMaterial({ ...decal, color: 0xff2020, opacity: 0.25 }));
    ring.position.set(x, 0.25, z);
    fill.position.set(x, 0.22, z);
    ring.renderOrder = fill.renderOrder = 2;
    const rock = new THREE.Mesh(this.rockGeo, this.rockMat);
    rock.visible = false;
    s.scene.add(ring, fill, rock);
    // Meteors come in at a steep angle from a random direction.
    const a = Math.random() * Math.PI * 2, t = s.track, i = t.nearest(x, z);
    this.meteors.push({ id, x, z, i, lat: t.lat, t: 0, ring, fill, rock, from: new THREE.Vector3(x + Math.cos(a) * 70, 160, z + Math.sin(a) * 70) });
  }

  update(dt) {
    const s = this.s;
    if (s.state !== 'race') return;
    if (!s.net || s.authority) {
      this.next -= dt;
      if (this.next <= 0) {
        this.next = 1.6 + Math.random() * 2.2;
        const p = this.pick();
        if (p) {
          const id = `m${this.seq++}`;
          this.spawn(p.x, p.z, id);
          s.net?.send({ t: 'mt', id, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 });
        }
      }
    }
    for (const m of this.meteors) {
      m.t += dt;
      if (!m.hit && m.t >= WARN) this.impact(m);
    }
    // AI drivers see the warning circles and swerve if they can.
    const t = s.track;
    for (const c of s.cars) {
      if (c.remote || c.isHuman || !c.ai || c.wreck > 0) continue;
      for (const m of this.meteors) {
        if (m.hit) continue;
        let di = m.i - c.trackIndex;
        if (di < -t.N / 2) di += t.N;
        if (di < 2 || di * t.seg > 50 || Math.abs(c.ai.lane - m.lat) > BLAST) continue;
        c.ai.lane = Math.max(-t.width * 0.4, Math.min(t.width * 0.4, m.lat + (m.lat > 0 ? -1 : 1) * (BLAST + 1.5)));
        c.ai.laneTimer = 2;
      }
    }
  }

  impact(m) {
    const s = this.s, p = { x: m.x, y: 0, z: m.z };
    m.hit = true;
    s.fx.sparks.emit(m.x, 1, m.z, 180, 0xff8c42, 18, 12);
    s.fx.rings.emit(m.x, 0, m.z, 0xff5a1a, 14, 0.6);
    s.fx.rings.emit(m.x, 0, m.z, 0xffd166, 8, 0.4);
    this.action.debris.burst(p, 10, 0x3a2618);
    for (let k = 0; k < 10; k++) s.smoke.emit(m.x + (Math.random() - 0.5) * 6, 0.5, m.z + (Math.random() - 0.5) * 6, 2.8);
    this.light.position.set(m.x, 6, m.z);
    this.light.intensity = 1500;
    for (const c of [...s.cars, ...this.action.cops]) {
      if (c.remote || c.eliminated || c.wreck > 0 || c.pos.y > 4) continue;
      if (Math.hypot(c.pos.x - m.x, c.pos.z - m.z) < BLAST) {
        if (c.isHuman) s.hud.center('METEOR HIT!', 1.2, c.player);
        this.action.wreck(c, null);
      }
    }
    for (const h of s.humans) {
      const d = Math.hypot(h.pos.x - m.x, h.pos.z - m.z);
      if (d < 60) h.cam.shake = Math.max(h.cam.shake, 1 - d / 60);
      if (d < 120) beep(40 + Math.random() * 20, 0.8, 'sawtooth', 0.3 * (1 - d / 120));
    }
  }

  onNet(m) {
    if (m.t === 'mt' && !this.meteors.some(x => x.id === m.id)) this.spawn(m.x, m.z, m.id);
  }

  frame(dt) {
    const s = this.s, now = performance.now() / 1000;
    this.light.intensity *= Math.exp(-dt * 5);
    for (const m of this.meteors) {
      const k = Math.min(1, m.t / WARN);
      m.ring.material.opacity = 0.5 + 0.5 * Math.sin(now * (8 + k * 20));
      m.ring.scale.setScalar(1.15 - k * 0.15);
      const fall = (m.t - (WARN - FALL)) / FALL;
      if (fall > 0 && !m.hit) {
        m.rock.visible = true;
        m.rock.position.lerpVectors(m.from, new THREE.Vector3(m.x, 0, m.z), fall);
        m.rock.rotation.x += dt * 5; m.rock.rotation.z += dt * 3;
        if (Math.random() < 0.9) s.smoke.emit(m.rock.position.x, m.rock.position.y, m.rock.position.z, 2.2);
        s.fx.sparks.emit(m.rock.position.x, m.rock.position.y, m.rock.position.z, 3, 0xff8c42, 2, 1);
      }
      if (m.hit) {
        m.rock.visible = false;
        m.ring.visible = false;
        // A scorch mark lingers briefly where it landed.
        m.fill.material.color.set(0x110904);
        m.fill.material.opacity = Math.max(0, 0.7 - (m.t - WARN) * 0.15);
      }
    }
    const gone = this.meteors.filter(m => m.hit && m.t > WARN + 5);
    for (const m of gone) { s.scene.remove(m.ring, m.fill, m.rock); m.ring.material.dispose(); m.fill.material.dispose(); }
    this.meteors = this.meteors.filter(m => !gone.includes(m));
  }

  markers() {
    return this.meteors.filter(m => !m.hit).map(m => ({ x: m.x, z: m.z, r: 5, color: '#ff3020' }));
  }
}
