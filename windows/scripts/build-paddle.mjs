import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, ".."),
  models = path.join(root, "experimental/paddle/models");
export const pinned = {
  det: "4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae",
  rec: "322f140154c820fcb83c3d24cfe42c9ec70dd1a1834163306a7338136e4f1eaa",
};
export async function packPaddle() {
  const result = {};
  for (const key of ["det", "rec"]) {
    const data = await fs.readFile(path.join(models, key + ".onnx"));
    if (createHash("sha256").update(data).digest("hex") !== pinned[key])
      throw Error("Paddle model integrity mismatch: " + key);
    result[key] = data.toString("base64");
  }
  result.dictionary = await fs.readFile(
    path.join(models, "ppocrv5_korean_dict.txt"),
    "utf8",
  );
  if (
    createHash("sha256").update(result.dictionary).digest("hex") !==
    "a88071c68c01707489baa79ebe0405b7beb5cca229f4fc94cc3ef992328802d7"
  )
    throw Error("Paddle dictionary integrity mismatch");
  const runtime = "node_modules/onnxruntime-web/dist/";
  result.wasm = (
    await fs.readFile(path.join(root, runtime, "ort-wasm-simd-threaded.wasm"))
  ).toString("base64");
  result.runtimeModule = await fs.readFile(
    path.join(root, runtime, "ort-wasm-simd-threaded.mjs"),
    "utf8",
  );
  const worker = await build({
    entryPoints: [path.join(root, "src/ocr/paddle-worker.js")],
    write: false,
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: true,
  });
  result.workerSource =
    (await fs.readFile(path.join(root, runtime, "ort.wasm.min.js"), "utf8")) +
    "\n" +
    worker.outputFiles[0].text;
  return result;
}
