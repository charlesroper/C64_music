#!/usr/bin/env node
// Repeatable Chromium layout check across desktop, two-column and mobile viewports.
// Uses playwright-core + resolveBrowserEngine so ad-hoc cache scanning is unnecessary.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { resolveBrowserEngine } from "./browser_engines.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 980, height: 1600 },
  { width: 390, height: 844 },
];
const MIME_TYPES = {
  ".asm": "text/plain",
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mjs": "text/javascript",
  ".txt": "text/plain",
  ".wasm": "application/wasm",
};

function createStaticServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const relativePath = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = path.resolve(ROOT, `.${decodeURIComponent(relativePath)}`);
      if (!filePath.startsWith(ROOT)) {
        response.writeHead(403);
        response.end("forbidden");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
}

async function run() {
  const { path: executablePath, warning } = resolveBrowserEngine("chromium");
  if (warning) console.warn(warning);

  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/?skipBoot=1`;
  const browser = await chromium.launch({ executablePath, headless: true });

  try {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({ viewport });
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      const measure = () =>
        page.evaluate(() =>
          [...document.querySelectorAll(".voice-card")].map((card, index) => {
            const regs = card.querySelector(".voice-regs");
            const rr = regs.getBoundingClientRect();
            const spans = [...regs.children].map((el) => {
              const r = el.getBoundingClientRect();
              return {
                x: Math.round(r.left - rr.left),
                y: Math.round(r.top - rr.top),
                w: Math.round(r.width),
                h: Math.round(r.height),
              };
            });
            return {
              card: index,
              w: Math.round(rr.width),
              h: Math.round(rr.height),
              scrollW: regs.scrollWidth,
              clientW: regs.clientWidth,
              spans,
            };
          }),
        );

      const idle = await measure();
      await page.evaluate(() => {
        const set = (id, v) => {
          const el = document.getElementById(id);
          if (el) el.textContent = v;
        };
        for (let i = 0; i < 3; i += 1) {
          set(`v${i}-wf`, "TRI+PUL");
          set(`v${i}-pw`, "$FFF");
          set(`v${i}-adsr`, "15/15/15/15");
          set(`v${i}-env`, "FF");
        }
        set("flt-fc", "$7FF (10030Hz)");
        set("flt-res", "15");
        set("flt-rout", "V1+V2+V3");
        set("flt-vol", "15");
      });
      const worst = await measure();

      assert.deepEqual(
        worst,
        idle,
        `Oscilloscope footer geometry shifted at ${viewport.width}x${viewport.height}`,
      );
      for (const entry of worst) {
        assert.ok(
          entry.scrollW <= entry.clientW,
          `Overflow in card ${entry.card} at ${viewport.width}x${viewport.height}: ${entry.scrollW} > ${entry.clientW}`,
        );
      }
      console.log(`PASS ${viewport.width}x${viewport.height}: .voice-regs locked across 4 cards`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
