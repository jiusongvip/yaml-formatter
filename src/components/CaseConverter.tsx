import React, { useMemo, useState } from "react";

type CaseMode =
  | "sentence"
  | "lower"
  | "upper"
  | "capitalized"
  | "alternating"
  | "title"
  | "inverse";

const MODES: Array<{ id: CaseMode; label: string; hint: string }> = [
  { id: "sentence", label: "Sentence", hint: "Sentence case" },
  { id: "lower", label: "lower", hint: "lower case" },
  { id: "upper", label: "UPPER", hint: "UPPER CASE" },
  { id: "capitalized", label: "Capitalized", hint: "Capitalized Case" },
  { id: "alternating", label: "aLtErNaTiNg", hint: "aLtErNaTiNg cAsE" },
  { id: "title", label: "Title", hint: "Title Case" },
  { id: "inverse", label: "InVeRsE", hint: "InVeRsE CaSe" },
];

const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet",
  "at", "by", "to", "of", "in", "on", "with", "from", "up", "out",
  "over", "under", "again", "further", "then", "once", "here", "there",
  "when", "where", "why", "how", "as", "than", "into", "onto", "off",
]);

function toTitleCase(input: string): string {
  return input.replace(/[A-Za-zÀ-ÿ]+/g, (word, offset, full) => {
    const lower = word.toLowerCase();
    const first = offset === 0;
    const last = offset + word.length >= full.length;
    const keepLower = TITLE_STOPWORDS.has(lower) && !first && !last;
    if (keepLower) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

function toSentenceCase(input: string): string {
  let out = "";
  let start = true;
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/[A-Za-zÀ-ÿ]/.test(ch)) {
      out += start ? ch.toUpperCase() : ch.toLowerCase();
      start = false;
    } else {
      out += ch;
      if (/[.!?…]/.test(ch)) start = true;
    }
    i++;
  }
  // standalone "i" → "I"
  out = out.replace(/(^|\s)i(?=\s|$)/g, (_m, pre: string) => pre + "I");
  return out;
}

function toAlternating(input: string): string {
  let flip = true;
  let out = "";
  for (const ch of input) {
    if (/[A-Za-zÀ-ÿ]/.test(ch)) {
      out += flip ? ch.toUpperCase() : ch.toLowerCase();
      flip = !flip;
    } else {
      out += ch;
    }
  }
  return out;
}

function toInverse(input: string): string {
  let out = "";
  for (const ch of input) {
    if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) out += ch.toLowerCase();
    else if (ch === ch.toLowerCase() && ch !== ch.toUpperCase()) out += ch.toUpperCase();
    else out += ch;
  }
  return out;
}

function convert(input: string, mode: CaseMode): string {
  switch (mode) {
    case "lower":
      return input.toLowerCase();
    case "upper":
      return input.toUpperCase();
    case "capitalized":
      return input.replace(/[A-Za-zÀ-ÿ]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    case "title":
      return toTitleCase(input);
    case "sentence":
      return toSentenceCase(input);
    case "alternating":
      return toAlternating(input);
    case "inverse":
      return toInverse(input);
  }
}

const SAMPLE = `accidentally left the caps lock on? This is how it ends up looking in every mode. Try the tabs above to shift the whole block instantly.`;

export default function CaseConverter() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<CaseMode>("sentence");
  const [copied, setCopied] = useState(false);

  const output = useMemo(() => convert(input, mode), [input, mode]);
  const stats = useMemo(() => {
    const trimmed = input.trim();
    return {
      chars: input.length,
      words: trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0,
      lines: input ? input.split(/\r\n|\r|\n/).length : 0,
    };
  }, [input]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section id="case-converter" className="container-tool py-6">
      <div className="tool-card">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 bg-zinc-50">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-6 h-6 rounded-md bg-blue-600 text-white text-[11px] font-bold">Cc</span>
            <span className="text-sm font-semibold text-zinc-900">Case Converter</span>
          </div>
          <span className="text-xs text-zinc-400">7 modes · live output</span>
        </div>

        {/* mode tabs */}
        <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-zinc-200">
          <span className="text-xs font-medium text-zinc-400">Mode</span>
          <div className="tabs" role="tablist" aria-label="Case mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={mode === m.id}
                title={m.hint}
                onClick={() => setMode(m.id)}
                className="tab"
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-zinc-200">
          {/* input */}
          <div className="p-5">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-sm font-medium text-zinc-700">Input</span>
              <span className="text-xs text-zinc-400">{stats.chars} chars · {stats.words} words · {stats.lines} lines</span>
            </div>
            <textarea
              className="tool-input h-[260px]"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste your text here — it converts live as you type…"
              aria-label="Input text"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => { setInput(SAMPLE); setMode("sentence"); }}>
                Load sample
              </button>
              <button
                className="btn-secondary text-xs px-3 py-1.5"
                onClick={() => setInput("")}
              >
                Clear
              </button>
            </div>
          </div>

          {/* output */}
          <div className="p-5">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-sm font-medium text-zinc-700">Output — {MODES.find((m) => m.id === mode)?.hint}</span>
              <button
                onClick={handleCopy}
                className="btn-primary text-xs px-3 py-1.5"
                disabled={!input}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <textarea
              className="tool-input h-[260px]"
              readOnly
              value={output}
              aria-label="Converted output"
            />
          </div>
        </div>

        <div className="statusline">
          <span><b className="hit">{MODES.find((m) => m.id === mode)?.hint}</b></span>
          <span className="sep">|</span>
          <span>Letters flipped on the fly</span>
          <span className="sep">|</span>
          <span className="font-mono">Nothing leaves your browser</span>
        </div>
      </div>
    </section>
  );
}