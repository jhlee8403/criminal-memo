import {
  ctcDecode,
  detectionPlan,
  normalizeRGB,
  dbBoxes,
  restoreLines,
} from "./paddle-core.js";
let det, rec, dictionary, moduleURL;
const canvas = (w, h) => new OffscreenCanvas(w, h);
async function run(session, image, kind) {
  const ctx = image.getContext("2d"),
    tensor = new ort.Tensor(
      "float32",
      normalizeRGB(
        ctx.getImageData(0, 0, image.width, image.height).data,
        image.width,
        image.height,
        kind,
      ),
      [1, 3, image.height, image.width],
    );
  const results = await session.run({ [session.inputNames[0]]: tensor });
  tensor.dispose();
  return results;
}
async function recognizeCrop(source, box) {
  const w = box.x1 - box.x0,
    h = box.y1 - box.y0;
  if (w < 1 || h < 1) return { text: "", confidence: 0 };
  const targetWidth = Math.max(1, Math.ceil((w * 48) / h));
  if (targetWidth > 2048)
    throw Error("Paddle recognition line too wide; select a smaller region");
  const image = canvas(Math.max(320, targetWidth), 48),
    ctx = image.getContext("2d");
  // Paddle RecResizeImg pads with normalized zero (RGB 127.5), not black/white.
  ctx.fillStyle = "rgb(128,128,128)";
  ctx.fillRect(0, 0, image.width, 48);
  ctx.drawImage(source, box.x0, box.y0, w, h, 0, 0, targetWidth, 48);
  const outputs = await run(rec, image, "rec"),
    tensor = outputs[rec.outputNames[0]];
  try {
    return ctcDecode(tensor.data, tensor.dims, dictionary);
  } finally {
    Object.values(outputs).forEach((t) => t.dispose());
    image.width = image.height = 1;
  }
}
self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "init") {
      moduleURL = URL.createObjectURL(
        new Blob([m.runtimeModule], { type: "text/javascript" }),
      );
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      const wasmURL = URL.createObjectURL(
        new Blob([m.wasm], { type: "application/wasm" }),
      );
      ort.env.wasm.wasmPaths = { mjs: moduleURL, wasm: wasmURL };
      const options = {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      };
      det = await ort.InferenceSession.create(new Uint8Array(m.det), options);
      rec = await ort.InferenceSession.create(new Uint8Array(m.rec), options);
      dictionary = m.dictionary
        .replace(/\r/g, "")
        .replace(/\n$/, "")
        .split("\n");
      self.postMessage({
        id: m.id,
        result: {
          ready: true,
          detInput: det.inputNames,
          recInput: rec.inputNames,
        },
      });
      return;
    }
    const start = performance.now(),
      source = canvas(m.width, m.height);
    source
      .getContext("2d")
      .putImageData(
        new ImageData(new Uint8ClampedArray(m.rgba), m.width, m.height),
        0,
        0,
      );
    let boxes;
    if (m.psm === 7) boxes = [{ x0: 0, y0: 0, x1: m.width, y1: m.height }];
    else {
      const plan = detectionPlan(m.width, m.height),
        image = canvas(plan.width, plan.height);
      image.getContext("2d").drawImage(source, 0, 0, plan.width, plan.height);
      const outputs = await run(det, image, "det"),
        prob = outputs[det.outputNames[0]],
        [mh, mw] = prob.dims.slice(-2);
      try {
        boxes = dbBoxes(prob.data, mw, mh).map((b) => ({
          x0: (b.x0 * m.width) / mw,
          y0: (b.y0 * m.height) / mh,
          x1: (b.x1 * m.width) / mw,
          y1: (b.y1 * m.height) / mh,
        }));
      } finally {
        Object.values(outputs).forEach((t) => t.dispose());
        image.width = image.height = 1;
      }
    }
    const words = [];
    for (const bbox of boxes) {
      const value = await recognizeCrop(source, bbox);
      if (value.text) words.push({ ...value, bbox });
    }
    const lines = restoreLines(words);
    source.width = source.height = 1;
    self.postMessage({
      id: m.id,
      result: {
        text: lines.map((l) => l.text).join("\n"),
        lines,
        confidence: words.length
          ? words.reduce((v, w) => v + w.confidence, 0) / words.length
          : 0,
        engine: "paddle-experimental",
        elapsedMs: performance.now() - start,
        detectedRegions: boxes.length,
      },
    });
  } catch (error) {
    self.postMessage({ id: m.id, error: error.message });
  }
};
