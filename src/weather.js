import * as THREE from 'three';
import { beep } from './audio.js';

/** Theme adjusted for weather. Night tracks keep their night sky (sunset falls back to clear). */
export function weatherTheme(th, kind) {
  const t = { ...th };
  if (kind === 'sunset' && !th.night) {
    Object.assign(t, { skyTop: 0x2d2466, skyBottom: 0xff8a50, fog: 0xe8946a, sun: 0xffa060, sunI: th.sunI * 0.8, amb: th.amb * 0.8 });
  } else if (kind === 'fog') {
    Object.assign(t, { skyTop: th.night ? 0x10101a : 0x9aa4ad, skyBottom: th.night ? 0x262636 : 0xc9cfd4, fog: th.night ? 0x1d1d28 : 0xc4cacf, sunI: th.sunI * 0.55 });
  } else if (kind === 'rain') {
    Object.assign(t, { skyTop: th.night ? 0x05060c : 0x3a4250, skyBottom: th.night ? 0x1a1a28 : 0x7d8794, fog: th.night ? 0x14141e : 0x6f7884, sunI: th.sunI * 0.35, amb: th.amb * 0.8 });
  }
  return t;
}

export function fogRange(kind, night) {
  if (kind === 'fog') return [15, 230];
  if (kind === 'rain') return [60, night ? 450 : 600];
  return [150, night ? 700 : 1100];
}

/** Rain streaks (or snowflakes) around the camera, with lightning in rain. */
export class Rain {
  constructor(scene, hemi, count = 2600, { snow = false } = {}) {
    this.snow = snow;
    this.size = snow ? [110, 50, 110] : [130, 60, 130];
    this.count = count;
    const pos = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) this.drop(pos, i, Math.random() * this.size[1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.lines = snow
      ? new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, transparent: true, opacity: 0.9 }))
      : new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb8d4ff, transparent: true, opacity: 0.45, fog: false }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.hemi = hemi;
    this.baseI = hemi.intensity;
    this.flash = 0;
    this.nextBolt = 5 + Math.random() * 8;
  }

  drop(a, i, y) {
    const [sx, , sz] = this.size;
    const x = (Math.random() - 0.5) * sx, z = (Math.random() - 0.5) * sz;
    a.set([x, y, z, x + 0.15, y + 1.3, z + 0.1], i * 6);
  }

  update(dt, center) {
    const a = this.lines.geometry.attributes.position.array, fall = (this.snow ? 5 : 38) * dt;
    const sway = this.snow ? Math.sin(performance.now() / 900) * dt * 1.2 : 0;
    for (let i = 0; i < this.count; i++) {
      const j = i * 6;
      a[j + 1] -= fall; a[j + 4] -= fall;
      a[j] += sway; a[j + 3] += sway;
      if (a[j + 1] < 0) this.drop(a, i, this.size[1]);
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.position.set(center.x, center.y - 8, center.z);

    if (this.snow) return;
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.flash = 1;
      this.nextBolt = 7 + Math.random() * 10;
      setTimeout(() => beep(45 + Math.random() * 20, 1.2, 'sawtooth', 0.18), 300 + Math.random() * 900);
    }
    this.flash = Math.max(0, this.flash - dt * 3);
    const flicker = this.flash > 0.5 || (this.flash > 0.2 && Math.random() < 0.5) ? this.flash : 0;
    this.hemi.intensity = this.baseI + flicker * 4;
  }
}
