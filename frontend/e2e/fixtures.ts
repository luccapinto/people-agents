/** Shared helpers for both e2e configurations (real app and static demo).
 *
 *  Every spec fails on an uncaught page error or a `console.error`, so a broken render or a
 *  rejected promise cannot hide behind a passing assertion. */
import { expect, type Locator, type Page, test as base } from '@playwright/test';

export const PERSONAS = {
  colaborador: 'Rafael Lima',
  gestora: 'Mariana Costa',
  hrbp: 'Patrícia Almeida',
  governanca: 'Carlos Mendes',
  novata: 'Beatriz Rocha',
} as const;

export type PersonaKey = keyof typeof PERSONAS;

const IGNORED_CONSOLE = [
  'Download the React DevTools',
  'React Router Future Flag Warning',
  'ResizeObserver loop',
];

export const test = base.extend<{ failOnPageErrors: void }>({
  failOnPageErrors: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (IGNORED_CONSOLE.some((ignored) => text.includes(ignored))) return;
        problems.push(`console.error: ${text}`);
      });
      await use();
      expect(problems, `page reported errors:\n${problems.join('\n')}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Navigate to an app route on either build: the demo keeps routes in the hash (no SPA
 *  fallback on static hosts), the real app uses clean paths. */
export async function goToRoute(page: Page, route: string): Promise<void> {
  const hashRouting = new URL(page.url()).hash.startsWith('#/');
  await page.goto(hashRouting ? `./#/${route}` : `./${route}`);
}


/** The demo keeps its state in localStorage; start every spec from a clean slate. */
export async function freshSession(page: Page): Promise<void> {
  await page.goto('./');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
}

export async function signIn(page: Page, persona: PersonaKey): Promise<void> {
  await freshSession(page);
  await pickPersona(page, persona);
}

/** Change persona inside one scenario: drop only the session, keep the demo's persisted state
 *  (Studio agents, confirmed proposals, audit), exactly like signing out and back in. */
export async function switchPersona(page: Page, persona: PersonaKey): Promise<void> {
  await page.goto('./');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await pickPersona(page, persona);
}

async function pickPersona(page: Page, persona: PersonaKey): Promise<void> {
  const card = page.getByRole('button', { name: new RegExp(PERSONAS[persona]) });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByPlaceholder(/Escreva/i)).toBeVisible();
  await dismissNotice(page);
}

async function dismissNotice(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Entendi' });
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
}

export function composer(page: Page): Locator {
  return page.getByPlaceholder(/Escreva/i);
}

export async function ask(page: Page, text: string): Promise<void> {
  const box = composer(page);
  await box.click();
  await box.fill(text);
  await box.press('Enter');
  await expect(page.getByRole('button', { name: 'Parar' })).toHaveCount(0, { timeout: 90_000 });
}

export async function openInside(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Por dentro' }).first().click();
}

/** Unique suffix so repeated runs never collide on Studio agent ids. */
export function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36).toUpperCase()}`;
}
