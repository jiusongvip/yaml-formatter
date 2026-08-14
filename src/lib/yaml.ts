// YAML processing - all pure JS, runs in browser
import { parse, parseDocument, stringify } from "yaml";

export interface FormatOptions {
  indent?: number;
  sortKeys?: boolean;
  stripComments?: boolean;
  quoteStyle?: "double" | "single" | "plain";
}

export interface FormatResult {
  result: string;
  valid: boolean;
  error?: { line: number; col: number; message: string };
  documentCount?: number;
}

export interface DiffResult {
  original: string;
  formatted: string;
  changes: DiffChange[];
}

export interface DiffChange {
  type: "added" | "removed" | "modified";
  line: number;
  content: string;
}

// Count YAML documents separated by ---
export function countDocuments(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  const docs = trimmed.split(/^---(?:\s*$|\s)/m);
  return docs.filter((d) => d.trim().length > 0).length;
}

// Split multi-document YAML into individual documents
export function splitDocuments(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const docs: string[] = [];
  const lines = trimmed.split("\n");
  let current: string[] = [];
  for (const line of lines) {
    if (/^---(?:\s*)$/.test(line) && current.length > 0) {
      docs.push(current.join("\n").trim());
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    docs.push(current.join("\n").trim());
  }
  return docs.filter((d) => d.length > 0);
}

const QUOTE_STYLE_MAP = {
  double: "QUOTE_DOUBLE",
  single: "QUOTE_SINGLE",
  plain: "PLAIN",
} as const;

function formatSingleYAML(input: string, options: FormatOptions = {}): FormatResult {
  const { indent = 2, sortKeys = false, stripComments = false, quoteStyle } = options;
  try {
    let doc;
    if (stripComments) {
      // Use parseDocument to strip comments, then convert back
      const parsed = parseDocument(input);
      parsed.comment = null;
      parsed.commentBefore = null;
      // Re-parse without comments to get clean object
      doc = parse(input);
    } else {
      doc = parse(input);
    }
    if (doc === null || doc === undefined) {
      return { result: "", valid: true };
    }
    const result = stringify(doc, {
      indent,
      sortMapEntries: sortKeys,
      defaultStringType: quoteStyle ? QUOTE_STYLE_MAP[quoteStyle] : undefined,
    });
    return { result, valid: true };
  } catch (e: unknown) {
    const err = e as { linePos?: Array<{ line: number; col: number }>; message: string };
    return {
      result: input,
      valid: false,
      error: {
        line: err.linePos?.[0]?.line ?? 1,
        col: err.linePos?.[0]?.col ?? 0,
        message: err.message || "Unknown YAML error",
      },
    };
  }
}

// Format YAML with full multi-document support
export function formatYAML(input: string, options: FormatOptions = {}): FormatResult {
  const docs = splitDocuments(input);
  if (docs.length > 1) {
    const results = docs.map((d) => formatSingleYAML(d, options));
    const anyError = results.find((r) => !r.valid);
    if (anyError) {
      return { result: input, valid: false, error: anyError.error, documentCount: docs.length };
    }
    const combined = results.map((r) => r.result).join("\n---\n");
    return { result: combined, valid: true, documentCount: docs.length };
  }
  return formatSingleYAML(input, options);
}

// Convert YAML to JSON
export function yamlToJSON(input: string): FormatResult {
  try {
    const doc = parse(input);
    const result = JSON.stringify(doc, null, 2);
    return { result, valid: true };
  } catch (e: unknown) {
    const err = e as { linePos?: Array<{ line: number; col: number }>; message: string };
    return {
      result: input,
      valid: false,
      error: {
        line: err.linePos?.[0]?.line ?? 1,
        col: err.linePos?.[0]?.col ?? 0,
        message: err.message || "Unknown YAML error",
      },
    };
  }
}

export function jsonToYAML(input: string): FormatResult {
  try {
    const parsed = JSON.parse(input);
    const result = stringify(parsed, { indent: 2 });
    return { result, valid: true };
  } catch (e: unknown) {
    const err = e as { message: string };
    return { result: input, valid: false, error: { line: 1, col: 1, message: err.message || "Invalid JSON" } };
  }
}

// Expand YAML anchors - resolve all aliases to full values
export function expandAnchors(input: string): FormatResult {
  try {
    const resolved = parse(input);
    const result = stringify(resolved, { indent: 2 });
    return { result, valid: true };
  } catch (e: unknown) {
    const err = e as { linePos?: Array<{ line: number; col: number }>; message: string };
    return {
      result: input,
      valid: false,
      error: {
        line: err.linePos?.[0]?.line ?? 1,
        col: err.linePos?.[0]?.col ?? 0,
        message: err.message || "Unknown YAML error",
      },
    };
  }
}

// Compute line-by-line diff between original and formatted YAML
export function computeDiff(original: string, formatted: string): DiffResult {
  const origLines = original.split("\n");
  const fmtLines = formatted.split("\n");
  const changes: DiffChange[] = [];

  const maxLen = Math.max(origLines.length, fmtLines.length);
  for (let i = 0; i < maxLen; i++) {
    const origLine = origLines[i] ?? "";
    const fmtLine = fmtLines[i] ?? "";
    if (origLine === "" && fmtLine !== "") {
      changes.push({ type: "added", line: i + 1, content: fmtLine });
    } else if (fmtLine === "" && origLine !== "") {
      changes.push({ type: "removed", line: i + 1, content: origLine });
    } else if (origLine.trim() !== fmtLine.trim()) {
      changes.push({ type: "modified", line: i + 1, content: fmtLine });
    }
  }

  return { original, formatted, changes };
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string; keyword: string }>;
}

// Validate YAML against a JSON Schema. Ajv is loaded on demand so the main
// tool bundle never pays for it — only the Schema tab triggers this.
export async function validateSchema(yamlInput: string, schemaJson: string): Promise<SchemaValidationResult> {
  try {
    const parsed = parse(yamlInput);
    const schema = JSON.parse(schemaJson);
    const { default: Ajv } = await import("ajv");
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const valid = validate(parsed);
    const errors = (validate.errors || []).map((e) => ({
      path: e.instancePath || "(root)",
      message: e.message || "Unknown error",
      keyword: e.keyword,
    }));
    return { valid: valid as boolean, errors };
  } catch (e: unknown) {
    const err = e as { message: string };
    return { valid: false, errors: [{ path: "(schema)", message: err.message || "Invalid JSON Schema", keyword: "parse" }] };
  }
}

// ---------- YAML -> TOML conversion (pure client-side) ----------

function tomlEscapeString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\x00-\x1f\x7f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

function tomlKey(k: string): string {
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : '"' + tomlEscapeString(k) + '"';
}

function tomlScalar(v: unknown): string | null {
  if (v === null || v === undefined) return null; // TOML has no null
  if (typeof v === "string") return '"' + tomlEscapeString(v) + '"';
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (Array.isArray(v)) {
    const items = v.map(tomlScalar).filter((x): x is string => x !== null);
    return "[" + items.join(", ") + "]";
  }
  return null;
}

function isArrayOfObjects(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every((x) => x !== null && typeof x === "object" && !Array.isArray(x));
}

// Serialize a mapping into TOML lines. Scalars are emitted first, then nested
// tables and array-of-tables, so later [table] headers never swallow loose keys.
function serializeTOMLTable(obj: Record<string, unknown>, path: string[], lines: string[]): void {
  const entries = Object.entries(obj);
  for (const [k, v] of entries) {
    const isTable = v !== null && typeof v === "object" && !Array.isArray(v);
    const isArrayTable = Array.isArray(v) && isArrayOfObjects(v);
    if (isTable || isArrayTable) continue;
    const s = tomlScalar(v);
    if (s !== null) lines.push(tomlKey(k) + " = " + s);
  }
  for (const [k, v] of entries) {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      lines.push("");
      lines.push("[" + [...path, k].map(tomlKey).join(".") + "]");
      serializeTOMLTable(v as Record<string, unknown>, [...path, k], lines);
    } else if (Array.isArray(v) && isArrayOfObjects(v)) {
      for (const item of v as Record<string, unknown>[]) {
        lines.push("");
        lines.push("[[" + [...path, k].map(tomlKey).join(".") + "]]");
        serializeTOMLTable(item, [...path, k], lines);
      }
    }
  }
}

// Convert YAML to TOML. TOML has no null literal, so null values are dropped
// rather than emitted as invalid syntax.
export function yamlToTOML(input: string): FormatResult {
  try {
    const doc = parse(input);
    if (doc === null || doc === undefined) {
      return { result: "", valid: true };
    }
    if (typeof doc !== "object" || Array.isArray(doc)) {
      return { result: input, valid: false, error: { line: 1, col: 1, message: "TOML conversion requires a top-level mapping (key/value object)." } };
    }
    const lines: string[] = [];
    serializeTOMLTable(doc as Record<string, unknown>, [], lines);
    return { result: lines.join("\n").replace(/^\n+/, ""), valid: true };
  } catch (e: unknown) {
    const err = e as { linePos?: Array<{ line: number; col: number }>; message: string };
    return {
      result: input,
      valid: false,
      error: {
        line: err.linePos?.[0]?.line ?? 1,
        col: err.linePos?.[0]?.col ?? 0,
        message: err.message || "Unknown YAML error",
      },
    };
  }
}

// ---------- Input format auto-detection ----------

export type DetectedFormat = "yaml" | "json" | "unknown";

export function detectInputFormat(input: string): DetectedFormat {
  const t = input.trim();
  if (!t) return "unknown";
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      return "yaml"; // braces/brackets can also start valid YAML flow collections
    }
  }
  return "yaml";
}

// ---------- YAML -> XML conversion (pure client-side) ----------

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// XML element names cannot start with a digit and may not contain spaces or
// most punctuation, so normalize keys into legal tag names.
function xmlTagName(key: string): string {
  let name = key.replace(/[^A-Za-z0-9_.-]/g, "_");
  if (/^[0-9]/.test(name)) name = "_" + name;
  return name || "item";
}

function xmlSerializeValue(value: unknown, tag: string, indent: number, lines: string[]): void {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) {
    lines.push(`${pad}<${tag} />`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      xmlSerializeValue(item, tag, indent, lines);
    }
    return;
  }
  if (typeof value === "object") {
    lines.push(`${pad}<${tag}>`);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      xmlSerializeValue(v, xmlTagName(k), indent + 1, lines);
    }
    lines.push(`${pad}</${tag}>`);
    return;
  }
  lines.push(`${pad}<${tag}>${xmlEscape(String(value))}</${tag}>`);
}

// Convert YAML to XML. XML requires exactly one root element, so a multi-key
// top-level mapping is wrapped in a <root> element; a single-key mapping uses
// that key as the root instead.
export function yamlToXML(input: string): FormatResult {
  try {
    const doc = parse(input);
    if (doc === null || doc === undefined) {
      return { result: "", valid: true };
    }
    const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
    if (Array.isArray(doc)) {
      lines.push("<root>");
      for (const item of doc) {
        xmlSerializeValue(item, "item", 1, lines);
      }
      lines.push("</root>");
    } else if (typeof doc === "object") {
      const entries = Object.entries(doc as Record<string, unknown>);
      if (entries.length === 1) {
        xmlSerializeValue(doc, xmlTagName(entries[0][0]), 0, lines);
      } else {
        lines.push("<root>");
        for (const [k, v] of entries) {
          xmlSerializeValue(v, xmlTagName(k), 1, lines);
        }
        lines.push("</root>");
      }
    } else {
      lines.push(`<root>${xmlEscape(String(doc))}</root>`);
    }
    return { result: lines.join("\n"), valid: true };
  } catch (e: unknown) {
    const err = e as { linePos?: Array<{ line: number; col: number }>; message: string };
    return {
      result: input,
      valid: false,
      error: {
        line: err.linePos?.[0]?.line ?? 1,
        col: err.linePos?.[0]?.col ?? 0,
        message: err.message || "Unknown YAML error",
      },
    };
  }
}