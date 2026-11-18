import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MIME_TYPES = {
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

/** Create a static HTTP server confined to `root` for local browser checks. */
export function createStaticServer(root = ROOT) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const relativePath = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = path.resolve(root, `.${decodeURIComponent(relativePath)}`);
      if (!filePath.startsWith(root)) {
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

/** Wait until Workbench View boot finishes and left/right panes have rendered DOM rows. */
export async function waitForWorkbenchReady(page) {
  await page.waitForFunction(
    () =>
      Boolean(window.__workbenchState?.player) &&
      document.getElementById("play-label")?.textContent !== "LOADING..." &&
      document.getElementById("game-meta-card")?.textContent.trim().length > 0 &&
      document.querySelectorAll(".tunesPanel-item").length > 0 &&
      document.querySelectorAll(".asm-line").length > 0,
  );
}

/** Open a context page at an explicit viewport size (Playwright ignores viewport on context.newPage). */
export async function openWorkbenchPage(context, url, viewport) {
  const page = await context.newPage();
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(url);
  await waitForWorkbenchReady(page);
  return page;
}
