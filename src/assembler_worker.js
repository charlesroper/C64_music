import { assembleOceanSource } from "./ocean_assembler.js";

self.onmessage = (event) => {
  const { id, gameId, sourceText, initialSymbols } = event.data || {};
  if (!sourceText) return;
  try {
    const asm = assembleOceanSource(sourceText, initialSymbols || {});
    self.postMessage(
      {
        id,
        gameId,
        entryPoint: asm.entryPoint,
        symbols: asm.symbols,
        symbolLines: asm.symbolLines,
        addrToLine: asm.addrToLine,
        lineAddresses: asm.lineAddresses,
        rawLines: asm.rawLines,
        mem: asm.mem.buffer,
      },
      [asm.mem.buffer],
    );
  } catch (error) {
    self.postMessage({
      id,
      gameId,
      error: error?.message || String(error),
    });
  }
};
