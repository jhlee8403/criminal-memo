import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const bundles = await Promise.all(
  ["pdf.worker", "pdf"].map(async (kind) => {
    const result = await build({
      entryPoints: [
        fileURLToPath(
          new URL(
            `../node_modules/pdfjs-dist/legacy/build/${kind}.mjs`,
            import.meta.url,
          ),
        ),
      ],
      bundle: true,
      write: false,
      format: "iife",
      globalName: kind === "pdf" ? "pdfjsLib" : "pdfjsWorker",
      platform: "browser",
      target: "edge104",
      minify: true,
    });
    return result.outputFiles[0].text;
  }),
);
function realm(remove = true) {
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
    "globalThis.nativeWithResolvers=Promise.withResolvers",
    context,
  );
  if (remove)
    vm.runInContext(
      "delete Promise.withResolvers; delete Set.prototype.union; delete Set.prototype.intersection; delete Object.getPrototypeOf(Uint8Array.prototype).toSorted; delete Object.getPrototypeOf(Uint8Array.prototype).toReversed; delete Object.getPrototypeOf(Uint8Array.prototype).with; delete ArrayBuffer.prototype.transfer; delete ArrayBuffer.prototype.transferToFixedLength;",
      context,
    );
  return context;
}
for (const [index, name] of ["worker", "main"].entries())
  test(`legacy ${name} initializes in a realm without modern Promise/Set/TypedArray APIs`, async () => {
    const context = realm();
    assert.equal(
      vm.runInContext("typeof Promise.withResolvers", context),
      "undefined",
    );
    assert.equal(
      vm.runInContext("typeof Uint8Array.prototype.toSorted", context),
      "undefined",
    );
    vm.runInContext(bundles[index], context);
    assert.equal(
      vm.runInContext("typeof Promise.withResolvers", context),
      "function",
    );
    assert.equal(
      vm.runInContext(
        'Object.getOwnPropertyDescriptor(Promise,"withResolvers").enumerable',
        context,
      ),
      false,
    );
    assert.equal(
      await vm.runInContext(
        "(async()=>{const d=Promise.withResolvers();d.resolve(42);return await d.promise;})()",
        context,
      ),
      42,
    );
    assert.equal(
      await vm.runInContext(
        '(async()=>{const d=Promise.withResolvers();d.promise.catch(()=>{});d.reject("expected");try{await d.promise;}catch(e){return e;}})()',
        context,
      ),
      "expected",
    );
    assert.equal(
      vm.runInContext(
        "class SubPromise extends Promise{}; Promise.withResolvers.call(SubPromise).promise instanceof SubPromise",
        context,
      ),
      true,
    );
    assert.equal(
      vm.runInContext(
        "JSON.stringify(Array.from(new Uint8Array([3,1,2]).toSorted()))",
        context,
      ),
      "[1,2,3]",
    );
    assert.equal(
      vm.runInContext(
        "JSON.stringify(Array.from(new Set([1]).union(new Set([2]))))",
        context,
      ),
      "[1,2]",
    );
  });
test("legacy bundles retain a working native Promise.withResolvers", () => {
  const context = realm(false);
  for (const bundle of bundles) vm.runInContext(bundle, context);
  assert.equal(
    vm.runInContext("Promise.withResolvers === nativeWithResolvers", context),
    true,
  );
});
test("baseline modern PDF.js reproduces the reported failure without Promise.withResolvers", async () => {
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL("../node_modules/pdfjs-dist/build/pdf.mjs", import.meta.url),
      ),
    ],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "pdfjsLib",
    platform: "browser",
    target: "edge104",
    minify: true,
  });
  const context = realm();
  vm.runInContext(result.outputFiles[0].text, context);
  assert.throws(
    () =>
      vm.runInContext(
        "pdfjsLib.getDocument({data:new Uint8Array([37,80,68,70])})",
        context,
      ),
    /withResolvers is not a function/,
  );
});
