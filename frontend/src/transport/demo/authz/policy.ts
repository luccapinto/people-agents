/** Policy engine: every authorization decision, in plain code, outside the model.
 *  Port of `atrium.authz.policy`. */
import type { RawUnit } from '../data/types';
import { type IdentityContext, isGovernance, isHrbp, isManager, rolesOf } from './identity';

export const MANAGER_CHAIN_ACTIONS = [
  'team.vacation.read',
  'team.time.read',
  'team.training.read',
  'team.profile.read',
  'team.onboarding.read',
];
export const DIRECT_REPORT_ACTIONS = ['team.vacation.decide'];
export const K_ANONYMITY_FLOOR = 5;

export interface Decision {
  allowed: boolean;
  policy: string;
  reason: string;
}

export const ALLOW_SELF: Decision = {
  allowed: true,
  policy: 'self_service',
  reason: 'O sujeito é a própria pessoa autenticada.',
};

export interface PolicyRow {
  key: string;
  value: Record<string, unknown>;
  description: string;
  updated_by: string | null;
  updated_at: string;
}

export const DEFAULT_POLICIES: [string, Record<string, unknown>, string][] = [
  ['manager_can_view_team_compensation', { enabled: false }, 'Gestores podem ver salário e holerite do time.'],
  ['k_anonymity_min', { value: 5 }, 'Tamanho mínimo de grupo em agregados de People Analytics (nunca abaixo de 5).'],
  ['retention_days', { value: 180 }, 'Retenção do conteúdo das conversas, em dias.'],
  ['dlp_secrets_mode', { value: 'block' }, 'Segredos e credenciais coladas no chat: warn ou block.'],
  ['dlp_customer_data_mode', { value: 'warn' }, 'Dados pessoais em massa (ex.: lista de CPFs): warn ou block.'],
  [
    'blocked_topics',
    { value: ['apostas esportivas', 'política partidária', 'criptomoedas como investimento'] },
    'Tópicos que o assistente recusa.',
  ],
  ['user_daily_token_budget', { value: 200000 }, 'Orçamento diário de tokens por pessoa.'],
  ['user_rate_limit_per_minute', { value: 12 }, 'Mensagens por minuto por pessoa.'],
  ['transcript_grant_minutes', { value: 60 }, 'Validade de um acesso justificado a uma transcrição.'],
];

export class PolicyStore {
  constructor(private readonly rows: Map<string, PolicyRow>) {}

  get(key: string): Record<string, unknown> | undefined {
    return this.rows.get(key)?.value;
  }

  enabled(key: string): boolean {
    return Boolean(this.get(key)?.enabled);
  }

  value<T>(key: string, fallback: T): T {
    const v = this.get(key);
    return v && 'value' in v ? (v.value as T) : fallback;
  }

  all(): PolicyRow[] {
    return [...this.rows.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  }
}

/** All unit ids under (and including) the given roots. */
export function unitSubtree(units: RawUnit[], rootIds: Set<string>): Set<string> {
  const children = new Map<string | null, string[]>();
  for (const u of units) {
    const list = children.get(u.parent_id) ?? [];
    list.push(u.id);
    children.set(u.parent_id, list);
  }
  const out = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const uid = stack.pop() as string;
    if (out.has(uid)) continue;
    out.add(uid);
    stack.push(...(children.get(uid) ?? []));
  }
  return out;
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export interface AuthorizeOptions {
  unitIds?: string[];
  allUnits?: RawUnit[];
}

export class PolicyEngine {
  constructor(readonly store: PolicyStore) {}

  authorize(ctx: IdentityContext, action: string, subjectId: string | null = null, o: AuthorizeOptions = {}): Decision {
    if (action.startsWith('self.')) {
      if (subjectId === null || subjectId === ctx.employeeId) return ALLOW_SELF;
      return {
        allowed: false,
        policy: 'self_service',
        reason: 'Ferramentas de autoatendimento só agem sobre a própria pessoa.',
      };
    }

    if (
      subjectId !== null &&
      subjectId !== ctx.employeeId &&
      action.endsWith('.read') &&
      (action.startsWith('other.') || !isManager(ctx))
    ) {
      // Not a leadership question at all: someone else's individual data.
      return {
        allowed: false,
        policy: 'personal_data_owner',
        reason: 'Dado individual de outra pessoa: só a própria pessoa tem acesso.',
      };
    }

    if (MANAGER_CHAIN_ACTIONS.includes(action)) {
      if (!isManager(ctx)) {
        return { allowed: false, policy: 'manager_chain', reason: 'A pessoa autenticada não é gestora.' };
      }
      if (subjectId !== null && ctx.chainReports.includes(subjectId)) {
        return {
          allowed: true,
          policy: 'manager_chain',
          reason: 'O sujeito está na cadeia de liderança da pessoa autenticada.',
        };
      }
      return {
        allowed: false,
        policy: 'manager_chain',
        reason: 'O sujeito não está na cadeia de liderança da pessoa autenticada.',
      };
    }

    if (DIRECT_REPORT_ACTIONS.includes(action)) {
      if (subjectId !== null && ctx.directReports.includes(subjectId)) {
        return { allowed: true, policy: 'direct_report', reason: 'O sujeito é liderado direto da pessoa autenticada.' };
      }
      return { allowed: false, policy: 'direct_report', reason: 'Somente o gestor imediato pode decidir este pedido.' };
    }

    if (action === 'team.compensation.read') {
      if (subjectId === null || !ctx.chainReports.includes(subjectId)) {
        return {
          allowed: false,
          policy: 'manager_chain',
          reason: 'O sujeito não está na cadeia de liderança da pessoa autenticada.',
        };
      }
      if (!this.store.enabled('manager_can_view_team_compensation')) {
        return {
          allowed: false,
          policy: 'manager_can_view_team_compensation',
          reason: 'Pela política vigente, gestores não veem salário nem holerite do time.',
        };
      }
      return {
        allowed: true,
        policy: 'manager_can_view_team_compensation',
        reason: 'Política de governança permite ao gestor ver remuneração do time.',
      };
    }

    if (action === 'analytics.aggregate') {
      if (!isHrbp(ctx)) {
        return { allowed: false, policy: 'hrbp_scope', reason: 'Somente HR Business Partners consultam agregados de pessoas.' };
      }
      const covered = unitSubtree(o.allUnits ?? [], new Set(ctx.hrbpUnits));
      const requested = new Set(o.unitIds ?? []);
      if (requested.size > 0 && isSubset(requested, covered)) {
        return { allowed: true, policy: 'hrbp_scope', reason: 'As unidades pedidas estão no escopo do HRBP.' };
      }
      return { allowed: false, policy: 'hrbp_scope', reason: 'Há unidades fora do escopo do HRBP.' };
    }

    if (action.startsWith('governance.')) {
      if (isGovernance(ctx)) return { allowed: true, policy: 'governance_role', reason: 'Papel de administração de governança.' };
      return { allowed: false, policy: 'governance_role', reason: 'Requer o papel de administração de governança.' };
    }

    if (action === 'studio.author') {
      const roles = rolesOf(ctx);
      if (roles.includes('agent_author') || roles.includes('governance_admin')) {
        return { allowed: true, policy: 'studio_author', reason: 'Papel de autoria de agentes.' };
      }
      return { allowed: false, policy: 'studio_author', reason: 'Requer o papel de autoria de agentes.' };
    }

    return { allowed: false, policy: 'default_deny', reason: `Nenhuma política permite a ação ${action}.` };
  }

  /** Personal data of many people at once: the speaker's team, a group (a role, an area,
   *  colleagues) or everyone. `domain` is compensation, vacation, time or personal. */
  authorizeScope(ctx: IdentityContext, scope: string, domain: string): Decision {
    if (scope === 'team') {
      if (!isManager(ctx)) {
        return { allowed: false, policy: 'manager_chain', reason: 'Dados de um time só aparecem para a liderança desse time.' };
      }
      if (domain === 'compensation') {
        if (this.store.enabled('manager_can_view_team_compensation')) {
          return {
            allowed: true,
            policy: 'manager_can_view_team_compensation',
            reason: 'Política de governança permite ao gestor ver remuneração do time.',
          };
        }
        return {
          allowed: false,
          policy: 'manager_can_view_team_compensation',
          reason: 'Pela política vigente, gestores não veem salário nem holerite do time.',
        };
      }
      if (domain === 'vacation' || domain === 'time') {
        return {
          allowed: true,
          policy: 'manager_chain',
          reason: 'Dados do próprio time, na cadeia de liderança da pessoa autenticada.',
        };
      }
      return {
        allowed: false,
        policy: 'personal_data_owner',
        reason: 'Dados cadastrais e de desempenho são individuais: só a própria pessoa tem acesso.',
      };
    }
    if (domain === 'compensation') {
      if (isHrbp(ctx)) {
        return {
          allowed: false,
          policy: 'aggregate_compensation',
          reason:
            'Remuneração agregada não está liberada: People Analytics publica headcount, ' +
            'turnover, absenteísmo, banco de horas e férias vencidas, sem salário.',
        };
      }
      return {
        allowed: false,
        policy: 'personal_data_owner',
        reason:
          'Remuneração é individual e confidencial: cada pessoa vê só a sua, e o assistente ' +
          'não mostra a de outras pessoas nem a de grupos.',
      };
    }
    if ((domain === 'vacation' || domain === 'time') && isHrbp(ctx)) {
      return {
        allowed: true,
        policy: 'hrbp_scope',
        reason: 'Indicador agregado com k-anonimato; as unidades pedidas são conferidas na consulta.',
      };
    }
    if ((domain === 'vacation' || domain === 'time') && isManager(ctx)) {
      return {
        allowed: false,
        policy: 'manager_chain',
        reason: 'Fora do time da pessoa autenticada: a liderança vê só o próprio time.',
      };
    }
    return {
      allowed: false,
      policy: 'personal_data_owner',
      reason: 'Dado individual de outras pessoas: cada pessoa tem acesso só ao seu.',
    };
  }

  kAnonymity(): number {
    return Math.max(K_ANONYMITY_FLOOR, Number(this.store.value('k_anonymity_min', K_ANONYMITY_FLOOR)));
  }
}
