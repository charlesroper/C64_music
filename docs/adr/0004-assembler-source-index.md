# Assembler Source Index

Expose an assembler-owned source index for address lookup, symbol jumps, and line search.

## Context

The presentation layer previously answered position queries by scanning raw text and data buffers in three different ways: scanning `addrToLine` backwards 16 bytes per frame, running regex matches across `rawLines` for symbol jumps, and looping through text lines on search keystrokes. This coupled the view to text layout and repeated work that the assembler had already resolved during parsing.

## Decision

`assembleOceanSource` builds and returns a `sourceIndex` object bound to the assembled output, exposing:
- `lineForAddress(addr, maxDelta)`: Resolves CPU execution addresses to source line numbers with backwards delta tolerance.
- `lineForSymbol(name)`: O(1) lookup returning the exact definition line of any label or equate recorded during pass 2.
- `findLines(query)`: Case-insensitive substring query returning all matching source line numbers.

The presentation layer queries `asm.sourceIndex` directly and performs zero regular expression scans on raw source strings.

## Consequences

Address-to-line resolution and symbol jumps become single-method calls backed by the assembler's parsed statement registry. Regular expression parsing is eliminated from symbol jump and search input handlers.
