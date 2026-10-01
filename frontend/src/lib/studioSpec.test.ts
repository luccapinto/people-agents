import { describe, expect, it } from 'vitest';
import { type AgentForm, EMPTY_FORM, formFromSpec, specFromForm, validateForm } from './studioSpec';

const filled: AgentForm = {
  ...EMPTY_FORM,
  name: 'Acesso Remoto',
  description: 'Dúvidas sobre VPN NimbusConnect, MFA e acesso remoto da Plataforma de Dados.',
  instructions: 'Responda sempre citando a fonte.',
  tone: 'direto',
  icon: 'laptop',
  audienceType: 'units',
  audienceUnits: ['U11'],
  tools: ['kb_search', 'ticket_open'],
  knowledge: ['corporativo'],
  keywords: ['vpn', ' nimbusconnect ', ''],
  examples: ['Como configuro a VPN?'],
  evaluation: [
    { kind: 'routing', question: 'Como configuro a VPN NimbusConnect?' },
    { kind: 'citation', question: 'A VPN funciona no celular?', expect_kb: 'agente-acesso-remoto' },
    { kind: 'refusal', question: 'Qual o salário da Maria Oliveira?' },
    { kind: 'routing', question: '   ' },
  ],
};

describe('specFromForm', () => {
  it('builds the audience object from the selected type', () => {
    expect(specFromForm(filled).audience).toEqual({ type: 'units', units: ['U11'] });
    expect(specFromForm({ ...filled, audienceType: 'all' }).audience).toEqual({ type: 'all' });
    expect(
      specFromForm({ ...filled, audienceType: 'roles', audienceRoles: ['manager'] }).audience,
    ).toEqual({ type: 'roles', roles: ['manager'] });
  });

  it('trims keywords and drops empty evaluation rows', () => {
    const spec = specFromForm(filled);
    expect(spec.routing.keywords).toEqual(['vpn', 'nimbusconnect']);
    expect(spec.evaluation).toHaveLength(3);
    expect(spec.evaluation[1]).toEqual({
      kind: 'citation',
      question: 'A VPN funciona no celular?',
      expect_kb: 'agente-acesso-remoto',
    });
    expect(spec.evaluation[0]).not.toHaveProperty('expect_kb');
  });

  it('always sends at least kb_search and deduplicates tools', () => {
    expect(specFromForm({ ...filled, tools: [] }).tools).toEqual(['kb_search']);
    expect(specFromForm({ ...filled, tools: ['kb_search', 'kb_search'] }).tools).toEqual(['kb_search']);
  });

  it('round-trips a spec through the form without the agent-owned knowledge base', () => {
    const spec = specFromForm(filled);
    const restored = formFromSpec({ ...spec, knowledge: ['agente-acesso-remoto', 'corporativo'] });
    expect(restored.knowledge).toEqual(['corporativo']);
    expect(restored.audienceUnits).toEqual(['U11']);
    expect(restored.evaluation).toHaveLength(3);
  });
});

describe('validateForm', () => {
  it('accepts a complete form', () => {
    expect(validateForm(filled)).toEqual([]);
  });

  it('requires a name and a router-usable description', () => {
    const problems = validateForm({ ...filled, name: 'VP', description: 'curta' });
    expect(problems).toHaveLength(2);
    expect(problems[1]).toContain('roteador');
  });

  it('requires one evaluation question of each kind', () => {
    const problems = validateForm({
      ...filled,
      evaluation: [{ kind: 'routing', question: 'Como configuro a VPN?' }],
    });
    expect(problems).toContain(
      'Inclua pelo menos uma pergunta de cada tipo: roteamento, resposta com citação e recusa.',
    );
  });

  it('requires a unit when the audience is restricted to units', () => {
    expect(validateForm({ ...filled, audienceUnits: [] })).toContain(
      'Escolha pelo menos uma unidade para o público.',
    );
  });
});
