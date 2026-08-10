import os

lines = []
lines.append('import React, { useState, useCallback, useEffect, useRef } from "react";')
lines.append('import { formatYAML, yamlToJSON } from "../lib/yaml";')
lines.append('import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";')
lines.append('import { EditorState } from "@codemirror/state";')
lines.append('import { yaml as yamlLang } from "@codemirror/lang-yaml";')
lines.append('import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";')
lines.append('import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";')
lines.append('')

with open("src/components/ToolPanel.tsx", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("Wrote header")
