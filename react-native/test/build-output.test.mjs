// The shape of the BUILT files, not the source: 0.1.7 shipped a black screen because the ESM build
// rewrote require("expo-iap") into esbuild's __require shim, which Metro cannot see, so the store
// library was never bundled. Source review and typechecks both passed; only the build output showed
// it. Run `npm run build` first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const file of ["dist/index.js", "dist/index.cjs"]) {
  test(`${file} references expo-iap in a form Metro can follow`, () => {
    const out = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(out, /import\("expo-iap"\)/, "expect a literal import(\"expo-iap\")");
    assert.doesNotMatch(out, /__require\(\s*["']expo-iap["']\s*\)/, "esbuild's __require shim is invisible to Metro");
  });
}
