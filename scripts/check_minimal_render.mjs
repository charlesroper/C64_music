import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CHROME =
  "/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell";
const WIDTHS = (process.env.CHECK_WIDTHS || "360,390")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

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

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const command of ["chromium", "chromium-browser", "google-chrome"]) {
    const found = spawnSync("which", [command], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return DEFAULT_CHROME;
}

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
    async send(method, params = {}) {
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

async function waitForMinimalRender(send) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const ready = await evaluate(send, "document.body.classList.contains('render-minimal')");
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The render-minimal body class did not appear within 10 seconds.");
}

function assertMinimalLayout(width, layout) {
  const failures = [];
  if (!layout.body.includes("render-minimal")) {
    failures.push(`body class was "${layout.body}"`);
  }
  for (const selector of ["center", "right", "sid", "tabs"]) {
    if (layout[selector] !== "none") failures.push(`${selector} display was ${layout[selector]}`);
  }
  if (layout.left !== "flex") failures.push(`left display was ${layout.left}`);
  if (layout.scrollWidth > layout.innerWidth) {
    failures.push(`scroll width ${layout.scrollWidth} exceeded viewport ${layout.innerWidth}`);
  }
  if (failures.length > 0) {
    throw new Error(`${width}px: ${failures.join(", ")}`);
  }
}

async function checkWidth({ debugBase, appUrl, width }) {
  const created = await fetch(`${debugBase}/json/new?about:blank`, { method: "PUT" });
  const tab = await created.json();
  const client = await connect(tab.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await client.send("Page.navigate", { url: appUrl });
    await waitForMinimalRender(client.send);

    const layout = await evaluate(
      client.send,
      `(() => {
        const display = (selector) => {
          const element = document.querySelector(selector);
          return element ? getComputedStyle(element).display : "missing";
        };
        return {
          body: document.body.className,
          center: display(".panel-center"),
          right: display(".panel-right"),
          sid: display(".sid-hex-strip"),
          left: display(".panel-left"),
          tabs: display(".mobile-view-tabs"),
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      })()`,
    );
    assertMinimalLayout(width, layout);
    console.log(
      `PASS ${width}px: centre, right, SID and tabs hidden; track list visible; ${layout.scrollWidth}/${layout.innerWidth}px wide.`,
    );
  } finally {
    client.close();
    await fetch(`${debugBase}/json/close/${tab.id}`).catch(() => {});
  }
}

async function main() {
  const chromePath = findChrome();
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const appUrl = `http://127.0.0.1:${port}/?skipBoot=1&render=minimal`;
  const chrome = await startChrome(chromePath);

  try {
    const debugBase = `http://127.0.0.1:${new URL(chrome.websocketUrl).port}`;
    for (const width of WIDTHS) {
      await checkWidth({ debugBase, appUrl, width });
    }
  } finally {
    chrome.child.kill("SIGTERM");
    server.close();
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
