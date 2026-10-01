/** System prompts. No secret or authorization logic lives here. */
import { type Day, fmtDate, weekday } from '../core/date';
import { type IdentityContext, firstName, identitySummary } from '../authz/identity';
import type { AgentSpec } from './agents';
import { WEEKDAYS } from '../tools/util';

export interface Branding {
  productName: string;
  company: { name: string };
  [key: string]: unknown;
}

function todayLabel(today: Day): string {
  const name = WEEKDAYS[weekday(today)];
  const suffix = name === 'sábado' || name === 'domingo' ? name : `${name}-feira`;
  return `${fmtDate(today)} (${suffix})`;
}

export function specialistPrompt(
  agent: AgentSpec,
  identity: IdentityContext,
  today: Day,
  branding: Branding,
  commonRules: string,
): string {
  return (
    `Você é ${agent.name}, um agente do ${branding.productName}, o assistente corporativo da ` +
    `${branding.company.name} (empresa fictícia).\n\n${agent.instructions.trim()}\n\n` +
    `${commonRules.trim()}\n\n` +
    'Pessoa autenticada (dados do sistema de RH, não do usuário):\n' +
    `${JSON.stringify(identitySummary(identity))}\n` +
    `Hoje é ${todayLabel(today)}.`
  );
}

export function routerPrompt(agents: AgentSpec[], today: Day, branding: Branding): string {
  const lines = agents
    .filter((a) => a.id !== 'concierge')
    .map((a) => `- ${a.id}: ${a.name} — ${a.description}`)
    .join('\n');
  return (
    `Você é o roteador do ${branding.productName}. Escolha o(s) especialista(s) para a mensagem da pessoa usando a ` +
    'função route_request. Especialistas disponíveis para esta pessoa:\n' +
    `${lines}\n- concierge: conversa geral, saudações, temas sem especialista.\n\n` +
    'Use mode=multi quando a mensagem tiver pedidos de especialistas diferentes (máximo 3). Use mode=clarify e uma ' +
    'pergunta curta quando estiver ambígua. Use life_event quando a pessoa relatar nascimento de filho, casamento ou ' +
    `mudança de endereço. Nunca escolha um id fora da lista. Hoje é ${todayLabel(today)}.`
  );
}

export function composePrompt(identity: IdentityContext, branding: Branding): string {
  return (
    `Você é o Concierge do ${branding.productName}. Componha UMA resposta curta e acolhedora em português para ` +
    `${firstName(identity)} a partir das respostas dos especialistas abaixo. Mantenha todos os valores, datas e prazos ` +
    'exatamente como estão; não acrescente números. Organize em tópicos curtos por assunto e termine dizendo que as ' +
    'ações estão nos cartões para confirmação, se houver.'
  );
}
