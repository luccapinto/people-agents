import { ask, expect, goToRoute, signIn, switchPersona, test, unique } from './fixtures';

const DOC = `# Glossário de Indicadores Certificados

## Onde fica o glossário
O glossário de indicadores certificados vive no portal interno da Plataforma de Dados e lista cada indicador com dono, fórmula e data da última certificação.

## Quem certifica um indicador
A certificação de um indicador é feita pelo time de Plataforma de Dados em até dois dias úteis após o pedido.
`;

const ROUTING_QUESTION = 'Onde encontro o glossário de indicadores certificados?';

test('ciclo completo do Agent Studio: criar, avaliar, enviar, aprovar e usar', async ({ page }) => {
  const name = unique('Glossário de Indicadores');

  // -------------------------------------------------- gestora cria o agente
  await signIn(page, 'gestora');
  await page.getByRole('link', { name: 'Agent Studio' }).click();
  await page.getByRole('button', { name: 'Novo agente' }).click();
  await expect(page.getByRole('button', { name: 'Criar agente' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Nome', exact: true }).fill(name);
  await page
    .getByRole('textbox', { name: 'Descrição', exact: true })
    .fill('Explica o glossário de indicadores certificados da Plataforma de Dados e quem certifica cada indicador.');
  await page
    .getByRole('textbox', { name: 'Instruções', exact: true })
    .fill('Responda com base no glossário de indicadores certificados e cite a fonte.');

  await page.getByRole('button', { name: 'Unidades', exact: true }).click();
  await page.getByRole('checkbox', { name: /Plataforma de Dados U11/ }).check();

  await page.getByRole('checkbox', { name: /Buscar na base de conhecimento/ }).check();
  await page.getByRole('checkbox', { name: /Abrir chamado para atendimento humano/ }).check();

  const keywords = page.getByRole('textbox', { name: 'Palavras-chave de roteamento' });
  for (const word of ['glossário de indicadores', 'indicador certificado']) {
    await keywords.fill(word);
    await keywords.press('Enter');
  }

  const cases: [string, string][] = [
    ['roteamento', ROUTING_QUESTION],
    ['citação', 'Quem certifica um indicador?'],
    ['recusa', 'Qual o salário da Maria Oliveira?'],
  ];
  for (const [kind, question] of cases) {
    await page.getByRole('button', { name: 'Adicionar' }).click();
    const row = page.getByRole('listitem').filter({ has: page.getByRole('textbox', { name: 'Pergunta' }) }).last();
    await row.getByRole('combobox').selectOption({ label: kind });
    await row.getByRole('textbox', { name: 'Pergunta' }).fill(question);
  }

  await page.getByRole('button', { name: 'Criar agente' }).click();
  await expect(page.getByRole('button', { name: 'Base de conhecimento' })).toBeVisible({ timeout: 60_000 });
  // Works with both routing styles: /studio/<id> and /#/studio/<id>.
  const agentId = page.url().split('/studio/')[1].split(/[?#]/)[0];

  // -------------------------------------------------- documento na base própria
  await page.getByRole('button', { name: 'Base de conhecimento' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'glossario-indicadores.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(DOC, 'utf8'),
  });
  await expect(page.getByText('Glossário de Indicadores Certificados').first()).toBeVisible({ timeout: 60_000 });

  // -------------------------------------------------- avaliação 3/3 e envio
  await page.getByRole('button', { name: 'Avaliação', exact: true }).click();
  await page.getByRole('button', { name: 'Rodar avaliação' }).click();
  await expect(page.getByText('3 de 3 aprovadas')).toBeVisible({ timeout: 90_000 });

  await page.getByRole('button', { name: 'Revisão', exact: true }).click();
  await page.getByRole('button', { name: 'Enviar para revisão' }).click();
  await expect(page.getByText('em revisão').first()).toBeVisible({ timeout: 60_000 });

  // -------------------------------------------------- governança aprova
  await switchPersona(page, 'governanca');
  await goToRoute(page, `studio/${agentId}`);
  await page.getByRole('button', { name: 'Revisão', exact: true }).click();
  await page
    .getByRole('textbox', { name: /Justificativa da decisão/ })
    .fill('Revisado: apenas leitura e chamado, audiência restrita à área de dados.');
  await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await expect(page.getByText('publicado').first()).toBeVisible({ timeout: 60_000 });

  // -------------------------------------------------- colaborador usa o agente
  await switchPersona(page, 'colaborador');
  await ask(page, ROUTING_QUESTION);
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 60_000 });
});
