import { C64_CHAR_ROM, VIC_PALETTE_RGBA } from "./c64_charset.js";

export const C64_SCREEN_WIDTH = 384;
export const C64_SCREEN_HEIGHT = 272;

const SCREEN_LEFT = 32;
const SCREEN_TOP = 36;
const SCREEN_ROWS = 25;
const SCREEN_COLS = 40;
const BORDER_OFFSET = 20;

const VIC_PALETTE_U32 = new Uint32Array(16);
for (let i = 0; i < 16; i++) {
  const [r, g, b, a] = VIC_PALETTE_RGBA[i];
  VIC_PALETTE_U32[i] = (a << 24) | (b << 16) | (g << 8) | r;
}

export function createC64ScreenRenderer(canvas) {
  if (!canvas || typeof canvas.getContext !== "function") return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const imageData = ctx.createImageData(C64_SCREEN_WIDTH, C64_SCREEN_HEIGHT);
  const pixels = new Uint32Array(imageData.data.buffer);

  function render({ screenRam, colorRam, border, background = 0 }) {
    if (!screenRam || !colorRam || !border) return;
    const bgPixel = VIC_PALETTE_U32[background & 0x0f];

    for (let y = 0; y < C64_SCREEN_HEIGHT; y++) {
      const bdrColorIdx = border[BORDER_OFFSET + y] & 0x0f;
      const bdrPixel = VIC_PALETTE_U32[bdrColorIdx];
      const inScreenY = y >= SCREEN_TOP && y < SCREEN_TOP + SCREEN_ROWS * 8;
      const screenY = y - SCREEN_TOP;
      const textRow = screenY >> 3;
      const charRow = screenY & 7;
      const dstIdx = y * C64_SCREEN_WIDTH;

      if (!inScreenY) {
        for (let x = 0; x < C64_SCREEN_WIDTH; x++) {
          pixels[dstIdx + x] = bdrPixel;
        }
        continue;
      }

      for (let x = 0; x < SCREEN_LEFT; x++) {
        pixels[dstIdx + x] = bdrPixel;
      }

      const rowBase = textRow * SCREEN_COLS;
      let pixelOffset = dstIdx + SCREEN_LEFT;
      for (let col = 0; col < SCREEN_COLS; col++) {
        const charCode = screenRam[rowBase + col];
        const fgColorIdx = colorRam[rowBase + col] & 0x0f;
        const fgPixel = VIC_PALETTE_U32[fgColorIdx];
        const glyphByte = C64_CHAR_ROM[charCode * 8 + charRow];

        for (let bit = 7; bit >= 0; bit--) {
          pixels[pixelOffset++] = (glyphByte >> bit) & 1 ? fgPixel : bgPixel;
        }
      }

      for (let x = 0; x < SCREEN_LEFT; x++) {
        pixels[pixelOffset + x] = bdrPixel;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  return {
    width: C64_SCREEN_WIDTH,
    height: C64_SCREEN_HEIGHT,
    render,
  };
}
