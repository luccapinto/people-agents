# Design direction

Calm, precise, trustworthy: Linear/Vercel cleanliness with the comfort of a modern chat app.
No template look, no emojis, no CDN (fonts are self-hosted with `@fontsource`).

## Tokens

CSS variables on `:root` (light) and `.dark` (dark); Tailwind reads them.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f7f8f8` | `#08090a` | page |
| `--panel` | `#ffffff` | `#0f1011` | sidebar, panels |
| `--surface` | `#f3f4f5` | `#191a1b` | elevated rows, inputs |
| `--border` | `#e3e5e8` | `rgba(255,255,255,0.08)` | default border |
| `--border-subtle` | `#eceef0` | `rgba(255,255,255,0.05)` | dividers |
| `--text` | `#14161a` | `#f7f8f8` | primary text |
| `--text-2` | `#3c4149` | `#d0d6e0` | body |
| `--text-3` | `#6b7079` | `#8a8f98` | muted (AA on bg) |
| `--brand` | `#4f57c4` | `#7170ff` | primary actions, focus (AA: white on `#4f57c4` = 6.0:1) |
| `--brand-soft` | `#eef0ff` | `rgba(113,112,255,0.12)` | selected, chips |
| `--ok` | `#127a3a` | `#3fb87f` | allowed, success |
| `--warn` | `#9a5b00` | `#e2a336` | warnings, attention |
| `--bad` | `#b42318` | `#f07167` | denied, blocked, critical |

Type: Inter Variable with `font-feature-settings: "cv01", "ss03"`; weights 400 / 510 / 590
(never 700). Mono: JetBrains Mono for ids, tokens, code. Sizes: 13 (meta), 14 (UI), 15
(chat body), 20 (card headline numbers 24–28). Radius: 6 (controls), 8 (cards), 12 (panels).
Borders define depth; shadows only on popovers and modals.

## Layout

- Desktop 1440×900: left sidebar 272px (persona, new chat, history, nav to Console/Studio
  for authorized roles), center chat column (max 760px), right "Por dentro" panel 380px
  (toggle; opens on the selected message).
- Mobile 390×844: sidebar becomes a drawer, "Por dentro" a bottom sheet, cards stack, tables
  scroll horizontally inside their card.

## Generative cards

Every tool result card shares a frame: small icon + title + agent name, content, footer with
source/notes. Numbers are big and tabular (`font-variant-numeric: tabular-nums`). Currency is
formatted `R$ 1.234,56`. Dates `dd/mm/aaaa`. Calendar cells: holiday (warn tint), vacation day
(brand), bonus rest day (brand-soft hatched), weekend (surface).

## "Por dentro" (inside view)

Per assistant message, a vertical timeline: guardrails (input) → routing (mode, agents,
method, scores) → each tool call (name, risk badge, arguments, decision allowed/denied with
policy id and reason, duration) → proposals → guardrails (output) → usage (tokens, cost,
model). Denials and blocks are red, warnings amber, passes muted.
