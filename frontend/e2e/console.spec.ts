import { ask, expect, signIn, test } from './fixtures';

test('governança abre o console, verifica a cadeia e lê as políticas', async ({ page }) => {
  await signIn(page, 'governanca');
  // One turn so the console has usage and audit events to show.
  await ask(page, 'Quais agentes estão publicados?');

  await page.getByRole('link', { name: 'Governança' }).click();
  await expect(page.getByRole('heading', { name: 'Governança' })).toBeVisible();
  await expect(page.getByText('Interações', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Pessoas', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Tokens', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Auditoria' }).click();
  await page.getByRole('button', { name: 'Verificar cadeia' }).click();
  await expect(page.getByText(/Cadeia íntegra/)).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Políticas' }).click();
  await expect(page.getByText('manager_can_view_team_compensation').first()).toBeVisible();
  await expect(page.getByText('k_anonymity_min').first()).toBeVisible();
});
