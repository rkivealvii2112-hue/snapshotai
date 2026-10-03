/**
 * Onboard demo mode — deterministic fake detections + templated explanations
 * so the full UI pipeline runs with zero API keys (great for judges/screenshots).
 * Clearly labelled as DEMO MODE in the terminal.
 */

const FORCED_BY_FILENAME = {
  hurricane: ['storm system', 'clouds', 'ocean'],
  wildfire: ['wildfire', 'smoke plume', 'forest'],
};

/** Tiny deterministic PRNG (mulberry32) seeded from a string. */
function seededRandom(seedStr) {
  let h = 1779033703;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoDetections(width, height, labels, seed = 'spacesnap') {
  const lowerSeed = seed.toLowerCase();
  const forced = Object.keys(FORCED_BY_FILENAME).find((k) => lowerSeed.includes(k));
  const rand = seededRandom(seed);

  let pool;
  if (forced) {
    pool = FORCED_BY_FILENAME[forced];
  } else {
    const shuffled = [...labels].sort(() => rand() - 0.5);
    pool = shuffled.slice(0, 3 + Math.floor(rand() * 2)); // 3–4 features
  }

  const boxes = [];
  return pool.map((label, i) => {
    // random well-placed box, 28–58% of the frame, avoiding heavy overlap
    let box = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const bw = width * (0.28 + rand() * 0.3);
      const bh = height * (0.28 + rand() * 0.3);
      const xmin = rand() * (width - bw);
      const ymin = rand() * (height - bh);
      const candidate = { xmin, ymin, xmax: xmin + bw, ymax: ymin + bh };
      const overlaps = boxes.some((b) => iou(candidate, b) > 0.3);
      if (!overlaps) {
        box = candidate;
        break;
      }
      box = candidate; // accept last attempt even if overlapping
    }
    boxes.push(box);
    const score = Math.min(0.97, 0.93 - i * 0.11 - rand() * 0.04);
    return { label, score: Number(score.toFixed(3)), box: roundBox(box, width, height) };
  });
}

const EXPLANATIONS = {
  'storm system':
    'A massive rotating storm system churns over the open ocean, its spiral cloud bands wrapping tightly around a well-defined eye as it gathers strength.',
  wildfire:
    'An active wildfire is burning through the forest below, sending a long smoke plume drifting downwind that can affect air quality for miles.',
  'smoke plume':
    'A thick smoke plume rises from the terrain and streams downwind, signalling an active burn spreading through dry vegetation.',
  clouds:
    'Broad fields of clouds are drifting across the surface, forming the kind of organised bands usually tied to an approaching weather front.',
  ocean:
    'Deep-blue ocean dominates the scene, with swirling surface patterns revealing currents and cloud shadows moving across the water.',
  forest:
    'A dense expanse of forest stretches to the horizon, its texture revealing a healthy canopy broken only by natural clearings.',
  'ice sheet':
    'Bright reflective ice covers the landscape, its jagged fractures and melt patterns hinting at seasonal thaw dynamics.',
};

export function demoExplanation(detections) {
  for (const d of detections) {
    if (EXPLANATIONS[d.label]) return EXPLANATIONS[d.label];
  }
  return 'The satellite view reveals large-scale atmospheric and surface patterns interacting across the scene, a textbook example of Earth system dynamics at work.';
}

function iou(a, b) {
  const x1 = Math.max(a.xmin, b.xmin);
  const y1 = Math.max(a.ymin, b.ymin);
  const x2 = Math.min(a.xmax, b.xmax);
  const y2 = Math.min(a.ymax, b.ymax);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a.xmax - a.xmin) * (a.ymax - a.ymin);
  const areaB = (b.xmax - b.xmin) * (b.ymax - b.ymin);
  return inter / Math.max(1, areaA + areaB - inter);
}

const roundBox = (box, width, height) => ({
  xmin: Math.max(0, Math.round(box.xmin)),
  ymin: Math.max(0, Math.round(box.ymin)),
  xmax: Math.min(width, Math.round(box.xmax)),
  ymax: Math.min(height, Math.round(box.ymax)),
});
