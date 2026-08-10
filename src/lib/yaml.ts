// YAML processing - all pure JS, runs in browser
import { parse, parseDocument, stringify } from "yaml";
import Ajv from "ajv";

export interface FormatOptions {
  indent?: number;
  sortKeys?: boolean;
  stripComments?: boolean;
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

function formatSingleYAML(input: string, options: FormatOptions = {}): FormatResult {
  const { indent = 2, sortKeys = false, stripComments = false } = options;
  try {
    let doc;
    if (stripComments) {
      // Use parseDocument to strip comments, then convert back
      const parsed = parseDocument(input);
      parsed.comment = undefined;
      parsed.commentBefore = undefined;
      // Re-parse without comments to get clean object
      doc = parse(input);
    } else {
      doc = parse(input);
    }
    if (doc === null || doc === undefined) {
      return { result: "", valid: true };
    }
    const result = stringify(doc, { indent, sortMapEntries: sortKeys });
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

// Validate YAML against a JSON Schema
export function validateSchema(yamlInput: string, schemaJson: string): SchemaValidationResult {
  try {
    const parsed = parse(yamlInput);
    const schema = JSON.parse(schemaJson);
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