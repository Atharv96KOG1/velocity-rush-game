const keys = new Set();
const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash']);

addEventListener('keydown', e => {
  keys.add(e.code);
  if (BLOCK.has(e.code) && e.target === document.body) e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

export const LAYOUTS = [
  { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], hand: ['Space'], nitro: ['ShiftLeft'], reset: ['KeyR'], cam: ['KeyC'], power: ['KeyE'], rewind: ['KeyQ'], photo: ['KeyP'], jump: ['KeyF'], item: ['KeyX'] },
  { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], hand: ['Slash', 'ControlRight'], nitro: ['ShiftRight'], reset: ['Backspace'], cam: ['Period'], power: ['Enter', 'Numpad0'], rewind: [], photo: [], jump: ['Semicolon', 'Numpad1'], item: ['Quote', 'Numpad2'] },
];

// Single player may use either WASD or the arrow keys.
const SOLO = Object.fromEntries(Object.keys(LAYOUTS[0]).map(k => [k, [...LAYOUTS[0][k], ...LAYOUTS[1][k]]]));

const held = codes => codes.some(c => keys.has(c));

export function readControls(player, solo) {
  const L = solo ? SOLO : LAYOUTS[player];
  const c = {
    throttle: held(L.up) ? 1 : 0,
    brake: held(L.down) ? 1 : 0,
    steer: (held(L.left) ? 1 : 0) - (held(L.right) ? 1 : 0),
    hand: held(L.hand),
    nitro: held(L.nitro),
    reset: held(L.reset),
    cam: held(L.cam),
    power: held(L.power),
    rewind: held(L.rewind),
    jump: held(L.jump),
    item: held(L.item),
  };

  // Gamepad N drives player N (standard mapping: RT gas, LT brake, A handbrake, B jump, X nitro, Y item,
  // LB power, RB camera, Back rewind, Start reset).
  const pads = [...(navigator.getGamepads?.() ?? [])].filter(Boolean);
  const pad = pads[player];
  if (pad) {
    const ax = pad.axes[0] ?? 0;
    if (Math.abs(ax) > 0.15) c.steer = -Math.sign(ax) * (Math.abs(ax) - 0.15) / 0.85;
    const b = i => pad.buttons[i] ?? { value: 0, pressed: false };
    c.throttle = Math.max(c.throttle, b(7).value);
    c.brake = Math.max(c.brake, b(6).value);
    c.hand ||= b(0).pressed;
    c.nitro ||= b(2).pressed;
    c.jump ||= b(1).pressed;
    c.item ||= b(3).pressed;
    c.reset ||= b(9).pressed;
    c.cam ||= b(5).pressed;
    c.power ||= b(4).pressed;
    c.rewind ||= b(8).pressed;
  }
  return c;
}

export const IDLE = { throttle: 0, brake: 0, steer: 0, hand: false, nitro: false, reset: false, cam: false, power: false, jump: false, item: false };
