import { useEffect, useRef } from 'react';

/**
 * Custom starfield rendered on <canvas>.
 * - Idle: slow drift of twinkling neon stars.
 * - Warp (`warp === true`): stars accelerate toward the camera, stretching
 *   into light-streaks; after ~2.3s `onWarped()` fires and the parent swaps
 *   to the dashboard while speed eases back down.
 */
export default function Starfield({ warp = false, onWarped, className = '' }) {
  const canvasRef = useRef(null);
  const sim = useRef({ speed: 1.4, target: 1.4, stars: [], w: 0, h: 0, depth: 1200 });

  // ease toward target speed
  useEffect(() => {
    sim.current.target = warp ? 60 : 1.4;
  }, [warp]);

  // after the warp burn, notify parent → dashboard reveal
  useEffect(() => {
    if (!warp) return undefined;
    const t = setTimeout(() => onWarped?.(), 2300);
    return () => clearTimeout(t);
  }, [warp, onWarped]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const s = sim.current;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.w = canvas.clientWidth;
      s.h = canvas.clientHeight;
      canvas.width = Math.max(1, s.w * dpr);
      canvas.height = Math.max(1, s.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (far = false) => ({
      x: (Math.random() * 2 - 1) * s.w,
      y: (Math.random() * 2 - 1) * s.h,
      z: far ? s.depth : Math.random() * s.depth + 1,
      col: pickColor(),
    });

    resize();
    s.stars = Array.from({ length: 340 }, () => spawn());
    window.addEventListener('resize', resize);

    let raf;
    let last = performance.now();

    const loop = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const accel = s.target > s.speed ? 2.2 : 1.1;
      s.speed += (s.target - s.speed) * Math.min(dt * accel, 1);
      draw(ctx, s, dt, spawn);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className={`block h-full w-full ${className}`} aria-hidden="true" />;
}

const COLORS = [
  [255, 255, 255],
  [255, 255, 255],
  [200, 240, 255],
  [0, 229, 255],
  [181, 55, 255],
  [57, 255, 20],
  [255, 45, 149],
];

function pickColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function draw(ctx, s, dt, spawn) {
  const { w, h, depth } = s;
  const cx = w / 2;
  const cy = h / 2;
  const focal = 130;
  const warpiness = Math.min(1, s.speed / 60);

  // motion-blur trail: translucent fill instead of full clear
  ctx.fillStyle = `rgba(5, 1, 14, ${0.55 - warpiness * 0.4})`;
  ctx.fillRect(0, 0, w, h);

  const travel = s.speed * dt * 34;

  for (const star of s.stars) {
    const prevZ = star.z;
    star.z -= travel;
    if (star.z < 1) {
      Object.assign(star, spawn(true));
      continue;
    }

    const k = focal / star.z;
    const px = cx + star.x * k;
    const py = cy + star.y * k;
    if (px < -40 || px > w + 40 || py < -40 || py > h + 40) {
      Object.assign(star, spawn(true));
      continue;
    }

    const kPrev = focal / Math.min(prevZ + travel * (1 + warpiness * 5), depth);
    const qx = cx + star.x * kPrev;
    const qy = cy + star.y * kPrev;

    const size = Math.max(0.4, (1 - star.z / depth) * 2.6);
    const alpha = Math.min(1, 0.25 + (1 - star.z / depth) * 1.1);
    const [r, g, b] = star.col;

    ctx.beginPath();
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.moveTo(qx, qy);
    ctx.lineTo(px, py);
    ctx.stroke();
  }

  // central glow blooms while warping
  if (warpiness > 0.15) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.45);
    grad.addColorStop(0, `rgba(180, 240, 255, ${0.28 * warpiness})`);
    grad.addColorStop(0.5, `rgba(120, 60, 255, ${0.12 * warpiness})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}
