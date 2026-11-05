import * as THREE from 'three';
import { canvasTex } from './env.js';

export class ChaseCam {
  constructor(car, groundFn = null) {
    this.car = car;
    this.groundFn = groundFn;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 5000);
    this.mode = 0;            // 0 chase, 1 far chase, 2 hood
    this.ready = false;
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.yaw = car.yaw;
    this.h = 0;
  }

  cycle() { this.mode = (this.mode + 1) % 3; this.ready = false; }

  update(dt) {
    const c = this.car, cam = this.camera;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const sp = Math.min(1.3, Math.abs(c.fwdSpeed) / c.spec.maxSpeed);
    if (this.mode === 2) {
      cam.position.set(c.pos.x + fx * 0.3, c.pos.y + 1.25, c.pos.z + fz * 0.3);
      this.look.set(c.pos.x + fx * 30, c.pos.y + 1.0, c.pos.z + fz * 30);
    } else {
      const big = c.mesh?.scale.x > 1.05 ? c.mesh.scale.x : 1;
      const dist = (this.mode === 0 ? 6.8 + sp * 1.6 : 10.5 + sp * 2.5) * big;
      const h = (this.mode === 0 ? 2.5 : 3.8) * big;
      // Smooth the heading (so drifts swing the view) but stay locked to the car's position.
      if (!this.ready) { this.yaw = c.yaw; this.h = c.pos.y + h; this.ready = true; }
      let dy = c.yaw - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * (1 - Math.exp(-dt * 6));
      const cx = Math.sin(this.yaw), cz = Math.cos(this.yaw);
      const tx = c.pos.x - cx * dist, tz = c.pos.z - cz * dist;
      let ty = c.pos.y + h;
      if (this.groundFn) ty = Math.max(ty, this.groundFn(tx, tz) + 1.2);
      this.h += (ty - this.h) * (1 - Math.exp(-dt * 6));
      cam.position.set(tx, this.h, tz);
      this.look.set(c.pos.x + cx * 4, c.pos.y + 1.2, c.pos.z + cz * 4);
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const a = this.shake * this.shake * 0.6;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      cam.position.z += (Math.random() - 0.5) * a;
    }
    cam.lookAt(this.look);
    const fov = 60 + sp * 14 + (c.nitroOn ? 8 : 0) + (c.turbo > 0 ? 12 : 0) + (c.shockNitro > 0 ? 16 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
  }
}

/** Each car is two circles (nose and tail). Equal-mass impulse with a little bounce. */
export function collideCars(cars, onHit = null) {
  const size = c => c.mesh?.scale.x ?? 1;   // mega cars are bigger, zapped cars smaller
  for (let a = 0; a < cars.length; a++) {
    for (let b = a + 1; b < cars.length; b++) {
      const A = cars[a], B = cars[b];
      if (A.ghost > 0 || B.ghost > 0) continue;
      // A shielded car acts as immovable; the other takes the whole hit.
      let wa = A.shield > 0 || A.mega > 0 ? 0 : 1, wb = B.shield > 0 || B.mega > 0 ? 0 : 1;
      if (!wa && !wb) wa = wb = 1;
      const sum = wa + wb;
      const sA = size(A), sB = size(B), R = 1.15 * (sA + sB), offA = 1.1 * sA, offB = 1.1 * sB;
      const dx0 = B.pos.x - A.pos.x, dz0 = B.pos.z - A.pos.z, reach = 3 * (sA + sB);
      if (dx0 * dx0 + dz0 * dz0 > reach * reach) continue;
      for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
        const ax = A.pos.x + Math.sin(A.yaw) * offA * sa, az = A.pos.z + Math.cos(A.yaw) * offA * sa;
        const bx = B.pos.x + Math.sin(B.yaw) * offB * sb, bz = B.pos.z + Math.cos(B.yaw) * offB * sb;
        const dx = bx - ax, dz = bz - az, d2 = dx * dx + dz * dz;
        if (d2 >= R * R || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = R - d;
        A.pos.x -= nx * pen * wa / sum; A.pos.z -= nz * pen * wa / sum;
        B.pos.x += nx * pen * wb / sum; B.pos.z += nz * pen * wb / sum;
        const rv = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
        if (rv < 0) {
          const j = -((wa && wb ? 1.3 : 2.2) * rv) / sum;
          A.vx -= nx * j * wa; A.vz -= nz * j * wa;
          B.vx += nx * j * wb; B.vz += nz * j * wb;
          if ((-rv > 4 || A.mega > 0 || B.mega > 0 || A.tiny > 0 || B.tiny > 0) && onHit) onHit(A, B, (ax + bx) / 2, (A.pos.y + B.pos.y) / 2 + 0.6, (az + bz) / 2, -rv);
        }
      }
    }
  }
}

/** Pooled tyre-smoke sprites. */
export class Smoke {
  constructor(scene, n = 220, color = 0xdddddd) {
    const tex = canvasTex(64, 64, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,.9)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, w);
    }, false);
    this.items = [];
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      scene.add(s);
      this.items.push({ s, life: 0 });
    }
    this.next = 0;
  }

  emit(x, y, z, size = 1) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.life = 1;
    it.size = size;
    it.s.position.set(x + (Math.random() - 0.5) * 0.4, y + 0.3, z + (Math.random() - 0.5) * 0.4);
    it.s.visible = true;
  }

  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt * 1.1;
      if (it.life <= 0) { it.s.visible = false; continue; }
      const sc = (1 + (1 - it.life) * 4) * it.size;
      it.s.scale.set(sc, sc, sc);
      it.s.position.y += dt * 0.9;
      it.s.material.opacity = it.life * 0.45;
    }
  }

  /** Smoke from the rear wheels of a drifting car. */
  fromCar(car) {
    if (!car.drifting || Math.random() > 0.55) return;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), side = Math.random() < 0.5 ? -0.95 : 0.95;
    this.emit(car.pos.x - fx * 1.4 - fz * side, car.pos.y, car.pos.z - fz * 1.4 + fx * side);
  }

  dispose() { for (const it of this.items) it.s.material.dispose(); }
}

/**
 * Hides cars that pass right through a camera. Otherwise a car overtaking through
 * the chase camera fills the screen with its dark underside for a few frames.
 */
export function hideNearCameras(cars, cameras, radius = 3.4) {
  for (const c of cars) {
    if (c.eliminated || c.left) continue;
    const p = c.mesh.position;
    let near = false;
    for (const cam of cameras) {
      const dx = cam.position.x - p.x, dy = cam.position.y - (p.y + 0.8), dz = cam.position.z - p.z;
      if (dx * dx + dy * dy + dz * dz < radius * radius && !c.isHuman) near = true;
    }
    c.mesh.visible = !near;
  }
}

/** Frees everything a session scene put on the GPU: geometry, materials, textures and shadow maps. */
export function disposeScene(scene) {
  scene.environment?.userData.target?.dispose();
  scene.environment?.dispose();
  scene.traverse(o => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const key of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'alphaMap']) m[key]?.dispose();
      m.dispose();
    }
    if (o.isLight) { o.shadow?.map?.dispose(); o.dispose?.(); }
  });
}
