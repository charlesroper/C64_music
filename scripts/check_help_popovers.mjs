import { spawn } from "node:child_process";
import { resolveBrowserEngine } from "./browser_engines.mjs";
import { createStaticServer } from "./browser_harness.mjs";

// Release gate, not a CI job. This check needs a real Chromium build and asserts
// font-sensitive pixel geometry, so it runs in the deploy preflight only.
// See docs/agents/browser-verification.md and CODING_STANDARDS Rule 6.4.

const SIZES = [
  [360, 800],
  [390, 844],
  [820, 1180],
  [1280, 600],
  [1440, 900],
];

function startChrome(chromePath) {
  const child = spawn(
    chromePath,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--remote-debugging-port=0",
      "--window-size=390,800",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("Chromium did not report a DevTools endpoint within 10 seconds."));
    }, 10000);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ child, websocketUrl: match[1] });
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Chromium exited before startup with code ${code}.`));
    });
  });
}

async function connect(websocketUrl) {
  const socket = new WebSocket(websocketUrl);
  const pending = new Map();
  let nextId = 0;

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  };

  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("Could not connect to the DevTools websocket."));
  });

  return {
    send(method, params = {}) {
      return new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(send, expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text || "Page evaluation failed.");
  }
  return response.result?.result?.value;
}

async function waitForApp(send) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const ready = await evaluate(
      send,
      "Boolean(window.__workbenchState?.player && document.querySelector('.tunesPanel-item'))",
    );
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The workbench did not appear within 30 seconds.");
}

async function openPanel(send, id) {
  await evaluate(send, `document.getElementById("${id}-help-trigger").click()`);
  await new Promise((resolve) => setTimeout(resolve, 180));
}

async function closePanel(send, id, expectedBorder) {
  await evaluate(send, `document.getElementById("${id}-help-panel").hidePopover?.()`);
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const settled = await evaluate(
      send,
      `(() => {
        const button = document.getElementById("${id}-help-trigger");
        return {
          expanded: button.getAttribute("aria-expanded"),
          expandedClass: button.classList.contains("helpPopover-trigger-isExpanded"),
          border: getComputedStyle(button).borderColor,
        };
      })()`,
    );
    if (settled.expanded === "false" && !settled.expandedClass && settled.border === expectedBorder)
      return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${id} help trigger did not settle after close`);
}

async function readLayout(send, id) {
  return evaluate(
    send,
    `(() => {
      const panel = document.getElementById("${id}-help-panel");
      const trigger = document.getElementById("${id}-help-trigger");
      const transport = document.querySelector(".transportBar");
      const p = panel.getBoundingClientRect();
      const t = trigger.getBoundingClientRect();
      const b = transport.getBoundingClientRect();
      const overlaps = !(p.right <= b.left || p.left >= b.right || p.bottom <= b.top || p.top >= b.bottom);
      return {
        expanded: trigger.getAttribute("aria-expanded"),
        expandedClass: trigger.classList.contains("helpPopover-trigger-isExpanded"),
        openClass: panel.classList.contains("helpPopover-panel-isOpen"),
        open: panel.matches(":popover-open"),
        panel: { left: p.left, top: p.top, right: p.right, bottom: p.bottom, width: p.width, height: p.height },
        trigger: { left: t.left, top: t.top, bottom: t.bottom },
        overlapsTransport: overlaps,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        width: window.innerWidth,
        height: window.innerHeight,
        animation: getComputedStyle(panel).animationName,
      };
    })()`,
  );
}

async function readIconCentring(send, triggerId) {
  return evaluate(
    send,
    `(() => {
      const button = document.getElementById("${triggerId}");
      const icon = button.querySelector("svg");
      const b = button.getBoundingClientRect();
      const i = icon.getBoundingClientRect();
      return {
        dx: Math.abs(b.left + b.width / 2 - (i.left + i.width / 2)),
        dy: Math.abs(b.top + b.height / 2 - (i.top + i.height / 2)),
        border: getComputedStyle(button).borderColor,
        expanded: button.getAttribute("aria-expanded"),
      };
    })()`,
  );
}

async function readHintLineAlignment(send, triggerId) {
  return evaluate(
    send,
    `(() => {
      const button = document.getElementById("${triggerId}");
      const hint = button.parentElement.querySelector(".hardwareControls-hint");
      const probe = document.createElement("span");
      probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
      hint.prepend(probe);
      const baseline = probe.getBoundingClientRect().bottom;
      probe.remove();
      const style = getComputedStyle(hint);
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = style.fontStyle + " " + style.fontWeight + " " + style.fontSize + " " + style.fontFamily;
      const cap = ctx.measureText("M").actualBoundingBoxAscent;
      const b = button.getBoundingClientRect();
      return {
        dy: Math.abs(b.top + b.height / 2 - (baseline - cap / 2)),
        cap,
        baseline,
      };
    })()`,
  );
}

async function checkWidth({ client, appUrl, width, height }) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 560,
  });
  await client.send("Page.navigate", { url: appUrl });
  await waitForApp(client.send);

  const closedIcon = await readIconCentring(client.send, "latency-mode-help-trigger");
  const hintAlignment = await readHintLineAlignment(client.send, "latency-mode-help-trigger");
  await openPanel(client.send, "latency-mode");
  const layout = await readLayout(client.send, "latency-mode");
  const openIcon = await readIconCentring(client.send, "latency-mode-help-trigger");
  const mobile = width <= 560;
  if (layout.expanded !== "true" || !layout.expandedClass || !layout.openClass || !layout.open) {
    throw new Error(`${width}px panel did not open`);
  }
  if (layout.overflow) throw new Error(`${width}px horizontal overflow`);
  if (layout.overlapsTransport) throw new Error(`${width}px panel overlaps transport`);
  if (layout.panel.left < 0 || layout.panel.top < 0)
    throw new Error(`${width}px panel runs off top or left`);
  if (layout.panel.right > width + 0.5 || layout.panel.bottom > height + 0.5) {
    throw new Error(`${width}px panel runs off bottom or right`);
  }
  if (mobile && Math.abs(layout.panel.bottom - (height - 12)) > 14) {
    throw new Error(`${width}px panel is not a bottom sheet (${layout.panel.bottom}/${height})`);
  }
  if (!mobile) {
    const anchored =
      layout.panel.top >= layout.trigger.bottom - 1 ||
      layout.panel.bottom <= layout.trigger.top + 1;
    if (!anchored) throw new Error(`${width}px panel is not anchored to its trigger`);
  }
  const closeButtonCentring = await evaluate(
    client.send,
    `(() => {
      const button = document.getElementById("latency-mode-help-close");
      const icon = button.querySelector("svg");
      const b = button.getBoundingClientRect();
      const i = icon.getBoundingClientRect();
      return {
        dx: Math.abs(b.left + b.width / 2 - (i.left + i.width / 2)),
        dy: Math.abs(b.top + b.height / 2 - (i.top + i.height / 2)),
      };
    })()`,
  );
  if (closedIcon.dx > 1 || closedIcon.dy > 1 || openIcon.dx > 1 || openIcon.dy > 1) {
    throw new Error(`${width}px help trigger icon is not centred`);
  }
  if (hintAlignment.dy > 1) {
    throw new Error(
      `${width}px help trigger is not centred on the hint line: ${JSON.stringify(hintAlignment)}`,
    );
  }
  if (closeButtonCentring.dx > 1 || closeButtonCentring.dy > 1) {
    throw new Error(`${width}px close icon is not centred`);
  }
  await closePanel(client.send, "latency-mode", closedIcon.border);
  const closedState = await readIconCentring(client.send, "latency-mode-help-trigger");
  if (closedState.expanded !== "false" || closedState.border !== closedIcon.border) {
    throw new Error(
      `${width}px trigger stayed lit after close: ${JSON.stringify({ closedIcon, closedState })}`,
    );
  }
  console.log(
    `PASS ${width}x${height}: panel inside viewport, ${mobile ? "bottom sheet" : "anchored"}, icons centred, trigger reset, no overflow.`,
  );
}

async function checkKeyboard({ client, appUrl }) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await client.send("Page.navigate", { url: appUrl });
  await waitForApp(client.send);

  await evaluate(client.send, 'document.getElementById("latency-mode-help-trigger").focus()');
  await client.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "char",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    text: "\r",
    unmodifiedText: "\r",
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  let state = await evaluate(
    client.send,
    `({
      expanded: document.getElementById("latency-mode-help-trigger").getAttribute("aria-expanded"),
      active: document.activeElement.id,
      animation: getComputedStyle(document.getElementById("latency-mode-help-panel")).animationName,
    })`,
  );
  if (state.expanded !== "true") throw new Error("Enter did not open the panel");
  if (state.active !== "latency-mode-help-title") {
    throw new Error(`Focus went to ${state.active || "nothing"} instead of the panel title`);
  }
  if (state.animation !== "none") throw new Error("Reduced motion still animates the panel");

  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  state = await evaluate(
    client.send,
    `({ active: document.activeElement.textContent.trim(), tag: document.activeElement.tagName })`,
  );
  if (state.tag !== "A" || state.active !== "Firefox buffer setting") {
    throw new Error("Tab did not reach the Firefox buffer setting link");
  }

  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  state = await evaluate(
    client.send,
    `({
      expanded: document.getElementById("latency-mode-help-trigger").getAttribute("aria-expanded"),
      active: document.activeElement.id,
    })`,
  );
  if (state.expanded !== "false" || state.active !== "latency-mode-help-trigger") {
    throw new Error("Escape did not close and return focus");
  }

  await openPanel(client.send, "latency-mode");
  await evaluate(client.send, 'document.getElementById("latency-mode-help-close").click()');
  await new Promise((resolve) => setTimeout(resolve, 120));
  state = await evaluate(
    client.send,
    `({
      expanded: document.getElementById("latency-mode-help-trigger").getAttribute("aria-expanded"),
      active: document.activeElement.id,
    })`,
  );
  if (state.expanded !== "false" || state.active !== "latency-mode-help-trigger") {
    throw new Error("Close button did not close and return focus");
  }

  await openPanel(client.send, "sid-model");
  await openPanel(client.send, "latency-mode");
  const exclusive = await evaluate(
    client.send,
    `({
      sid: document.getElementById("sid-model-help-trigger").getAttribute("aria-expanded"),
      audio: document.getElementById("latency-mode-help-trigger").getAttribute("aria-expanded"),
    })`,
  );
  if (exclusive.sid !== "false" || exclusive.audio !== "true") {
    throw new Error("Only one help panel may be open");
  }
  console.log(
    "PASS keyboard: title focus, link Tab, Escape return, exclusive panels, reduced motion.",
  );
}

async function main() {
  const chromium = resolveBrowserEngine("chromium");
  if (chromium.warning) throw new Error(chromium.warning);
  const chromePath = chromium.path;
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const appUrl = `http://127.0.0.1:${port}/?skipBoot=1`;
  let chrome = null;
  let client = null;
  let tab = null;
  let debugBase = null;

  try {
    chrome = await startChrome(chromePath);
    debugBase = `http://127.0.0.1:${new URL(chrome.websocketUrl).port}`;
    const created = await fetch(`${debugBase}/json/new?about:blank`, { method: "PUT" });
    tab = await created.json();
    client = await connect(tab.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    for (const [width, height] of SIZES) {
      await checkWidth({ client, appUrl, width, height });
    }
    await checkKeyboard({ client, appUrl });
  } finally {
    if (client) client.close();
    if (tab && debugBase) await fetch(`${debugBase}/json/close/${tab.id}`).catch(() => {});
    if (chrome) chrome.child.kill("SIGTERM");
    server.close();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  });
}
