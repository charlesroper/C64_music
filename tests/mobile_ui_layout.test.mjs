import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createWorkbenchView } from "../src/workbench_view.js";
import { createBrowserHarness, createFakePlayer } from "./helpers/browser_harness.mjs";
import {
  computeStyleForExactSelectors,
  loadLinkedStylesheets,
  parseStylesheet,
} from "./helpers/stylesheets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadLinkedRules() {
  return parseStylesheet(loadLinkedStylesheets().cssText);
}

test("mobile 375x812 CSS cascade enables vertical scrolling, single-column layout, bounded code/track heights, and anti-zoom inputs while preserving 3-column desktop", () => {
  const { html, cssText: css } = loadLinkedStylesheets();
  const rules = parseStylesheet(css);

  assert.match(
    html,
    /<meta\s+name="viewport"\s+content="[^"]*width=device-width[^"]*"/i,
    "index.html must include responsive viewport meta tag",
  );

  const desktop = { width: 1440, height: 900 };
  const mobile = { width: 375, height: 812 };

  // 1. Desktop keeps studio 3-column viewport lock; mobile unlocks vertical page scroll
  const deskBody = computeStyleForExactSelectors(rules, ["html", "body"], desktop);
  assert.equal(deskBody["overflow-y"], "hidden");

  const mobBody = computeStyleForExactSelectors(rules, ["html", "body"], mobile);
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

  const mobShell = computeStyleForExactSelectors(rules, [".app-shell"], mobile);
  assert.equal(mobShell.height, "auto", "Mobile .app-shell must allow vertical growth");
  assert.equal(mobShell.width, "100%", "Mobile .app-shell must use 100% width instead of 100vw");

  // 2. Workbench grid collapses from 3 columns on desktop to 1 column on 375px phone
  const deskGrid = computeStyleForExactSelectors(rules, [".workbench-grid"], desktop);
  assert.match(deskGrid["grid-template-columns"], /320px/);

  const mobGrid = computeStyleForExactSelectors(rules, [".workbench-grid"], mobile);
  assert.ok(
    mobGrid["grid-template-columns"] === "1fr" ||
      mobGrid["grid-template-columns"] === "minmax(0, 1fr)",
    `Mobile .workbench-grid must collapse to a single column, got: ${mobGrid["grid-template-columns"]}`,
  );

  // 3. Top bar, transport bar, panel headers, and source toolbar wrap cleanly on 375px phone
  for (const sel of [".top-bar", ".transport-bar", ".panel-header", ".source-toolbar"]) {
    const style = computeStyleForExactSelectors(rules, [sel], mobile);
    assert.equal(
      style["flex-wrap"],
      "wrap",
      `Mobile ${sel} must wrap (flex-wrap: wrap) to prevent off-screen clipping`,
    );
  }

  // 4. Scopes grid and modal columns collapse to 1 column on narrow 375px phones
  const mobScopes = computeStyleForExactSelectors(rules, [".scopes-grid"], mobile);
  assert.equal(
    mobScopes["grid-template-columns"],
    "1fr",
    "Narrow mobile .scopes-grid must stack 1fr so voice headers and waveforms fit",
  );

  const mobModalCols = computeStyleForExactSelectors(rules, [".modal-cols"], mobile);
  assert.equal(
    mobModalCols["grid-template-columns"],
    "1fr",
    "Mobile .modal-cols must stack 1fr so assembler docs are readable",
  );

  // 5. Track list and .ASM source viewer have bounded mobile heights (preventing 40,000px scroll)
  const mobTrackList = computeStyleForExactSelectors(rules, [".track-list"], mobile);
  assert.ok(
    mobTrackList["max-height"] && mobTrackList["max-height"] !== "none",
    "Mobile .track-list must set a bounded max-height",
  );

  const mobSourceViewer = computeStyleForExactSelectors(rules, [".source-viewer"], mobile);
  assert.ok(
    mobSourceViewer.height || mobSourceViewer["max-height"],
    "Mobile .source-viewer must constrain height so 2,300 .asm lines do not stretch the page",
  );

  // 6. Touch targets (>= 34px) and iOS Safari 16px anti-zoom on inputs/selects
  const mobTransportBtn = computeStyleForExactSelectors(
    rules,
    ["button", ".transport-bar button"],
    mobile,
  );
  assert.ok(
    parseInt(mobTransportBtn["min-height"] || "0", 10) >= 36,
    `Mobile transport buttons must be >= 36px tall, got ${mobTransportBtn["min-height"]}`,
  );

  const mobKeyBtn = computeStyleForExactSelectors(rules, ["button", ".key-btn"], mobile);
  assert.ok(
    parseInt(mobKeyBtn["min-height"] || "0", 10) >= 34,
    `Mobile C64 keypad buttons must be >= 34px tall, got ${mobKeyBtn["min-height"]}`,
  );

  for (const inputSel of [".symbol-select", ".source-search", ".source-editor"]) {
    const st = computeStyleForExactSelectors(rules, [inputSel], mobile);
    assert.equal(
      st["font-size"],
      "16px",
      `Mobile ${inputSel} should use 16px font-size to prevent iOS Safari auto-zoom on focus`,
    );
  }

  // 7. Mobile hardware controls: slider spans full width, docs & story buttons form a 2-up row
  const mobSliderGroup = computeStyleForExactSelectors(
    rules,
    [".hw-group", ".hw-group-full", ".hw-group-digi"],
    mobile,
  );
  assert.equal(
    mobSliderGroup["grid-column"],
    "1 / -1",
    "Mobile .hw-group-digi must span all columns (1 / -1) so the slider fills the entire width",
  );

  const mobHwToggle = computeStyleForExactSelectors(rules, [".hw-toggle"], mobile);
  assert.ok(
    parseInt(mobHwToggle["min-height"] || "0", 10) >= 36,
    "Mobile hardware toggles must be >= 36px tall",
  );

  const mobActionBtn = computeStyleForExactSelectors(rules, [".hw-action-btn"], mobile);
  const mobStatsBtn = computeStyleForExactSelectors(
    rules,
    [".hw-action-btn", ".hw-action-btn-full"],
    mobile,
  );
  assert.equal(mobActionBtn.width, "100%", "Mobile top-bar action buttons must be width: 100%");
  assert.equal(mobStatsBtn.width, "100%", "Mobile stats button must be width: 100%");
  assert.ok(
    parseInt(mobActionBtn["min-height"] || "0", 10) >= 36,
    "Mobile top-bar action buttons must be >= 36px tall",
  );
  assert.ok(
    parseInt(mobStatsBtn["min-height"] || "0", 10) >= 36,
    "Mobile stats button must be >= 36px tall",
  );

  // 8. Voice 3 button toggle and dot have bright glowing orange/yellow (not dim brown)
  const dotV2Style = computeStyleForExactSelectors(rules, [".dot-v2"], mobile);
  assert.match(dotV2Style.background, /var\(--accent-yellow\)/);
  assert.match(dotV2Style["box-shadow"], /var\(--accent-yellow\)/);
  assert.match(dotV2Style["box-shadow"], /#ffffff/);

  const v3SelectedStyle = computeStyleForExactSelectors(rules, [".legend-chip.selected"], mobile);
  assert.match(v3SelectedStyle["border-color"], /var\(--border-bright\)/);
  assert.doesNotMatch(v3SelectedStyle["border-color"], /var\(--accent-yellow\)/);

  const disabledDotStyle = computeStyleForExactSelectors(
    rules,
    [".legend-chip.disabled .dot-v2"],
    mobile,
  );
  assert.equal(disabledDotStyle["box-shadow"], "none");
  assert.match(disabledDotStyle.background, /var\(--text-dim\)/);

  const v3FollowStyle = computeStyleForExactSelectors(
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

    // 1. On 375px phones, HUD row guide defaults to hidden so C64 40x25 screen is legible
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

    // 4. Follow voice starts unchecked by default, but clicking a voice chip selects voice and enables it
    const chkFollow = elementsById.get("chk-follow-pc");
    assert.equal(chkFollow.checked, false, "Follow voice must start unchecked by default");
    const v1Chip = legendChips.find((c) => c.dataset.voice === "1");
    assert.ok(v1Chip, "Expected Voice 2 legend chip");
    v1Chip.click();
    assert.equal(chkFollow.checked, true, "Clicking a voice chip must activate Follow voice");
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
    assert.equal(elementsById.get("source-file-name").textContent, "arkadrum.asm");

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
    assert.equal(elementsById.get("source-file-name").textContent, "arkanoid.asm");

    // Click DRM chip again -> switch back to arkadrum.asm
    drmChip.click();
    assert.equal(
      drmChip.classList.contains("active-followed"),
      true,
      "DRM chip must be active-followed again",
    );
    assert.equal(elementsById.get("source-file-name").textContent, "arkadrum.asm");

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
  const rules = loadLinkedRules();
  const laptop = { width: 1024, height: 768 };

  const bodyStyle = computeStyleForExactSelectors(rules, ["html", "body"], laptop);
  assert.equal(
    bodyStyle["overflow-y"],
    "auto",
    "Laptop html/body must allow vertical page scrolling",
  );

  const gridStyle = computeStyleForExactSelectors(rules, [".workbench-grid"], laptop);
  assert.match(gridStyle["grid-template-columns"], /310px/);

  const panelCenter = computeStyleForExactSelectors(rules, [".panel-center"], laptop);
  assert.ok(
    parseInt(panelCenter["min-height"] || "0", 10) >= 500,
    "Laptop .panel-center must have min-height >= 500px to prevent C64 monitor squashing",
  );

  const panelLeft = computeStyleForExactSelectors(rules, [".panel-left"], laptop);
  assert.ok(
    parseInt(panelLeft["min-height"] || "0", 10) >= 500,
    "Laptop .panel-left must have min-height >= 500px to keep Panel 2 tunes visible",
  );

  const panelRight = computeStyleForExactSelectors(rules, [".panel-right"], laptop);
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

test("HUD row guide and Follow voice initial states match markup defaults and stay synchronized on boot", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  // chk-hud-overlay must be unchecked by default, hud-guide-overlay hidden
  assert.match(
    html,
    /<input[^>]*type="checkbox"[^>]*id="chk-hud-overlay"[^>]*>/,
    "HUD row guide checkbox must be unchecked by default in index.html",
  );
  assert.match(
    html,
    /<div class="hud-guide-overlay hidden" id="hud-guide-overlay"><\/div>/,
    "HUD row guide overlay element must start with 'hidden' class in index.html",
  );

  // chk-follow-pc must be unchecked by default with 'Follow voice' label
  assert.match(
    html,
    /<input[^>]*type="checkbox"[^>]*id="chk-follow-pc"[^>]*>\s*<span>Follow voice<\/span>/,
    "Follow voice checkbox must be unchecked by default in index.html",
  );

  // Interactive voice legend chips must be present with V1 selected (follow off) and DRM disabled by default
  const legendStart = html.indexOf('<div class="pc-legend"');
  const legendEnd = html.indexOf("</div>", legendStart);
  const legendSlice =
    legendStart >= 0 && legendEnd > legendStart ? html.slice(legendStart, legendEnd) : "";
  assert.match(
    legendSlice,
    /class="legend-chip selected"[^>]*data-voice="0"/,
    "Voice 1 legend chip must start selected without active-followed by default",
  );
  assert.doesNotMatch(
    legendSlice,
    /class="legend-chip[^"]*active-followed/,
    "No voice legend chip may start active-followed in static markup",
  );
  assert.match(legendSlice, /data-voice="1"/, "Voice 2 legend chip must be present");
  assert.match(legendSlice, /data-voice="2"/, "Voice 3 legend chip must be present");
  assert.match(
    legendSlice,
    /class="legend-chip disabled"[^>]*data-voice="seq"/,
    "Drum sequencer legend chip must start disabled in static markup",
  );
});

test("SID hardware register strip ($D400-$D418) groups voices into labeled sections and stacks responsively on mobile", () => {
  const rules = loadLinkedRules();
  const desktop = { width: 1440, height: 900 };
  const mobile = { width: 375, height: 812 };

  // Desktop styles: full-width strip, four balanced register groups
  const stripDesktop = computeStyleForExactSelectors(rules, [".sid-hex-strip"], desktop);
  assert.equal(
    stripDesktop["grid-column"],
    "1 / -1",
    ".sid-hex-strip must span the full workbench width on wide screens",
  );
  const cellsDesktop = computeStyleForExactSelectors(rules, [".sid-hex-cells"], desktop);
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

  const groupDesktop = computeStyleForExactSelectors(rules, [".sid-hex-group"], desktop);
  assert.equal(
    groupDesktop["justify-content"],
    "space-between",
    ".sid-hex-group must spread its label and registers across the row",
  );

  const groupCells = computeStyleForExactSelectors(rules, [".sid-group-cells"], desktop);
  assert.equal(groupCells.display, "grid", ".sid-group-cells must be a grid");
  assert.equal(groupCells["grid-auto-flow"], "column", "Register cells must run left to right");
  assert.equal(
    groupCells["grid-auto-columns"],
    "minmax(18px, 34px)",
    "Register cells must stretch between 18px and 34px",
  );
  assert.equal(groupCells.flex, "1 1 auto", "Register cells must fill the group's spare width");

  const tablet = { width: 1000, height: 812 };
  const cellsTablet = computeStyleForExactSelectors(rules, [".sid-hex-cells"], tablet);
  assert.equal(
    cellsTablet["grid-template-columns"],
    "repeat(2, minmax(0, 1fr))",
    ".sid-hex-cells must use two balanced groups per row when four would crowd",
  );

  // Mobile styles: column strip with stacked voice groups and no horizontal overflow
  const stripMobile = computeStyleForExactSelectors(rules, [".sid-hex-strip"], mobile);
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

  const cellsMobile = computeStyleForExactSelectors(rules, [".sid-hex-cells"], mobile);
  assert.equal(
    cellsMobile["grid-template-columns"],
    "1fr",
    ".sid-hex-cells must stack one full-width group per row on mobile",
  );

  for (const tab of ["monitor", "tunes"]) {
    const hiddenLocator = `.workbench-grid[data-mobile-view="${tab}"] .sid-hex-strip`;
    const stripHidden = computeStyleForExactSelectors(rules, [hiddenLocator], mobile);
    assert.equal(
      stripHidden.display,
      "none",
      `SID strip must stay hidden in the ${tab} mobile tab`,
    );
  }

  const groupMobile = computeStyleForExactSelectors(rules, [".sid-hex-group"], mobile);
  assert.equal(
    groupMobile.width,
    "100%",
    ".sid-hex-group must stack as full-width rows on mobile viewports",
  );

  const viewerDesktop = computeStyleForExactSelectors(rules, [".source-viewer"], desktop);
  assert.equal(
    viewerDesktop.position,
    "relative",
    ".source-viewer must be position: relative for accurate element centering",
  );

  const lineDesktop = computeStyleForExactSelectors(rules, [".asm-line"], desktop);
  assert.equal(
    lineDesktop["min-width"],
    "100%",
    ".asm-line must be min-width: 100% to fill scrollable code viewer",
  );
  assert.equal(lineDesktop["box-sizing"], "border-box", ".asm-line must use border-box sizing");
});

test("Section 4 telemetry items have tabular-nums and fixed ch widths so highlighted numbers sit still without jitter", () => {
  const rules = loadLinkedRules();
  const desktop = { width: 1440, height: 900 };

  const telSummary = computeStyleForExactSelectors(rules, [".telemetry-summary"], desktop);
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

  const telFrame = computeStyleForExactSelectors(rules, [".tel-value-frame"], desktop);
  assert.equal(
    telFrame["min-width"],
    "5.5ch",
    ".tel-value-frame must have fixed min-width: 5.5ch to prevent number jitter",
  );

  const telPc = computeStyleForExactSelectors(rules, [".tel-value-pc"], desktop);
  assert.equal(
    telPc["min-width"],
    "5ch",
    ".tel-value-pc must have fixed min-width: 5ch to prevent hex address jitter",
  );

  const telD418 = computeStyleForExactSelectors(rules, [".tel-value-d418"], desktop);
  assert.equal(
    telD418["min-width"],
    "2.5ch",
    ".tel-value-d418 must have fixed min-width: 2.5ch to prevent drum write jitter",
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

test("help panel becomes a bottom sheet at phone width", () => {
  const rules = loadLinkedRules();
  const phone = computeStyleForExactSelectors(rules, ".hw-help-panel", { width: 390, height: 844 });
  assert.equal(phone.inset, "auto 12px calc(12px + env(safe-area-inset-bottom)) 12px");
  assert.equal(phone.width, "auto");
  assert.equal(phone.transform, "none");

  const desktop = computeStyleForExactSelectors(rules, ".hw-help-panel", {
    width: 1440,
    height: 900,
  });
  assert.equal(desktop.inset, "50% auto auto 50%");
  assert.equal(desktop.transform, "translate(-50%, -50%)");
});

test("left panel stretches to match center panel on 2-column layouts, prioritises Source Files Panel, and sizes bottom metadata card legibly", () => {
  const rules = loadLinkedRules();

  for (const viewport of [
    { width: 980, height: 1600 },
    { width: 1440, height: 900 },
  ]) {
    const panelLeft = computeStyleForExactSelectors(rules, [".panel-left"], viewport);
    assert.ok(
      !panelLeft.height || panelLeft.height === "auto",
      `${viewport.width}x${viewport.height} .panel-left must stretch with row height, not use fixed height (${panelLeft.height})`,
    );

    const gameList = computeStyleForExactSelectors(rules, [".game-list"], viewport);
    assert.equal(
      gameList.flex,
      "0 1 auto",
      `${viewport.width}x${viewport.height} .game-list must use flex: 0 1 auto to fit all source files first`,
    );
    assert.equal(
      gameList["max-height"],
      "none",
      `${viewport.width}x${viewport.height} .game-list must uncap max-height`,
    );
    assert.equal(
      gameList["min-height"],
      "0",
      `${viewport.width}x${viewport.height} .game-list must set min-height: 0 so it can shrink on very short viewports`,
    );

    const trackList = computeStyleForExactSelectors(rules, [".track-list"], viewport);
    assert.equal(
      trackList.flex,
      "1 1 0",
      `${viewport.width}x${viewport.height} .track-list must use flex: 1 1 0 to fill remaining space`,
    );
    assert.equal(
      trackList["max-height"],
      "none",
      `${viewport.width}x${viewport.height} .track-list must uncap max-height`,
    );
    assert.ok(
      Number.parseInt(trackList["min-height"] || "0", 10) > 0,
      `${viewport.width}x${viewport.height} .track-list must keep a non-zero min-height floor on short viewports`,
    );

    const metaCard = computeStyleForExactSelectors(rules, [".game-meta-card"], viewport);
    assert.equal(metaCard["font-size"], "11px");
    assert.equal(metaCard["line-height"], "1.4");
    assert.equal(metaCard.padding, "7px 9px");
    assert.ok(
      Number.parseInt(metaCard["max-height"] || "0", 10) >= 160,
      `${viewport.width}x${viewport.height} .game-meta-card max-height must stay >= 160px`,
    );
  }

  const mobile = { width: 375, height: 812 };
  const mobGameList = computeStyleForExactSelectors(rules, [".game-list"], mobile);
  assert.equal(mobGameList.flex, "0 0 auto");
  assert.equal(mobGameList["max-height"], "none");

  const mobTrackList = computeStyleForExactSelectors(rules, [".track-list"], mobile);
  assert.equal(mobTrackList.flex, "1 1 auto");
  assert.ok(
    Number.parseInt(mobTrackList["min-height"] || "0", 10) >= 120,
    "Mobile .track-list must keep a >= 120px min-height",
  );
  assert.ok(
    mobTrackList["max-height"] && mobTrackList["max-height"] !== "none",
    "Mobile .track-list in All panels must keep a bounded max-height",
  );

  const mobTunesTabTrackList = computeStyleForExactSelectors(
    rules,
    [".track-list", '.workbench-grid[data-mobile-view="tunes"] .track-list'],
    mobile,
  );
  assert.equal(mobTunesTabTrackList["max-height"], "none");
});

test("SID register strip uses tight vertical padding and never stretches in tall 2-column viewports", () => {
  const rules = loadLinkedRules();

  const tabletGrid = computeStyleForExactSelectors(rules, [".workbench-grid"], {
    width: 980,
    height: 1600,
  });
  assert.equal(
    tabletGrid["grid-template-rows"],
    "auto auto auto",
    "2-column .workbench-grid must size all three rows to auto so the register strip never stretches",
  );

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 980, height: 1600 },
    { width: 375, height: 812 },
  ]) {
    const strip = computeStyleForExactSelectors(rules, [".sid-hex-strip"], viewport);
    assert.equal(
      strip["align-self"],
      "start",
      `${viewport.width}x${viewport.height} .sid-hex-strip must use align-self: start`,
    );
    assert.equal(
      strip.padding,
      "3px 6px",
      `${viewport.width}x${viewport.height} .sid-hex-strip must use tight 3px 6px padding`,
    );
  }
});

test("oscilloscope card headers use fixed two-row layout with nowrap and tabular-nums so live updates never jump", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const scopesStart = html.indexOf('<div class="scopes-grid">');
  const scopesEnd = html.indexOf("<!-- RIGHT PANEL:", scopesStart);
  assert.ok(
    scopesStart > -1 && scopesEnd > scopesStart,
    "Expected .scopes-grid fragment in index.html",
  );
  const scopesHtml = html.slice(scopesStart, scopesEnd);

  const headerRows = scopesHtml.match(/class="voice-header-row"/g) || [];
  const telemetryRows = scopesHtml.match(/class="voice-telemetry-row"/g) || [];
  assert.equal(headerRows.length, 4, "All 4 voice cards must have .voice-header-row");
  assert.equal(telemetryRows.length, 4, "All 4 voice cards must have .voice-telemetry-row");

  for (const [noteId, pcId] of [
    ["v0-note", "v0-pc"],
    ["v1-note", "v1-pc"],
    ["v2-note", "v2-pc"],
    ["filter-mode-tag", "seq-pc"],
  ]) {
    const rowPattern = new RegExp(
      `<div\\s+[^>]*class="voice-telemetry-row"[^>]*>[\\s\\S]*?id="${noteId}"[\\s\\S]*?id="${pcId}"[\\s\\S]*?<\\/div>`,
    );
    assert.match(
      scopesHtml,
      rowPattern,
      `Expected ${noteId} and ${pcId} inside .voice-telemetry-row`,
    );
  }

  const rules = loadLinkedRules();
  const desktop = { width: 1440, height: 900 };

  const card = computeStyleForExactSelectors(rules, [".voice-card"], desktop);
  assert.equal(card["min-width"], "0", ".voice-card must set min-width: 0 inside CSS grid");

  const header = computeStyleForExactSelectors(rules, [".voice-card-header"], desktop);
  assert.equal(header["flex-direction"], "column");

  for (const rowSel of [".voice-header-row", ".voice-telemetry-row"]) {
    const rowStyle = computeStyleForExactSelectors(rules, [rowSel], desktop);
    assert.equal(rowStyle.display, "flex");
    assert.equal(rowStyle["justify-content"], "space-between");
  }

  for (const textSel of [".voice-name", ".voice-note", ".voice-pc-tag"]) {
    const style = computeStyleForExactSelectors(rules, [textSel], desktop);
    assert.equal(style["white-space"], "nowrap", `${textSel} must stay on a single line`);
  }

  for (const numSel of [".voice-note", ".voice-pc-tag"]) {
    const style = computeStyleForExactSelectors(rules, [numSel], desktop);
    assert.equal(style["font-variant-numeric"], "tabular-nums");
  }
});

test("oscilloscope card footers use a fixed 2x2 grid with tabular-nums so live register updates never shift or wrap", () => {
  const rules = loadLinkedRules();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 980, height: 1600 },
    { width: 375, height: 812 },
  ]) {
    const regs = computeStyleForExactSelectors(rules, [".voice-regs"], viewport);
    assert.equal(regs.display, "grid");
    assert.equal(regs["grid-template-columns"], "minmax(0, 1fr) auto");
    assert.equal(regs["font-variant-numeric"], "tabular-nums");
    assert.equal(regs["white-space"], "nowrap");
    assert.notEqual(regs["flex-wrap"], "wrap");
  }

  const fltRegValue = computeStyleForExactSelectors(rules, [".flt-reg-value"], {
    width: 1440,
    height: 900,
  });
  assert.equal(fltRegValue["min-width"], "2ch");
});

test("loadLinkedStylesheets discovers and concatenates all linked CSS files from entry HTML in cascade order", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "galway-css-links-"));
  try {
    fs.mkdirSync(path.join(dir, "src/styles"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/styles/a.css"), ".panel { color: red; }", "utf8");
    fs.writeFileSync(path.join(dir, "src/styles/b.css"), ".panel { color: blue; }", "utf8");
    const htmlPath = path.join(dir, "index.html");
    fs.writeFileSync(
      htmlPath,
      [
        "<!doctype html><html><head>",
        '<link rel="icon" href="./favicon.ico">',
        '<link rel="stylesheet" href="./src/styles/a.css?v=2026.11.17">',
        "<link href='./src/styles/b.css?v=2026.11.17' rel='stylesheet'>",
        "</head></html>",
      ].join("\n"),
      "utf8",
    );

    const loaded = loadLinkedStylesheets({ htmlPath });
    assert.deepEqual(
      loaded.links.map((link) => link.path),
      ["./src/styles/a.css", "./src/styles/b.css"],
    );
    assert.equal(
      computeStyleForExactSelectors(parseStylesheet(loaded.cssText), [".panel"], {
        width: 1440,
        height: 900,
      }).color,
      "blue",
    );

    fs.writeFileSync(path.join(dir, "empty.html"), "<html><head></head></html>", "utf8");
    assert.throws(
      () => loadLinkedStylesheets({ htmlPath: path.join(dir, "empty.html") }),
      /No stylesheet/,
    );

    fs.writeFileSync(
      path.join(dir, "missing.html"),
      '<link rel="stylesheet" href="./src/styles/missing.css">',
      "utf8",
    );
    assert.throws(
      () => loadLinkedStylesheets({ htmlPath: path.join(dir, "missing.html") }),
      /Missing linked stylesheet/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseStylesheet traverses @layer statements and blocks alongside @media and applies layer cascade precedence", () => {
  const css = `
    @layer reset, tokens, base, modules, state;

    :root { --accent: cyan; }
    .unlayered-wins { display: block; }

    @layer state {
      .hidden { display: none; }
      .unlayered-wins { display: none; }
      @media (max-width: 820px) {
        .panel { display: none; }
      }
    }

    @media (max-width: 820px) {
      @layer modules {
        .panel { display: flex; }
      }
    }

    @layer modules {
      .hidden { display: flex; }
      .panel { display: grid; }
      @layer sub {
        .sub-override { color: orange; }
      }
      .sub-override { color: lime; }
    }

    @layer {
      .anon { opacity: 0.5; }
    }

    @media (max-width: 1200px) and (min-width: 821px), (max-height: 680px) and (min-width: 821px) {
      .shell-scroll { overflow-y: auto; }
    }
  `;

  const rules = parseStylesheet(css);
  const desktop = { width: 1440, height: 900 };
  const tablet = { width: 980, height: 900 };
  const shortDesktop = { width: 1440, height: 600 };
  const mobile = { width: 375, height: 812 };

  assert.equal(computeStyleForExactSelectors(rules, [":root"], desktop)["--accent"], "cyan");
  assert.equal(
    computeStyleForExactSelectors(rules, [".hidden"], desktop).display,
    "none",
    "@layer state must override @layer modules even when @layer modules appears later",
  );
  assert.equal(
    computeStyleForExactSelectors(rules, [".unlayered-wins"], desktop).display,
    "block",
    "Unlayered rules must override @layer rules regardless of source order",
  );
  assert.equal(computeStyleForExactSelectors(rules, [".panel"], desktop).display, "grid");
  assert.equal(
    computeStyleForExactSelectors(rules, [".panel"], mobile).display,
    "none",
    "@media inside @layer state must beat @layer modules inside @media",
  );
  assert.equal(
    computeStyleForExactSelectors(rules, [".sub-override"], desktop).color,
    "lime",
    "Direct rules inside @layer modules must beat nested @layer sub",
  );
  assert.equal(computeStyleForExactSelectors(rules, [".anon"], desktop).opacity, "0.5");
  assert.equal(
    computeStyleForExactSelectors(rules, [".shell-scroll"], tablet)["overflow-y"],
    "auto",
    "Comma-separated @media list must match when the first branch holds",
  );
  assert.equal(
    computeStyleForExactSelectors(rules, [".shell-scroll"], shortDesktop)["overflow-y"],
    "auto",
    "Comma-separated @media list must match when the second branch holds",
  );
  assert.equal(
    computeStyleForExactSelectors(rules, [".shell-scroll"], desktop)["overflow-y"],
    undefined,
    "Comma-separated @media list must not match when neither branch holds",
  );
});

test("foundation stylesheet defines cascade layers, expanded tokens, and .hidden in @layer state without !important", () => {
  const { links, cssText } = loadLinkedStylesheets();
  assert.equal(links[0]?.path, "./src/styles/foundation.css", "foundation.css must load first");
  assert.ok(
    links.some((link) => link.path === "./src/styles.css"),
    "index.html must still link legacy ./src/styles.css in @layer modules",
  );

  const foundationCss = fs.readFileSync(path.join(ROOT, "src/styles/foundation.css"), "utf8");
  assert.match(
    foundationCss,
    /@layer\s+reset\s*,\s*tokens\s*,\s*base\s*,\s*modules\s*,\s*state\s*;/,
    "foundation.css must declare the five cascade layers in order",
  );
  assert.doesNotMatch(
    foundationCss.replace(/\/\*[\s\S]*?\*\//g, ""),
    /!important/i,
    "foundation.css must contain zero !important",
  );

  const rules = parseStylesheet(cssText);
  const desktop = { width: 1440, height: 900 };
  const tokens = computeStyleForExactSelectors(rules, [":root"], desktop);
  for (const token of [
    "--bg-deep",
    "--accent-cyan",
    "--font-mono",
    "--text-base",
    "--space-2",
    "--radius-md",
    "--z-modal",
    "--z-popover",
    "--z-boot",
  ]) {
    assert.ok(tokens[token], `foundation tokens must define ${token}`);
  }

  const hiddenRules = rules.filter((rule) => rule.selector === ".hidden");
  assert.equal(hiddenRules.length, 1, ".hidden must have a single canonical rule");
  assert.equal(hiddenRules[0].layer, "state", ".hidden must live in @layer state");
  assert.equal(hiddenRules[0].decls.display, "none");

  const hiddenModal = computeStyleForExactSelectors(rules, [".modal-backdrop", ".hidden"], desktop);
  assert.equal(
    hiddenModal.display,
    "none",
    "@layer state .hidden must override @layer modules display: flex on .modal-backdrop",
  );
});

function assertExtractedModulesOrder(linkPaths, expectedRelPaths, afterRelPath) {
  let prevIdx = linkPaths.indexOf(afterRelPath);
  assert.ok(prevIdx > -1, `index.html must link ${afterRelPath}`);
  const legacyIdx = linkPaths.indexOf("./src/styles.css");
  assert.ok(legacyIdx > -1, "index.html must link legacy ./src/styles.css");

  for (const rel of expectedRelPaths) {
    const idx = linkPaths.indexOf(rel);
    assert.ok(idx > -1, `index.html must link ${rel}`);
    assert.ok(idx > prevIdx, `${rel} must load after ${linkPaths[prevIdx]}`);
    assert.ok(idx < legacyIdx, `${rel} must load before legacy styles.css`);
    prevIdx = idx;
  }
}

function assertPreservedIds(html, ids) {
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `index.html must preserve #${id} for DOM/ARIA wiring`);
  }
}

test("shared button, help popover, and modal modules extract with co-located media queries and expected computed styles", () => {
  const { links, cssText } = loadLinkedStylesheets();
  assertExtractedModulesOrder(
    links.map((link) => link.path),
    ["./src/styles/buttons.css", "./src/styles/help-popover.css", "./src/styles/modal.css"],
    "./src/styles/foundation.css",
  );

  const helpCss = fs.readFileSync(path.join(ROOT, "src/styles/help-popover.css"), "utf8");
  assert.match(helpCss, /@media\s*\(\s*max-width:\s*560px\s*\)/);
  assert.match(helpCss, /@media\s*\(\s*prefers-reduced-motion:\s*no-preference\s*\)/);

  const modalCss = fs.readFileSync(path.join(ROOT, "src/styles/modal.css"), "utf8");
  assert.match(modalCss, /@media\s*\(\s*max-width:\s*820px\s*\)/);

  const rules = parseStylesheet(cssText);
  const desktop = { width: 1440, height: 900 };
  const mobile = { width: 375, height: 812 };
  assert.equal(
    computeStyleForExactSelectors(rules, [".btn-primary"], desktop)["min-width"],
    "92px",
  );
  assert.equal(
    computeStyleForExactSelectors(rules, [".hw-help-panel"], desktop)["z-index"],
    "var(--z-popover)",
  );
  assert.equal(
    computeStyleForExactSelectors(rules, [".modal-backdrop"], desktop)["z-index"],
    "var(--z-modal)",
  );
  assert.equal(
    computeStyleForExactSelectors(rules, [".modal-cols"], mobile)["grid-template-columns"],
    "1fr",
  );
});

test("Boot Sequence module extracts with co-located media queries and expected computed styles", () => {
  const { links, cssText } = loadLinkedStylesheets();
  const rel = "./src/styles/boot-sequence.css";
  assertExtractedModulesOrder(
    links.map((link) => link.path),
    [rel],
    "./src/styles/foundation.css",
  );
  const bootCss = fs.readFileSync(path.join(ROOT, rel), "utf8");
  assert.match(bootCss, /@media\s*\(\s*max-width:\s*560px\s*\)/);

  const rules = parseStylesheet(cssText);
  const desktop = { width: 1440, height: 900 };
  const phone = { width: 390, height: 844 };
  assert.equal(
    computeStyleForExactSelectors(rules, [".boot-sequence"], desktop)["z-index"],
    "var(--z-boot)",
  );
  assert.equal(
    computeStyleForExactSelectors(rules, ['body[data-boot-state="booting"] .app-shell'], desktop)
      .visibility,
    "hidden",
  );
  assert.equal(
    computeStyleForExactSelectors(
      rules,
      ['html[data-boot-mode="immediate"] .boot-sequence'],
      desktop,
    ).display,
    "none",
  );
  assert.equal(
    computeStyleForExactSelectors(rules, [".boot-hint"], phone).bottom,
    "var(--space-4)",
  );
});

test("workbench shell, top bar, and hardware controls modules extract with co-located media queries and state-layer reduced motion", () => {
  const { html, links, cssText } = loadLinkedStylesheets();
  assertExtractedModulesOrder(
    links.map((link) => link.path),
    [
      "./src/styles/workbench-shell.css",
      "./src/styles/top-bar.css",
      "./src/styles/hardware-controls.css",
    ],
    "./src/styles/foundation.css",
  );

  const shellCss = fs.readFileSync(path.join(ROOT, "src/styles/workbench-shell.css"), "utf8");
  assert.match(shellCss, /@media\s*\(\s*max-width:\s*1200px\s*\)/);
  assert.match(shellCss, /@media\s*\(\s*max-width:\s*820px\s*\)/);

  const topBarCss = fs.readFileSync(path.join(ROOT, "src/styles/top-bar.css"), "utf8");
  assert.match(topBarCss, /@media\s*\(\s*max-width:\s*820px\s*\)/);
  assert.match(topBarCss, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);

  const hwCss = fs.readFileSync(path.join(ROOT, "src/styles/hardware-controls.css"), "utf8");
  assert.match(hwCss, /@media\s*\(\s*max-width:\s*820px\s*\)/);

  const rules = parseStylesheet(cssText);
  const desktop = { width: 1440, height: 900 };
  const mobile = { width: 375, height: 812 };

  assert.equal(
    computeStyleForExactSelectors(rules, [".hw-toggle-value-latency"], desktop)["min-width"],
    "76px",
  );
  assert.equal(
    computeStyleForExactSelectors(rules, [".hw-group-full"], mobile)["grid-column"],
    "1 / -1",
  );
  assert.equal(
    computeStyleForExactSelectors(rules, [".hw-action-btn-full"], mobile)["grid-column"],
    "1 / -1",
  );

  const reducedMotionRule = rules.find(
    (rule) =>
      rule.selector === ".brand-logo.sparkle-active .c64-logo-svg path" &&
      rule.mediaQuery === "(prefers-reduced-motion: reduce)",
  );
  assert.ok(reducedMotionRule, "Sparkle reduced-motion rule must remain defined");
  assert.equal(
    reducedMotionRule.layer,
    "state",
    "Sparkle reduced-motion rule must live in @layer state so it overrides without !important",
  );
  assert.equal(reducedMotionRule.decls.animation, "none");

  assertPreservedIds(html, [
    "latency-mode-value",
    "hw-group-sid",
    "hw-group-latency",
    "hw-group-digi",
    "btn-directives-modal",
    "btn-narrative-modal",
    "btn-stats-nerds",
  ]);
});

test("Source Panel, C64 Monitor, and Oscilloscopes Panel modules extract in order with co-located media queries and CAUTION notices", () => {
  const { html, links, cssText } = loadLinkedStylesheets();
  assertExtractedModulesOrder(
    links.map((link) => link.path),
    [
      "./src/styles/source-panel.css",
      "./src/styles/c64-monitor.css",
      "./src/styles/oscilloscopes-panel.css",
    ],
    "./src/styles/boot-sequence.css",
  );

  const sourceCss = fs.readFileSync(path.join(ROOT, "src/styles/source-panel.css"), "utf8");
  assert.match(sourceCss, /@media\s*\(\s*max-width:\s*820px\s*\)/);
  assert.match(sourceCss, /@media\s*\(\s*max-width:\s*560px\s*\)/);

  const monitorCss = fs.readFileSync(path.join(ROOT, "src/styles/c64-monitor.css"), "utf8");
  assert.match(
    monitorCss,
    /@media\s*\(\s*max-width:\s*1200px\s*\)\s*and\s*\(\s*min-width:\s*821px\s*\)/,
  );
  assert.match(
    monitorCss,
    /@media\s*\(\s*max-height:\s*780px\s*\)\s*and\s*\(\s*min-width:\s*821px\s*\)/,
  );
  assert.match(monitorCss, /@media\s*\(\s*max-width:\s*820px\s*\)/);
  assert.match(monitorCss, /@media\s*\(\s*max-width:\s*560px\s*\)/);

  const scopesCss = fs.readFileSync(path.join(ROOT, "src/styles/oscilloscopes-panel.css"), "utf8");
  assert.match(
    scopesCss,
    /@media\s*\(\s*max-width:\s*1200px\s*\)\s*and\s*\(\s*min-width:\s*821px\s*\)/,
  );
  assert.match(
    scopesCss,
    /@media\s*\(\s*max-height:\s*780px\s*\)\s*and\s*\(\s*min-width:\s*821px\s*\)/,
  );
  assert.match(scopesCss, /@media\s*\(\s*max-width:\s*820px\s*\)/);
  assert.match(scopesCss, /@media\s*\(\s*max-width:\s*560px\s*\)/);
  for (const [name, css] of [
    ["source-panel.css", sourceCss],
    ["c64-monitor.css", monitorCss],
    ["oscilloscopes-panel.css", scopesCss],
  ]) {
    assert.match(css, /\/\*\s*CAUTION:\s+[^*]+\*\//, `${name} must carry STE-80 CAUTION: notices`);
  }

  const rules = parseStylesheet(cssText);
  const desktop = { width: 1440, height: 900 };
  assert.equal(
    computeStyleForExactSelectors(rules, [".c64-monitor-canvas"], desktop)["image-rendering"],
    "pixelated",
  );
  assert.equal(
    computeStyleForExactSelectors(rules, [".flt-reg-value"], desktop).display,
    "inline-block",
  );

  assertPreservedIds(html, [
    "c64-monitor-canvas",
    "tel-frame",
    "tel-pc",
    "tel-d418",
    "flt-res",
    "flt-vol",
  ]);
});
