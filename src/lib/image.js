/**
 * Image helpers: file → dataURL, remote url → dataURL, downscale for the APIs.
 */

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(blob);
  });
}

export function fileToDataURL(file) {
  return blobToDataURL(file);
}

export async function urlToDataURL(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch ${url} (HTTP ${res.status})`);
  return blobToDataURL(await res.blob());
}

export function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image data'));
    img.src = src;
  });
}

/**
 * Downscale a dataURL so its longest side <= maxDim.
 * Returns { dataUrl, base64, mime, width, height } of the *processed* image —
 * the exact pixels we show on screen AND send to both APIs, so bounding-box
 * coordinates map 1:1 onto the displayed image.
 */
export async function processImage(dataUrl, maxDim = 1024) {
  const img = await loadImageEl(dataUrl);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const srcMime = /^data:(.*?);/.exec(dataUrl)?.[1] || 'image/jpeg';

  if (Math.max(srcW, srcH) <= maxDim) {
    return {
      dataUrl,
      base64: dataUrl.split(',')[1],
      mime: srcMime,
      width: srcW,
      height: srcH,
    };
  }

  const scale = maxDim / Math.max(srcW, srcH);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(srcW * scale);
  canvas.height = Math.round(srcH * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL('image/jpeg', 0.92);

  return {
    dataUrl: out,
    base64: out.split(',')[1],
    mime: 'image/jpeg',
    width: canvas.width,
    height: canvas.height,
  };
}
