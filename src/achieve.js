import { ACHIEVEMENTS } from './data.js';
import { save, persist } from './save.js';
import { beep } from './audio.js';

export function toast(title, text) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  const b = document.createElement('b');
  b.textContent = title;
  t.append(b, text);
  box.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

/** Unlocks an achievement once, pays its reward and shows a toast. */
export function unlock(id) {
  const a = ACHIEVEMENTS.find(x => x.id === id);
  if (!a || save.ach[id]) return;
  save.ach[id] = true;
  save.credits += a.reward;
  persist();
  toast('ACHIEVEMENT UNLOCKED', `${a.icon} ${a.name} · +${a.reward.toLocaleString()} CR`);
  beep(1046, 0.12, 'triangle', 0.2);
  setTimeout(() => beep(1568, 0.25, 'triangle', 0.2), 120);
}

/** Bumps a lifetime counter and unlocks the matching achievement at its threshold. */
export function count(stat, id, target) {
  save.stats[stat] = (save.stats[stat] ?? 0) + 1;
  persist();
  if (save.stats[stat] >= target) unlock(id);
}
