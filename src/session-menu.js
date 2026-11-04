import * as THREE from 'three';
import { buildCarMesh } from './car.js';
import { carById } from './data.js';

/** Showroom turntable rendered behind the menus. */
export class MenuSession {
  constructor() {
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07080f);
    scene.fog = new THREE.Fog(0x07080f, 18, 50);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.views = [{ camera: this.camera, rect: [0, 0, 1, 1] }];
    this.pausable = false;
    this.bloomStrength = 0.6;

    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x10131f, metalness: 0.5, roughness: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.16, 64), new THREE.MeshStandardMaterial({ color: 0x1c2135, metalness: 0.7, roughness: 0.3 }));
    disc.position.y = 0.08;
    disc.receiveShadow = true;
    scene.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.35, 0.05, 8, 96), new THREE.MeshBasicMaterial({ color: 0xff2e63 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.17;
    scene.add(ring);

    scene.add(new THREE.HemisphereLight(0x8090ff, 0x101018, 0.7));
    const key = new THREE.SpotLight(0xffffff, 900, 40, 0.5, 0.6, 1.5);
    key.position.set(4, 12, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const pink = new THREE.PointLight(0xff2e63, 60, 20);
    pink.position.set(-5, 2.5, -4);
    const cyan = new THREE.PointLight(0x08d9d6, 60, 20);
    cyan.position.set(5, 2.5, -3);
    scene.add(pink, cyan);

    this.turn = new THREE.Group();
    this.turn.position.y = 0.16;
    scene.add(this.turn);
    this.t = 0;
    this.current = null;
  }

  showCar(id) {
    if (this.current === id) return;
    this.current = id;
    this.turn.clear();
    this.turn.add(buildCarMesh(carById(id).color).group);
  }

  update() {}

  frame(dt) {
    this.t += dt;
    this.turn.rotation.y += dt * 0.4;
    // Frame the car on the right so the menu column on the left stays readable.
    const wide = innerWidth > 760;
    this.camera.position.set(Math.sin(this.t * 0.15) * 0.8 + 6.5, 2.6, 8.5);
    this.camera.lookAt(wide ? -2.4 : 0, 0.7, 0);
  }

  dispose() {}
}
