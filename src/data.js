// Car stats: maxSpeed in m/s, accel in m/s², handling = yaw rate, grip = lateral damping.
export const CARS = [
  { id: 'striker', name: 'Striker GT', color: 0xe63946, maxSpeed: 60, accel: 24, handling: 2.4, grip: 6.5, price: 0, desc: 'Balanced street racer. Forgiving and quick.' },
  { id: 'kaze', name: 'Kaze Drift', color: 0xf4a261, maxSpeed: 61, accel: 25, handling: 3.0, grip: 4.6, price: 2500, desc: 'Loose rear end, built to go sideways. Charges nitro fast.' },
  { id: 'viper', name: 'Viper X', color: 0x2ec4b6, maxSpeed: 64, accel: 28, handling: 2.7, grip: 7.6, price: 4000, desc: 'Razor handling and brutal launch.' },
  { id: 'phantom', name: 'Phantom R', color: 0x7b5cff, maxSpeed: 72, accel: 25, handling: 2.3, grip: 6.2, price: 7000, desc: 'Top-speed monster for long straights.' },
];

export const carById = id => CARS.find(c => c.id === id) ?? CARS[0];

export const THEMES = {
  day: { skyTop: 0x2f7fd8, skyBottom: 0xd6ecff, fog: 0xd6ecff, ground: 0x4f8a3c, groundAlt: 0x3f7a30, sun: 0xffffff, sunI: 2.6, amb: 1.1, night: false, scenery: 'forest' },
  desert: { skyTop: 0xd0703c, skyBottom: 0xffe3b8, fog: 0xf3d2a4, ground: 0xc58a4f, groundAlt: 0xb37742, sun: 0xfff0d6, sunI: 2.8, amb: 1.0, night: false, scenery: 'desert' },
  night: { skyTop: 0x03040c, skyBottom: 0x2a1650, fog: 0x160c2e, ground: 0x1b1b26, groundAlt: 0x15151e, sun: 0x9aa6ff, sunI: 0.7, amb: 0.75, night: true, scenery: 'city' },
};

// Track control points (x, z in metres). Splines are closed and smoothed with centripetal Catmull-Rom.
export const TRACKS = {
  harbor: {
    name: 'Harbor Loop', theme: 'day', width: 18,
    desc: 'Fast sweepers along the bay. Great for beginners.',
    points: [[0, -150], [150, -170], [260, -90], [270, 40], [180, 110], [200, 220], [90, 290], [-60, 250], [-120, 140], [-230, 100], [-260, -40], [-160, -130]],
  },
  canyon: {
    name: 'Red Canyon', theme: 'desert', width: 16,
    desc: 'Twisty desert pass with tight hairpins.',
    points: [[0, -200], [120, -210], [200, -140], [160, -60], [240, 0], [300, 100], [220, 190], [100, 160], [40, 240], [-80, 260], [-180, 180], [-140, 80], [-240, 20], [-260, -110], [-140, -170]],
  },
  neon: {
    name: 'Neon City', theme: 'night', width: 17,
    desc: 'Midnight street circuit with a brutal chicane.',
    points: [[-200, -200], [0, -220], [200, -200], [220, -50], [100, 0], [220, 60], [220, 200], [0, 220], [-100, 120], [-220, 200], [-240, 0]],
  },
};

export const AI_NAMES = ['Dex', 'Nova', 'Rook', 'Kira', 'Blaze', 'Juno', 'Axel', 'Mika', 'Sable', 'Orion', 'Zed', 'Lumi'];

export const DIFFICULTY = { easy: 0.8, normal: 0.95, hard: 1.06 };

// Goal types: position (finish at or above), teamWin, drift (score), time (avg speed in m/s), survive (win knockout).
export const STORY = [
  { id: 's1', title: 'Rookie Night', speaker: 'Mara · Crew Chief', text: "Welcome to the Velocity scene. Local hotshot Dex says you can't drive. Beat him one-on-one and the crew is yours.", track: 'harbor', type: 'race', format: '1v1', laps: 2, difficulty: 0.78, rival: 'Dex', goal: { type: 'position', value: 1 }, reward: 800 },
  { id: 's2', title: 'Sideways', speaker: 'Mara', text: 'Sponsors pay for style. Hold SPACE through corners to drift and fill your nitro. Score 2,500 drift points in one lap.', track: 'harbor', type: 'drift', laps: 1, goal: { type: 'drift', value: 2500 }, reward: 900 },
  { id: 's3', weather: 'sunset', title: 'Crew Up', speaker: 'Mara', text: "The Dust Vipers run Red Canyon in pairs. You and Kira against two of theirs. Team points decide it — protect your partner's position.", track: 'canyon', type: 'race', format: '2v2', laps: 2, difficulty: 0.88, goal: { type: 'teamWin' }, reward: 1200 },
  { id: 's4', title: 'Against the Clock', speaker: 'Kira · Teammate', text: 'Canyon record attempt. No traffic, no excuses. Average better than 115 km/h over one lap.', track: 'canyon', type: 'timeTrial', laps: 1, goal: { type: 'time', avg: 32 }, reward: 1200 },
  { id: 's5', weather: 'rain', title: 'Neon Wars', speaker: 'Mara', text: 'Three-on-three in the city. The Neon Syndicate runs it, and they hate visitors.', track: 'neon', type: 'race', format: '3v3', laps: 2, difficulty: 0.95, goal: { type: 'teamWin' }, reward: 1600 },
  { id: 's6', title: 'Last One Standing', speaker: 'Kira', text: 'Knockout rules: last place after every lap is out. Survive to the end.', track: 'neon', type: 'knockout', format: 'ffa', laps: 6, difficulty: 0.95, goal: { type: 'survive' }, reward: 1800 },
  { id: 's7', weather: 'fog', title: 'Vex', speaker: 'Vex · Syndicate Boss', text: "So you're the one making noise. Three laps in my canyon. Lose, and you never race here again.", track: 'canyon', type: 'race', format: '1v1', laps: 3, difficulty: 1.06, rival: 'Vex', goal: { type: 'position', value: 1 }, reward: 2500 },
  { id: 's8', title: 'Grand Prix Final', speaker: 'Mara', text: 'Six of the best drivers in the city. Win this and Velocity is yours.', track: 'harbor', type: 'race', format: 'ffa', laps: 3, difficulty: 1.04, goal: { type: 'position', value: 1 }, reward: 4000 },
];

export const CHALLENGES = [
  { id: 'c1', title: 'Harbor Hot Lap', desc: 'Average 140 km/h over one lap.', track: 'harbor', type: 'timeTrial', laps: 1, goal: { type: 'time', avg: 39 }, reward: 600 },
  { id: 'c2', title: 'Canyon Drift King', desc: 'Score 6,000 drift points in two laps.', track: 'canyon', type: 'drift', laps: 2, goal: { type: 'drift', value: 6000 }, reward: 800 },
  { id: 'c3', title: 'Neon Knockout', desc: 'Survive a hard 6-car knockout.', track: 'neon', type: 'knockout', format: 'ffa', laps: 6, difficulty: 1.04, goal: { type: 'survive' }, reward: 1200 },
  { id: 'c4', weather: 'rain', title: 'Underdog', desc: 'Win a 3v3 on hard difficulty.', track: 'canyon', type: 'race', format: '3v3', laps: 2, difficulty: 1.06, goal: { type: 'teamWin' }, reward: 1200 },
  { id: 'c5', title: 'City Sprint', desc: 'Average 125 km/h through Neon City over two laps.', track: 'neon', type: 'timeTrial', laps: 2, goal: { type: 'time', avg: 34.5 }, reward: 900 },
  { id: 'c6', title: 'Pro Duel', desc: 'Beat a hard rival over 3 laps at the harbor.', track: 'harbor', type: 'race', format: '1v1', laps: 3, difficulty: 1.1, goal: { type: 'position', value: 1 }, reward: 1000 },
];

export const PAYOUT = [600, 400, 260, 160, 100, 60];

// Weather changes visuals and, for rain, tyre grip.
export const WEATHER = {
  clear: { label: 'Clear', icon: '☀️' },
  sunset: { label: 'Sunset', icon: '🌇' },
  fog: { label: 'Fog', icon: '🌫️' },
  rain: { label: 'Rain', icon: '🌧️' },
};

export const PAINTS = [0xe63946, 0xff7a00, 0xffd166, 0x3ddc84, 0x2ec4b6, 0x3a86ff, 0x7b5cff, 0xff2e63, 0xf1f1f1, 0x2b2d36];

export const ACHIEVEMENTS = [
  { id: 'firstWin', icon: '🏆', name: 'First Blood', desc: 'Win any race.', reward: 300 },
  { id: 'story', icon: '👑', name: 'King of Velocity', desc: 'Finish the story campaign.', reward: 3000 },
  { id: 'speed300', icon: '🚀', name: 'Breaking 300', desc: 'Hit 300 km/h.', reward: 500 },
  { id: 'drift10k', icon: '🌀', name: 'Sideways Legend', desc: 'Score 10,000 drift points in one race.', reward: 600 },
  { id: 'combo5', icon: '🔥', name: 'On Fire', desc: 'Reach a x5 style combo.', reward: 500 },
  { id: 'nearMiss25', icon: '😱', name: 'Thread the Needle', desc: 'Land 25 near misses in total.', reward: 500 },
  { id: 'powers25', icon: '⚡', name: 'Power Hungry', desc: 'Use super powers 25 times.', reward: 400 },
  { id: 'koWin', icon: '💀', name: 'Last One Standing', desc: 'Win a knockout race.', reward: 600 },
  { id: 'onlineWin', icon: '🌐', name: 'Global Champion', desc: 'Win an online race.', reward: 800 },
  { id: 'coins45', icon: '🪙', name: 'Treasure Hunter', desc: 'Collect all 45 open-world coins.', reward: 1500 },
  { id: 'rainWin', icon: '🌧️', name: 'Rain Master', desc: 'Win a race in the rain.', reward: 500 },
  { id: 'daily', icon: '📅', name: 'Daily Driver', desc: 'Complete a daily challenge.', reward: 400 },
];

/** Deterministic daily challenge derived from the local date. */
export function dailyChallenge(date = new Date()) {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  let seed = [...key].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);
  const r = () => ((seed = (Math.imul(seed, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
  const pick = a => a[Math.floor(r() * a.length)];
  const track = pick(Object.keys(TRACKS));
  const weather = pick(['clear', 'sunset', 'fog', 'rain']);
  const kind = pick(['race', 'timeTrial', 'drift', 'knockout']);
  const base = { id: 'daily-' + key, day: key, track, weather, reward: 1500, title: `Daily · ${TRACKS[track].name}` };
  switch (kind) {
    case 'race': return { ...base, type: 'race', format: pick(['1v1', '3v3', 'ffa']), laps: 2, difficulty: 1.02, goal: { type: 'position', value: 1 }, desc: 'Win the race.' };
    case 'timeTrial': return { ...base, type: 'timeTrial', laps: 2, goal: { type: 'time', avg: weather === 'rain' ? 33 : 35 }, desc: 'Beat the target time.' };
    case 'drift': return { ...base, type: 'drift', laps: 1, goal: { type: 'drift', value: 4000 }, desc: 'Score 4,000 drift points.' };
    default: return { ...base, type: 'knockout', format: 'ffa', laps: 6, difficulty: 1, goal: { type: 'survive' }, desc: 'Survive the knockout.' };
  }
}

// Performance tuning bought in the garage, per car. Three levels each.
export const UPGRADES = {
  engine: { name: 'Engine', icon: '🔧', desc: '+8 km/h top speed and quicker acceleration per level', prices: [800, 1600, 3200] },
  grip: { name: 'Tyres & Suspension', icon: '🛞', desc: 'More grip and sharper turn-in per level', prices: [700, 1400, 2800] },
  nitro: { name: 'Nitro System', icon: '🔥', desc: 'Nitro charges 30% faster and lasts longer per level', prices: [600, 1200, 2400] },
};

export function tuneSpec(spec, t) {
  if (!t) return spec;
  const e = t.engine ?? 0, g = t.grip ?? 0, n = t.nitro ?? 0;
  return {
    ...spec,
    maxSpeed: spec.maxSpeed + 2.2 * e, accel: spec.accel + 1.6 * e,
    grip: spec.grip + 0.45 * g, handling: spec.handling + 0.07 * g,
    nitroMul: 1 + 0.3 * n,
  };
}
