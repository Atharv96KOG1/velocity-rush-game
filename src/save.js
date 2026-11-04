const KEY = 'velocity-rush-save-v1';

const DEFAULT = {
  credits: 800,
  story: 0,                 // index of the next unlocked story chapter
  owned: ['striker'],
  car: 'striker',
  powers: ['turbo'],        // unlocked super powers
  power: 'turbo',           // equipped super power
  challenges: {},           // id -> { done, best }
  world: { coins: [], traps: {}, sprints: {} },
};

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}');
    const s = structuredClone(DEFAULT);
    return { ...s, ...data, world: { ...s.world, ...(data.world || {}) } };
  } catch {
    return structuredClone(DEFAULT);
  }
}

export const save = load();

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* storage unavailable */ }
}
