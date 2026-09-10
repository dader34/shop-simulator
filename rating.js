// Elo-style skill rating. Each difficulty level has a fixed "opponent" rating;
// beating a level above your rating gains more than beating one below it.
const START = 1200;
const LEVEL_RATING = { 1: 1000, 2: 1150, 3: 1300, 4: 1450, 5: 1600 };
const K = 40;

export const TITLES = [
  [0,    'Apprentice'],
  [1100, 'B Technician'],
  [1250, 'A Technician'],
  [1400, 'Master Technician'],
  [1550, 'Shop Foreman'],
  [1700, 'Diagnostic Specialist'],
];

export function titleFor(rating) {
  let t = TITLES[0][1];
  for (const [min, name] of TITLES) if (rating >= min) t = name;
  return t;
}

export function load() {
  try {
    const raw = localStorage.getItem('sts_profile');
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt profile — start fresh */ }
  return { rating: START, jobs: [], recentCauses: [] };
}

export function save(p) {
  localStorage.setItem('sts_profile', JSON.stringify(p));
}

/**
 * Score 0..1 for one job: correctness dominates, with completeness and
 * efficiency as modifiers. A comeback caps the score hard.
 */
export function scoreJob({ verdict, minutesUsed, parMinutes }) {
  if (!verdict.correct) return verdict.root_cause_found ? 0.25 : 0;
  let s = 0.75 + 0.2 * (verdict.completeness / 100);
  const eff = parMinutes / Math.max(minutesUsed, 1);
  s += Math.max(-0.1, Math.min(0.05, (eff - 1) * 0.1));
  if (verdict.comeback.happens) s = Math.min(s, 0.35);
  return Math.max(0, Math.min(1, s));
}

export function applyResult(profile, { difficulty, score, comeback = false }) {
  const opp = LEVEL_RATING[difficulty];
  const expected = 1 / (1 + 10 ** ((opp - profile.rating) / 400));
  const before = profile.rating;
  let delta = K * (score - expected);
  // A comeback is the failure this sim exists to punish. Attempting a level
  // well above your rating shouldn't turn one into a net gain.
  if (comeback) delta = Math.min(delta, -5);
  profile.rating = Math.round(profile.rating + delta);
  return { before, after: profile.rating, delta: profile.rating - before };
}

export function recommendedLevel(rating) {
  let best = 1;
  for (const [lvl, r] of Object.entries(LEVEL_RATING)) {
    if (rating >= r - 60) best = Number(lvl);
  }
  return best;
}
