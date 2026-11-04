import { buildCarMesh } from './car.js';

const RATE = 20;   // samples per second
const key = (track, laps, type) => `velocity-rush-ghost-${track}-${laps}-${type}`;

/** Best run for a solo event, or null. */
export function loadGhost(track, laps, type) {
  try { return JSON.parse(localStorage.getItem(key(track, laps, type)) || 'null'); } catch { return null; }
}

export class GhostRecorder {
  constructor() { this.frames = []; this.t = 0; }

  record(time, car) {
    if (time < this.t) return;
    this.t = time + 1 / RATE;
    this.frames.push(Math.round(car.pos.x * 100) / 100, Math.round(car.pos.z * 100) / 100, Math.round(car.yaw * 1000) / 1000);
  }

  /** Saves the run when it beats the stored ghost. Returns true if saved. */
  saveIfBest(track, laps, type, time, color) {
    const best = loadGhost(track, laps, type);
    if (best && best.time <= time) return false;
    try {
      localStorage.setItem(key(track, laps, type), JSON.stringify({ time, color, frames: this.frames }));
      return true;
    } catch { return false; }
  }
}

/** Plays a recorded run back as a translucent car. */
export class GhostPlayer {
  constructor(scene, data) {
    this.data = data;
    this.n = data.frames.length / 3;
    const { group } = buildCarMesh(0x08d9d6);
    group.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.35;
      o.material.depthWrite = false;
      if (o.material.emissive) { o.material.emissive.set(0x08d9d6); o.material.emissiveIntensity = 0.6; }
    });
    this.mesh = group;
    scene.add(group);
  }

  update(time) {
    const f = this.data.frames, i = Math.min(this.n - 2, Math.max(0, Math.floor(time * RATE)));
    const k = Math.min(1, Math.max(0, time * RATE - i)), a = i * 3, b = a + 3;
    let dy = f[b + 2] - f[a + 2];
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.mesh.position.set(f[a] + (f[b] - f[a]) * k, 0, f[a + 1] + (f[b + 1] - f[a + 1]) * k);
    this.mesh.rotation.y = f[a + 2] + dy * k;
    this.mesh.visible = time * RATE < this.n;
  }
}
