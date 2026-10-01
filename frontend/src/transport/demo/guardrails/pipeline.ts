/** Input and output guardrails: pass | warn | mask | block, with a reason. */
import { fold } from '../core/text';
import type { PolicyStore } from '../authz/policy';
import { containsPhrase } from '../runtime/nlu';
import { detectInjection } from './injection';
import { CPF_RE, maskPii, validCpf } from './pii';

const SECRET_PATTERNS: [string, RegExp][] = [
  ['api_key', /\b(sk|rk|pk)-[A-Za-z0-9_-]{20,}/],
  ['aws_key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github_token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['password', /\b(senha|password|pwd|passwd)\s*[:=]\s*\S{4,}/i],
];

const SENSITIVE: [string, string[]][] = [
  [
    'assédio',
    ['assedio', 'assediada', 'assediado', 'assediando', 'me humilha', 'humilhacao', 'abuso', 'importunacao', 'discriminacao', 'racismo'],
  ],
  ['denúncia', ['denuncia', 'denunciar', 'fraude', 'corrupcao', 'propina', 'desvio de dinheiro']],
  [
    'saúde mental',
    [
      'ansiedade', 'depressao', 'burnout', 'crise de panico', 'nao aguento mais', 'esgotado', 'esgotada', 'suicidio',
      'me matar', 'tirar minha vida', 'acabar com tudo', 'automutilacao',
    ],
  ],
];

const HIGH_RISK = ['suicidio', 'me matar', 'tirar minha vida', 'acabar com tudo', 'automutilacao'];
const MONEY_RE = /R\$\s?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/g;

export interface GuardrailOutcome {
  name: string;
  stage: string;
  outcome: string;
  detail: string;
}

export interface InputCheck {
  outcomes: GuardrailOutcome[];
  storedText: string;
  blocked: boolean;
  message: string;
  sensitive: string | null;
  highRisk: boolean;
  injection: boolean;
}

/** What the answer may rely on in this turn. */
export class Evidence {
  readonly texts: string[] = [];
  readonly authorizedPeople = new Set<string>();

  amounts(): Set<string> {
    const out = new Set<string>();
    const thousands = (v: number): string => {
      const [int, frac] = v.toFixed(2).split('.');
      const groups: string[] = [];
      let rest = int;
      while (rest.length > 3) {
        groups.unshift(rest.slice(-3));
        rest = rest.slice(0, -3);
      }
      groups.unshift(rest);
      return `${groups.join('.')},${frac}`;
    };
    for (const t of this.texts) {
      for (const m of t.matchAll(MONEY_RE)) out.add(m[1]);
      for (const m of t.matchAll(/\b\d+\.\d{1,2}\b/g)) out.add(thousands(Number(m[0])));
      for (const m of t.matchAll(/\b\d{2,}\b/g)) out.add(thousands(Number(m[0])));
    }
    return out;
  }
}

export interface OutputCheck {
  outcomes: GuardrailOutcome[];
  text: string;
  blocked: boolean;
}

export class GuardrailPipeline {
  constructor(
    private readonly store: PolicyStore,
    private readonly directoryNames: () => string[],
  ) {}

  checkInput(text: string): InputCheck {
    const outcomes: GuardrailOutcome[] = [];
    const f = fold(text);
    const [masked, findings] = maskPii(text);
    outcomes.push({
      name: 'pii',
      stage: 'input',
      outcome: findings.length ? 'mask' : 'pass',
      detail: findings.map((x) => `${x.kind} x${x.count}`).join(', ') || 'nenhum dado pessoal detectado',
    });
    const check: InputCheck = {
      outcomes,
      storedText: masked,
      blocked: false,
      message: '',
      sensitive: null,
      highRisk: false,
      injection: false,
    };

    const secrets = SECRET_PATTERNS.filter(([, rx]) => rx.test(text)).map(([name]) => name);
    const mode = this.store.value('dlp_secrets_mode', 'block');
    if (secrets.length) {
      const blocked = mode === 'block';
      outcomes.push({
        name: 'dlp_secrets',
        stage: 'input',
        outcome: blocked ? 'block' : 'warn',
        detail: `detectado: ${secrets.join(', ')}`,
      });
      check.storedText = '[mensagem com credenciais omitida pelo DLP]';
      if (blocked) {
        check.blocked = true;
        check.message =
          'Bloqueei esta mensagem porque ela parece conter uma credencial (senha, token ou chave). ' +
          'Nunca cole segredos no chat; se uma credencial vazou, troque-a e avise Segurança da Informação.';
        return check;
      }
    } else {
      outcomes.push({ name: 'dlp_secrets', stage: 'input', outcome: 'pass', detail: 'sem credenciais' });
    }

    const cpfs = [...text.matchAll(new RegExp(CPF_RE.source, 'g'))].map((m) => m[0]).filter(validCpf);
    if (cpfs.length >= 3) {
      const bulkMode = this.store.value<string>('dlp_customer_data_mode', 'warn');
      outcomes.push({
        name: 'dlp_bulk_personal_data',
        stage: 'input',
        outcome: bulkMode === 'block' ? 'block' : 'warn',
        detail: `${cpfs.length} CPFs na mesma mensagem`,
      });
      if (bulkMode === 'block') {
        check.blocked = true;
        check.message = 'Esta mensagem tem vários CPFs. Dados pessoais de clientes ou colegas não devem ser colados no chat.';
        return check;
      }
    }

    const topics = this.store.value<string[]>('blocked_topics', []).filter((t) => containsPhrase(f, t));
    if (topics.length) {
      outcomes.push({ name: 'blocked_topics', stage: 'input', outcome: 'block', detail: topics.join(', ') });
      check.blocked = true;
      check.message =
        `Esse assunto (${topics[0]}) está fora do que posso tratar por aqui, conforme a política de uso. ` +
        'Posso ajudar com algo do seu trabalho ou dos seus benefícios?';
      return check;
    }

    const verdict = detectInjection(text);
    check.injection = verdict.suspected;
    outcomes.push({
      name: 'prompt_injection',
      stage: 'input',
      outcome: verdict.suspected ? 'warn' : 'pass',
      detail: verdict.signals.join(', ') || 'sem sinais',
    });

    for (const [category, wordList] of SENSITIVE) {
      if (wordList.some((w) => containsPhrase(f, w))) {
        check.sensitive = category;
        check.highRisk = HIGH_RISK.some((w) => containsPhrase(f, w));
        check.storedText = `[conteúdo sensível omitido; categoria: ${category}]`;
        outcomes.push({
          name: 'sensitive_topic',
          stage: 'input',
          outcome: 'warn',
          detail: `categoria ${category}: encaminhamento ao canal humano, conteúdo não armazenado`,
        });
        break;
      }
    }
    return check;
  }

  checkOutput(text: string, evidence: Evidence, selfName: string): OutputCheck {
    const outcomes: GuardrailOutcome[] = [];
    const amounts = [...text.matchAll(MONEY_RE)].map((m) => m[1]);
    if (amounts.length) {
      const leaked = this.directoryNames().filter(
        (n) => n !== selfName && !evidence.authorizedPeople.has(n) && text.includes(n),
      );
      if (leaked.length) {
        outcomes.push({
          name: 'third_party_leak',
          stage: 'output',
          outcome: 'block',
          detail: `resposta citava valores junto de ${leaked.length} pessoa(s) não autorizada(s)`,
        });
        return {
          outcomes,
          text:
            'Não posso compartilhar informações financeiras de outras pessoas. ' +
            'Posso ajudar com os seus próprios dados.',
          blocked: true,
        };
      }
    }
    outcomes.push({ name: 'third_party_leak', stage: 'output', outcome: 'pass', detail: 'nenhum dado de terceiro não autorizado' });
    const grounded = evidence.amounts();
    const ungrounded = [...new Set(amounts.filter((a) => !grounded.has(a)))].sort();
    let out = text;
    if (ungrounded.length) {
      outcomes.push({
        name: 'number_grounding',
        stage: 'output',
        outcome: 'warn',
        detail: `valores sem fonte: ${ungrounded.join(', ')}`,
      });
      out +=
        '\n\n_Atenção: alguns valores desta resposta não foram encontrados nas fontes consultadas; confirme no cartão ou no holerite._';
    } else {
      outcomes.push({
        name: 'number_grounding',
        stage: 'output',
        outcome: 'pass',
        detail: amounts.length ? `${amounts.length} valor(es) conferido(s) com as fontes` : 'sem valores monetários',
      });
    }
    return { outcomes, text: out, blocked: false };
  }
}
