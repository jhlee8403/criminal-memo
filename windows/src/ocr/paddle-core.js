// Experimental PP-OCRv5 adapter. Horizontal-document DB component boxes are
// intentionally simpler than Paddle's polygon/rotated-box postprocessor.
export function ctcDecode(data, dims, dictionary) {
  const [batch, steps, classes] = dims;
  if (batch !== 1 || classes !== dictionary.length + 2)
    throw Error(
      `CTC dictionary/model mismatch: ${classes} classes / ${dictionary.length} characters`,
    );
  const chars = ["", ...dictionary, " "];
  let text = "",
    previous = -1,
    score = 0,
    count = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    for (let c = 1; c < classes; c++)
      if (data[t * classes + c] > data[t * classes + best]) best = c;
    if (best && best !== previous) {
      text += chars[best];
      score += data[t * classes + best];
      count++;
    }
    previous = best;
  }
  return { text: text.trim(), confidence: count ? (100 * score) / count : 0 };
}
export function detectionPlan(width, height, maxSide = 1280) {
  const ratio = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(32, Math.round((width * ratio) / 32) * 32),
    height: Math.max(32, Math.round((height * ratio) / 32) * 32),
  };
}
export function normalizeRGB(rgba, width, height, kind) {
  const n = width * height,
    data = new Float32Array(n * 3),
    mean = [0.485, 0.456, 0.406],
    std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) {
      const x = rgba[i * 4 + c] / 255;
      data[c * n + i] =
        kind === "det" ? (x - mean[c]) / std[c] : (x - 0.5) / 0.5;
    }
  return data;
}
export function dbBoxes(
  map,
  width,
  height,
  { threshold = 0.3, scoreThreshold = 0.6, maxBoxes = 300 } = {},
) {
  if (map.length !== width * height)
    throw Error("Unexpected DB probability map");
  const visited = new Uint8Array(map.length),
    queue = new Int32Array(map.length),
    boxes = [];
  for (let start = 0; start < map.length; start++) {
    if (visited[start] || map[start] < threshold) continue;
    let head = 0,
      tail = 1,
      minX = width,
      minY = height,
      maxX = 0,
      maxY = 0,
      sum = 0;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const pos = queue[head++],
        x = pos % width,
        y = Math.floor(pos / width);
      minX = Math.min(x, minX);
      minY = Math.min(y, minY);
      maxX = Math.max(x, maxX);
      maxY = Math.max(y, maxY);
      sum += map[pos];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy,
            np = ny * width + nx;
          if (
            nx < 0 ||
            nx >= width ||
            ny < 0 ||
            ny >= height ||
            visited[np] ||
            map[np] < threshold
          )
            continue;
          visited[np] = 1;
          queue[tail++] = np;
        }
    }
    if (
      tail < 4 ||
      maxX - minX < 2 ||
      maxY - minY < 2 ||
      sum / tail < scoreThreshold
    )
      continue;
    const w = maxX - minX + 1,
      h = maxY - minY + 1;
    // Approximate unclip for horizontal text; not a rotated polygon equivalent.
    const pad = Math.max(2, Math.min(w, h) * 0.55);
    boxes.push({
      x0: Math.max(0, minX - pad),
      y0: Math.max(0, minY - pad),
      x1: Math.min(width, maxX + 1 + pad),
      y1: Math.min(height, maxY + 1 + pad),
      score: sum / tail,
    });
    if (boxes.length > maxBoxes)
      throw Error(
        "Paddle detection exceeded bounded line count; select a smaller region",
      );
  }
  return boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}
export function restoreLines(words) {
  const rows = [];
  for (const word of [...words].sort(
    (a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0,
  )) {
    const cy = (word.bbox.y0 + word.bbox.y1) / 2,
      h = word.bbox.y1 - word.bbox.y0;
    let row = rows.find(
      (r) => Math.abs(r.cy - cy) < Math.max(3, Math.min(r.h, h) * 0.5),
    );
    if (!row) {
      row = { cy, h, words: [] };
      rows.push(row);
    }
    row.words.push(word);
  }
  return rows
    .sort((a, b) => a.cy - b.cy)
    .map((r) => {
      const words = r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      return {
        text: words.map((w) => w.text).join(" "),
        confidence: words.reduce((n, w) => n + w.confidence, 0) / words.length,
        words,
        bbox: {
          x0: Math.min(...words.map((w) => w.bbox.x0)),
          y0: Math.min(...words.map((w) => w.bbox.y0)),
          x1: Math.max(...words.map((w) => w.bbox.x1)),
          y1: Math.max(...words.map((w) => w.bbox.y1)),
        },
      };
    });
}
