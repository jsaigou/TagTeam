/**
 * OpenCV.js document scanning: edge-detect the document in a camera frame and
 * perspective-crop it into a clean page.
 *
 * OpenCV.js (~10 MB) is loaded lazily on first use from `VITE_OPENCV_URL`
 * (default: the same-origin vendored copy at /vendor/opencv.js — the official
 * 4.10.0 build, self-hosted because docs.opencv.org sits behind bot protection
 * and is an unsuitable runtime dependency). It is never part of the app bundle.
 * If it fails to load, `scanImage` falls back to the un-cropped frame so the
 * flow still works without the engine.
 */
export type QuadPoint = { x: number; y: number };
export type Quad = { points: [QuadPoint, QuadPoint, QuadPoint, QuadPoint] };

type CvLike = any;

let cvPromise: Promise<CvLike> | null = null;

export function getOpenCvUrl(): string {
  const fromEnv = (import.meta.env.VITE_OPENCV_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  // Same-origin vendored copy (public/vendor/opencv.js) — served by Vite in
  // dev and by the Express static mount in prod.
  return "/vendor/opencv.js";
}

/** Load OpenCV.js (lazy singleton). Resolves with the global `cv` namespace. */
export function loadOpenCV(): Promise<CvLike> {
  if (cvPromise) return cvPromise;
  const existing = (globalThis as Record<string, unknown>).cv as CvLike | undefined;
  if (existing) {
    cvPromise = Promise.resolve(existing);
    return cvPromise;
  }
  if (typeof document === "undefined") {
    return Promise.reject(new Error("OpenCV requires a browser environment"));
  }
  const url = getOpenCvUrl();
  cvPromise = new Promise<CvLike>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => {
      const cv = (globalThis as Record<string, unknown>).cv as CvLike | undefined;
      if (!cv) {
        reject(new Error(`OpenCV did not expose a global after loading ${url}`));
        return;
      }
      if (cv.Mat) {
        resolve(cv); // already initialized
        return;
      }
      cv.onRuntimeInitialized = () => resolve(cv);
    };
    script.onerror = () =>
      reject(new Error(`Failed to load OpenCV.js from ${url}`));
    document.head.appendChild(script);
  });
  return cvPromise;
}

/** Order four points as TL, TR, BR, BL (top-left first, clockwise). */
export function orderCorners(points: QuadPoint[]): Quad {
  const pts = points.map((p) => ({ x: p.x, y: p.y }));
  const sum = pts.map((p) => p.x + p.y);
  const diff = pts.map((p) => p.x - p.y);
  const tl = pts[sum.indexOf(Math.min(...sum))];
  const br = pts[sum.indexOf(Math.max(...sum))];
  const tr = pts[diff.indexOf(Math.max(...diff))];
  const bl = pts[diff.indexOf(Math.min(...diff))];
  return { points: [tl, tr, br, bl] };
}

/**
 * Detect the largest quadrilateral in a frame. Returns ordered corners scaled
 * back to the *original* frame coordinates, or null when no document is found.
 */
export function detectDocumentQuad(
  cv: CvLike,
  src: CvLike,
  maxDim = 1200,
): Quad | null {
  const scale = Math.min(1, maxDim / Math.max(src.cols, src.rows));
  const workW = Math.max(1, Math.round(src.cols * scale));
  const workH = Math.max(1, Math.round(src.rows * scale));

  const work = new cv.Mat();
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.resize(src, work, new cv.Size(workW, workH), 0, 0, cv.INTER_AREA);
    cv.cvtColor(work, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edges, edges, kernel);
    kernel.delete();

    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const totalArea = workW * workH;
    let best: QuadPoint[] | null = null;
    let bestArea = 0;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area < totalArea * 0.05) {
        contour.delete();
        continue;
      }
      const peri = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * peri, true);
      if (approx.rows === 1 && approx.cols === 4 && area > bestArea) {
        bestArea = area;
        const data = approx.data32S;
        const pts: QuadPoint[] = [];
        for (let k = 0; k < 4; k++) {
          pts.push({ x: data[k * 2], y: data[k * 2 + 1] });
        }
        best = pts;
      }
      approx.delete();
      contour.delete();
    }

    if (!best) return null;
    const quad = orderCorners(best);
    // Scale back to original coordinates so the caller can crop the source.
    if (scale !== 1) {
      for (const p of quad.points) {
        p.x = Math.round(p.x / scale);
        p.y = Math.round(p.y / scale);
      }
    }
    return quad;
  } finally {
    work.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/** Perspective-crop a quad out of `src`, returning a data URL. */
export function cropQuadToDataUrl(
  cv: CvLike,
  src: CvLike,
  quad: Quad,
  maxDim = 1600,
): string {
  const [tl, tr, br, bl] = quad.points;
  const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const bottomW = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftH = Math.hypot(bl.y - tl.y, bl.x - tl.x);
  const rightH = Math.hypot(br.y - tr.y, br.x - tr.x);
  const outW = Math.round(Math.max(topW, bottomW));
  const outH = Math.round(Math.max(leftH, rightH));
  const scale = Math.min(1, maxDim / Math.max(outW, outH, 1));
  const dstW = Math.max(1, Math.round(outW * scale));
  const dstH = Math.max(1, Math.round(outH * scale));

  const srcPts = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y],
  );
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    dstW - 1,
    0,
    dstW - 1,
    dstH - 1,
    0,
    dstH - 1,
  ]);
  const transform = cv.getPerspectiveTransform(srcPts, dstPts);
  const dst = new cv.Mat();
  try {
    cv.warpPerspective(
      src,
      dst,
      transform,
      new cv.Size(dstW, dstH),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(),
    );
    return matToDataUrl(dst);
  } finally {
    srcPts.delete();
    dstPts.delete();
    transform.delete();
    dst.delete();
  }
}

function matToDataUrl(mat: CvLike): string {
  const canvas = document.createElement("canvas");
  canvas.width = mat.cols;
  canvas.height = mat.rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const imageData = new ImageData(
    new Uint8ClampedArray(
      (mat.data ?? mat.dataU8 ?? mat.data8S ?? new Uint8Array(0)).slice(0, mat.rows * mat.cols * 4),
    ),
    mat.cols,
    mat.rows,
  );
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.9);
}

export type ScanResult = {
  /** Cropped page (or the raw frame when detection failed). */
  dataUrl: string;
  /** True when the document quad was found and cropped. */
  detected: boolean;
};

/**
 * High-level scan: run edge detection on a frame and return a cropped page.
 * Falls back to the raw frame when OpenCV can't load or no quad is found.
 */
export async function scanFrame(frame: HTMLCanvasElement): Promise<ScanResult> {
  const raw = frame.toDataURL("image/jpeg", 0.9);
  try {
    const cv = await loadOpenCV();
    const src = cv.imread(frame);
    try {
      const quad = detectDocumentQuad(cv, src);
      if (!quad) return { dataUrl: raw, detected: false };
      return { dataUrl: cropQuadToDataUrl(cv, src, quad), detected: true };
    } finally {
      src.delete();
    }
  } catch {
    return { dataUrl: raw, detected: false };
  }
}
