/** Text normalization shared by search, routing and guardrails (`atrium.text`). */

const WS = /\s+/g;

/** Lowercase, strip accents, collapse whitespace: "Férias  São" -> "ferias sao". */
export function fold(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(WS, ' ')
    .trim();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Python `str.capitalize()`: first character upper, the rest lower. */
export function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;
}
