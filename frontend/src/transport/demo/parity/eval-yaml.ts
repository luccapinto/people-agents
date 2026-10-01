/** Minimal YAML reader for the evaluation files under `shared/eval` (the front-end has no YAML
 *  dependency, and these files only use a small, fixed subset).
 *
 *  Supported: full-line comments, block mappings, block sequences of mappings, flow sequences
 *  (`[a, b]`), flow mappings (`{k: v}`), double-quoted and plain scalars, integers and booleans.
 *  Anything else (anchors, multi-line scalars, nested block sequences) is out of scope. */
import { readFileSync } from 'node:fs';

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  indent: number;
  text: string;
}

function scalar(raw: string): YamlValue {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    return text.slice(1, -1).split('\\"').join('"').split('\\\\').join('\\');
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).split("''").join("'");
  if (text.startsWith('[') && text.endsWith(']')) return splitFlow(text.slice(1, -1)).map(scalar);
  if (text.startsWith('{') && text.endsWith('}')) {
    const out: Record<string, YamlValue> = {};
    for (const part of splitFlow(text.slice(1, -1))) {
      const at = splitKey(part);
      if (at < 0) continue;
      out[part.slice(0, at).trim()] = scalar(part.slice(at + 1));
    }
    return out;
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  return text;
}

/** Top-level commas of a flow collection (quotes and nested brackets are skipped). */
function splitFlow(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const ch of body) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Index of the `:` that separates a key from its value, outside quotes and brackets. */
function splitKey(text: string): number {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    else if (ch === ':' && depth === 0 && (i + 1 === text.length || text[i + 1] === ' ')) return i;
  }
  return -1;
}

function parseBlock(lines: Line[], start: number, indent: number): [YamlValue, number] {
  const head = lines[start].text;
  if (head.startsWith('{') || head.startsWith('[')) return [scalar(head), start + 1];
  if (lines[start].text.startsWith('- ')) {
    const items: YamlValue[] = [];
    let i = start;
    while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
      const inner: Line[] = [{ indent: indent + 2, text: lines[i].text.slice(2) }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > indent) {
        inner.push(lines[j]);
        j += 1;
      }
      items.push(parseBlock(inner, 0, indent + 2)[0]);
      i = j;
    }
    return [items, i];
  }
  const map: Record<string, YamlValue> = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const at = splitKey(lines[i].text);
    if (at < 0) break;
    const key = lines[i].text.slice(0, at).trim();
    const rest = lines[i].text.slice(at + 1).trim();
    if (rest) {
      map[key] = scalar(rest);
      i += 1;
      continue;
    }
    i += 1;
    if (i < lines.length && lines[i].indent > indent) {
      const [value, next] = parseBlock(lines, i, lines[i].indent);
      map[key] = value;
      i = next;
    } else {
      map[key] = null;
    }
  }
  return [map, i];
}

export function loadYaml(path: string): Record<string, YamlValue> {
  const lines: Line[] = [];
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const text = raw.trimEnd();
    if (!text.trim() || text.trimStart().startsWith('#')) continue;
    lines.push({ indent: text.length - text.trimStart().length, text: text.trim() });
  }
  return parseBlock(lines, 0, 0)[0] as Record<string, YamlValue>;
}
