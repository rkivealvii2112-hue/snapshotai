/**
 * Global mission config — candidate labels, neon palette, misc constants.
 */

/** Zero-shot candidate labels sent to OWL-ViT (editable in the UI). */
export const DEFAULT_LABELS = [
  'clouds',
  'storm system',
  'ocean',
  'forest',
  'wildfire',
  'smoke plume',
  'ice sheet',
];

/** Vibrant HUD palette cycled for bounding boxes. */
export const PALETTE = [
  '#39ff14', // neon green
  '#00e5ff', // cyan
  '#ff2d95', // hot pink
  '#b537ff', // purple
  '#ffc233', // amber
  '#2dffc4', // teal
  '#ff6b6b', // coral
  '#8ab4ff', // periwinkle
];

/** Deterministic color per label (stable across re-renders). */
export function colorFor(label = '', salt = 0) {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return PALETTE[(h + salt) % PALETTE.length];
}

/** Max dimension (px) the uploaded image is downscaled to before display + API calls. */
export const MAX_IMAGE_DIM = 1024;

/** Bundled demo imagery (public/samples) — works with zero API keys. */
export const SAMPLES = [
  { name: 'HURRICANE.JPG', url: '/samples/hurricane.jpg' },
  { name: 'WILDFIRE.JPG', url: '/samples/wildfire.jpg' },
];
