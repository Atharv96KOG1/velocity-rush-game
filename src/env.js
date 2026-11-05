import * as THREE from 'three';

export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function noiseFill(g, w, h, base, spread, count, size = 2) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const v = (Math.random() - 0.5) * spread;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

export const SUN_DIR = new THREE.Vector3(90, 160, 50).normalize();

export function makeSky(top, bottom, stars = false, sunColor = 0xfff3d6) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) },
      sunDir: { value: SUN_DIR.clone() }, sunColor: { value: new THREE.Color(sunColor) }, night: { value: stars ? 1 : 0 },
    },
    vertexShader: `varying vec3 vP;
      void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float night; varying vec3 vP;
      void main() {
        float h = clamp(vP.y * 1.5 + 0.08, 0.0, 1.0);
        vec3 col = mix(bottom, top, pow(h, 0.7));
        float d = max(dot(normalize(vP), sunDir), 0.0);
        // Sun (or moon at night): hard disc plus soft halo.
        float disc = smoothstep(0.9993, 0.9996, d);
        float halo = pow(d, 64.0) * 0.6 + pow(d, 8.0) * 0.18;
        col += sunColor * (disc * (night > 0.5 ? 1.2 : 6.0) + halo * (night > 0.5 ? 0.25 : 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  group.add(sky);
  if (stars) {
    const r = rng(7), pos = [];
    for (let i = 0; i < 2000; i++) {
      const a = r() * Math.PI * 2, y = 0.08 + r() * 0.92, s = Math.sqrt(1 - y * y);
      pos.push(Math.cos(a) * s * 2200, y * 2200, Math.sin(a) * s * 2200);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    group.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false })));
  } else {
    group.add(makeClouds());
  }
  return group;
}

/** Pre-filtered reflection map from a sky, so glossy paint and wet roads reflect it. */
export function makeEnvMap(renderer, sky) {
  const pm = new THREE.PMREMGenerator(renderer);
  const sc = new THREE.Scene();
  sc.add(sky.children[0].clone()); // gradient dome only: stars and clouds would speckle the paint
  const rt = pm.fromScene(sc, 0, 1, 3000);
  pm.dispose();
  return rt.texture;
}

export function makeClouds(count = 46) {
  const tex = canvasTex(256, 128, (g, w, h) => {
    for (let i = 0; i < 28; i++) {
      const x = w * (0.15 + Math.random() * 0.7), y = h * (0.35 + Math.random() * 0.35), r = 18 + Math.random() * 34;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
  }, false);
  const group = new THREE.Group(), r = rng(31);
  for (let i = 0; i < count; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.75 + r() * 0.25 }));
    const a = r() * Math.PI * 2, d = 700 + r() * 1300;
    s.position.set(Math.cos(a) * d, 260 + r() * 260, Math.sin(a) * d);
    const sc = 260 + r() * 340;
    s.scale.set(sc, sc * 0.45, 1);
    group.add(s);
  }
  return group;
}

/** Ring of low-poly mountains on the horizon; fog turns them into hazy silhouettes. */
export function makeMountains(color, fogColor, radius = 1500, count = 34, seed = 5) {
  const r = rng(seed), spots = [], colors = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + r() * 0.1, d = radius + r() * 400;
    const h = 110 + r() * 230;
    spots.push({ x: Math.cos(a) * d, y: -10, z: Math.sin(a) * d, ry: r() * 6.28, sx: 300 + r() * 320, sy: h, sz: 300 + r() * 320 });
    colors.push(new THREE.Color(color).offsetHSL(0, 0, (r() - 0.5) * 0.08).lerp(new THREE.Color(fogColor), 0.45 + r() * 0.2));
  }
  // Jagged peak: a cone with jittered vertices reads as rock instead of a pyramid.
  const geo = new THREE.ConeGeometry(1, 1, 12, 5).translate(0, 0.5, 0);
  const pos = geo.attributes.position, jr = rng(seed * 3), seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, [(jr() - 0.5) * 0.28, (jr() - 0.5) * 0.12, (jr() - 0.5) * 0.28]);
    const [jx, jy, jz] = seen.get(k), y = pos.getY(i);
    if (y <= 0.001) continue;
    pos.setXYZ(i, pos.getX(i) + jx, y + jy * (1 - y), pos.getZ(i) + jz);
  }
  geo.computeVertexNormals();
  const m = instanced(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, fog: false }), spots, colors);
  m.castShadow = m.receiveShadow = false;
  return m;
}

export function makeLights(scene, th) {
  const hemi = new THREE.HemisphereLight(th.skyBottom, th.ground, th.amb);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(th.sun, th.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 1; sc.far = 500;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const off = new THREE.Vector3(90, 160, 50);
  return {
    sun,
    hemi,
    follow(p) {
      sun.position.copy(p).add(off);
      sun.target.position.copy(p);
    },
  };
}

export function makeLabel(text, color, fixedSize = false) {
  const tex = canvasTex(256, 64, (g, w, h) => {
    g.font = '700 34px Rajdhani, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,.75)';
    g.strokeText(text, w / 2, h / 2);
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2);
  }, false);
  // fixedSize: same size on screen at any distance (car name tags).
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, sizeAttenuation: !fixedSize }));
  if (fixedSize) s.scale.set(0.16, 0.04, 1); else s.scale.set(4, 1, 1);
  return s;
}

export function groundMesh(th, size = 4000) {
  const tex = canvasTex(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#' + new THREE.Color(th.ground).getHexString(), 0.18, 9000, 2);
  });
  tex.repeat.set(size / 12, size / 12);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.05;
  m.receiveShadow = true;
  return m;
}

// ---------- Reusable instanced scenery ----------

export function windowTexture(night) {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = night ? '#0c0d18' : '#7d8794';
    g.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 16) {
      for (let x = 8; x < w; x += 16) {
        const lit = Math.random();
        g.fillStyle = night
          ? (lit > 0.55 ? ['#ffd27a', '#7ff6ff', '#ff7ad9'][Math.floor(Math.random() * 3)] : '#151827')
          : (lit > 0.5 ? '#bcd7ee' : '#4c5a6a');
        g.fillRect(x, y, 9, 10);
      }
    }
  });
}

export function instanced(geo, mat, transforms, colors) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, transforms.length));
  m.count = transforms.length;
  const o = new THREE.Object3D();
  transforms.forEach((t, i) => {
    o.position.set(t.x, t.y, t.z);
    o.rotation.set(0, t.ry ?? 0, 0);
    o.scale.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
    if (colors) m.setColorAt(i, colors[i]);
  });
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function addTrees(group, spots) {
  const trunk = new THREE.CylinderGeometry(0.35, 0.5, 3, 6).translate(0, 1.5, 0);
  const leaves = new THREE.ConeGeometry(2.4, 7, 7).translate(0, 6, 0);
  const colors = spots.map(() => new THREE.Color().setHSL(0.27 + Math.random() * 0.08, 0.5, 0.22 + Math.random() * 0.1));
  group.add(instanced(trunk, new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 1 }), spots));
  group.add(instanced(leaves, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), spots, colors));
}

export function addBuildings(group, spots, night) {
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const tex = windowTexture(night);
  const mat = new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.7, metalness: 0.2,
    emissive: night ? 0xffffff : 0x000000, emissiveMap: night ? tex : null, emissiveIntensity: night ? 0.9 : 0,
  });
  const colors = spots.map(() => new THREE.Color().setHSL(night ? 0.65 : 0.6, 0.08, night ? 0.5 : 0.75 + Math.random() * 0.25));
  group.add(instanced(geo, mat, spots, colors));
}

export function addRocks(group, spots, color) {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  group.add(instanced(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }), spots));
}

export function addCacti(group, spots) {
  const geo = new THREE.CylinderGeometry(0.45, 0.5, 5, 7).translate(0, 2.5, 0);
  const arm = new THREE.CylinderGeometry(0.3, 0.3, 2, 6).translate(1, 3.2, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4f7d3a, roughness: 0.9 });
  group.add(instanced(geo, mat, spots));
  group.add(instanced(arm, mat, spots));
}

// Scatter scenery around a closed circuit, keeping it off the tarmac.
export function buildCircuitScenery(track, th) {
  const g = new THREE.Group();
  const r = rng(track.N * 13);
  const clear = track.width / 2 + 14;
  const pick = (count, minR, maxR, extraClear = 0) => {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 20; tries++) {
      const x = (r() - 0.5) * 2 * maxR, z = (r() - 0.5) * 2 * maxR;
      if (Math.hypot(x, z) < minR) continue;
      if (track.distApprox(x, z) < clear + extraClear) continue;
      out.push({ x, y: 0, z, ry: r() * Math.PI * 2 });
    }
    return out;
  };

  if (th.scenery === 'forest') {
    const dry = p => p.z > -235;
    addTrees(g, pick(1000, 0, 650).filter(dry).map(p => ({ ...p, s: 0.8 + r() * 0.8 })));
    addBuildings(g, pick(60, 380, 700, 30).filter(p => p.z > -200).map(p => ({ ...p, sx: 18 + r() * 20, sy: 14 + r() * 40, sz: 18 + r() * 20 })), false);
    // Bay water on one side of the circuit.
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 1200), new THREE.MeshStandardMaterial({ color: 0x1f6fa8, roughness: 0.15, metalness: 0.4 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 0.02, -850);
    g.add(sea);
  } else if (th.scenery === 'snow') {
    addTrees(g, pick(1100, 0, 650).map(p => ({ ...p, s: 0.8 + r() * 1.1 })));
    addRocks(g, pick(160, 0, 700, 4).map(p => ({ ...p, sx: 2 + r() * 6, sy: 1.5 + r() * 4, sz: 2 + r() * 6 })), 0x8d96a3);
  } else if (th.scenery === 'desert') {
    addCacti(g, pick(260, 0, 600).map(p => ({ ...p, s: 0.7 + r() * 0.6 })));
    addRocks(g, pick(200, 0, 700, 4).map(p => ({ ...p, sx: 3 + r() * 8, sy: 2 + r() * 7, sz: 3 + r() * 8 })), 0xa0522d);
    addRocks(g, pick(40, 420, 900, 40).map(p => ({ ...p, sx: 40 + r() * 60, sy: 30 + r() * 70, sz: 40 + r() * 60 })), 0x8b3f22);
  } else {
    addBuildings(g, pick(320, 0, 650, 6).map(p => ({ ...p, ry: Math.round(p.ry / (Math.PI / 2)) * Math.PI / 2, sx: 14 + r() * 24, sy: 18 + r() * 90, sz: 14 + r() * 24 })), true);
  }

  // Street lamps along the circuit.
  const lamps = [];
  for (let i = 0; i < track.N; i += Math.round(36 / track.seg)) {
    for (const s of [-1, 1]) {
      const o = s * (track.width / 2 + 5);
      lamps.push({ x: track.px[i] - track.tz[i] * o, y: 0, z: track.pz[i] + track.tx[i] * o });
    }
  }
  g.add(instanced(new THREE.CylinderGeometry(0.15, 0.2, 8, 6).translate(0, 4, 0), new THREE.MeshStandardMaterial({ color: 0x555a66, metalness: 0.6, roughness: 0.4 }), lamps));
  const head = instanced(new THREE.SphereGeometry(0.5, 8, 6).translate(0, 8.2, 0),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: th.night ? 0xffe2a8 : 0x666666, emissiveIntensity: th.night ? 3 : 0.4 }), lamps);
  head.castShadow = false;
  g.add(head);

  g.add(makeMountains(th.night ? 0x1d1830 : th.scenery === 'desert' ? 0xa0522d : th.scenery === 'snow' ? 0xf2f6fb : 0x4b6b4a, th.fog));
  g.add(grandstands(track, th));
  g.add(billboards(track, th));
  return g;
}

const SPONSORS = [['VELOCITY', '#ff2e63'], ['NITRO X', '#08d9d6'], ['APEX OIL', '#ffb703'], ['TURBOWAVE', '#7b5cff'], ['GRIP+', '#3ddc84'], ['HYPERFUEL', '#ff7a00']];

function billboards(track, th) {
  const g = new THREE.Group();
  const post = new THREE.MeshStandardMaterial({ color: 0x30333d, metalness: 0.6, roughness: 0.4 });
  const mats = SPONSORS.map(([text, col]) => {
    const tex = canvasTex(512, 160, (c, w, h) => {
      c.fillStyle = '#0d0f1a'; c.fillRect(0, 0, w, h);
      c.fillStyle = col; c.fillRect(0, h - 18, w, 18); c.fillRect(0, 0, 22, h);
      c.fillStyle = '#fff'; c.font = 'italic 900 78px Orbitron, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, w / 2 + 10, h / 2 - 6);
    }, false);
    return new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: th.night ? 1.4 : 0.25, side: THREE.DoubleSide });
  });
  const step = Math.round(140 / track.seg);
  let k = 0;
  for (let i = Math.round(60 / track.seg); i < track.N - 20; i += step, k++) {
    const side = k % 2 ? 1 : -1, o = side * (track.width / 2 + 7);
    const b = new THREE.Group();
    b.position.set(track.px[i] - track.tz[i] * o, 0, track.pz[i] + track.tx[i] * o);
    // Face the oncoming cars (sign looks back down the track).
    b.rotation.y = Math.atan2(-track.tx[i], -track.tz[i]) + side * 0.5;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.75), mats[k % mats.length]);
    board.position.y = 4.5;
    board.castShadow = true;
    b.add(board);
    for (const x of [-4.5, 4.5]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.5, 0.3), post);
      p.position.set(x, 2.25, -0.2);
      b.add(p);
    }
    g.add(b);
  }
  return g;
}

function grandstands(track, th) {
  const g = new THREE.Group();
  const crowd = canvasTex(256, 64, (c, w, h) => {
    c.fillStyle = '#2a2d38'; c.fillRect(0, 0, w, h);
    const cols = ['#ff2e63', '#08d9d6', '#ffd166', '#ffffff', '#3a86ff', '#ff7a00', '#7b5cff', '#f1c0a0'];
    for (let y = 4; y < h; y += 8) for (let x = 2; x < w; x += 5) {
      if (Math.random() < 0.15) continue;
      c.fillStyle = cols[Math.floor(Math.random() * cols.length)];
      c.fillRect(x + Math.random() * 2, y, 3, 5);
    }
  });
  crowd.repeat.set(6, 1);
  const seatMat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9, emissive: th.night ? 0xffffff : 0, emissiveMap: th.night ? crowd : null, emissiveIntensity: 0.25 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x3a3f4d, metalness: 0.5, roughness: 0.5 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xe8ecf3, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const i = track.wrap(side < 0 ? -18 : 10);
    const o = side * (track.width / 2 + 12);
    const stand = new THREE.Group();
    stand.position.set(track.px[i] - track.tz[i] * o, 0, track.pz[i] + track.tx[i] * o);
    stand.rotation.y = Math.atan2(track.tx[i], track.tz[i]);
    const len = 70;
    for (let t = 0; t < 5; t++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, len), t === 4 ? frame : seatMat);
      tier.position.set(-side * (t * 2.6), 0, 0);
      tier.scale.y = 1 + t;
      tier.position.y = (1.6 * (1 + t)) / 2;
      tier.castShadow = tier.receiveShadow = true;
      stand.add(tier);
    }
    const r = new THREE.Mesh(new THREE.BoxGeometry(14, 0.3, len + 4), roof);
    r.position.set(-side * 5, 11, 0);
    r.rotation.z = side * 0.12;
    r.castShadow = true;
    stand.add(r);
    for (const z of [-len / 2, 0, len / 2]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, 11, 0.5), frame);
      col.position.set(-side * 11, 5.5, z);
      stand.add(col);
    }
    g.add(stand);
  }
  return g;
}
