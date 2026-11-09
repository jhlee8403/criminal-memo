// Reproducible research assets, never called at application runtime.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "experimental/paddle/models");
const files = [
  [
    "det.onnx",
    "https://raw.githubusercontent.com/BobLd/RapidOcrNet/9d1f9f1f6c3ec6f0da123a420842390de9b97268/RapidOcrNet/models/v5/ch_PP-OCRv5_mobile_det.onnx",
    "4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae",
  ],
  [
    "rec.onnx",
    "https://raw.githubusercontent.com/123456789qwaszx/game-text-extractor/674b76b04b57e923c5be1eb5ad39076236e90e4d/models/korean_PP-OCRv5_mobile_rec.onnx",
    "322f140154c820fcb83c3d24cfe42c9ec70dd1a1834163306a7338136e4f1eaa",
  ],
  [
    "ppocrv5_korean_dict.txt",
    "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf/ppocr/utils/dict/ppocrv5_korean_dict.txt",
    "a88071c68c01707489baa79ebe0405b7beb5cca229f4fc94cc3ef992328802d7",
  ],
];
await fs.mkdir(out, { recursive: true });
for (const [file, url, hash] of files) {
  const destination = path.join(out, file);
  try {
    const old = await fs.readFile(destination);
    if (createHash("sha256").update(old).digest("hex") === hash) {
      console.log("verified", file);
      continue;
    }
    throw Error("Existing model differs; preserve it and investigate: " + file);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const temp = destination + ".download";
  execFileSync("curl", ["-fSL", "--max-time", "120", url, "-o", temp], {
    stdio: "inherit",
  });
  const data = await fs.readFile(temp);
  if (createHash("sha256").update(data).digest("hex") !== hash)
    throw Error("Downloaded model hash mismatch: " + file);
  await fs.rename(temp, destination);
  console.log("downloaded/verified", file);
}
