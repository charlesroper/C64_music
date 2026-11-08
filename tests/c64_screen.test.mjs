import assert from "node:assert/strict";
import test from "node:test";
import { C64_CHAR_ROM, VIC_PALETTE_RGBA } from "../src/c64_charset.js";
import { C64_SCREEN_HEIGHT, C64_SCREEN_WIDTH, createC64ScreenRenderer } from "../src/c64_screen.js";

function createFakeCanvas() {
  let image = null;
  const context = {
    createImageData(width, height) {
      image = {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      };
      return image;
    },
    putImageData(source) {
      image = source;
    },
  };
  return {
    getContext(type) {
      assert.equal(type, "2d");
      return context;
    },
    getImage() {
      return image;
    },
  };
}

function pixelBytes(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return image.data.subarray(offset, offset + 4);
}

function paletteBytes(colorIndex) {
  return new Uint8ClampedArray(VIC_PALETTE_RGBA[colorIndex]);
}

test("shared C64 screen renderer draws border, glyph rows and colour RAM", () => {
  const canvas = createFakeCanvas();
  const renderer = createC64ScreenRenderer(canvas);
  assert.equal(renderer.width, C64_SCREEN_WIDTH);
  assert.equal(renderer.height, C64_SCREEN_HEIGHT);

  const screenRam = new Uint8Array(1000).fill(0x20);
  const colorRam = new Uint8Array(1000).fill(14);
  const border = new Uint8Array(312).fill(6);
  screenRam[0] = 1;
  colorRam[0] = 1;
  screenRam[40] = 1;
  colorRam[40] = 2;

  renderer.render({ screenRam, colorRam, border });
  const image = canvas.getImage();
  assert.ok(image, "renderer must paint an image");
  assert.equal(image.width, C64_SCREEN_WIDTH);
  assert.equal(image.height, C64_SCREEN_HEIGHT);

  assert.deepEqual(pixelBytes(image, 0, 0), paletteBytes(6));

  const glyph = C64_CHAR_ROM[1 * 8];
  for (let bit = 0; bit < 8; bit++) {
    const set = Boolean(glyph & (1 << (7 - bit)));
    const expected = set ? paletteBytes(1) : paletteBytes(0);
    assert.deepEqual(pixelBytes(image, 32 + bit, 36), expected);
  }

  const secondRowGlyph = C64_CHAR_ROM[1 * 8];
  for (let bit = 0; bit < 8; bit++) {
    const set = Boolean(secondRowGlyph & (1 << (7 - bit)));
    const expected = set ? paletteBytes(2) : paletteBytes(0);
    assert.deepEqual(pixelBytes(image, 32 + bit, 44), expected);
  }
});

test("shared C64 screen renderer reuses its image buffer", () => {
  const canvas = createFakeCanvas();
  const renderer = createC64ScreenRenderer(canvas);
  const screenRam = new Uint8Array(1000).fill(0x20);
  const colorRam = new Uint8Array(1000).fill(14);
  const border = new Uint8Array(312).fill(6);

  renderer.render({ screenRam, colorRam, border });
  const first = canvas.getImage();
  renderer.render({ screenRam, colorRam, border });
  const second = canvas.getImage();
  assert.equal(second, first, "the renderer must not allocate a new ImageData per frame");
});
