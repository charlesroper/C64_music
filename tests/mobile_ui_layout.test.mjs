import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createWorkbenchView } from "../src/workbench_view.js";
import { createBrowserHarness, createFakePlayer } from "./helpers/browser_harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Parse CSS into ordered rules with optional @media condition so we can compute
// active cascaded declarations for any viewport (e.g. 375x812 iPhone vs 1440x900 desktop).
function parseStylesheet(cssText) {
  const clean = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];

  function parseBlocks(src, mediaQuery = null) {
    let i = 0;
    while (i < src.length) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (i >= src.length) break;

      const openBrace = src.indexOf("{", i);
      if (openBrace === -1) break;
      const header = src.slice(i, openBrace).trim();

      let depth = 1;
      let j = openBrace + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const body = src.slice(openBrace + 1, j - 1);

      if (header.startsWith("@media")) {
        const cond = header.replace(/^@media\s+/, "").trim();
        parseBlocks(body, cond);
      } else if (!header.startsWith("@")) {
        const decls = {};
        for (const stmt of body.split(";")) {
          const colon = stmt.indexOf(":");
          if (colon === -1) continue;
          const prop = stmt.slice(0, colon).trim().toLowerCase();
          const val = stmt
            .slice(colon + 1)
            .replace(/!important/gi, "")
            .trim();
          if (prop) decls[prop] = val;
        }
        for (const rawSel of header.split(",")) {
          const sel = rawSel.trim();
          if (sel) rules.push({ selector: sel, mediaQuery, decls });
        }
      }
      i = j;
    }
  }

  parseBlocks(clean, null);
  return rules;
}

function matchesMedia(mediaQuery, { width, height }) {
  if (!mediaQuery) return true;
  const maxW = mediaQuery.match(/\(max-width:\s*(\d+)px\)/);
  if (maxW && !(width <= Number(maxW[1]))) return false;
  const minW = mediaQuery.match(/\(min-width:\s*(\d+)px\)/);
  if (minW && !(width >= Number(minW[1]))) return false;
  const maxH = mediaQuery.match(/\(max-height:\s*(\d+)px\)/);
  if (maxH && !(height <= Number(maxH[1]))) return false;
  const minH = mediaQuery.match(/\(min-height:\s*(\d+)px\)/);
  if (minH && !(height >= Number(minH[1]))) return false;
  return true;
}

function computeStyleForSelector(rules, targetSelectors, viewport) {
  const selectorSet = new Set(Array.isArray(targetSelectors) ? targetSelectors : [targetSelectors]);
  const computed = {};
  for (const rule of rules) {
    if (!matchesMedia(rule.mediaQuery, viewport)) continue;
    if (selectorSet.has(rule.selector)) {
      for (const [k, v] of Object.entries(rule.decls)) {
        if (k === "overflow") {
          computed.overflow = v;
          computed["overflow-x"] = v;
          computed["overflow-y"] = v;
        } else {
          computed[k] = v;
        }
      }
    }
  }
  return computed;
}

test("mobile 375x812 CSS cascade enables vertical scrolling, single-column layout, bounded code/track heights, and anti-zoom inputs while preserving 3-column desktop", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  const rules = parseStylesheet(css);

  assert.match(
    html,
    /<meta\s+name="viewport"\s+content="[^"]*width=device-width[^"]*"/i,
    "index.html must include responsive viewport meta tag",
  );

  const desktop = { width: 1440, height: 900 };
  const mobile = { width: 375, height: 812 };

  // 1. Desktop keeps studio 3-column viewport lock; mobile unlocks vertical page scroll
  const deskBody = computeStyleForSelector(rules, ["html", "body"], desktop);
  assert.equal(deskBody["overflow-y"], "hidden");

  const mobBody = computeStyleForSelector(rules, ["html", "body"], mobile);
  assert.equal(
    mobBody["overflow-y"],
    "auto",
    "Mobile html/body must allow vertical scrolling (overflow-y: auto)",
  );
  assert.equal(
    mobBody["overflow-x"],
    "hidden",
    "Mobile html/body must prevent horizontal page overflow (overflow-x: hidden)",
  );

  const mobShell = computeStyleForSelector(rules, [".app-shell"], mobile);
  assert.equal(mobShell.height, "auto", "Mobile .app-shell must allow vertical growth");
  assert.equal(mobShell.width, "100%", "Mobile .app-shell must use 100% width instead of 100vw");

  // 2. Workbench grid collapses from 3 columns on desktop to 1 column on 375px phone
  const deskGrid = computeStyleForSelector(rules, [".workbench-grid"], desktop);
  assert.match(deskGrid["grid-template-columns"], /320px/);

  const mobGrid = computeStyleForSelector(rules, [".workbench-grid"], mobile);
  assert.ok(
    mobGrid["grid-template-columns"] === "1fr" ||
      mobGrid["grid-template-columns"] === "minmax(0, 1fr)",
    `Mobile .workbench-grid must collapse to a single column, got: ${mobGrid["grid-template-columns"]}`,
  );

  // 3. Top bar, transport bar, panel headers, and source toolbar wrap cleanly on 375px phone
  for (const sel of [".top-bar", ".transport-bar", ".panel-header", ".source-toolbar"]) {
    const style = computeStyleForSelector(rules, [sel], mobile);
    assert.equal(
      style["flex-wrap"],
      "wrap",
      `Mobile ${sel} must wrap (flex-wrap: wrap) to prevent off-screen clipping`,
    );
  }

  // 4. Scopes grid and modal columns collapse to 1 column on narrow 375px phones
  const mobScopes = computeStyleForSelector(rules, [".scopes-grid"], mobile);
  assert.equal(
    mobScopes["grid-template-columns"],
    "1fr",
    "Narrow mobile .scopes-grid must stack 1fr so voice headers and waveforms fit",
  );

  const mobModalCols = computeStyleForSelector(rules, [".modal-cols"], mobile);
  assert.equal(
    mobModalCols["grid-template-columns"],
    "1fr",
    "Mobile .modal-cols must stack 1fr so assembler docs are readable",
  );

  // 5. Track list and .ASM source viewer have bounded mobile heights (preventing 40,000px scroll)
  const mobTrackList = computeStyleForSelector(rules, [".track-list"], mobile);
  assert.ok(
    mobTrackList["max-height"] && mobTrackList["max-height"] !== "none",
    "Mobile .track-list must set a bounded max-height",
  );

  const mobSourceViewer = computeStyleForSelector(rules, [".source-viewer"], mobile);
  assert.ok(
    mobSourceViewer.height || mobSourceViewer["max-height"],
    "Mobile .source-viewer must constrain height so 2,300 .asm lines do not stretch the page",
  );

  // 6. Touch targets (>= 34px) and iOS Safari 16px anti-zoom on inputs/selects
  const mobTransportBtn = computeStyleForSelector(
    rules,
    ["button", ".transport-bar button"],
    mobile,
  );
  assert.ok(
    parseInt(mobTransportBtn["min-height"] || "0", 10) >= 36,
    `Mobile transport buttons must be >= 36px tall, got ${mobTransportBtn["min-height"]}`,
  );

  const mobKeyBtn = computeStyleForSelector(rules, ["button", ".key-btn"], mobile);
  assert.ok(
    parseInt(mobKeyBtn["min-height"] || "0", 10) >= 34,
    `Mobile C64 keypad buttons must be >= 34px tall, got ${mobKeyBtn["min-height"]}`,
  );

  for (const inputSel of [".symbol-select", ".source-search", ".source-editor"]) {
    const st = computeStyleForSelector(rules, [inputSel], mobile);
    assert.equal(
      st["font-size"],
      "16px",
      `Mobile ${inputSel} should use 16px font-size to prevent iOS Safari auto-zoom on focus`,
    );
  }

  // 7. Mobile hardware controls: slider spans full width, docs & story buttons form a 2-up row
  const mobSliderGroup = computeStyleForSelector(rules, ["#hw-group-digi"], mobile);
  assert.equal(
    mobSliderGroup["grid-column"],
    "1 / -1",
    "Mobile #hw-group-digi must span all columns (1 / -1) so the slider fills the entire width",
  );

  const mobHwToggle = computeStyleForSelector(rules, [".hw-toggle"], mobile);
  assert.ok(
    parseInt(mobHwToggle["min-height"] || "0", 10) >= 36,
    "Mobile hardware toggles must be >= 36px tall",
  );

  const mobDocsBtn = computeStyleForSelector(rules, ["#btn-directives-modal"], mobile);
  const mobStoryBtn = computeStyleForSelector(rules, ["#btn-narrative-modal"], mobile);
  const mobStatsBtn = computeStyleForSelector(rules, ["#btn-stats-nerds"], mobile);
  assert.equal(mobDocsBtn.width, "100%", "Mobile docs button must be width: 100%");
  assert.equal(mobStoryBtn.width, "100%", "Mobile story button must be width: 100%");
  assert.equal(mobStatsBtn.width, "100%", "Mobile stats button must be width: 100%");
  assert.ok(
    parseInt(mobDocsBtn["min-height"] || "0", 10) >= 36,
    "Mobile docs button must be >= 36px tall",
  );
  assert.ok(
    parseInt(mobStoryBtn["min-height"] || "0", 10) >= 36,
    "Mobile story button must be >= 36px tall",
  );
  assert.ok(
    parseInt(mobStatsBtn["min-height"] || "0", 10) >= 36,
    "Mobile stats button must be >= 36px tall",
  );

  // 8. Voice 3 button toggle and dot have bright glowing orange/yellow (not dim brown)
  const dotV2Style = computeStyleForSelector(rules, [".dot-v2"], mobile);
  assert.match(dotV2Style.background, /var\(--accent-yellow\)/);
  assert.match(dotV2Style["box-shadow"], /var\(--accent-yellow\)/);
  assert.match(dotV2Style["box-shadow"], /#ffffff/);

  const v3FollowStyle = computeStyleForSelector(
    rules,
    ['.legend-chip[data-voice="2"].active-followed'],
    mobile,
  );
  assert.match(v3FollowStyle["border-color"], /var\(--accent-yellow\)/);
  assert.match(v3FollowStyle.background, /rgba\(255,\s*170,\s*0/);
});

test("booting SPA on a 375px mobile viewport auto-hides crowded HUD tags, exposes mobile view tabs, and switches to ASM tab on PC jump", async () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(
    html,
    /id="mobile-view-tabs"/,
    "index.html must render #mobile-view-tabs for quick mobile panel switching",
  );

  const harness = createBrowserHarness({
    viewport: { width: 375, height: 812 },
    hardwareSampleRate: 48000,
  });
  const { elementsById, scrolledElements } = harness;
  const tabButtons = Array.from(globalThis.document.querySelectorAll("[data-mobile-tab]"));
  const legendChips = Array.from(globalThis.document.querySelectorAll(".legend-chip"));

  let view = null;
  try {
    const player = createFakePlayer();
    view = createWorkbenchView({
      document: globalThis.document,
      elements: elementsById,
      player,
    });
    view.selectGameAndTrack("wizball.asm", "wiz-title", false);
    view.renderTelemetry(player.getTelemetry());

    // 1. On 375px phones, HUD Row Guide defaults to hidden so C64 40x25 screen is legible
    assert.equal(elementsById.get("chk-hud-overlay").checked, false);
    assert.equal(elementsById.get("hud-guide-overlay").classList.contains("hidden"), true);

    // 2. Mobile view tabs switch workbench-grid[data-mobile-view]
    const grid = elementsById.get("workbench-grid");
    assert.ok(tabButtons.length >= 4, "Expected mobile tabs (all, monitor, tunes, asm)");

    const monitorTab = tabButtons.find((b) => b.dataset.mobileTab === "monitor");
    monitorTab.click();
    assert.equal(grid.dataset.mobileView, "monitor");

    // 3. Clicking Voice 1 PC tag while on "monitor" tab switches mobileView to "asm" and scrolls
    const v0Pc = elementsById.get("v0-pc");
    assert.ok(Number(v0Pc.dataset.line) > 0, "Expected v0-pc to carry active .asm line number");
    v0Pc.click();
    assert.equal(
      grid.dataset.mobileView,
      "asm",
      "Tapping PC0 tag on mobile monitor view must reveal the ASM panel",
    );
    assert.ok(scrolledElements.length > 0, "Expected scrollIntoView on target ASM line");

    // 4. Follow Voice starts unchecked by default, but clicking a voice chip selects voice and enables it
    const chkFollow = elementsById.get("chk-follow-pc");
    assert.equal(chkFollow.checked, false, "Follow Voice must start unchecked by default");
    const v1Chip = legendChips.find((c) => c.dataset.voice === "1");
    assert.ok(v1Chip, "Expected Voice 2 legend chip");
    v1Chip.click();
    assert.equal(chkFollow.checked, true, "Clicking a voice chip must activate Follow Voice");
    assert.equal(
      v1Chip.classList.contains("active-followed"),
      true,
      "Voice 2 chip must be active-followed",
    );

    // 5. Following a voice adds high-visibility .pc-followed highlight to active source line
    view.renderTelemetry(player.getTelemetry());
    const v1LineNo = Number(elementsById.get("v1-pc").dataset.line || "0");
    assert.ok(v1LineNo > 0, "Expected Voice 2 line number on v1-pc");
    const followedEl = elementsById.get(`asm-L${v1LineNo}`);
    assert.ok(followedEl, "Expected an active .asm-line element");
    assert.equal(
      followedEl.classList.contains("pc-followed"),
      true,
      "Followed line must carry .pc-followed",
    );
    assert.equal(
      followedEl.classList.contains("pc-v1"),
      true,
      ".pc-followed must match selected Voice 2",
    );

    // 6. DRM chip switches to arkadrum.asm and tapping V1/V2/V3 switches back to arkanoid.asm
    const gameList = elementsById.get("game-list");
    const arkadrumItem = gameList.children.find((c) => c.innerHTML?.includes("arkadrum.asm"));
    assert.ok(arkadrumItem, "Expected arkadrum.asm in game list");
    arkadrumItem.click();
    view.renderTelemetry(player.getTelemetry());

    const drmChip = legendChips.find((c) => c.dataset.voice === "seq");
    const v3Chip = legendChips.find((c) => c.dataset.voice === "2");
    assert.ok(drmChip, "Expected DRM chip");
    assert.ok(v3Chip, "Expected Voice 3 chip");
    assert.equal(
      drmChip.classList.contains("disabled"),
      false,
      "DRM chip must be enabled for arkadrum.asm",
    );

    // Click DRM chip -> follow DRM in arkadrum.asm
    drmChip.click();
    assert.equal(
      drmChip.classList.contains("active-followed"),
      true,
      "DRM chip must be active-followed",
    );
    assert.equal(
      v3Chip.classList.contains("active-followed"),
      false,
      "Voice 3 chip must not be active-followed",
    );
    assert.match(elementsById.get("source-file-title").textContent, /ARKADRUM\.ASM/);

    // Click Voice 3 chip -> switch back to arkanoid.asm and follow V3
    v3Chip.click();
    assert.equal(
      v3Chip.classList.contains("active-followed"),
      true,
      "Voice 3 chip must be active-followed",
    );
    assert.equal(
      drmChip.classList.contains("active-followed"),
      false,
      "DRM chip must not be active-followed",
    );
    assert.match(elementsById.get("source-file-title").textContent, /ARKANOID\.ASM/);

    // Click DRM chip again -> switch back to arkadrum.asm
    drmChip.click();
    assert.equal(
      drmChip.classList.contains("active-followed"),
      true,
      "DRM chip must be active-followed again",
    );
    assert.match(elementsById.get("source-file-title").textContent, /ARKADRUM\.ASM/);

    // 7. SID Hex Strip renders all 4 labeled voice and filter groups
    const hexCells = elementsById.get("sid-hex-cells");
    assert.equal(hexCells.children.length, 4, "Must render 4 register groups");
    assert.deepEqual(
      hexCells.children.map((group) => group.children[0].textContent),
      ["V1", "V2", "V3", "FILTER + DRUMS (FLT)"],
    );
    assert.ok(elementsById.get("sid-group-v0"), "Must render #sid-group-v0");
    assert.ok(elementsById.get("sid-group-v1"), "Must render #sid-group-v1");
    assert.ok(elementsById.get("sid-group-v2"), "Must render #sid-group-v2");
    assert.ok(elementsById.get("sid-group-flt"), "Must render #sid-group-flt");
  } finally {
    if (view) view.destroy();
    harness.restoreGlobals();
  }
});

test("laptop 1024x768 and 1100x700 breakpoints enable vertical scrolling, prevent C64 monitor crushing, preserve Panel 2 tunes visibility, and span .ASM source", () => {
  const css = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  const rules = parseStylesheet(css);
  const laptop = { width: 1024, height: 768 };

  const bodyStyle = computeStyleForSelector(rules, ["html", "body"], laptop);
  assert.equal(
    bodyStyle["overflow-y"],
    "auto",
    "Laptop html/body must allow vertical page scrolling",
  );

  const gridStyle = computeStyleForSelector(rules, [".workbench-grid"], laptop);
  assert.match(gridStyle["grid-template-columns"], /310px/);

  const panelCenter = computeStyleForSelector(rules, [".panel-center"], laptop);
  assert.ok(
    parseInt(panelCenter["min-height"] || "0", 10) >= 500,
    "Laptop .panel-center must have min-height >= 500px to prevent C64 monitor squashing",
  );

  const panelLeft = computeStyleForSelector(rules, [".panel-left"], laptop);
  assert.ok(
    parseInt(panelLeft["min-height"] || "0", 10) >= 500,
    "Laptop .panel-left must have min-height >= 500px to keep Panel 2 tunes visible",
  );

  const panelRight = computeStyleForSelector(rules, [".panel-right"], laptop);
  assert.equal(
    panelRight["grid-column"],
    "1 / -1",
    "Laptop .panel-right must span all columns (1 / -1)",
  );
  assert.ok(
    parseInt(panelRight["min-height"] || "0", 10) >= 400,
    "Laptop .panel-right must have min-height >= 400px",
  );
});

test("C64 character ROM contains authentic 8x8 glyphs for all 256 characters with lowercase support and no arithmetic noise hieroglyphs", async () => {
  const { C64_CHAR_ROM } = await import("../src/c64_charset.js");
  assert.equal(C64_CHAR_ROM.length, 256 * 8, "C64_CHAR_ROM must be 2048 bytes (256 * 8)");

  // Verify lowercase 'a' (code 0x61 = 97) is not a solid middle line hieroglyph
  const glyphA = Array.from(C64_CHAR_ROM.slice(97 * 8, 97 * 8 + 8));
  assert.notEqual(
    glyphA[3],
    0xff,
    "Lowercase 'a' must not be replaced with a solid-line hieroglyph",
  );
  assert.equal(glyphA[0], 0x00, "Lowercase 'a' top row must be 0x00");

  // Verify letters 'A'..'Z' ($41..$5A) have non-empty valid rows
  for (let c = 0x41; c <= 0x5a; c++) {
    const rows = Array.from(C64_CHAR_ROM.slice(c * 8, c * 8 + 8));
    const nonZero = rows.filter((r) => r !== 0);
    assert.ok(
      nonZero.length >= 4,
      `Character code ${c} ($${c.toString(16)}) must have a readable letter glyph`,
    );
  }

  // Verify brackets, braces, and vertical bar ($5B, $5D, $7B, $7C, $7D)
  for (const c of [0x5b, 0x5d, 0x7b, 0x7c, 0x7d]) {
    const rows = Array.from(C64_CHAR_ROM.slice(c * 8, c * 8 + 8));
    const nonZero = rows.filter((r) => r !== 0);
    assert.ok(nonZero.length >= 4, `Punctuation code ${c} ($${c.toString(16)}) must be defined`);
  }
});

test("HUD row guide and Follow Voice initial states match markup defaults and stay synchronized on boot", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  // chk-hud-overlay must be unchecked by default, hud-guide-overlay hidden
  assert.match(
    html,
    /<input[^>]*type="checkbox"[^>]*id="chk-hud-overlay"[^>]*>/,
    "HUD Row Guide checkbox must be unchecked by default in index.html",
  );
  assert.match(
    html,
    /<div class="hud-guide-overlay hidden" id="hud-guide-overlay"><\/div>/,
    "HUD Row Guide overlay element must start with 'hidden' class in index.html",
  );

  // chk-follow-pc must be unchecked by default with 'Follow Voice' label
  assert.match(
    html,
    /<input[^>]*type="checkbox"[^>]*id="chk-follow-pc"[^>]*>\s*<span>Follow Voice<\/span>/,
    "Follow Voice checkbox must be unchecked by default in index.html",
  );

  // Interactive voice legend chips must be present with V1 active by default
  assert.match(
    html,
    /class="legend-chip active-followed"[^>]*data-voice="0"/,
    "Voice 1 legend chip must be selected by default",
  );
  assert.match(html, /data-voice="1"/, "Voice 2 legend chip must be present");
  assert.match(html, /data-voice="2"/, "Voice 3 legend chip must be present");
  assert.match(html, /data-voice="seq"/, "Drum sequencer legend chip must be present");
});

test("SID hardware register strip ($D400-$D418) groups voices into labeled sections and stacks responsively on mobile", () => {
  const css = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  const rules = parseStylesheet(css);
  const desktop = { width: 1440, height: 900 };
  const mobile = { width: 375, height: 812 };

  // Desktop styles: full-width strip, four balanced register groups
  const stripDesktop = computeStyleForSelector(rules, [".sid-hex-strip"], desktop);
  assert.equal(
    stripDesktop["grid-column"],
    "1 / -1",
    ".sid-hex-strip must span the full workbench width on wide screens",
  );
  const cellsDesktop = computeStyleForSelector(rules, [".sid-hex-cells"], desktop);
  assert.equal(cellsDesktop.display, "grid", ".sid-hex-cells must be a grid on desktop");
  assert.equal(
    cellsDesktop["grid-template-columns"],
    "repeat(4, minmax(0, 1fr))",
    ".sid-hex-cells must place four balanced groups on wide screens",
  );
  assert.equal(
    cellsDesktop.flex,
    "1 1 auto",
    ".sid-hex-cells must consume the remaining strip width",
  );

  const groupDesktop = computeStyleForSelector(rules, [".sid-hex-group"], desktop);
  assert.equal(
    groupDesktop["justify-content"],
    "space-between",
    ".sid-hex-group must spread its label and registers across the row",
  );

  const groupCells = computeStyleForSelector(rules, [".sid-group-cells"], desktop);
  assert.equal(groupCells.display, "grid", ".sid-group-cells must be a grid");
  assert.equal(groupCells["grid-auto-flow"], "column", "Register cells must run left to right");
  assert.equal(
    groupCells["grid-auto-columns"],
    "minmax(18px, 34px)",
    "Register cells must stretch between 18px and 34px",
  );
  assert.equal(groupCells.flex, "1 1 auto", "Register cells must fill the group's spare width");

  const tablet = { width: 1000, height: 812 };
  const cellsTablet = computeStyleForSelector(rules, [".sid-hex-cells"], tablet);
  assert.equal(
    cellsTablet["grid-template-columns"],
    "repeat(2, minmax(0, 1fr))",
    ".sid-hex-cells must use two balanced groups per row when four would crowd",
  );

  // Mobile styles: column strip with stacked voice groups and no horizontal overflow
  const stripMobile = computeStyleForSelector(rules, [".sid-hex-strip"], mobile);
  assert.equal(
    stripMobile["flex-direction"],
    "column",
    ".sid-hex-strip must switch to column on mobile",
  );
  assert.equal(
    stripMobile["overflow-x"],
    "hidden",
    ".sid-hex-strip must eliminate horizontal scroll on mobile",
  );

  const cellsMobile = computeStyleForSelector(rules, [".sid-hex-cells"], mobile);
  assert.equal(
    cellsMobile["grid-template-columns"],
    "1fr",
    ".sid-hex-cells must stack one full-width group per row on mobile",
  );

  for (const tab of ["monitor", "tunes"]) {
    const hiddenLocator = `.workbench-grid[data-mobile-view="${tab}"] .sid-hex-strip`;
    const stripHidden = computeStyleForSelector(rules, [hiddenLocator], mobile);
    assert.equal(
      stripHidden.display,
      "none",
      `SID strip must stay hidden in the ${tab} mobile tab`,
    );
  }

  const groupMobile = computeStyleForSelector(rules, [".sid-hex-group"], mobile);
  assert.equal(
    groupMobile.width,
    "100%",
    ".sid-hex-group must stack as full-width rows on mobile viewports",
  );

  const viewerDesktop = computeStyleForSelector(rules, [".source-viewer"], desktop);
  assert.equal(
    viewerDesktop.position,
    "relative",
    ".source-viewer must be position: relative for accurate element centering",
  );

  const lineDesktop = computeStyleForSelector(rules, [".asm-line"], desktop);
  assert.equal(
    lineDesktop["min-width"],
    "100%",
    ".asm-line must be min-width: 100% to fill scrollable code viewer",
  );
  assert.equal(lineDesktop["box-sizing"], "border-box", ".asm-line must use border-box sizing");
});

test("Section 4 telemetry items have tabular-nums and fixed ch widths so highlighted numbers sit still without jitter", () => {
  const css = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  const rules = parseStylesheet(css);
  const desktop = { width: 1440, height: 900 };

  const telSummary = computeStyleForSelector(rules, [".telemetry-summary"], desktop);
  assert.equal(
    telSummary["font-variant-numeric"],
    "tabular-nums",
    ".telemetry-summary must enforce tabular-nums",
  );
  assert.equal(
    telSummary["white-space"],
    "nowrap",
    ".telemetry-summary must have white-space: nowrap",
  );

  const telFrame = computeStyleForSelector(rules, ["#tel-frame"], desktop);
  assert.equal(
    telFrame["min-width"],
    "5.5ch",
    "#tel-frame must have fixed min-width: 5.5ch to prevent number jitter",
  );

  const telPc = computeStyleForSelector(rules, ["#tel-pc"], desktop);
  assert.equal(
    telPc["min-width"],
    "5ch",
    "#tel-pc must have fixed min-width: 5ch to prevent hex address jitter",
  );

  const telD418 = computeStyleForSelector(rules, ["#tel-d418"], desktop);
  assert.equal(
    telD418["min-width"],
    "2.5ch",
    "#tel-d418 must have fixed min-width: 2.5ch to prevent drum write jitter",
  );
});

test("source viewer smooth scrolling keeps pace with fast note steps and uses adaptive ease-out on long jumps without jank", async () => {
  const { smoothScrollSourceViewer, cancelViewerSmoothScroll } = await import("../src/app.js");

  const prevPerf = globalThis.performance;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCaf = globalThis.cancelAnimationFrame;

  let nowMs = 1000;
  let scheduledCallbacks = [];
  let nextRafId = 1;

  globalThis.performance = { now: () => nowMs };
  globalThis.requestAnimationFrame = (cb) => {
    const id = nextRafId++;
    scheduledCallbacks.push({ id, cb });
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    scheduledCallbacks = scheduledCallbacks.filter((item) => item.id !== id);
  };

  function advanceTime(deltaMs) {
    nowMs += deltaMs;
    const current = scheduledCallbacks.slice();
    scheduledCallbacks = [];
    for (const item of current) {
      item.cb(nowMs);
    }
  }

  try {
    const viewer = { scrollTop: 100 };

    // 1. Instant scroll mode jumps immediately without scheduling animation frames
    smoothScrollSourceViewer(viewer, 250, { instant: true });
    assert.equal(viewer.scrollTop, 250, "instant: true must set target scrollTop immediately");
    assert.equal(scheduledCallbacks.length, 0, "instant: true must not schedule RAF");

    // 2. Short note step (<= 120px, e.g. 54px note step): completes in 90ms easeOutCubic
    viewer.scrollTop = 100;
    smoothScrollSourceViewer(viewer, 154);
    assert.ok(scheduledCallbacks.length > 0, "Expected RAF scheduled for smooth scroll");

    // At 45ms (halfway through 90ms duration), easeOutCubic is 87.5% complete
    advanceTime(45);
    assert.ok(
      viewer.scrollTop >= 145 && viewer.scrollTop <= 150,
      `Expected fast ease-out tracking near target at halfway mark, got ${viewer.scrollTop}`,
    );

    // At 90ms, scroll settles precisely at target and clears active animation
    advanceTime(45);
    assert.equal(viewer.scrollTop, 154, "Short note step must reach exact targetTop at 90ms");
    assert.equal(scheduledCallbacks.length, 0, "Animation loop must terminate at completion");

    // 3. Long jump (> 500px, e.g. loop return or routine jump across 1200px):
    // Pre-positions within 40px of target immediately to avoid lag, then eases the final 40px in 70ms.
    viewer.scrollTop = 100;
    smoothScrollSourceViewer(viewer, 1300);
    assert.equal(
      viewer.scrollTop,
      1260,
      "Long jump must immediately pre-position within 40px of targetTop to avoid crawling delay",
    );
    advanceTime(35);
    assert.ok(
      viewer.scrollTop > 1260 && viewer.scrollTop < 1300,
      `Final 40px must ease smoothly toward target, got ${viewer.scrollTop}`,
    );
    advanceTime(35);
    assert.equal(viewer.scrollTop, 1300, "Long jump must settle precisely at 1300 after 70ms");
    assert.equal(scheduledCallbacks.length, 0);

    // 4. Backward long jump (e.g. from line 1400 back to line 200, -1200px)
    viewer.scrollTop = 1400;
    smoothScrollSourceViewer(viewer, 200);
    assert.equal(
      viewer.scrollTop,
      240,
      "Backward long jump must pre-position within +40px of targetTop",
    );
    advanceTime(70);
    assert.equal(viewer.scrollTop, 200, "Backward long jump must settle at targetTop");

    // 5. User interaction cancelation: cancelViewerSmoothScroll aborts active RAF
    viewer.scrollTop = 100;
    smoothScrollSourceViewer(viewer, 300);
    assert.ok(scheduledCallbacks.length > 0);
    cancelViewerSmoothScroll();
    assert.equal(
      scheduledCallbacks.length,
      0,
      "cancelViewerSmoothScroll must cancel active RAF loop",
    );
  } finally {
    globalThis.performance = prevPerf;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCaf;
  }
});

test("minimal render CSS hides centre and right panels at phone width", () => {
  const css = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  const rules = parseStylesheet(css);
  const phone = { width: 375, height: 812 };

  for (const selector of [
    "body.render-minimal .panel-center",
    "body.render-minimal .panel-right",
    "body.render-minimal .mobile-view-tabs",
  ]) {
    assert.equal(
      computeStyleForSelector(rules, selector, phone).display,
      "none",
      `${selector} must be hidden in minimal render mode`,
    );
  }

  const grid = computeStyleForSelector(rules, "body.render-minimal .workbench-grid", phone);
  assert.equal(grid["grid-template-columns"], "minmax(0, 720px)");
  assert.equal(grid["justify-content"], "center");
  assert.equal(
    computeStyleForSelector(rules, "body.render-minimal .panel-left", phone).display,
    "flex",
    "The track list panel must stay visible in minimal render mode",
  );
});
