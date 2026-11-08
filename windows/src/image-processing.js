import { OCR_LIMITS } from "./diagnostics.js";
export function renderPlan(
  width,
  height,
  {
    dpi = 300,
    maxPixels = OCR_LIMITS.maxPixels,
    maxSide = OCR_LIMITS.maxSide,
  } = {},
) {
  const scale = Math.min(
    dpi / 72,
    maxSide / Math.max(width, height),
    Math.sqrt(maxPixels / (width * height)),
  );
  const w = Math.max(1, Math.floor(width * scale)),
    h = Math.max(1, Math.floor(height * scale));
  return {
    scale,
    width: w,
    height: h,
    effectiveDPI: scale * 72,
    estimatedRGBABytes: w * h * 4,
  };
}
export async function renderOCR(
  page,
  { box = null, dpi = 300, maxPixels = OCR_LIMITS.maxPixels } = {},
) {
  const unit = page.getViewport({ scale: 1 });
  const raw = box ?? [0, 0, unit.width, unit.height];
  const x = Math.max(0, Math.min(unit.width, raw[0])),
    y = Math.max(0, Math.min(unit.height, raw[1])),
    w = Math.min(raw[2], unit.width - x),
    h = Math.min(raw[3], unit.height - y);
  if (w < 3 || h < 3) throw Error("선택 영역이 너무 작거나 페이지 밖입니다.");
  const plan = renderPlan(w, h, { dpi, maxPixels });
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const viewport = page.getViewport({
    scale: plan.scale,
    offsetX: -x * plan.scale,
    offsetY: -y * plan.scale,
  });
  await page.render({ canvasContext: canvas.getContext("2d"), viewport })
    .promise;
  return { canvas, plan, box: [x, y, w, h] };
}
const grayPixels = (canvas) => {
  const rgba = canvas
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < gray.length; i++)
    gray[i] = Math.round(
      rgba.data[i * 4] * 0.299 +
        rgba.data[i * 4 + 1] * 0.587 +
        rgba.data[i * 4 + 2] * 0.114,
    );
  return { rgba, gray };
};
export function estimateSkew(canvas) {
  const small = document.createElement("canvas");
  small.width = Math.min(600, canvas.width);
  small.height = Math.round((canvas.height * small.width) / canvas.width);
  small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
  const { gray } = grayPixels(small),
    w = small.width,
    h = small.height;
  let best = { angle: 0, score: 0 },
    zero = 0;
  for (const angle of [-3, -2, -1, 0, 1, 2, 3]) {
    const rows = new Float64Array(h + 80),
      slope = Math.tan((angle * Math.PI) / 180);
    // Sample every row: skipping alternate rows biases the zero-angle score.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x += 2)
        if (gray[y * w + x] < 140) {
          const r = Math.round(y + (x - w / 2) * slope) + 40;
          if (r >= 0 && r < rows.length) rows[r]++;
        }
    const score = rows.reduce((s, v) => s + v * v, 0);
    if (angle === 0) zero = score;
    if (score > best.score) best = { angle, score };
  }
  small.width = small.height = 1;
  return best.score > zero * 1.08 ? best.angle : 0;
}
export function preprocess(canvas, method = "original") {
  const start = performance.now(),
    out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, out.width, out.height);
  let angle = 0;
  if (method === "deskew-denoise") {
    angle = estimateSkew(canvas);
    ctx.save();
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(canvas, -out.width / 2, -out.height / 2);
    ctx.restore();
  } else ctx.drawImage(canvas, 0, 0);
  if (method !== "original") {
    const { rgba, gray } = grayPixels(out),
      w = out.width,
      h = out.height;
    let integral;
    if (method === "adaptive") {
      integral = new Uint32Array((w + 1) * (h + 1));
      for (let y = 1; y <= h; y++) {
        let sum = 0;
        for (let x = 1; x <= w; x++) {
          sum += gray[(y - 1) * w + x - 1];
          integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + sum;
        }
      }
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let value = gray[i];
        if (method === "contrast")
          value = Math.max(0, Math.min(255, (value - 128) * 1.35 + 128));
        if (method === "adaptive") {
          const r = 15,
            x0 = Math.max(0, x - r),
            x1 = Math.min(w, x + r + 1),
            y0 = Math.max(0, y - r),
            y1 = Math.min(h, y + r + 1);
          const mean =
            (integral[y1 * (w + 1) + x1] -
              integral[y0 * (w + 1) + x1] -
              integral[y1 * (w + 1) + x0] +
              integral[y0 * (w + 1) + x0]) /
            ((x1 - x0) * (y1 - y0));
          value = value < mean - 12 ? 0 : 255;
        }
        if (
          method === "deskew-denoise" &&
          x > 0 &&
          x < w - 1 &&
          y > 0 &&
          y < h - 1
        ) {
          const near = [gray[i - 1], gray[i + 1], gray[i - w], gray[i + w]],
            mean = near.reduce((a, b) => a + b, 0) / 4;
          if (
            Math.max(...near) - Math.min(...near) < 18 &&
            Math.abs(value - mean) > 45
          )
            value = mean;
        }
        rgba.data[i * 4] = rgba.data[i * 4 + 1] = rgba.data[i * 4 + 2] = value;
        rgba.data[i * 4 + 3] = 255;
      }
    ctx.putImageData(rgba, 0, 0);
  }
  return {
    canvas: out,
    method,
    angle,
    elapsedMs: performance.now() - start,
    estimatedPeakBytes:
      out.width * out.height * (method === "adaptive" ? 17 : 13),
  };
}
export async function estimateNativeDPI(page) {
  try {
    const ops = await page.getOperatorList(),
      OPS = window.pdfjsLib.OPS;
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack = [],
      values = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i],
        a = ops.argsArray[i];
      if (fn === OPS.save) stack.push([...matrix]);
      else if (fn === OPS.restore) matrix = stack.pop() ?? matrix;
      else if (fn === OPS.transform) {
        const [b0, b1, b2, b3, b4, b5] = a,
          [a0, a1, a2, a3, a4, a5] = matrix;
        matrix = [
          a0 * b0 + a2 * b1,
          a1 * b0 + a3 * b1,
          a0 * b2 + a2 * b3,
          a1 * b2 + a3 * b3,
          a0 * b4 + a2 * b5 + a4,
          a1 * b4 + a3 * b5 + a5,
        ];
      } else if (fn === OPS.paintImageXObject && Number(a?.[1]) > 0) {
        const points = Math.hypot(matrix[0], matrix[1]);
        if (points > 50) values.push((a[1] / points) * 72);
      }
    }
    return values.length
      ? { min: Math.min(...values), max: Math.max(...values), estimated: true }
      : null;
  } catch {
    return null;
  }
}
