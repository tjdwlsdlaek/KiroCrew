/**
 * Drift guards for the macOS menu-bar tray template icon.
 *
 * macOS renders tray icons as template images: a monochrome (black + alpha)
 * glyph the system recolors for light/dark/tinted menu bars. The failure this
 * guards against is SILENT on the Linux CI host and on developer machines
 * without a packaged mac build: the tray simply renders the full-colour icon
 * again, clashing with neighbouring status items. macOS rendering cannot be
 * exercised here, so these tests assert the objective parts instead:
 *
 *   1. the template assets exist, at 18px with an exact @2x retina variant,
 *      and every visible pixel is pure black (a colour pixel would render
 *      wrong on every menu bar, and nothing else would ever catch it);
 *   2. createTray() actually takes the template path on macOS, calls
 *      setTemplateImage(true), and keeps the channel-aware full-colour
 *      selection for the other platforms;
 *   3. electron-builder ships the new assets and still ships the colour ones.
 *
 * The assets are encoded as single-IDAT, filter-0 RGBA PNGs on purpose so this
 * test can decode pixels with just zlib.inflateSync — no image dependency.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..");

/** Decode a filter-0, 8-bit RGBA PNG into { width, height, pixels }. */
function decodeFilter0Png(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.readUInt32BE(0), 0x89504e47, `${file}: not a PNG`);
  let off = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const tag = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (tag === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, `${file}: bit depth must be 8`);
      assert.equal(data[9], 6, `${file}: color type must be RGBA`);
      assert.equal(data[12], 0, `${file}: must be non-interlaced`);
    } else if (tag === "IDAT") {
      idat.push(data);
    }
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = 1 + width * 4;
  assert.equal(raw.length, stride * height, `${file}: unexpected scanline data`);
  const pixels = [];
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * stride], 0, `${file}: row ${y} must use filter 0`);
    for (let x = 0; x < width; x++) {
      const p = y * stride + 1 + x * 4;
      pixels.push([raw[p], raw[p + 1], raw[p + 2], raw[p + 3]]);
    }
  }
  return { width, height, pixels };
}

test("tray template assets are monochrome black-on-transparent at 1x and 2x", () => {
  const base = decodeFilter0Png(path.join(ROOT, "trayTemplate.png"));
  const retina = decodeFilter0Png(path.join(ROOT, "trayTemplate@2x.png"));

  assert.equal(base.width, 18);
  assert.equal(base.height, 18);
  assert.equal(retina.width, base.width * 2, "@2x must be exactly double");
  assert.equal(retina.height, base.height * 2, "@2x must be exactly double");

  for (const { width, pixels } of [base, retina]) {
    let visible = 0;
    pixels.forEach(([r, g, b, a], i) => {
      if (a === 0) return; // fully transparent — colour bytes irrelevant
      visible++;
      const at = `${width}px pixel #${i}`;
      assert.equal(r, 0, `${at}: template pixels must be pure black (r)`);
      assert.equal(g, 0, `${at}: template pixels must be pure black (g)`);
      assert.equal(b, 0, `${at}: template pixels must be pure black (b)`);
    });
    assert.ok(visible > 0, `${width}px: asset has no visible glyph`);
  }
});

test("createTray uses the template image on macOS and colour icons elsewhere", () => {
  const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  const start = main.indexOf("function createTray()");
  assert.notEqual(start, -1, "createTray not found");
  const body = main.slice(start, main.indexOf("\n}", start));

  // macOS branch: template asset, template flag, platform guard.
  assert.match(body, /trayTemplate\.png/, "tray must reference the template asset");
  assert.match(body, /setTemplateImage\(true\)/, "template flag must be set explicitly");
  assert.match(body, /IS_MAC/, "template path must be guarded to macOS");

  // Non-mac branch: channel-aware colour selection untouched.
  assert.match(body, /icon-nightly\.png/, "nightly colour icon selection must remain");
  assert.match(body, /"icon\.png"/, "stable colour icon selection must remain");
});

test("electron-builder ships the template assets alongside the colour icons", () => {
  const files = require(path.join(ROOT, "package.json")).build.files;
  for (const asset of ["trayTemplate.png", "trayTemplate@2x.png", "icon.png", "icon-nightly.png"]) {
    assert.ok(files.includes(asset), `${asset} missing from build.files`);
  }
});
