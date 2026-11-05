import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SpeedShader, SanitizeShader } from './post.js';
import { MenuSession } from './session-menu.js';
import { music } from './music.js';
import { save, persist } from './save.js';

// Physics runs on a fixed step so car handling is identical at any frame rate.
const STEP = 1 / 120;
const MAX_STEPS = 12;

export class Game {
  constructor(container) {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);

    // Bloom makes lights, neon and power effects glow. Single-view only (split-screen renders direct).
    const pr = r.getPixelRatio();
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples: 4 }));
    this.renderPass = new RenderPass(null, null);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.9);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.composer.addPass(this.bloom);
    this.post = new ShaderPass(SpeedShader);
    this.composer.addPass(this.post);
    this.composer.addPass(new OutputPass());
    this.bloomOn = true;
    addEventListener('resize', () => {
      r.setSize(innerWidth, innerHeight);
      this.composer.setSize(innerWidth, innerHeight);
    });

    this.menu = new MenuSession(r);
    this.session = this.menu;
    this.paused = false;
    this.acc = 0;
    this.last = performance.now();

    music.muted = save.music === false;
    addEventListener('keydown', e => {
      if (e.code === 'KeyM' && !e.repeat && e.target === document.body) {
        save.music = music.muted;
        persist();
        music.setMuted(!music.muted);
        this.ui?.flashNote(music.muted ? '🔇 Music off (M)' : '🎵 Music on (M)');
      }
      if (e.code === 'KeyP' && !e.repeat && this.session.pausable && !this.session.over && !this.session.cfg?.net && !this.ui.pauseOpen) this.ui.photo();
      if (e.code === 'Escape' && this.session.pausable && !this.session.over) this.ui.togglePause();
    });
    r.setAnimationLoop(() => this.frame());
  }

  setSession(s) {
    if (this.session !== this.menu) this.session.dispose();
    this.session = s;
    this.paused = false;
    this.acc = 0;
  }

  backToMenu() { this.setSession(this.menu); }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const s = this.session;
    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < MAX_STEPS) { s.update(STEP); this.acc -= STEP; n++; }
      if (n === MAX_STEPS) this.acc = 0;
      s.frame(dt);
    }
    if (music.on) music.set(s === this.menu || this.paused || s.over ? 0.3 : 1, s.post?.speed ?? 0);
    this.render(s);
  }

  render(s) {
    const r = this.renderer;
    const w = r.domElement.clientWidth, h = r.domElement.clientHeight;
    if (this.bloomOn && s.views.length === 1) {
      const cam = s.views[0].camera;
      if (Math.abs(cam.aspect - w / h) > 1e-3) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
      r.setScissorTest(false);
      r.setViewport(0, 0, w, h);
      this.renderPass.scene = s.scene;
      this.renderPass.camera = cam;
      this.bloom.strength = s.bloomStrength ?? 0.55;
      const u = this.post.uniforms, p = s.post ?? {};
      u.speed.value += ((p.speed ?? 0) - u.speed.value) * 0.15;
      u.look.value = p.look ?? 0;
      u.rewind.value = p.rewind ? 1 : 0;
      u.vignette.value = p.vignette ?? 0.35;
      u.time.value = performance.now() / 1000;
      this.composer.render();
      return;
    }
    r.setScissorTest(true);
    for (const v of s.views) {
      const x = v.rect[0] * w, y = v.rect[1] * h, vw = v.rect[2] * w, vh = v.rect[3] * h;
      r.setViewport(x, y, vw, vh);
      r.setScissor(x, y, vw, vh);
      const aspect = vw / vh;
      if (Math.abs(v.camera.aspect - aspect) > 1e-3) {
        v.camera.aspect = aspect;
        v.camera.updateProjectionMatrix();
      }
      r.render(s.scene, v.camera);
    }
  }
}
