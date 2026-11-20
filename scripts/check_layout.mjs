#!/usr/bin/env node
// Release gate, not a CI job: asserts font-sensitive Workbench View layout
// across desktop, two-column and mobile viewports using real Chromium.
// See docs/agents/browser-verification.md and CODING_STANDARDS Rule 6.4.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { resolveBrowserEngine } from "./browser_engines.mjs";
import { createStaticServer, openWorkbenchPage } from "./browser_harness.mjs";

const VIEWPORTS = [
  { width: 1440, height: 900, expectAllGamesFit: true, minMetaFit: 4 },
  { width: 1280, height: 800, expectAllGamesFit: true },
  { width: 1280, height: 720, minTrackHeight: 90 },
  { width: 1280, height: 600, maxPanelHeight: 900 },
  { width: 980, height: 1600, expectAllGamesFit: true },
  { width: 390, height: 844, expectAllGamesFit: true, minMetaFit: 5, checkMobileTabs: true },
];

async function checkVoiceFooterLock(page, viewport) {
  const measure = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".voiceCard")].map((card, index) => {
        const regs = card.querySelector(".voiceCard-regs");
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
}

async function checkLeftPanel(page, viewport) {
  const metrics = await page.evaluate(() => {
    const panelLeft = document.querySelector(".panel--left");
    const panelCenter = document.querySelector(".panel--center");
    const panelRight = document.querySelector(".panel--right");
    const games = document.getElementById("game-list");
    const tracks = document.getElementById("track-list");
    return {
      panelLeftH: panelLeft.clientHeight,
      panelCenterH: panelCenter.clientHeight,
      panelRightH: panelRight.clientHeight,
      gamesClientH: games.clientHeight,
      gamesScrollH: games.scrollHeight,
      tracksClientH: tracks.clientHeight,
      tracksScrollH: tracks.scrollHeight,
    };
  });

  if (viewport.expectAllGamesFit) {
    assert.ok(
      metrics.gamesScrollH <= metrics.gamesClientH,
      `Source Files Panel must fit without scroll at ${viewport.width}x${viewport.height} (${metrics.gamesScrollH} > ${metrics.gamesClientH})`,
    );
  }
  if (viewport.minTrackHeight) {
    assert.ok(
      metrics.tracksClientH >= viewport.minTrackHeight,
      `Tunes Panel fell below ${viewport.minTrackHeight}px at ${viewport.width}x${viewport.height} (${metrics.tracksClientH})`,
    );
  }
  if (viewport.maxPanelHeight) {
    for (const [name, height] of [
      ["panel--left", metrics.panelLeftH],
      ["panel--center", metrics.panelCenterH],
      ["panel--right", metrics.panelRightH],
    ]) {
      assert.ok(
        height <= viewport.maxPanelHeight,
        `.${name} stretched past ${viewport.maxPanelHeight}px at ${viewport.width}x${viewport.height} (${height}px)`,
      );
    }
  }
  if (viewport.minMetaFit) {
    const count = await page.locator(".sourceFiles-item").count();
    let fitCount = 0;
    for (let i = 0; i < count; i += 1) {
      await page.locator(".sourceFiles-item").nth(i).click();
      const fits = await page.evaluate(() => {
        const card = document.getElementById("game-meta-card");
        return card.scrollHeight <= card.clientHeight;
      });
      if (fits) fitCount += 1;
    }
    assert.ok(
      fitCount >= viewport.minMetaFit,
      `Expected at least ${viewport.minMetaFit} of ${count} metadata cards to fit without scroll at ${viewport.width}x${viewport.height}, got ${fitCount}`,
    );
  }
  if (viewport.checkMobileTabs) {
    assert.ok(
      metrics.tracksClientH <= 340,
      `All-panels mobile .tunesPanel should stay bounded (${metrics.tracksClientH}px)`,
    );
    await page.locator('.mobileTabs-button[data-mobile-tab="tunes"]').click();
    await page.locator(".sourceFiles-item").nth(2).click();
    const tunesTab = await page.evaluate(() => {
      const tracks = document.getElementById("track-list");
      return { clientH: tracks.clientHeight, scrollH: tracks.scrollHeight };
    });
    assert.ok(
      tunesTab.scrollH <= tunesTab.clientH,
      `Mobile Tunes tab .tunesPanel must not nest-scroll (${tunesTab.scrollH} > ${tunesTab.clientH})`,
    );
  }
}

async function run() {
  const { path: executablePath, warning } = resolveBrowserEngine("chromium");
  if (warning) console.warn(warning);

  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/?skipBoot=1`;
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  });

  try {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    for (const viewport of VIEWPORTS) {
      const page = await openWorkbenchPage(context, baseUrl, viewport);
      await checkVoiceFooterLock(page, viewport);
      await checkLeftPanel(page, viewport);
      console.log(`PASS ${viewport.width}x${viewport.height}: layout and footer checks.`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

if (import.meta.main) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
