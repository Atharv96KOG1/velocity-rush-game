import * as THREE from 'three';

const LOOKS = ['Natural', 'Noir', 'Vivid', 'Retro'];

/** Freezes the race and gives an orbit camera around the player's car, filters and PNG export. */
export class PhotoMode {
  constructor(game, onExit) {
    this.game = game;
    this.s = game.session;
    this.onExit = onExit;
    this.car = this.s.humans[0];
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.3, 5000);
    this.target = this.car.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0));
    this.dist = 7.5;
    this.theta = this.car.yaw + Math.PI + 0.7;
    this.phi = 1.25;
    this.look = 0;
    this.savedViews = this.s.views;
    this.savedPost = this.s.post;
    this.wasPaused = game.paused;
    game.paused = true;
    this.s.views = [{ camera: this.camera, rect: [0, 0, 1, 1] }];
    document.getElementById('hud').style.visibility = 'hidden';
    this.place();

    const el = game.renderer.domElement;
    let drag = null;
    this.handlers = {
      down: e => { drag = { x: e.clientX, y: e.clientY }; },
      move: e => {
        if (!drag) return;
        this.theta -= (e.clientX - drag.x) * 0.006;
        this.phi = Math.min(1.52, Math.max(0.2, this.phi - (e.clientY - drag.y) * 0.005));
        drag = { x: e.clientX, y: e.clientY };
        this.place();
      },
      up: () => { drag = null; },
      wheel: e => { this.dist = Math.min(30, Math.max(3, this.dist * (e.deltaY > 0 ? 1.1 : 0.9))); this.place(); e.preventDefault(); },
    };
    el.addEventListener('pointerdown', this.handlers.down);
    addEventListener('pointermove', this.handlers.move);
    addEventListener('pointerup', this.handlers.up);
    el.addEventListener('wheel', this.handlers.wheel, { passive: false });
  }

  get looks() { return LOOKS; }

  setLook(i) { this.look = i; this.place(); }

  place() {
    const t = this.target, sp = Math.sin(this.phi);
    this.camera.position.set(t.x + Math.sin(this.theta) * sp * this.dist, t.y + Math.cos(this.phi) * this.dist, t.z + Math.cos(this.theta) * sp * this.dist);
    this.camera.lookAt(t);
    this.s.post = { speed: 0, look: this.look, vignette: 0.45 };
  }

  save() {
    this.game.render(this.s);
    const a = document.createElement('a');
    a.href = this.game.renderer.domElement.toDataURL('image/png');
    a.download = `velocity-rush-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
  }

  exit() {
    const el = this.game.renderer.domElement;
    el.removeEventListener('pointerdown', this.handlers.down);
    removeEventListener('pointermove', this.handlers.move);
    removeEventListener('pointerup', this.handlers.up);
    el.removeEventListener('wheel', this.handlers.wheel);
    this.s.views = this.savedViews;
    this.s.post = this.savedPost;
    document.getElementById('hud').style.visibility = '';
    this.game.paused = this.wasPaused;
    this.onExit?.();
  }
}
