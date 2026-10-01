import { ask, composer, expect, openInside, PERSONAS, signIn, test, type PersonaKey } from './fixtures';

/** One starter per persona: the answer must render at least one card. The governance
 *  starters are policy questions answered from the knowledge base, so that persona also
 *  asks a data question to exercise a card. */
const STARTERS: Record<PersonaKey, string> = {
  colaborador: 'Quantos dias de férias eu tenho e qual a melhor data para emendar feriados?',
  gestora: 'Como está meu time?',
  hrbp: 'Qual o headcount da Tecnologia por área?',
  governanca: 'O que você faz com os meus dados?',
  novata: 'O que falta no meu onboarding?',
};

const EXTRA: Partial<Record<PersonaKey, string>> = {
  governanca: 'Quantos dias de férias eu tenho?',
};

test.describe('chat com cada persona', () => {
  for (const persona of Object.keys(STARTERS) as PersonaKey[]) {
    test(`${persona} recebe um cartão`, async ({ page }) => {
      await signIn(page, persona);
      await expect(composer(page)).toBeVisible();
      await ask(page, STARTERS[persona]);
      const extra = EXTRA[persona];
      if (extra) await ask(page, extra);
      await expect(page.locator('[data-card]').first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(PERSONAS[persona], { exact: false }).first()).toBeVisible();
    });
  }
});

test('colaborador pede férias e confirma a proposta', async ({ page }) => {
  await signIn(page, 'colaborador');
  await ask(page, 'Quero tirar férias de 23/11 a 07/12');
  const confirm = page.getByRole('button', { name: 'Confirmar', exact: true });
  await expect(confirm).toBeVisible({ timeout: 60_000 });
  await confirm.click();
  await expect(page.getByText('Executado', { exact: true })).toBeVisible({ timeout: 60_000 });
});

test('colaborador não vê o salário de uma colega', async ({ page }) => {
  await signIn(page, 'colaborador');
  await ask(page, 'Qual o salário da Maria Oliveira?');
  await expect(page.getByText(/Não posso mostrar o salário ou o holerite de Maria Oliveira/)).toBeVisible({
    timeout: 60_000,
  });
  await openInside(page);
  await expect(page.getByText('Negado').first()).toBeVisible();
  await expect(page.getByText('team.compensation.read').first()).toBeVisible();
});

test('evento de vida gera cartão e três propostas', async ({ page }) => {
  await signIn(page, 'colaborador');
  await ask(page, 'Meu filho nasceu ontem');
  await expect(page.locator('[data-card="life_event"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Confirmar', exact: true })).toHaveCount(3);
});

test('ação sensível exige verificação em duas etapas', async ({ page }) => {
  await signIn(page, 'colaborador');
  await ask(page, 'Quero trocar para o Vitalis Plus');
  const confirm = page.getByRole('button', { name: 'Confirmar', exact: true });
  await expect(confirm).toBeVisible({ timeout: 60_000 });
  await confirm.click();

  const dialog = page.getByRole('dialog', { name: 'Confirme sua identidade' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const shown = await dialog.getByText(/Código de demonstração:/).textContent();
  const code = /(\d{6})/.exec(shown ?? '')?.[1];
  expect(code).toBeTruthy();
  await dialog.locator('#step-up-code').fill(code as string);
  await dialog.getByRole('button', { name: 'Confirmar identidade' }).click();
  await expect(page.getByText('Executado', { exact: true })).toBeVisible({ timeout: 60_000 });
});
