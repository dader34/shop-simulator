// Elo-style skill rating, rebased so a new tech starts at 0. Each difficulty
// has a fixed "opponent" rating; beating a level above your own gains more than
// beating one below it. The 400-point Elo spacing is preserved — only the
// origin is shifted — so the math behaves exactly like standard Elo.
const START = 0;
const LEVEL_RATING = { 1: -200, 2: -50, 3: 100, 4: 250, 5: 400 };
const K = 40;

// Real shop hierarchy: C is entry level, A is senior, then Master above that.
export const TITLES = [
  [-Infinity, 'C Technician'],
  [75,        'B Technician'],
  [175,       'A Technician'],
  [300,       'Master Technician'],
  [425,       'Shop Foreman'],
  [550,       'Diagnostic Specialist'],
];

export function titleFor(rating) {
  let t = TITLES[0][1];
  for (const [min, name] of TITLES) if (rating >= min) t = name;
  return t;
}

export function load() {
  try {
    const raw = localStorage.getItem('sts_profile');
    if (raw) {
      const p = JSON.parse(raw);
      // Migrate profiles saved on the old 1200-based scale.
      if (p && typeof p.rating === 'number' && p.rating > 600) p.rating -= 1200;
      return p;
    }
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
