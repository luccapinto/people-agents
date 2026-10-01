import type { AgentAudience, AgentSpec, EvaluationCase } from '@/transport/types';

/** Editable form state of the agent editor. `audience` is split so the UI can keep the
 *  selected units/roles while the person toggles between audience types. */
export interface AgentForm {
  name: string;
  description: string;
  instructions: string;
  tone: string;
  icon: string;
  audienceType: AgentAudience['type'];
  audienceUnits: string[];
  audienceRoles: string[];
  tools: string[];
  knowledge: string[];
  keywords: string[];
  examples: string[];
  evaluation: EvaluationCase[];
}

export const EMPTY_FORM: AgentForm = {
  name: '',
  description: '',
  instructions: '',
  tone: '',
  icon: 'bot',
  audienceType: 'all',
  audienceUnits: [],
  audienceRoles: [],
  tools: ['kb_search'],
  knowledge: [],
  keywords: [],
  examples: [],
  evaluation: [
    { kind: 'routing', question: '' },
    { kind: 'citation', question: '' },
    { kind: 'refusal', question: '' },
  ],
};

export function formFromSpec(spec: AgentSpec): AgentForm {
  const audience = spec.audience ?? { type: 'all' };
  return {
    name: spec.name ?? '',
    description: spec.description ?? '',
    instructions: spec.instructions ?? '',
    tone: spec.tone ?? '',
    icon: spec.icon ?? 'bot',
    audienceType: audience.type ?? 'all',
    audienceUnits: audience.units ?? [],
    audienceRoles: audience.roles ?? [],
    tools: spec.tools?.length ? spec.tools : ['kb_search'],
    // The agent's own base (`agente-…`) is managed by the back-end and never edited here.
    knowledge: (spec.knowledge ?? []).filter((kb) => !kb.startsWith('agente-')),
    keywords: spec.routing?.keywords ?? [],
    examples: spec.routing?.examples ?? [],
    evaluation: spec.evaluation?.length ? spec.evaluation : EMPTY_FORM.evaluation,
  };
}

/** Serialize the form into the spec the back-end validates (backend/atrium/studio.py). */
export function specFromForm(form: AgentForm): AgentSpec {
  const audience: AgentAudience =
    form.audienceType === 'units'
      ? { type: 'units', units: form.audienceUnits }
      : form.audienceType === 'roles'
        ? { type: 'roles', roles: form.audienceRoles }
        : { type: 'all' };
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    instructions: form.instructions.trim(),
    tone: form.tone.trim(),
    icon: form.icon,
    audience,
    tools: [...new Set(form.tools.length ? form.tools : ['kb_search'])],
    knowledge: [...new Set(form.knowledge)],
    routing: {
      keywords: form.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 30),
      examples: form.examples.map((x) => x.trim()).filter(Boolean).slice(0, 20),
    },
    evaluation: form.evaluation
      .filter((item) => item.question.trim())
      .map((item) => ({
        kind: item.kind,
        question: item.question.trim(),
        ...(item.expect_kb ? { expect_kb: item.expect_kb } : {}),
      })),
  };
}

/** Same rules the API enforces, so the editor can explain the problem before saving. */
export function validateForm(form: AgentForm): string[] {
  const problems: string[] = [];
  if (form.name.trim().length < 3) problems.push('O nome precisa de pelo menos 3 caracteres.');
  if (form.description.trim().length < 20) {
    problems.push('A descrição precisa de pelo menos 20 caracteres — o roteador a utiliza.');
  }
  if (form.audienceType === 'units' && form.audienceUnits.length === 0) {
    problems.push('Escolha pelo menos uma unidade para o público.');
  }
  if (form.audienceType === 'roles' && form.audienceRoles.length === 0) {
    problems.push('Escolha pelo menos um papel para o público.');
  }
  if (form.tools.length === 0) problems.push('Selecione pelo menos uma ferramenta.');
  const filled = form.evaluation.filter((item) => item.question.trim());
  const kinds = new Set(filled.map((item) => item.kind));
  if (!(kinds.has('routing') && kinds.has('citation') && kinds.has('refusal'))) {
    problems.push(
      'Inclua pelo menos uma pergunta de cada tipo: roteamento, resposta com citação e recusa.',
    );
  }
  return problems;
}
