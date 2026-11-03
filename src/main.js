// ============================================================================
// Galway 2664 // Ocean 6502-SID Workbench Browser Entry Point
// ============================================================================

import { bootWorkbench } from "./app.js";

if (typeof window !== "undefined" && typeof document !== "undefined") {
  bootWorkbench();
}
