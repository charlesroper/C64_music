import { assembleOceanSource } from "./ocean_assembler.js";

export function assembleSources(sources) {
  const results = {};
  for (const [gameId, sourceText] of Object.entries(sources || {})) {
    const { sourceIndex, ...assembled } = assembleOceanSource(sourceText);
    results[gameId] = assembled;
  }
  return results;
}

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = (event) => {
    const { sources } = event.data || {};
    try {
      self.postMessage({ results: assembleSources(sources) });
    } catch (error) {
      self.postMessage({ error: String(error?.message || error) });
    }
  };
}
