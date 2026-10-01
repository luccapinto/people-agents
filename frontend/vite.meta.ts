import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { ptBR } from './src/i18n/pt-BR';

const BRANDING = fileURLToPath(new URL('../config/branding.json', import.meta.url));

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

/** Fills the document head from `config/branding.json` and the pt-BR strings, so the title, the
 *  description and the social preview never drift from their single source of truth.
 *
 *  `VITE_SITE_URL` (set by the GitHub Pages workflow) makes the Open Graph image absolute, which
 *  LinkedIn and WhatsApp require to fetch it. Without it the tag falls back to a URL relative to
 *  the deployment base, which is still correct for a local build. */
export function brandingMeta({ demo = false }: { demo?: boolean } = {}): Plugin {
  let base = '/';
  return {
    name: 'atrium-branding-meta',
    configResolved(config) {
      base = config.base;
    },
    // Must run before Vite's own HTML pass, which decodes URLs and would choke on `%BASE%`.
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string): string {
        const brand = JSON.parse(readFileSync(BRANDING, 'utf8')) as {
          productName: string;
          tagline: string;
        };
        const site = process.env.VITE_SITE_URL?.trim();
        const image = site
          ? new URL('og-image.png', site.endsWith('/') ? site : `${site}/`).href
          : `${base}og-image.png`;
        // The static demo talks to no server except, in live mode, OpenRouter: the browser
        // itself refuses any other destination for fetch/XHR, so the visitor's key cannot leave.
        const csp = demo ? `<meta http-equiv="Content-Security-Policy" content="connect-src 'self' https://openrouter.ai" />` : '';
        return html
          .replace('<!-- csp -->', csp)
          .replaceAll('%BASE%', base)
          .replaceAll('%OG_IMAGE%', escapeAttribute(image))
          .replaceAll(
            '%TITLE%',
            escapeAttribute(`${brand.productName} · ${brand.tagline.replace(/\.$/, '')}`),
          )
          .replaceAll('%DESCRIPTION%', escapeAttribute(ptBR['login.thesis']));
      },
    },
  };
}
