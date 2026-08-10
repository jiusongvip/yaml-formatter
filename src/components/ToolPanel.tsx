import React, { useState, useCallback, useEffect, useRef } from "react";
import { formatYAML, yamlToJSON, jsonToYAML, countDocuments, computeDiff, expandAnchors, validateSchema } from "../lib/yaml";
import type { DiffChange, SchemaValidationResult } from "../lib/yaml";
import { EditorView, keymap, lineNumbers, highlightActiveLine, Decoration } from "@codemirror/view";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { StateField, StateEffect, RangeSetBuilder } from "@codemirror/state";

const DEFAULT_YAML = `apiVersion:   apps/v1
kind: Deployment
metadata:
  name:   nginx-deployment
  labels:
      app: nginx
spec:
  replicas:    3
  selector:
    matchLabels:
        app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image:   nginx:1.25
        ports:
        - containerPort:   80`;

const EXAMPLES: Record<string, string> = {
  kubernetes: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: my-app:latest
          ports:
            - containerPort: 8080
          env:
            - name: NODE_ENV
              value: production`,
  docker: `version: "3.8"
services:
  web:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://user:pass@db:5432/app
    depends_on:
      - db
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:`,
  ansible: `---
- name: Install and configure nginx
  hosts: webservers
  become: yes
  vars:
    nginx_port: 80
    server_name: example.com
  tasks:
    - name: Install nginx
      apt:
        name: nginx
        state: present
        update_cache: yes
    - name: Start nginx
      service:
        name: nginx
        state: started
        enabled: yes`,
  github: `name: CI Pipeline
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm test`,
};

// Map error messages to actionable hints for users
function getErrorHint(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes("unexpected") || m.includes("unknown")) {
    return "Check for stray characters, missing colons, or unquoted strings that look like YAML syntax.";
  }
  if (m.includes("end of the stream") || m.includes("end of the file") || m.includes("unexpected end")) {
    return "The YAML document appears to be incomplete. Check for missing closing brackets or unfinished mappings.";
  }

  if (m.includes("implicit map keys need") || m.includes("map keys must")) {
    return "Move the key and value onto the same line, or use a block scalar (| or >) for multi-line values.";
  }
  if (m.includes("tab") || m.includes("tab character")) {
    return "YAML does not allow tab characters. Replace all tabs with spaces for indentation.";
  }
  if (m.includes("duplicate") || m.includes("already") || m.includes("repeated")) {
    return "A mapping key appears more than once. Remove the duplicate or use a different key name.";
  }
  return null;
}

const JSON_EXAMPLES: Record<string, string> = {
  "package.json": `{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "yaml": "^2.7.0"
  },
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=10.0.0"
  }
}`,
  dockerConfig: `{
  "version": "3.8",
  "services": {
    "web": {
      "build": ".",
      "ports": [
        "3000:3000"
      ],
      "depends_on": [
        "db"
      ]
    },
    "db": {
      "image": "postgres:16",
      "environment": {
        "POSTGRES_DB": "app"
      }
    }
  }
}`,
  ciConfig: `{
  "name": "CI Pipeline",
  "on": {
    "push": {
      "branches": [
        "main"
      ]
    },
    "pull_request": {
      "branches": [
        "main"
      ]
    }
  },
  "jobs": {
    "test": {
      "runs-on": "ubuntu-latest",
      "steps": [
        {
          "uses": "actions/checkout@v4"
        },
        {
          "name": "Setup Node",
          "uses": "actions/setup-node@v4",
          "with": {
            "node-version": "20"
          }
        },
        {
          "run": "npm ci"
        },
        {
          "run": "npm test"
        }
      ]
    }
  }
}`,
};

type TabType = "format" | "to-json" | "json-to-yaml" | "diff" | "schema";

// Error line highlight effect
const errorLineEffect = StateEffect.define<{ line: number | null }>();
const errorLineField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(errorLineEffect)) {
        if (e.value.line === null) return Decoration.none;
        const builder = new RangeSetBuilder<Decoration>();
        const doc = tr.state.doc;
        const lineNum = e.value.line - 1; // 0-indexed
        if (lineNum >= 0 && lineNum < doc.lines) {
          const line = doc.line(lineNum + 1);
          builder.add(line.from, line.to, Decoration.line({ class: "cm-error-line" }));
        }
        return builder.finish();
      }
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const errorLineTheme = EditorView.baseTheme({
  ".cm-error-line": {
    backgroundColor: "rgba(239, 68, 68, 0.1) !important",
  },
  ".dark .cm-error-line": {
    backgroundColor: "rgba(239, 68, 68, 0.15) !important",
  },
});

function createEditorExtensions(onCtrlEnter: () => void, onDragDrop: (text: string) => void) {
  return [
    lineNumbers(),
    highlightActiveLine(),
    history(),
    yamlLang(),
    syntaxHighlighting(defaultHighlightStyle),
    errorLineField,
    errorLineTheme,
    EditorView.domEventHandlers({
      drop: (event, view) => {
        event.preventDefault();
        const file = event.dataTransfer?.files?.[0];
        if (file && (file.name.endsWith(".yaml") || file.name.endsWith(".yml"))) {
          const reader = new FileReader();
          reader.onload = (e) => {
            const text = e.target?.result as string;
            if (text) onDragDrop(text);
          };
          reader.readAsText(file);
        }
      },
      dragover: (event) => {
        event.preventDefault();
      },
    }),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
      {
        key: "Ctrl-Enter",
        run: () => {
          onCtrlEnter();
          return true;
        },
      },
      {
        key: "Mod-Enter",
        run: () => {
          onCtrlEnter();
          return true;
        },
      },
    ]),
    EditorView.theme({
      "&": { fontSize: "14px", fontFamily: "''JetBrains Mono'', ''Fira Code'', ''Cascadia Code'', monospace" },
      ".cm-scroller": { overflow: "auto" },
      ".cm-content": { padding: "12px" },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 6px", color: "var(--cm-gutter)" },
      ".cm-activeLine": { background: "var(--cm-active-line) !important" },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const event = new CustomEvent("cm-change", { detail: update.state.doc.toString() });
        update.view.dom.dispatchEvent(event);
      }
    }),
  ];
}

interface ToolPanelProps {
  initialTab?: TabType;
  initialInput?: string;
}

export default function ToolPanel({ initialTab = "format", initialInput = DEFAULT_YAML }: ToolPanelProps = {}) {
  const [input, setInput] = useState(initialInput);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<{ line: number; col: number; message: string } | null>(null);
  const [tab, setTab] = useState<TabType>(initialTab);
  const [copied, setCopied] = useState(false);
  const [indent, setIndent] = useState(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [autoFormat, setAutoFormat] = useState(true);
  const [docCount, setDocCount] = useState(0);
  const [diffChanges, setDiffChanges] = useState<DiffChange[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [formatTime, setFormatTime] = useState<number | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlLoadValue, setUrlLoadValue] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlLoadError, setUrlLoadError] = useState<string | null>(null);
  const [schemaInput, setSchemaInput] = useState("");
  const [history, setHistory] = useState<Array<{ input: string; output: string; tab: TabType; ts: number }>>([]);

  const inputRef = useRef<HTMLDivElement>(null);
  const inputEditor = useRef<EditorView | null>(null);
  const editorParentRef = useRef<HTMLDivElement>(null);

  const processYAML = useCallback(
    (value: string) => {
      if (!value.trim()) {
        setFormatTime(null);
        setOutput("");
        setError(null);
        setDocCount(0);
        setDiffChanges([]);
        return;
      }
      const t0 = performance.now();
      if (tab === "json-to-yaml") {
        const r = jsonToYAML(value);
        setOutput(r.result);
        setError(r.valid ? null : (r.error ?? null));
        setFormatTime(performance.now() - t0);
        setDocCount(0);
        setDiffChanges([]);
      } else if (tab === "to-json") {
        const r = yamlToJSON(value);
        setOutput(r.result);
        setError(r.valid ? null : (r.error ?? null));
        setFormatTime(performance.now() - t0);
        setDocCount(0);
        setDiffChanges([]);
      } else if (tab === "diff") {
        const r = formatYAML(value, { indent, sortKeys });
        if (r.valid) {
          const diff = computeDiff(value, r.result);
          setOutput(r.result);
          setDiffChanges(diff.changes);
          setError(null);
          setFormatTime(performance.now() - t0);
          setDocCount(r.documentCount ?? countDocuments(value));
        } else {
          setOutput("");
          setDiffChanges([]);
          setError(r.error ?? null);
        }
      } else {
        const r = formatYAML(value, { indent, sortKeys });
        setOutput(r.result);
        setFormatTime(performance.now() - t0);
        setError(r.valid ? null : (r.error ?? null));
        setDocCount(r.documentCount ?? countDocuments(value));
        if (r.valid && tab === "format") {
          setDiffChanges([]);
        }
      }
    },
    [tab, indent, sortKeys],
  );

  const processYAMLRef = useRef(processYAML);
  processYAMLRef.current = processYAML;
  const autoFormatRef = useRef(autoFormat);
  autoFormatRef.current = autoFormat;

  // Format handler (Ctrl+Enter)
  const handleFormat = useCallback(() => {
    if (!input.trim()) return;
    const t0 = performance.now();
    const r = formatYAML(input, { indent, sortKeys });
    if (r.valid) {
      setOutput(r.result);
      setError(null);
      setDocCount(r.documentCount ?? 0);
      setFormatTime(performance.now() - t0);
      setDiffChanges([]);
    } else {
      setError(r.error ?? null);
      setFormatTime(null);
    }
    setTab("format");
  }, [input, indent, sortKeys]);

  // Drag-drop handler
  const handleDragDrop = useCallback((text: string) => {
    if (inputEditor.current) {
      inputEditor.current.dispatch({
        changes: { from: 0, to: inputEditor.current.state.doc.length, insert: text },
      });
    }
  }, []);

  useEffect(() => {
    if (!inputRef.current || inputEditor.current) return;
    const extensions = createEditorExtensions(handleFormat, handleDragDrop);

    const editor = new EditorView({
      doc: initialInput,
      extensions,
      parent: inputRef.current,
    });

    const dom = editor.dom;
    dom.addEventListener("cm-change", ((e: Event) => {
      const val = (e as CustomEvent).detail as string;
      setInput(val);
      if (autoFormatRef.current) {
        processYAMLRef.current(val);
      }
    }) as EventListener);

    inputEditor.current = editor;
    processYAML(initialInput);

    return () => {
      editor.destroy();
      inputEditor.current = null;
    };
  }, []);

  // Re-process when tab changes or options change
  useEffect(() => {
    processYAML(input);
  }, [tab, indent, sortKeys]);

  // Toggle auto-format
  useEffect(() => {
    if (autoFormat) processYAML(input);
  }, [autoFormat]);
  // Save to history when output changes
  useEffect(() => {
    if (output && input.trim() && !error) {
      try {
        const entry = { input: input.slice(0, 5000), output: output.slice(0, 5000), tab, ts: Date.now() };
        const h = JSON.parse(localStorage.getItem("yf-history") || "[]");
        const filtered = h.filter((e: { input: string }) => e.input !== entry.input);
        filtered.unshift(entry);
        const trimmed = filtered.slice(0, 20);
        localStorage.setItem("yf-history", JSON.stringify(trimmed));
        setHistory(trimmed);
      } catch {}
    }
  }, [output]);

  // Apply error line highlight to editor
  useEffect(() => {
    if (inputEditor.current && tab !== "diff") {
      inputEditor.current.dispatch({
        effects: [errorLineEffect.of({ line: error?.line ?? null })],
      });
    }
  }, [error, tab]);

  // Load shared YAML from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#data=")) {
      try {
        const encoded = hash.slice(6);
        const decoded = decodeURIComponent(
          Array.from(atob(encoded), (c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
        );
        if (inputEditor.current) {
          inputEditor.current.dispatch({
            changes: { from: 0, to: inputEditor.current.state.doc.length, insert: decoded },
          });
        }
        window.history.replaceState({}, "", window.location.pathname + window.location.search);
      } catch {
        window.history.replaceState({}, "", window.location.pathname + window.location.search);
      }
    }
  }, []);

  const handleTabChange = (newTab: TabType) => {
    const trimmed = input.trim();
    // When switching to a tab that expects a different input format, clear if incompatible
    if (newTab === "json-to-yaml" && trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      setInput("");
      setOutput("");
      setError(null);
      if (inputEditor.current) {
        inputEditor.current.dispatch({
          changes: { from: 0, to: inputEditor.current.state.doc.length, insert: "" },
        });
      }
    } else if ((newTab === "format" || newTab === "to-json" || newTab === "diff") && trimmed && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
      setInput("");
      setOutput("");
      setError(null);
      if (inputEditor.current) {
        inputEditor.current.dispatch({
          changes: { from: 0, to: inputEditor.current.state.doc.length, insert: "" },
        });
      }
    }
    setTab(newTab);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    if (inputEditor.current) {
      inputEditor.current.dispatch({
        changes: { from: 0, to: inputEditor.current.state.doc.length, insert: "" },
      });
    }
  };

  const handleLoadExample = (type: string, isJson: boolean = false) => {
    const yml = isJson ? (JSON_EXAMPLES[type] || "") : (EXAMPLES[type] || "");
    if (inputEditor.current) {
      inputEditor.current.dispatch({
        changes: { from: 0, to: inputEditor.current.state.doc.length, insert: yml },
      });
    }
    if (isJson && tab !== "json-to-yaml") {
      setTab("json-to-yaml");
    } else if (!isJson && tab === "json-to-yaml") {
      setTab("format");
    }
  };

  // Share: base64-encode output YAML and copy shareable URL
  const handleShare = async () => {
    if (!output) return;
    const encoded = btoa(
      encodeURIComponent(output).replace(/%([0-9A-F]{2})/g, (_m: string, p: string) =>
        String.fromCharCode(parseInt(p, 16))
      )
    );
    const url = `${window.location.origin}${window.location.pathname}#data=${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    } catch {
      // Clipboard API not available
    }
  };

  // Load YAML from URL
  const handleUrlLoad = async () => {
    if (!urlLoadValue.trim()) return;
    setUrlLoading(true);
    setUrlLoadError(null);
    try {
      const resp = await fetch(urlLoadValue.trim());
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      if (!text.trim()) throw new Error("Empty response");
      if (inputEditor.current) {
        inputEditor.current.dispatch({
          changes: { from: 0, to: inputEditor.current.state.doc.length, insert: text },
        });
      }
      setShowUrlInput(false);
      setUrlLoadValue("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to fetch URL";
      setUrlLoadError(msg);
    }
    setUrlLoading(false);
  };

  const inputLines = input.split("\n").length;
  const outputLines = output ? output.split("\n").length : 0;

  return (
    <section id="formatter" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-6">
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-950/80">
          {/* Tab buttons */}
          <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-white dark:bg-zinc-900">
            <button onClick={() => handleTabChange("format")} className={`px-3.5 py-1.5 text-xs font-semibold transition-colors border-r border-zinc-200 dark:border-zinc-700 ${tab === "format" ? "bg-emerald-600 text-white" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
              Format
            </button>
            <button onClick={() => handleTabChange("to-json")} className={`px-3.5 py-1.5 text-xs font-semibold transition-colors border-r border-zinc-200 dark:border-zinc-700 ${tab === "to-json" ? "bg-emerald-600 text-white" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
              YAML to JSON
            </button>
            <button onClick={() => handleTabChange("json-to-yaml")} className={`px-3.5 py-1.5 text-xs font-semibold transition-colors border-r border-zinc-200 dark:border-zinc-700 ${tab === "json-to-yaml" ? "bg-emerald-600 text-white" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
              JSON to YAML
            </button>
            <button onClick={() => handleTabChange("diff")} className={`px-3.5 py-1.5 text-xs font-semibold transition-colors ${tab === "diff" ? "bg-emerald-600 text-white" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
              Diff
            </button>
          </div>

          {tab === "format" && (
            <>
              <select value={indent} onChange={(e) => setIndent(Number(e.target.value))}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 cursor-pointer">
                <option value={2}>Indent: 2</option>
                <option value={4}>Indent: 4</option>
                <option value={8}>Indent: 8</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer select-none">
                <input type="checkbox" checked={sortKeys} onChange={(e) => setSortKeys(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-600 text-emerald-600 focus:ring-emerald-500 cursor-pointer" />
                Sort keys
              </label>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer select-none">
                <input type="checkbox" checked={autoFormat} onChange={(e) => setAutoFormat(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-600 text-emerald-600 focus:ring-emerald-500 cursor-pointer" />
                Auto
              </label>
            </>
          )}

          <div className="flex-1" />

          <div className="flex items-center gap-1.5">
            <button onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (text && inputEditor.current) {
                  inputEditor.current.dispatch({ changes: { from: 0, to: inputEditor.current.state.doc.length, insert: text } });
                }
              } catch {}
            }} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="Paste from clipboard">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </button>
            <button onClick={handleClear} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
              Clear
            </button>
            <button
              onClick={() => { setShowUrlInput(true); setUrlLoadError(null); }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Load YAML from a URL"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
            </button>
            <button onClick={handleCopy}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${copied ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"}`}>
              {copied ? (
                <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg> Copied</>
              ) : (
                <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg> Copy</>
              )}
            </button>
            {output && !error && (
              <button onClick={handleShare}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${shareCopied ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300" : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                {shareCopied ? "Link Copied" : "Share"}
              </button>
            )}
          </div>
        </div>

        {/* Editors */}
                  {tab === "schema" && (
            <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-950/80">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 block mb-1.5">JSON Schema</label>
              <textarea
                value={schemaInput}
                onChange={(e) => setSchemaInput(e.target.value)}
                placeholder="Enter a JSON Schema to validate your YAML against..."
                rows={4}
                className="w-full h-[80px] px-3 py-2 text-xs font-mono rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none"
              />
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-xs text-zinc-400 dark:text-zinc-500">Try:</span>
                <button onClick={() => setSchemaInput('{"type":"object","required":["apiVersion","kind","metadata"],"properties":{"apiVersion":{"type":"string"},"kind":{"type":"string","enum":["Deployment","Service","Pod"]},"metadata":{"type":"object","required":["name"],"properties":{"name":{"type":"string"},"labels":{"type":"object"}}}}}')} className="px-2 py-0.5 text-xs rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-emerald-300 dark:hover:border-emerald-700 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer">K8s Object</button>
                <button onClick={() => setSchemaInput('{"type":"object","required":["services"],"properties":{"services":{"type":"object","additionalProperties":{"type":"object","properties":{"image":{"type":"string"},"ports":{"type":"array"}}}}}}')} className="px-2 py-0.5 text-xs rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-emerald-300 dark:hover:border-emerald-700 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer">Docker Compose</button>
                <button onClick={() => setSchemaInput('{"type":"object","required":["on","jobs"],"properties":{"on":{"type":"object"},"jobs":{"type":"object","additionalProperties":{"type":"object","required":["runs-on","steps"],"properties":{"runs-on":{"type":"string"},"steps":{"type":"array"}}}}}}')} className="px-2 py-0.5 text-xs rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-emerald-300 dark:hover:border-emerald-700 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer">GitHub Actions</button>
              </div>
            </div>
          )}
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-zinc-200 dark:divide-zinc-700" style={{ "--cm-gutter": "#9ca3af", "--cm-active-line": "#f4f4f5" } as React.CSSProperties}>
          {/* Input */}
          <div ref={editorParentRef} className={`relative bg-white dark:bg-zinc-950 [&_.cm-editor]:h-[440px] lg:[&_.cm-editor]:h-[520px] [&_.cm-editor]:outline-none [&_.cm-scroller]:overscroll-contain ${isDragging ? "ring-2 ring-emerald-400 ring-inset" : ""}`}>
            <div ref={inputRef} className="h-full" />
            {/* Drag & drop overlay */}
            {isDragging && (
              <div className="absolute inset-0 flex items-center justify-center bg-emerald-50/80 dark:bg-emerald-950/50 z-10 pointer-events-none">
                <div className="text-center">
                  <svg className="w-10 h-10 mx-auto text-emerald-500 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Drop .yaml or .yml file</span>
                </div>
              </div>
            )}
          </div>

          {/* Output */}
          <div className="relative h-[440px] lg:h-[520px]">
            {/* Mode indicator */}
            {tab !== "format" && (
              <div className="absolute top-2 left-2 z-10">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {tab === "to-json" ? "YAML → JSON" : tab === "json-to-yaml" ? "JSON → YAML" : tab === "diff" ? "Diff" : "Schema"}
                </span>
              </div>
            )}
            <div className="h-full bg-zinc-50/50 dark:bg-zinc-950/50 overflow-auto">
            {tab === "diff" && diffChanges.length > 0 ? (
              <div className="font-mono text-sm h-full">
                {output.split("\n").map((line, i) => {
                  const change = diffChanges.find((c) => c.line === i + 1);
                  let bg = "";
                  let prefix = "  ";
                  if (change?.type === "added") {
                    bg = "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300";
                    prefix = "+ ";
                  } else if (change?.type === "removed") {
                    bg = "bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300";
                    prefix = "- ";
                  } else if (change?.type === "modified") {
                    bg = "bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300";
                    prefix = "~ ";
                  }
                  return (
                    <div key={i} className={`flex px-4 py-0.5 ${bg} min-h-[1.6em]`}>
                      <span className="w-6 text-right mr-3 text-zinc-300 dark:text-zinc-600 select-none shrink-0">{i + 1}</span>
                      <span className={change ? "font-medium" : "text-zinc-500 dark:text-zinc-400"}>{prefix}{line || "\u00A0"}</span>
                    </div>
                  );
                })}
              </div>
            ) : error ? (
              <div className="p-5 font-mono text-sm h-full">
                <div className="flex items-center gap-2 mb-4">
                  <svg className="w-5 h-5 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                  <span className="font-semibold text-red-600 dark:text-red-400">{tab === "json-to-yaml" ? "JSON Syntax Error" : "YAML Syntax Error"}</span>
                </div>
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <div className="text-red-800 dark:text-red-200 font-medium mb-2">Line {error.line}, Column {error.col}</div>
                  <div className="text-red-700 dark:text-red-300 text-sm leading-relaxed">{error.message}</div>
                </div>
                {(tab === "json-to-yaml") ? (
                  <div className="mt-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-2.5">
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14"/></svg>
                      <p className="text-amber-700 dark:text-amber-300 text-sm leading-relaxed">This input looks like YAML, not JSON. The <strong className="font-semibold">JSON to YAML</strong> converter requires valid JSON input (starting with <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-xs font-mono">{'{'}</code> or <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-xs font-mono">[</code>).</p>
                    </div>
                    <button onClick={() => setTab("format")} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-colors">
                      Switch to Format
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
                    </button>
                  </div>
                ) : getErrorHint(error.message) && (
                  <div className="mt-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-2">
                    <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span className="text-amber-700 dark:text-amber-300 text-sm">{getErrorHint(error.message)}</span>
                  </div>
                )}
                <div className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
                  Fix the error in the input panel and the output will update automatically.
                </div>
              </div>
            ) : output ? (
              <pre className="p-5 font-mono text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed">{output}</pre>
            ) : (
              <div className="flex items-center justify-center h-full">
                <span className="text-sm text-zinc-400 dark:text-zinc-500">
                  {tab === "format" ? "Formatted YAML will appear here" : tab === "to-json" ? "JSON output will appear here" : tab === "json-to-yaml" ? "YAML output will appear here" : tab === "diff" ? "Diff view — format first to see changes" : "Enter a JSON Schema above to validate your YAML"}
                </span>
              </div>
            )}
            </div>
            {output && !error && tab !== "diff" && tab !== "schema" && (
              <div className="absolute bottom-3 right-3 z-10">
                <button onClick={handleCopy}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg transition-all">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                  {copied ? "Copied!" : "Copy Result"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-4 px-4 py-1.5 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-950/80 text-xs text-zinc-400 dark:text-zinc-500 font-mono">
          <div className="flex items-center gap-1.5">
            {error ? (
              <span className="inline-flex items-center gap-1 text-red-500 dark:text-red-400">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Invalid
              </span>
            ) : input.trim() ? (
              <span className="inline-flex items-center gap-1 text-emerald-500 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Valid
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600" /> Empty
              </span>
            )}
          </div>
          <span className="text-zinc-300 dark:text-zinc-600">|</span>
          <span>{inputLines} lines</span>
          <span>{input.length.toLocaleString()} chars</span>
          {docCount > 1 && (
            <>
              <span className="text-zinc-300 dark:text-zinc-600">|</span>
              <span className="text-emerald-500 dark:text-emerald-400">{docCount} docs</span>
            </>
          )}
          {formatTime !== null && (
            <>
              <span className="text-zinc-300 dark:text-zinc-600">|</span>
              <span className="text-emerald-500 dark:text-emerald-400">
                Formatted in {formatTime < 1 ? "<1" : formatTime.toFixed(formatTime < 10 ? 1 : 0)}ms
              </span>
            </>
          )}
          <span className="text-zinc-300 dark:text-zinc-600">|</span>
          <span>Ctrl+Enter to format</span>
          <span className="text-zinc-300 dark:text-zinc-600">|</span>
          <span>YAML 1.2</span>
        </div>
      </div>

      {/* Examples */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">Try an example:</span>
        {tab === "json-to-yaml" ? (
          Object.entries({ "package.json": "Package.json", dockerConfig: "Docker Config", ciConfig: "CI Config" }).map(([id, label]) => (
            <button key={id} onClick={() => handleLoadExample(id, true)}
              className="px-2.5 py-1 text-xs rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-emerald-300 dark:hover:border-emerald-700 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer">
              {label}
            </button>
          ))
        ) : (
          Object.entries({ kubernetes: "K8s Deploy", docker: "Docker Compose", ansible: "Ansible", github: "CI/CD" }).map(([id, label]) => (
            <button key={id} onClick={() => handleLoadExample(id)}
              className="px-2.5 py-1 text-xs rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-emerald-300 dark:hover:border-emerald-700 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer">
              {label}
            </button>
          ))
        )}
      </div>

      {/* URL Load Modal */}
      {showUrlInput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowUrlInput(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-2xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Load YAML from URL</h3>
            <div className="flex gap-2">
              <input
                type="url"
                value={urlLoadValue}
                onChange={(e) => setUrlLoadValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUrlLoad()}
                placeholder="https://raw.githubusercontent.com/..."
                autoFocus
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
              <button onClick={handleUrlLoad} disabled={urlLoading || !urlLoadValue.trim()}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors">
                {urlLoading ? "Loading..." : "Load"}
              </button>
            </div>
            {urlLoadError && (
              <p className="mt-2 text-xs text-red-500">{urlLoadError}</p>
            )}
            <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
              Paste a link to a raw YAML file (GitHub raw, Gist, etc.)
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
