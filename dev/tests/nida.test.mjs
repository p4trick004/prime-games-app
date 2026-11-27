// Client-side NIDA NIN validation shared by the landing booking form and the
// portal (booking + KYC). Both implementations must behave identically.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const landing = require("../../web/nida.js");
const portal = await import("../../portal/src/lib/nida.ts");

const IMPLS = [
  ["landing page", landing],
  ["portal", portal],
];

const VALID = [
  ["grouped 8-5-5-2", "19900101-12345-67890-12"],
  ["plain 20 digits", "19900101123456789012"],
  ["space separated", "19900101 12345 67890 12"],
  ["surrounding whitespace", "  19900101-12345-67890-12\n"],
  ["mixed separators", "19900101 - 12345 67890-12"],
  ["leading zeros", "00123456-78901-23456-78"],
];

const INVALID = [
  ["empty", ""],
  ["whitespace only", "   "],
  ["incomplete 19 digits", "19900101-12345-67890-1"],
  ["incomplete 17 digits", "19900101-12345-67890"],
  ["too long 21 digits", "19900101-12345-67890-123"],
  ["letter inside", "1990010A-12345-67890-12"],
  ["slash separators", "19900101/12345/67890/12"],
  ["dot separators", "19900101.12345.67890.12"],
  ["en dash separators", "19900101\u201312345\u201367890\u201312"],
  ["hyphenated but short", "1990-0101-12345-67890"],
  ["only separators", "---- ----- ----- --"],
];

for (const [name, impl] of IMPLS) {
  test(`${name}: accepts valid NINs`, () => {
    for (const [label, value] of VALID) {
      assert.equal(impl.isValidNida(value), true, `${label} (${JSON.stringify(value)})`);
    }
  });

  test(`${name}: rejects invalid NINs`, () => {
    for (const [label, value] of INVALID) {
      assert.equal(impl.isValidNida(value), false, `${label} (${JSON.stringify(value)})`);
    }
  });

  test(`${name}: normalization strips separators and keeps a string`, () => {
    const out = impl.normalizeNida(" 0012-3456 7890-1234-5678 ");
    assert.equal(out, "00123456789012345678");
    assert.equal(typeof out, "string");
    assert.equal(out.length, 20);
    assert.equal(impl.normalizeNida("19900101123456789012"), "19900101123456789012");
  });

  test(`${name}: leading zeros survive normalization`, () => {
    const out = impl.normalizeNida("00123456-78901-23456-78");
    assert.equal(out, "00123456789012345678");
    assert.ok(out.startsWith("00123456"));
    // A numeric round-trip would drop the leading zeros; we never do that.
    assert.notEqual(String(Number(out)), out);
  });
}

test("both implementations agree", () => {
  for (const [, value] of [...VALID, ...INVALID]) {
    assert.equal(landing.isValidNida(value), portal.isValidNida(value), JSON.stringify(value));
    assert.equal(landing.normalizeNida(value), portal.normalizeNida(value), JSON.stringify(value));
  }
});

test("landing page loads the NIDA helper before app.js", () => {
  const html = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");
  const helper = html.indexOf('src="nida.js"');
  const app = html.indexOf('src="app.js"');
  assert.ok(helper !== -1, "nida.js script tag missing");
  assert.ok(app !== -1, "app.js script tag missing");
  assert.ok(helper < app, "nida.js must load before app.js");
});
