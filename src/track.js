import * as THREE from 'three';
import { canvasTex, noiseFill } from './env.js';

let roadTex, kerbTex, wallTex, checkerTex;

function textures() {
  if (roadTex) return;
  roadTex = canvasTex(256, 512, (g, w, h) => {
    noiseFill(g, w, h, '#2e3036', 0.14, 14000, 2);
    g.fillStyle = '#e8e8e8';
    g.fillRect(8, 0, 7, h);
    g.fillRect(w - 15, 0, 7, h);
    g.fillStyle = '#f5f5f5';
    g.fillRect(124, 0, 8, h / 2);
  });
  kerbTex = canvasTex(32, 64, (g, w, h) => {
    g.fillStyle = '#d62828'; g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#f1f1f1'; g.fillRect(0, h / 2, w, h / 2);
  });
  wallTex = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#e9ecef'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, w * 0.35, h);
    g.fillStyle = '#ef233c'; g.fillRect(w * 0.35, 0, w * 0.1, h / 2);
  });
  checkerTex = canvasTex(128, 32, (g) => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  });
}

/**
 * A road spline sampled every ~2m. Used for race circuits (flat, closed) and
 * open-world roads (draped over a height function, open or closed).
 * Right-hand vector at sample i is (-tz, tx), matching Car's convention.
 */
export class Track {
  constructor(points, { width = 16, closed = true, heightFn = null, lift = 0.03 } = {}) {
    this.width = width;
    this.closed = closed;
    this.heightFn = heightFn;
    this.lift = lift;
    this.curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], 0, p[1])), closed, 'centripetal');
    this.length = this.curve.getLength();
    const N = this.N = Math.max(20, Math.round(this.length / 2));
    this.seg = this.length / N;
    this.px = new Float32Array(N); this.pz = new Float32Array(N);
    this.tx = new Float32Array(N); this.tz = new Float32Array(N);
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const u = closed ? i / N : i / (N - 1);
      this.curve.getPointAt(u, p);
      this.curve.getTangentAt(u, t);
      const l = Math.hypot(t.x, t.z) || 1;
      this.px[i] = p.x; this.pz[i] = p.z;
      this.tx[i] = t.x / l; this.tz[i] = t.z / l;
    }
    this.lat = 0;
    this.dist = 0;
  }

  wrap(i) {
    const N = this.N;
    return this.closed ? ((i % N) + N) % N : Math.max(0, Math.min(N - 1, i));
  }

  heightAt(x, z) { return this.heightFn ? this.heightFn(x, z) : 0; }

  /** Nearest sample index. Also sets this.lat (signed, + = right of centre) and this.dist. */
  nearest(x, z, hint = -1, range = 40) {
    let best = 0, bd = Infinity;
    if (hint < 0) {
      for (let i = 0; i < this.N; i++) {
        const dx = x - this.px[i], dz = z - this.pz[i], d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
    } else {
      for (let k = -range; k <= range; k++) {
        const i = this.wrap(hint + k);
        const dx = x - this.px[i], dz = z - this.pz[i], d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
    }
    this.measure(x, z, best);
    return best;
  }

  measure(x, z, i) {
    const dx = x - this.px[i], dz = z - this.pz[i];
    this.lat = -dx * this.tz[i] + dz * this.tx[i];
    this.dist = Math.hypot(dx, dz);
  }

  distApprox(x, z) {
    let bd = Infinity;
    for (let i = 0; i < this.N; i += 3) {
      const dx = x - this.px[i], dz = z - this.pz[i], d = dx * dx + dz * dz;
      if (d < bd) bd = d;
    }
    return Math.sqrt(bd);
  }

  /** Strip between lateral offsets a..b (or a vertical wall when a === b). */
  ribbon(offA, offB, y0, y1, vLen) {
    const N = this.N, count = this.closed ? N + 1 : N;
    const pos = new Float32Array(count * 6), uv = new Float32Array(count * 4), idx = [];
    for (let k = 0; k < count; k++) {
      const i = k % N, rx = -this.tz[i], rz = this.tx[i];
      const ax = this.px[i] + rx * offA, az = this.pz[i] + rz * offA;
      const bx = this.px[i] + rx * offB, bz = this.pz[i] + rz * offB;
      pos.set([ax, this.heightAt(ax, az) + y0, az, bx, this.heightAt(bx, bz) + y1, bz], k * 6);
      const v = (k * this.seg) / vLen;
      uv.set([0, v, 1, v], k * 4);
      if (k < count - 1) {
        const a = k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  buildMesh({ kerbs = true, walls = false, wallGap = 3.5, night = false } = {}) {
    textures();
    const group = new THREE.Group();
    const W = this.width / 2, L = this.lift;
    const road = new THREE.Mesh(this.ribbon(-W, W, L, L, 24),
      new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    road.receiveShadow = true;
    group.add(road);

    if (kerbs) {
      const km = new THREE.MeshStandardMaterial({
        map: kerbTex, roughness: 0.7, side: THREE.DoubleSide,
        emissive: night ? 0xff2e63 : 0x000000, emissiveIntensity: night ? 0.6 : 0,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      });
      for (const [a, b] of [[-W - 1.4, -W], [W, W + 1.4]]) {
        const m = new THREE.Mesh(this.ribbon(a, b, L + 0.04, L + 0.04, 4), km);
        m.receiveShadow = true;
        group.add(m);
      }
    }

    if (walls) {
      const wm = new THREE.MeshStandardMaterial({
        map: wallTex, roughness: 0.6, side: THREE.DoubleSide,
        emissive: night ? 0x08d9d6 : 0x000000, emissiveIntensity: night ? 0.25 : 0,
      });
      for (const s of [-1, 1]) {
        const o = s * (W + wallGap);
        const m = new THREE.Mesh(this.ribbon(o, o, 0, 1.2, 6), wm);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
    }
    return group;
  }

  startGate(text = 'VELOCITY RUSH') {
    textures();
    const g = new THREE.Group();
    g.position.set(this.px[0], this.heightAt(this.px[0], this.pz[0]), this.pz[0]);
    g.rotation.y = Math.atan2(this.tx[0], this.tz[0]);
    const W = this.width / 2;

    const line = new THREE.Mesh(new THREE.PlaneGeometry(this.width, 2.4),
      new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    line.rotation.x = -Math.PI / 2;
    line.position.y = this.lift + 0.02;
    line.receiveShadow = true;
    g.add(line);

    const metal = new THREE.MeshStandardMaterial({ color: 0x23262f, metalness: 0.7, roughness: 0.35 });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), metal);
      p.position.set(s * (W + 2.5), 4.5, 0);
      p.castShadow = true;
      g.add(p);
    }
    const bannerTex = canvasTex(1024, 96, (c, w, h) => {
      c.fillStyle = '#ff2e63'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff';
      c.font = 'italic 900 64px Orbitron, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(text, w / 2, h / 2 + 4);
    }, false);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(this.width + 6, 1.8, 0.6),
      new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.5 }));
    banner.position.y = 8.6;
    banner.castShadow = true;
    g.add(banner);
    return g;
  }
}
