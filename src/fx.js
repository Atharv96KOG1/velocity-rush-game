import * as THREE from 'three';
import { canvasTex } from './env.js';

let glowTex;
function glow() {
  return glowTex ??= canvasTex(64, 64, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.3, 'rgba(255,255,255,.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
  }, false);
}

/** Additive point sparks with simple gravity. One draw call for all sparks. */
export class Sparks {
  constructor(scene, n = 600) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.28, map: glow(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    this.tmp = new THREE.Color();
  }

  emit(x, y, z, count, color = 0xffb347, speed = 8, up = 4) {
    this.tmp.set(color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      this.pos.set([x, y, z], i * 3);
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.vel.set([Math.cos(a) * s, up * (0.4 + Math.random()), Math.sin(a) * s], i * 3);
      this.col.set([this.tmp.r * 3, this.tmp.g * 3, this.tmp.b * 3], i * 3);
      this.life[i] = 0.5 + Math.random() * 0.5;
    }
  }

  update(dt) {
    const p = this.pos, v = this.vel;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) { p[j + 1] = -9999; continue; }
      v[j + 1] -= 18 * dt;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      const f = Math.exp(-dt * 2.5);
      this.col[j] *= f; this.col[j + 1] *= f; this.col[j + 2] *= f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

/** Expanding flat rings (shockwaves, EMP pulses, blink flashes). */
export class Rings {
  constructor(scene, n = 12) {
    this.items = [];
    const geo = new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.visible = false;
      scene.add(m);
      this.items.push({ m, t: 0, dur: 1, size: 1 });
    }
    this.next = 0;
  }

  emit(x, y, z, color, size = 25, dur = 0.6) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.m.position.set(x, y + 0.6, z);
    it.m.material.color.set(color);
    it.t = 0; it.dur = dur; it.size = size;
    it.m.visible = true;
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.t += dt;
      const k = it.t / it.dur;
      if (k >= 1) { it.m.visible = false; continue; }
      const s = 1 + it.size * (1 - (1 - k) * (1 - k));
      it.m.scale.set(s, 1 + k * 4, s);
      it.m.material.opacity = (1 - k) * 0.9;
    }
  }
}

/** Fresnel bubble around a shielded car. */
export function makeShield(color = 0x5bc0ff) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 color; uniform float time; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.5); float pulse = 0.75 + 0.25*sin(time*8.0);
      gl_FragColor = vec4(color * (f*1.8+0.06) * pulse, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  m.scale.set(1.9, 1.3, 3.1);
  m.position.y = 0.8;
  m.visible = false;
  return m;
}

/** Glowing ribbon trails behind both tail lights. */
export class Trail {
  constructor(scene, color = 0xff2040, len = 34) {
    this.len = len;
    this.pts = [];
    this.geos = [0, 1].map(() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(len * 2 * 3), 3));
      const alpha = new Float32Array(len * 2);
      for (let i = 0; i < len; i++) alpha[i * 2] = alpha[i * 2 + 1] = 1 - i / (len - 1);
      g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
      const idx = [];
      for (let i = 0; i < len - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setIndex(idx);
      return g;
    });
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(color) }, strength: { value: 0 } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float strength; varying float vA; void main(){ gl_FragColor = vec4(color*2.0, vA*vA*strength); }',
    });
    this.meshes = this.geos.map(g => {
      const m = new THREE.Mesh(g, this.mat);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });
  }

  /** Forget the trail, e.g. after a respawn or teleport, so it doesn't streak across the map. */
  reset() { this.pts.length = 0; this.mat.uniforms.strength.value = 0; }

  update(car, strength) {
    this.mat.uniforms.strength.value += (strength - this.mat.uniforms.strength.value) * 0.15;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    this.pts.unshift({ x: car.pos.x - fx * 2.25, y: car.pos.y + 0.68, z: car.pos.z - fz * 2.25, rx: -fz, rz: fx });
    if (this.pts.length > this.len) this.pts.length = this.len;
    this.geos.forEach((g, side) => {
      const off = side ? 0.6 : -0.6, a = g.attributes.position.array;
      for (let i = 0; i < this.len; i++) {
        const p = this.pts[Math.min(i, this.pts.length - 1)];
        const cx = p.x + p.rx * off, cz = p.z + p.rz * off;
        a.set([cx, p.y - 0.07, cz, cx, p.y + 0.07, cz], i * 6);
      }
      g.attributes.position.needsUpdate = true;
    });
  }
}
