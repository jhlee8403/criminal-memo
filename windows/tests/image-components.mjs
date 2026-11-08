import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, ".."),
  b = await chromium.launch({
    executablePath: process.env.CM_CHROMIUM || "/usr/bin/chromium",
    headless: true,
  });
try {
  const p = await b.newPage();
  await p.setContent(
    await fs.readFile(
      path.join(root, "distribution/CriminalMemo/CriminalMemo.html"),
      "utf8",
    ),
  );
  await p.waitForFunction(() => !!CM);
  const a = await p.evaluate(() => {
    const results = [];
    for (const angle of [-2, 0, 2]) {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 1000;
      const x = c.getContext("2d");
      x.fillStyle = "white";
      x.fillRect(0, 0, 800, 1000);
      x.translate(400, 500);
      x.rotate((angle * Math.PI) / 180);
      x.fillStyle = "black";
      x.font = "20px Arial";
      for (let i = 0; i < 20; i++)
        x.fillText(
          "Criminal memo prosecutor and charges horizontal text",
          -350,
          -400 + i * 38,
        );
      results.push({
        input: angle,
        correction: CM.preprocess(c, "deskew-denoise").angle,
      });
    }
    return results;
  });
  for (const r of a) assert.ok(Math.abs(r.input + r.correction) <= 1);
  console.log(a);
} finally {
  await b.close();
}
