import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
const root = new URL("../distribution/CriminalMemo/", import.meta.url);
const html = await fs.readFile(new URL("CriminalMemo.html", root), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  (m) => m[1],
);
test("shipped HTML installs PDF.js legacy compatibility before main/app initialization", async () => {
  const worker = scripts.findIndex((s) => /\bvar pdfjsWorker\s*=/.test(s));
  const main = scripts.findIndex((s) => /\bvar pdfjsLib\s*=/.test(s));
  const app = scripts.findIndex((s) => s.includes("window.CM="));
  assert.ok(
    worker >= 0 && main > worker && app > main,
    "worker, main, app must execute in order",
  );
  assert.doesNotMatch(
    html,
    /<script\s+src=/,
    "single HTML must not need external scripts",
  );
  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
    structuredClone,
    DOMException,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    ReadableStream,
    Response,
    setTimeout,
    clearTimeout,
    atob,
    btoa,
  });
  vm.runInContext(
    "delete Promise.withResolvers; delete Set.prototype.union; delete Object.getPrototypeOf(Uint8Array.prototype).toSorted; delete ArrayBuffer.prototype.transfer;",
    context,
  );
  assert.equal(
    vm.runInContext("typeof Promise.withResolvers", context),
    "undefined",
  );
  vm.runInContext(scripts[worker], context);
  assert.equal(
    vm.runInContext("typeof Promise.withResolvers", context),
    "function",
    "compatibility must exist before PDF.js main executes",
  );
  vm.runInContext(scripts[main], context);
  assert.equal(vm.runInContext("pdfjsLib.version", context), "4.8.69");
  assert.equal(
    vm.runInContext("typeof pdfjsWorker.WorkerMessageHandler", context),
    "function",
  );
  assert.equal(
    await vm.runInContext(
      "(async()=>{const d=Promise.withResolvers();d.resolve(104);return await d.promise;})()",
      context,
    ),
    104,
  );
});
test("distribution manifest records Edge 104 and the paired legacy build", async () => {
  const manifest = JSON.parse(
    await fs.readFile(new URL("manifest.json", root), "utf8"),
  );
  assert.equal(manifest.browserTarget, "edge104");
  assert.equal(manifest.pdfjsBuild, "legacy");
  assert.equal(manifest.pdfjsVersion, "4.8.69");
});
test('the new complete two-page original is embedded byte-for-byte without a second template', async () => {
  const {createHash}=await import('node:crypto');
  const context=vm.createContext({window:{}});vm.runInContext(scripts[0],context);
  const docs=context.window.CM_DOCUMENTS;
  const original=await fs.readFile(new URL('../templates/형사메모(1).pdf',import.meta.url));
  assert.deepEqual(Buffer.from(docs.template,'base64'),original);
  assert.equal(createHash('sha256').update(original).digest('hex'),'b16fcb041110090725863c5a4934a03b80ea935f6086d9bcf7111528aeb6f75c');
  assert.equal(docs.secondTemplate,undefined);
  assert.equal(docs.secondTemplateSHA256,undefined);
  const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',root),'utf8'));
  assert.equal(manifest.templateSHA256,docs.templateSHA256);
  assert.equal(manifest.secondTemplateSHA256,undefined);
  assert.deepEqual(await fs.readdir(new URL('templates/',root)),['형사메모(1).pdf']);
});
