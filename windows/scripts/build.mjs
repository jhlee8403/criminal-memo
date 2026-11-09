import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { packPaddle } from "./build-paddle.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "distribution-candidates/CriminalMemo-v2.2");
const read = (p) => fs.readFile(path.join(root, p));
await fs.mkdir(path.join(out, "assets"), { recursive: true });
await fs.mkdir(path.join(out, "templates"), { recursive: true });
const pdfs = (await fs.readdir(path.join(root, ".."))).filter(
  (n) => n.normalize("NFC") === "형사메모.pdf",
);
if (pdfs.length !== 1)
  throw Error("원본 형사메모 PDF를 하나로 찾을 수 없습니다.");
const template = await fs.readFile(path.join(root, "..", pdfs[0]));
await fs.writeFile(path.join(out, "templates/형사메모.pdf"), template);
const resources = {
  template: template.toString("base64"),
  font: (await read("vendor/NanumGothic-Regular.ttf")).toString("base64"),
  templateSHA256: createHash("sha256").update(template).digest("hex"),
};
for (const [key, dir] of [
  ["cmaps", "cmaps"],
  ["standardFonts", "standard_fonts"],
]) {
  resources[key] = {};
  for (const file of await fs.readdir(
    path.join(root, "node_modules/pdfjs-dist", dir),
  )) {
    if (
      file.endsWith(".bcmap") ||
      file.endsWith(".pfb") ||
      file.endsWith(".ttf")
    )
      resources[key][file] = (
        await read(`node_modules/pdfjs-dist/${dir}/${file}`)
      ).toString("base64");
  }
}
await fs.writeFile(
  path.join(out, "assets/documents.js"),
  "window.CM_DOCUMENTS=" + JSON.stringify(resources) + ";\n",
);
const paddle = await packPaddle();
await fs.writeFile(
  path.join(out, "assets/paddle.js"),
  "window.CM_PADDLE=" + JSON.stringify(paddle) + ";\n",
);
const lang = {};
for (const code of ["kor", "eng"])
  lang[code] = (
    await read(
      `node_modules/@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`,
    )
  ).toString("base64");
const core = await read(
  "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
);
const worker = await read("node_modules/tesseract.js/dist/worker.min.js");
const prelude = `const packed=${JSON.stringify(lang)};const originalFetch=self.fetch.bind(self);self.fetch=async(input,options)=>{const u=String(input);if(u.startsWith('cm-local:')){const code=u.split('/').pop().split('.')[0];if(!packed[code])throw Error('Local OCR language missing');const b=Uint8Array.from(atob(packed[code]),c=>c.charCodeAt(0));return new Response(b);}if(u.startsWith('data:')||u.startsWith('blob:'))return originalFetch(input,options);throw Error('Offline OCR: network request blocked');};\n`;
// The official wasm.js distribution embeds its WASM bytes; no local fetch is needed.
const workerSource = prelude + core.toString() + "\n" + worker.toString();
await fs.writeFile(
  path.join(out, "assets/ocr.js"),
  "window.CM_OCR_WORKER=" + JSON.stringify(workerSource) + ";\n",
);
for (const kind of ["pdf", "pdf.worker"])
  await build({
    entryPoints: [path.join(root, `node_modules/pdfjs-dist/build/${kind}.mjs`)],
    bundle: true,
    format: "iife",
    globalName: kind === "pdf" ? "pdfjsLib" : "pdfjsWorker",
    outfile: path.join(out, `assets/${kind}.js`),
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "eof",
  });
await build({
  entryPoints: [path.join(root, "src/app.js")],
  bundle: true,
  format: "iife",
  outfile: path.join(out, "assets/app.js"),
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
});
let html = await fs.readFile(path.join(root, "src/CriminalMemo.html"), "utf8");
for (const script of [
  "documents",
  "ocr",
  "paddle",
  "pdf.worker",
  "pdf",
  "app",
]) {
  const name = `assets/${script}.js`,
    code = await fs.readFile(path.join(out, name), "utf8");
  html = html.replace(
    `<script src="${name}"></script>`,
    () => "<script>" + code.replaceAll("</script", "<\\/script") + "</script>",
  );
  await fs.unlink(path.join(out, name));
}
const css = await fs.readFile(path.join(root, "src/styles.css"), "utf8");
html = html.replace(
  '<link rel="stylesheet" href="styles.css">',
  () => "<style>" + css + "</style>",
);
await fs.writeFile(path.join(out, "CriminalMemo.html"), html);
await fs.rm(path.join(out, "styles.css"), { force: true }); // obsolete generated probe stylesheet
await fs.copyFile(
  path.join(root, "USER_GUIDE.txt"),
  path.join(out, "README.txt"),
);
await fs.copyFile(
  path.join(root, "vendor/OFL.txt"),
  path.join(out, "assets/NanumGothic-OFL.txt"),
);
await fs.copyFile(
  path.join(root, "vendor/tessdata-LICENSE.txt"),
  path.join(out, "assets/tessdata-Apache-2.0.txt"),
);
const licenses = [];
for (const name of [
  "onnxruntime-web",
  "pdfjs-dist",
  "pdf-lib",
  "@pdf-lib/fontkit",
  "tesseract.js",
  "tesseract.js-core",
  "@tesseract.js-data/kor",
  "@tesseract.js-data/eng",
]) {
  const p = JSON.parse(await read(`node_modules/${name}/package.json`));
  let text = "";
  for (const f of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    try {
      text = (await read(`node_modules/${name}/${f}`)).toString();
      break;
    } catch {}
  }
  licenses.push(
    `${name} ${p.version} (${p.license})\nAuthor: ${JSON.stringify(p.author)}\nContributors: ${JSON.stringify(p.contributors ?? [])}\nRepository: ${JSON.stringify(p.repository)}\n${text || "Package license declared in metadata; underlying trained data Apache-2.0 terms are supplied separately."}`,
  );
}
for (const file of [
  "standard_fonts/LICENSE_FOXIT",
  "standard_fonts/LICENSE_LIBERATION",
  "cmaps/LICENSE",
]) {
  try {
    licenses.push(
      file + "\n" + (await read("node_modules/pdfjs-dist/" + file)).toString(),
    );
  } catch {}
}
await fs.writeFile(
  path.join(out, "assets/THIRD_PARTY_LICENSES.txt"),
  licenses.join("\n\n----------------\n\n"),
);
for (const file of [
  "PaddleOCR-LICENSE.txt",
  "RapidOCR-LICENSE.txt",
  "MODEL_PROVENANCE.md",
  "MODEL_MANIFEST.json",
])
  await fs.copyFile(
    path.join(root, "experimental/paddle", file),
    path.join(out, "assets", file),
  );
const manifest = {
  builtAt: new Date().toISOString(),
  candidate: "v2.2-experimental",
  windowsEdgeFileVerified: false,
  templateSHA256: resources.templateSHA256,
  files: {},
};
async function scan(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) await scan(p);
    else if (item.name !== "manifest.json")
      manifest.files[path.relative(out, p).replaceAll("\\", "/")] = createHash(
        "sha256",
      )
        .update(await fs.readFile(p))
        .digest("hex");
  }
}
await scan(out);
await fs.writeFile(
  path.join(out, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log("Built", out);
