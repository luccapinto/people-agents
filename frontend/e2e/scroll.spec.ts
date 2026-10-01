import { ask, expect, freshSession, signIn, test } from './fixtures';

/** A long answer is read from its beginning: the view stops with the question at the top
 *  instead of jumping to the answer's last line. */

const thread = 'main';

async function questionOffset(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate((selector) => {
    const main = document.querySelector(selector)!;
    const questions = main.querySelectorAll('[data-role="user"]');
    const question = questions[questions.length - 1];
    return question.getBoundingClientRect().top - main.getBoundingClientRect().top;
  }, thread);
}

async function overflow(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate((selector) => {
    const main = document.querySelector(selector)!;
    return main.scrollHeight - main.clientHeight - main.scrollTop;
  }, thread);
}

test('frase da tela de entrada abre a resposta pelo começo, com a pergunta no topo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await freshSession(page);
  await page
    .getByRole('button', { name: /^Quantos dias de férias eu tenho, como está o calendário/ })
    .first()
    .click();
  await expect(page.locator('[data-card="vacation_calendar"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Parar' })).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(400);

  // The answer is longer than the view: the rest stays below, the question stays visible.
  expect(await overflow(page)).toBeGreaterThan(200);
  const offset = await questionOffset(page);
  expect(offset).toBeGreaterThanOrEqual(0);
  expect(offset).toBeLessThan(80);
  await expect(page.locator('[data-role="user"]').last()).toBeInViewport();
});

test('a segunda pergunta também sobe para o topo e quem rola manda na tela', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(page, 'colaborador');
  await ask(page, 'Quantos dias de férias eu tenho?');
  await ask(page, 'Quanto que eu vou receber de salário esse ano e quanto valeria eu colocar de PGBL dado o meu salário?');
  await expect(page.locator('[data-card="pgbl_simulation"]')).toBeVisible();
  await page.waitForTimeout(400);
  const offset = await questionOffset(page);
  expect(offset).toBeGreaterThanOrEqual(0);
  expect(offset).toBeLessThan(80);

  // Scrolling by hand is kept: nothing pulls the view back.
  await page.locator(thread).evaluate((main) => main.scrollBy(0, 300));
  const kept = await page.locator(thread).evaluate((main) => main.scrollTop);
  await page.waitForTimeout(600);
  expect(await page.locator(thread).evaluate((main) => main.scrollTop)).toBe(kept);
});
