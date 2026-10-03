import { useEffect, useRef, useState } from 'react';
import { colorFor } from '../config.js';

/**
 * <canvas> HUD overlay.
 *
 * The canvas is sized to the *displayed* image (responsive width, image aspect
 * preserved), so coordinates only need ONE scale factor:
 *
 *     screenCoord = apiCoord * (canvasDisplayWidth / imageNaturalWidth)
 *
 * because the API analysed the same pixels we draw (see lib/image.js).
 * Detections pop in one-by-one with glowing brackets; while `scanning` is
 * true a cyan sweep line rasterises down the frame.
 */
export default function DetectionCanvas({ image, detections, scanning }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [shown, setShown] = useState(0); // staggered reveal count

  // track container width responsively
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // staggered box reveal whenever a new detection set arrives
  useEffect(() => {
    setShown(0);
    if (!detections.length) return undefined;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= detections.length) clearInterval(t);
    }, 170);
    return () => clearInterval(t);
  }, [detections]);

  // redraw (continuously while scanning for the sweep animation)
  useEffect(() => {
    if (!image || width === 0) return undefined;
    let raf;
    const render = () => {
      paint(canvasRef.current, image, detections.slice(0, shown), scanning);
      if (scanning) raf = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(raf);
  }, [image, width, shown, detections, scanning]);

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas ref={canvasRef} className="block w-full" />
      <div className="pointer-events-none absolute left-2 top-2 bg-void/70 px-2 py-0.5 font-term text-base text-cyan-300/80">
        FEED 01 · {image.width}×{image.height}px · {detections.length} TARGET(S)
      </div>
    </div>
  );
}

function paint(canvas, image, visibleDetections, scanning) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const scale = w / image.width; // ← the one scale factor that maps API px → screen px
  const h = image.height * scale;

  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = `${h}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // base image
  ctx.drawImage(image.el, 0, 0, w, h);

  // subtle HUD grid over the feed
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.06)';
  ctx.lineWidth = 1;
  const step = 44;
  for (let x = step; x < w; x += step) line(ctx, x, 0, x, h);
  for (let y = step; y < h; y += step) line(ctx, 0, y, w, y);
  ctx.restore();

  // scanning sweep
  if (scanning) {
    const y = ((performance.now() / 6) % (h + 160)) - 80;
    const grad = ctx.createLinearGradient(0, y - 60, 0, y + 6);
    grad.addColorStop(0, 'rgba(0,229,255,0)');
    grad.addColorStop(1, 'rgba(0,229,255,0.22)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - 60, w, 66);
    ctx.save();
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 16;
    ctx.strokeStyle = 'rgba(0,229,255,0.9)';
    ctx.lineWidth = 2;
    line(ctx, 0, y, w, y);
    ctx.restore();
  }

  visibleDetections.forEach((det, i) => drawDetection(ctx, det, i, scale));
}

function drawDetection(ctx, det, i, scale) {
  const color = colorFor(det.label, i);
  const x = det.box.xmin * scale;
  const y = det.box.ymin * scale;
  const bw = (det.box.xmax - det.box.xmin) * scale;
  const bh = (det.box.ymax - det.box.ymin) * scale;
  const c = Math.min(14, bw / 4, bh / 4); // corner bracket length

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  // faint full rect
  ctx.globalAlpha = 0.35;
  ctx.strokeRect(x, y, bw, bh);
  // bold corner brackets (gamified look)
  ctx.globalAlpha = 1;
  ctx.lineWidth = 3;
  const corners = [
    [x, y, 1, 1],
    [x + bw, y, -1, 1],
    [x, y + bh, 1, -1],
    [x + bw, y + bh, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + c * sx, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + c * sy);
    ctx.stroke();
  }

  // center reticle
  ctx.shadowBlur = 8;
  ctx.lineWidth = 1.5;
  const mx = x + bw / 2;
  const my = y + bh / 2;
  line(ctx, mx - 6, my, mx + 6, my);
  line(ctx, mx, my - 6, mx, my + 6);

  // label chip
  const text = `#${String(i).padStart(2, '0')} ${det.label.toUpperCase()} ${(det.score * 100).toFixed(0)}%`;
  ctx.font = '700 11px "Space Mono", ui-monospace, monospace';
  const tw = ctx.measureText(text).width;
  const pad = 5;
  const chipH = 18;
  const chipW = tw + pad * 2;
  let chipY = y - chipH - 4;
  if (chipY < 0) chipY = y + bh + 4; // flip below when clipped at top
  const chipX = Math.max(2, Math.min(x, ctx.canvas.clientWidth - chipW - 2));

  ctx.shadowBlur = 10;
  ctx.fillStyle = 'rgba(5, 1, 14, 0.88)';
  ctx.fillRect(chipX, chipY, chipW, chipH);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(chipX, chipY, chipW, chipH);
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.fillText(text, chipX + pad, chipY + chipH - 5);

  ctx.restore();
}

const line = (ctx, x1, y1, x2, y2) => {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
};
