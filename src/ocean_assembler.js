// ============================================================================
// Ocean Software 1987 6502 Cross-Assembler (JavaScript Implementation)
// Implements all directives documented in ocean_assembler_directives.txt:
// ORG, EQU, DFS, DFB, DFW, DFM, DFH, DFL, DSP, DFC, ENT, ADD, SUB,
// plus MOD, OR, XOR, DIV, AND, # (low-byte), ^ (high-byte), &char, "str", .
// ============================================================================

export const OPCODES = {
  ADC: { imm: 0x69, zp: 0x65, zpx: 0x75, abs: 0x6D, absx: 0x7D, absy: 0x79, indx: 0x61, indy: 0x71 },
  AND: { imm: 0x29, zp: 0x25, zpx: 0x35, abs: 0x2D, absx: 0x3D, absy: 0x39, indx: 0x21, indy: 0x31 },
  ASL: { acc: 0x0A, imp: 0x0A, zp: 0x06, zpx: 0x16, abs: 0x0E, absx: 0x1E },
  BCC: { rel: 0x90 }, BCS: { rel: 0xB0 }, BEQ: { rel: 0xF0 }, BMI: { rel: 0x30 },
  BNE: { rel: 0xD0 }, BPL: { rel: 0x10 }, BVC: { rel: 0x50 }, BVS: { rel: 0x70 },
  BIT: { zp: 0x24, abs: 0x2C },
  BRK: { imp: 0x00 },
  CLC: { imp: 0x18 }, CLD: { imp: 0xD8 }, CLI: { imp: 0x58 }, CLV: { imp: 0xB8 },
  CMP: { imm: 0xC9, zp: 0xC5, zpx: 0xD5, abs: 0xCD, absx: 0xDD, absy: 0xD9, indx: 0xC1, indy: 0xD1 },
  CPX: { imm: 0xE0, zp: 0xE4, abs: 0xEC },
  CPY: { imm: 0xC0, zp: 0xC4, abs: 0xCC },
  DEC: { zp: 0xC6, zpx: 0xD6, abs: 0xCE, absx: 0xDE },
  DEX: { imp: 0xCA }, DEY: { imp: 0x88 },
  EOR: { imm: 0x49, zp: 0x45, zpx: 0x55, abs: 0x4D, absx: 0x5D, absy: 0x59, indx: 0x41, indy: 0x51 },
  INC: { zp: 0xE6, zpx: 0xF6, abs: 0xEE, absx: 0xFE },
  INX: { imp: 0xE8 }, INY: { imp: 0xC8 },
  JMP: { abs: 0x4C, ind: 0x6C },
  JSR: { abs: 0x20 },
  LDA: { imm: 0xA9, zp: 0xA5, zpx: 0xB5, abs: 0xAD, absx: 0xBD, absy: 0xB9, indx: 0xA1, indy: 0xB1 },
  LDX: { imm: 0xA2, zp: 0xA6, zpy: 0xB6, abs: 0xAE, absy: 0xBE },
  LDY: { imm: 0xA0, zp: 0xA4, zpx: 0xB4, abs: 0xAC, absx: 0xBC },
  LSR: { acc: 0x4A, imp: 0x4A, zp: 0x46, zpx: 0x56, abs: 0x4E, absx: 0x5E },
  NOP: { imp: 0xEA },
  ORA: { imm: 0x09, zp: 0x05, zpx: 0x15, abs: 0x0D, absx: 0x1D, absy: 0x19, indx: 0x01, indy: 0x11 },
  PHA: { imp: 0x48 }, PHP: { imp: 0x08 }, PLA: { imp: 0x68 }, PLP: { imp: 0x28 },
  ROL: { acc: 0x2A, imp: 0x2A, zp: 0x26, zpx: 0x36, abs: 0x2E, absx: 0x3E },
  ROR: { acc: 0x6A, imp: 0x6A, zp: 0x66, zpx: 0x76, abs: 0x6E, absx: 0x7E },
  RTI: { imp: 0x40 }, RTS: { imp: 0x60 },
  SBC: { imm: 0xE9, zp: 0xE5, zpx: 0xF5, abs: 0xED, absx: 0xFD, absy: 0xF9, indx: 0xE1, indy: 0xF1 },
  SEC: { imp: 0x38 }, SED: { imp: 0xF8 }, SEI: { imp: 0x78 },
  STA: { zp: 0x85, zpx: 0x95, abs: 0x8D, absx: 0x9D, absy: 0x99, indx: 0x81, indy: 0x91 },
  STX: { zp: 0x86, zpy: 0x96, abs: 0x8E },
  STY: { zp: 0x84, zpx: 0x94, abs: 0x8C },
  TAX: { imp: 0xAA }, TAY: { imp: 0xA8 }, TSX: { imp: 0xBA },
  TXA: { imp: 0x8A }, TXS: { imp: 0x9A }, TYA: { imp: 0x98 },
};

const DIRECTIVES = new Set(["ORG", "EQU", "DFS", "DFB", "DFW", "DFM", "DFH", "DFL", "DSP", "DFC", "ENT"]);
const MNEMONICS = new Set([...Object.keys(OPCODES), "ADD", "SUB"]);
const ALL_OPS = new Set([...DIRECTIVES, ...MNEMONICS]);

function splitCodeComment(line) {
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
    } else if (ch === '&' && !inQ && i + 1 < line.length) {
      i++;
    } else if (ch === ';' && !inQ) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitByChar(s, sep) {
  const res = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      inQ = !inQ;
      cur += ch;
    } else if (ch === '&' && !inQ && i + 1 < s.length) {
      cur += ch + s[i + 1];
      i++;
    } else if (ch === sep && !inQ) {
      res.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  res.push(cur);
  return res;
}

export function evalExpr(expr, symbols, pc, strict = false) {
  const s = expr.trim();
  if (!s) return 0;

  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '$') {
      i++;
      const start = i;
      while (i < s.length && /[0-9a-fA-F]/.test(s[i])) i++;
      tokens.push({ type: "NUM", val: parseInt(s.slice(start, i) || "0", 16) });
    } else if (ch === '%') {
      i++;
      const start = i;
      while (i < s.length && /[01]/.test(s[i])) i++;
      tokens.push({ type: "NUM", val: parseInt(s.slice(start, i) || "0", 2) });
    } else if (ch === '&') {
      if (i + 1 < s.length) {
        tokens.push({ type: "NUM", val: s.charCodeAt(i + 1) });
        i += 2;
      } else {
        i++;
      }
    } else if (ch === '"') {
      i++;
      const start = i;
      while (i < s.length && s[i] !== '"') i++;
      const val = i > start ? s.charCodeAt(start) : 0;
      if (i < s.length) i++;
      tokens.push({ type: "NUM", val });
    } else if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < s.length && /[0-9]/.test(s[i])) i++;
      tokens.push({ type: "NUM", val: parseInt(s.slice(start, i), 10) });
    } else if ("+-*/()#^".includes(ch)) {
      tokens.push({ type: "OP", val: ch });
      i++;
    } else if (ch === '.') {
      tokens.push({ type: "NUM", val: pc });
      i++;
    } else if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < s.length && /[a-zA-Z0-9_.]/.test(s[i])) i++;
      const word = s.slice(start, i);
      if (word === "MOD" || word === "OR" || word === "XOR" || word === "DIV" || word === "AND") {
        tokens.push({ type: "OP", val: word });
      } else if (Object.prototype.hasOwnProperty.call(symbols, word)) {
        tokens.push({ type: "NUM", val: symbols[word] });
      } else {
        if (strict) {
          throw new Error(`Undefined symbol '${word}' in expression '${expr}'`);
        }
        return null;
      }
    } else {
      throw new Error(`Unexpected character '${ch}' in expression '${expr}'`);
    }
  }

  let pos = 0;
  const peek = () => (pos < tokens.length ? tokens[pos] : null);
  const consume = () => tokens[pos++];

  function parseUnary() {
    const t = peek();
    if (t && t.type === "OP") {
      if (t.val === '+') {
        consume();
        const v = parseUnary();
        return v === null ? null : +v;
      }
      if (t.val === '-') {
        consume();
        const v = parseUnary();
        return v === null ? null : -v;
      }
      if (t.val === '#') {
        consume();
        const v = parseUnary();
        return v === null ? null : (v & 0xFF);
      }
      if (t.val === '^') {
        consume();
        const v = parseUnary();
        return v === null ? null : ((v >> 8) & 0xFF);
      }
      if (t.val === '(') {
        consume();
        const v = parseAdd();
        if (peek() && peek().val === ')') consume();
        return v;
      }
    }
    if (t && t.type === "NUM") {
      consume();
      return t.val;
    }
    throw new Error(`Syntax error in expression '${expr}'`);
  }

  function parseMul() {
    let left = parseUnary();
    while (true) {
      const t = peek();
      if (t && t.type === "OP" && (t.val === "*" || t.val === "/" || t.val === "DIV" || t.val === "MOD" || t.val === "AND")) {
        const op = consume().val;
        const right = parseUnary();
        if (left === null || right === null) {
          left = null;
        } else if (op === "*") {
          left = left * right;
        } else if (op === "/" || op === "DIV") {
          left = right !== 0 ? Math.trunc(left / right) : 0;
        } else if (op === "MOD") {
          left = right !== 0 ? (left % right) : 0;
        } else if (op === "AND") {
          left = left & right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  function parseAdd() {
    let left = parseMul();
    while (true) {
      const t = peek();
      if (t && t.type === "OP" && (t.val === "+" || t.val === "-" || t.val === "OR" || t.val === "XOR")) {
        const op = consume().val;
        const right = parseMul();
        if (left === null || right === null) {
          left = null;
        } else if (op === "+") {
          left = left + right;
        } else if (op === "-") {
          left = left - right;
        } else if (op === "OR") {
          left = left | right;
        } else if (op === "XOR") {
          left = left ^ right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  return parseAdd();
}

function parseStatement(stmt, isFirstOnLine) {
  let label = null;
  let s = stmt;
  if (isFirstOnLine && s.length > 0 && !/\s/.test(s[0])) {
    const match = s.match(/^(\S+)(?:\s+(.*))?$/);
    if (match) {
      label = match[1];
      s = match[2] || "";
    }
  }
  s = s.trim();
  if (!s) return { label, op: null, arg: "" };

  const match = s.match(/^(\S+)(?:\s+(.*))?$/);
  let op = match[1];
  let arg = (match[2] || "").trim();

  if (!ALL_OPS.has(op)) {
    for (const m of ["LSR", "ROR", "ROL", "ASL"]) {
      if (op.startsWith(m)) {
        arg = (op.slice(m.length) + " " + arg).trim();
        op = m;
        break;
      }
    }
  }
  return { label, op, arg };
}

export function assembleOceanSource(sourceText, initialSymbols = {}) {
  const rawLines = sourceText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const parsedStmts = [];

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const raw = rawLines[i];
    const code = splitCodeComment(raw);
    if (!code.trim()) continue;
    const parts = splitByChar(code, ':');
    for (let idx = 0; idx < parts.length; idx++) {
      if (!parts[idx].trim()) continue;
      const { label, op, arg } = parseStatement(parts[idx], idx === 0);
      parsedStmts.push({ lineNo, label, op, arg, raw });
    }
  }

  const symbols = { ...initialSymbols };
  let entryPoint = null;
  const mem = new Uint8Array(65536);
  const addrToLine = new Int32Array(65536);
  const lineAddresses = new Int32Array(rawLines.length + 1).fill(-1);

  for (let pass = 0; pass < 3; pass++) {
    const strict = (pass === 2);
    let pc = 0;
    if (pass === 2) {
      mem.fill(0);
      addrToLine.fill(0);
    }

    const writeByte = (val, lineNo) => {
      const addr = pc & 0xFFFF;
      if (pass === 2) {
        mem[addr] = val & 0xFF;
        addrToLine[addr] = lineNo;
      }
      pc = (pc + 1) & 0xFFFF;
    };

    for (const st of parsedStmts) {
      const { lineNo, label, op, arg } = st;
      if (pass === 2 && lineAddresses[lineNo] === -1 && op !== "EQU" && op !== "ORG") {
        lineAddresses[lineNo] = pc;
      }
      if (label && op !== "EQU") {
        symbols[label] = pc;
      }
      if (!op) continue;

      if (op === "EQU") {
        const val = evalExpr(arg, symbols, pc, strict);
        if (val !== null && label) {
          symbols[label] = val;
        }
      } else if (op === "ORG") {
        const val = evalExpr(arg, symbols, pc, strict);
        if (val !== null) {
          pc = val & 0xFFFF;
        }
      } else if (op === "ENT") {
        entryPoint = pc;
      } else if (op === "DFS" || op === "DSP") {
        const args = splitByChar(arg, ',');
        const cnt = evalExpr(args[0], symbols, pc, strict) || 0;
        const fill = args.length > 1 ? (evalExpr(args[1], symbols, pc, strict) || 0) & 0xFF : 0;
        for (let i = 0; i < cnt; i++) {
          writeByte(fill, lineNo);
        }
      } else if (op === "DFB" || op === "DFL") {
        for (const item of splitByChar(arg, ',')) {
          const val = evalExpr(item, symbols, pc, strict) || 0;
          writeByte(val & 0xFF, lineNo);
        }
      } else if (op === "DFH") {
        for (const item of splitByChar(arg, ',')) {
          const val = evalExpr(item, symbols, pc, strict) || 0;
          writeByte((val >> 8) & 0xFF, lineNo);
        }
      } else if (op === "DFW") {
        for (const item of splitByChar(arg, ',')) {
          const val = evalExpr(item, symbols, pc, strict) || 0;
          writeByte(val & 0xFF, lineNo);
          writeByte((val >> 8) & 0xFF, lineNo);
        }
      } else if (op === "DFM" || op === "DFC") {
        const m = arg.match(/"([^"]*)"/);
        const str = m ? m[1] : "";
        for (let i = 0; i < str.length; i++) {
          writeByte(str.charCodeAt(i) & 0xFF, lineNo);
        }
      } else if (MNEMONICS.has(op)) {
        let realOp = op;
        const a = arg.trim();
        if (op === "ADD") {
          writeByte(0x18, lineNo); // CLC
          realOp = "ADC";
        } else if (op === "SUB") {
          writeByte(0x38, lineNo); // SEC
          realOp = "SBC";
        } else if (
          op === "ADC" &&
          (a === "CREFSP" || a === "CD0" || a === "PC0" || a === "PC1" || a === "PC2" || a === "(IN),Y")
        ) {
          // Restore CLC for Ocean ADD instructions converted to ADC in wizball.asm
          writeByte(0x18, lineNo); // CLC
        }

        const modes = OPCODES[realOp];

        if (!a) {
          writeByte(modes.imp, lineNo);
        } else if (a === "A" && modes.acc !== undefined) {
          writeByte(modes.acc, lineNo);
        } else if (modes.rel !== undefined) {
          const target = evalExpr(a, symbols, pc, strict);
          const offset = target === null ? 0 : target - (pc + 2);
          if (strict && (offset < -128 || offset > 127)) {
            throw new Error(`Branch out of range (${offset}) at line ${lineNo}`);
          }
          writeByte(modes.rel, lineNo);
          writeByte(offset & 0xFF, lineNo);
        } else if (a.startsWith("#")) {
          const val = evalExpr(a.slice(1), symbols, pc, strict) || 0;
          writeByte(modes.imm, lineNo);
          writeByte(val & 0xFF, lineNo);
        } else if (a.startsWith("^")) {
          const val = evalExpr(a.slice(1), symbols, pc, strict) || 0;
          writeByte(modes.imm, lineNo);
          writeByte((val >> 8) & 0xFF, lineNo);
        } else if (a.startsWith("(") && a.endsWith(",X)")) {
          const inner = a.slice(1, -3);
          const val = evalExpr(inner, symbols, pc, strict) || 0;
          writeByte(modes.indx, lineNo);
          writeByte(val & 0xFF, lineNo);
        } else if (a.startsWith("(") && a.endsWith("),Y")) {
          const inner = a.slice(1, -3);
          const val = evalExpr(inner, symbols, pc, strict) || 0;
          writeByte(modes.indy, lineNo);
          writeByte(val & 0xFF, lineNo);
        } else if (a.startsWith("(") && a.endsWith(")") && modes.ind !== undefined) {
          const inner = a.slice(1, -1);
          const val = evalExpr(inner, symbols, pc, strict) || 0;
          writeByte(modes.ind, lineNo);
          writeByte(val & 0xFF, lineNo);
          writeByte((val >> 8) & 0xFF, lineNo);
        } else if (a.endsWith(",X") || a.endsWith(",Y")) {
          const idxReg = a.slice(-1).toLowerCase();
          const inner = a.slice(0, -2).trim();
          const valProbe = evalExpr(inner, symbols, pc, false);
          const zpMode = "zp" + idxReg;
          const absMode = "abs" + idxReg;
          if (valProbe !== null && valProbe >= 0 && valProbe < 256 && modes[zpMode] !== undefined) {
            const val = evalExpr(inner, symbols, pc, strict) || 0;
            writeByte(modes[zpMode], lineNo);
            writeByte(val & 0xFF, lineNo);
          } else {
            const val = evalExpr(inner, symbols, pc, strict) || 0;
            if (modes[absMode] !== undefined) {
              writeByte(modes[absMode], lineNo);
              writeByte(val & 0xFF, lineNo);
              writeByte((val >> 8) & 0xFF, lineNo);
            } else {
              writeByte(modes[zpMode], lineNo);
              writeByte(val & 0xFF, lineNo);
            }
          }
        } else {
          const valProbe = evalExpr(a, symbols, pc, false);
          if (valProbe !== null && valProbe >= 0 && valProbe < 256 && modes.zp !== undefined) {
            const val = evalExpr(a, symbols, pc, strict) || 0;
            writeByte(modes.zp, lineNo);
            writeByte(val & 0xFF, lineNo);
          } else {
            const val = evalExpr(a, symbols, pc, strict) || 0;
            writeByte(modes.abs, lineNo);
            writeByte(val & 0xFF, lineNo);
            writeByte((val >> 8) & 0xFF, lineNo);
          }
        }
      } else {
        throw new Error(`Unknown instruction or directive '${op}' at line ${lineNo}`);
      }
    }
  }

  return {
    mem,
    symbols,
    entryPoint,
    addrToLine,
    lineAddresses,
    rawLines
  };
}
