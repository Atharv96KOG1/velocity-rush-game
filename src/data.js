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
  { id: 's3', title: 'Crew Up', speaker: 'Mara', text: "The Dust Vipers run Red Canyon in pairs. You and Kira against two of theirs. Team points decide it — protect your partner's position.", track: 'canyon', type: 'race', format: '2v2', laps: 2, difficulty: 0.88, goal: { type: 'teamWin' }, reward: 1200 },
  { id: 's4', title: 'Against the Clock', speaker: 'Kira · Teammate', text: 'Canyon record attempt. No traffic, no excuses. Average better than 115 km/h over one lap.', track: 'canyon', type: 'timeTrial', laps: 1, goal: { type: 'time', avg: 32 }, reward: 1200 },
  { id: 's5', title: 'Neon Wars', speaker: 'Mara', text: 'Three-on-three in the city. The Neon Syndicate runs it, and they hate visitors.', track: 'neon', type: 'race', format: '3v3', laps: 2, difficulty: 0.95, goal: { type: 'teamWin' }, reward: 1600 },
  { id: 's6', title: 'Last One Standing', speaker: 'Kira', text: 'Knockout rules: last place after every lap is out. Survive to the end.', track: 'neon', type: 'knockout', format: 'ffa', laps: 6, difficulty: 0.95, goal: { type: 'survive' }, reward: 1800 },
  { id: 's7', title: 'Vex', speaker: 'Vex · Syndicate Boss', text: "So you're the one making noise. Three laps in my canyon. Lose, and you never race here again.", track: 'canyon', type: 'race', format: '1v1', laps: 3, difficulty: 1.06, rival: 'Vex', goal: { type: 'position', value: 1 }, reward: 2500 },
  { id: 's8', title: 'Grand Prix Final', speaker: 'Mara', text: 'Six of the best drivers in the city. Win this and Velocity is yours.', track: 'harbor', type: 'race', format: 'ffa', laps: 3, difficulty: 1.04, goal: { type: 'position', value: 1 }, reward: 4000 },
];

export const CHALLENGES = [
  { id: 'c1', title: 'Harbor Hot Lap', desc: 'Average 140 km/h over one lap.', track: 'harbor', type: 'timeTrial', laps: 1, goal: { type: 'time', avg: 39 }, reward: 600 },
  { id: 'c2', title: 'Canyon Drift King', desc: 'Score 6,000 drift points in two laps.', track: 'canyon', type: 'drift', laps: 2, goal: { type: 'drift', value: 6000 }, reward: 800 },
  { id: 'c3', title: 'Neon Knockout', desc: 'Survive a hard 6-car knockout.', track: 'neon', type: 'knockout', format: 'ffa', laps: 6, difficulty: 1.04, goal: { type: 'survive' }, reward: 1200 },
  { id: 'c4', title: 'Underdog', desc: 'Win a 3v3 on hard difficulty.', track: 'canyon', type: 'race', format: '3v3', laps: 2, difficulty: 1.06, goal: { type: 'teamWin' }, reward: 1200 },
  { id: 'c5', title: 'City Sprint', desc: 'Average 125 km/h through Neon City over two laps.', track: 'neon', type: 'timeTrial', laps: 2, goal: { type: 'time', avg: 34.5 }, reward: 900 },
  { id: 'c6', title: 'Pro Duel', desc: 'Beat a hard rival over 3 laps at the harbor.', track: 'harbor', type: 'race', format: '1v1', laps: 3, difficulty: 1.1, goal: { type: 'position', value: 1 }, reward: 1000 },
];

export const PAYOUT = [600, 400, 260, 160, 100, 60];
