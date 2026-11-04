import { beep } from './audio.js';

const CHAIN = 3;       // seconds to land the next trick and keep the combo
const MAX_MULT = 5;

/**
 * Rewards stylish driving for each local player: slipstreaming, near misses,
 * overtakes and drift chains. Events landed within CHAIN seconds of each other
 * raise a multiplier. Every event tops up nitro; the total pays out credits.
 */
export class StyleTracker {
  constructor(hud, players, { onEvent = null, overtakes = true } = {}) {
    this.hud = hud;
    this.onEvent = onEvent;
    this.overtakes = overtakes;
    this.st = new Map(players.map(h => [h, {
      mult: 1, chain: 0, total: 0, draftT: 0, drifting: false, driftPeak: 0, pos: h.position, cool: new Map(),
    }]));
  }

  total(h) { return Math.round(this.st.get(h)?.total ?? 0); }

  event(h, label, pts, color = '#ffd166') {
    const s = this.st.get(h);
    s.mult = s.chain > 0 ? Math.min(MAX_MULT, s.mult + 1) : 1;
    s.chain = CHAIN;
    const gained = Math.round(pts * s.mult);
    s.total += gained;
    h.boost = Math.min(1, h.boost + 0.08);
    this.hud.popup(h.player, `${label} +${gained}`, color);
    if (s.mult >= 3) beep(500 + s.mult * 120, 0.08, 'triangle', 0.12);
    this.onEvent?.(h, label, s);
  }

  update(dt, cars, active = true) {
    for (const [h, s] of this.st) {
      s.chain = Math.max(0, s.chain - dt);
      if (s.chain === 0) s.mult = 1;
      if (!active || h.finished || h.eliminated) { h.draft = false; continue; }

      const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw), rx = -fz, rz = fx;
      let draft = false;
      for (const o of cars) {
        if (o === h || o.eliminated || o.left) continue;
        const dx = o.pos.x - h.pos.x, dz = o.pos.z - h.pos.z;
        if (dx * dx + dz * dz > 900) continue;
        const ahead = dx * fx + dz * fz, side = dx * rx + dz * rz;

        // Slipstream: tucked in close behind a car.
        if (ahead > 4 && ahead < 22 && Math.abs(side) < 2.2 && h.fwdSpeed > 25) draft = true;

        // Near miss: alongside at speed without touching.
        const cd = (s.cool.get(o) ?? 0) - dt;
        s.cool.set(o, cd);
        const rel = Math.hypot(o.vx - h.vx, o.vz - h.vz);
        if (cd <= 0 && Math.abs(ahead) < 2.2 && Math.abs(side) > 2.4 && Math.abs(side) < 3.8 && rel > 9 && h.speed > 15) {
          s.cool.set(o, 2.5);
          this.event(h, 'NEAR MISS', 150, '#08d9d6');
        }
      }

      h.draft = draft;
      if (draft) {
        s.draftT += dt;
        s.total += 40 * dt;
        if (s.draftT >= 1 && s.draftT - dt < 1) this.event(h, 'SLIPSTREAM', 100, '#a0c4ff');
      } else s.draftT = 0;

      if (h.drifting) { s.drifting = true; s.driftPeak = Math.max(s.driftPeak, h.driftCombo); }
      else if (s.drifting) {
        s.drifting = false;
        if (s.driftPeak > 300) this.event(h, `DRIFT ${Math.round(s.driftPeak)}`, s.driftPeak * 0.4, '#ffb703');
        s.driftPeak = 0;
      }

      // Only a new best position counts, so swapping places back and forth can't be farmed.
      if (this.overtakes && h.position < s.pos) {
        this.event(h, s.pos - h.position > 1 ? `OVERTAKE x${s.pos - h.position}` : 'OVERTAKE', 120 * (s.pos - h.position), '#3ddc84');
        s.pos = h.position;
      }
      this.hud.setCombo(h.player, s.mult, this.total(h));
    }
  }
}
