import clsx from 'clsx';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, IconButton, KeyValue, RiskBadge, ScrollArea } from '@/components/ui';
import { t } from '@/i18n';
import { usd } from '@/lib/format';
import type { ChatMessage } from '@/state/chat';
import type { GuardrailTrace, ToolTrace } from '@/transport/types';

const OUTCOME_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = {
  pass: 'neutral',
  warn: 'warn',
  mask: 'warn',
  block: 'bad',
};

function Step({
  title,
  tone = 'neutral',
  children,
}: {
  title: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'bad';
  children: ReactNode;
}): JSX.Element {
  const dot = {
    neutral: 'bg-[var(--border)]',
    ok: 'bg-[var(--ok)]',
    warn: 'bg-[var(--warn)]',
    bad: 'bg-[var(--bad)]',
  };
  return (
    <li className="relative pl-5">
      <span
        className={clsx('absolute left-0 top-1.5 h-2 w-2 rounded-full', dot[tone])}
        aria-hidden
      />
      <p className="text-meta font-medium uppercase tracking-wide text-text-3">{title}</p>
      <div className="mt-1 space-y-1.5">{children}</div>
    </li>
  );
}

function GuardrailRow({ item }: { item: GuardrailTrace }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate font-mono text-meta text-text-2">{item.name}</p>
        {item.detail ? <p className="text-meta text-text-3">{item.detail}</p> : null}
      </div>
      <Badge tone={OUTCOME_TONE[item.outcome] ?? 'neutral'}>{item.outcome}</Badge>
    </div>
  );
}

function ToolStep({ tool }: { tool: ToolTrace }): JSX.Element {
  const denied = !tool.decision?.allowed;
  return (
    <div
      className={clsx(
        'rounded-card border p-2.5',
        denied ? 'border-[var(--bad)]/40 bg-[var(--bad)]/5' : 'border-border-subtle bg-surface/50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-ui text-text">{tool.title ?? tool.tool}</p>
          <p className="truncate font-mono text-meta text-text-3">{tool.tool}</p>
        </div>
        <RiskBadge risk={tool.risk} />
      </div>
      {Object.keys(tool.args ?? {}).length ? (
        <div className="mt-2">
          <p className="text-[11px] uppercase tracking-wide text-text-3">{t('inside.args')}</p>
          <ScrollArea>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-text-2">
              {JSON.stringify(tool.args, null, 1)}
            </pre>
          </ScrollArea>
        </div>
      ) : null}
      <div className="mt-2 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-meta text-text-3">{t('inside.decision')}</span>
          <Badge tone={denied ? 'bad' : 'ok'}>
            {denied ? t('inside.denied') : t('inside.allowed')}
          </Badge>
        </div>
        {tool.decision?.policy ? (
          <KeyValue
            label={t('inside.policy')}
            value={<span className="font-mono text-meta">{tool.decision.policy}</span>}
          />
        ) : null}
        {tool.decision?.reason ? (
          <p className="text-meta text-text-3">{tool.decision.reason}</p>
        ) : null}
        <KeyValue label={t('inside.status')} value={tool.status} />
        <KeyValue label={t('inside.duration')} value={`${tool.duration_ms} ms`} />
        {tool.error ? <p className="text-meta text-bad">{tool.error}</p> : null}
      </div>
    </div>
  );
}

export function InsideContent({ message }: { message: ChatMessage | null }): JSX.Element {
  if (!message) {
    return <p className="px-4 py-6 text-meta text-text-3">{t('inside.empty')}</p>;
  }
  const trace = message.trace;
  const input = trace.guardrails.filter((g) => g.stage !== 'output');
  const output = trace.guardrails.filter((g) => g.stage === 'output');
  const usage = message.usage;

  return (
    <ol className="relative space-y-4 px-4 py-4">
      <span className="absolute bottom-2 left-[3px] top-2 w-px bg-border" aria-hidden />
      {input.length ? (
        <Step
          title={t('inside.guardrailsIn')}
          tone={input.some((g) => g.outcome === 'block') ? 'bad' : input.some((g) => g.outcome !== 'pass') ? 'warn' : 'neutral'}
        >
          {input.map((item, i) => (
            <GuardrailRow key={i} item={item} />
          ))}
        </Step>
      ) : null}

      {trace.route ? (
        <Step title={t('inside.route')}>
          <KeyValue label={t('inside.mode')} value={trace.route.mode} />
          <KeyValue
            label={t('inside.agents')}
            value={(trace.route.agent_names ?? trace.route.agents ?? []).join(', ') || '—'}
          />
          <KeyValue label={t('inside.method')} value={trace.route.method ?? '—'} />
          {trace.route.reason ? (
            <p className="text-meta text-text-3">{trace.route.reason}</p>
          ) : null}
          {trace.route.scores && Object.keys(trace.route.scores).length ? (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-3">
                {t('inside.scores')}
              </p>
              {Object.entries(trace.route.scores).map(([agent, score]) => (
                <KeyValue key={agent} label={agent} value={score.toFixed(2)} />
              ))}
            </div>
          ) : null}
        </Step>
      ) : null}

      {trace.authz ? (
        <Step title={t('inside.authz')} tone={trace.authz.decision.allowed ? 'ok' : 'bad'}>
          <KeyValue label={t('inside.subject')} value={trace.authz.subject_name} />
          <KeyValue
            label={t('inside.action')}
            value={<span className="font-mono text-meta">{trace.authz.action}</span>}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-meta text-text-3">{t('inside.decision')}</span>
            <Badge tone={trace.authz.decision.allowed ? 'ok' : 'bad'}>
              {trace.authz.decision.allowed ? t('inside.allowed') : t('inside.denied')}
            </Badge>
          </div>
          <KeyValue
            label={t('inside.policy')}
            value={<span className="font-mono text-meta">{trace.authz.decision.policy}</span>}
          />
          <p className="text-meta text-text-3">{trace.authz.decision.reason}</p>
        </Step>
      ) : null}

      {trace.tools.length ? (
        <Step
          title={t('inside.tools')}
          tone={trace.tools.some((tool) => !tool.decision?.allowed) ? 'bad' : 'ok'}
        >
          {trace.tools.map((tool, i) => (
            <ToolStep key={i} tool={tool} />
          ))}
        </Step>
      ) : null}

      {message.proposals.length ? (
        <Step title={t('inside.proposals')} tone="warn">
          {message.proposals.map((proposal) => (
            <div key={proposal.id} className="rounded-card border border-border-subtle bg-surface/50 p-2.5">
              <p className="text-ui text-text">{proposal.summary}</p>
              <p className="font-mono text-meta text-text-3">{proposal.tool}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <RiskBadge risk={proposal.risk} />
                {proposal.step_up_required ? <Badge tone="warn">step-up</Badge> : null}
              </div>
            </div>
          ))}
        </Step>
      ) : null}

      {output.length ? (
        <Step
          title={t('inside.guardrailsOut')}
          tone={output.some((g) => g.outcome === 'block') ? 'bad' : output.some((g) => g.outcome !== 'pass') ? 'warn' : 'neutral'}
        >
          {output.map((item, i) => (
            <GuardrailRow key={i} item={item} />
          ))}
        </Step>
      ) : null}

      {usage ? (
        <Step title={t('inside.usage')}>
          <KeyValue
            label={t('inside.model')}
            value={<span className="font-mono text-meta">{usage.model || '—'}</span>}
          />
          <KeyValue label={t('inside.promptTokens')} value={usage.prompt_tokens} />
          <KeyValue label={t('inside.completionTokens')} value={usage.completion_tokens} />
          <KeyValue label={t('inside.cost')} value={usd(usage.cost_usd)} />
        </Step>
      ) : null}
    </ol>
  );
}

export function InsidePanel({
  message,
  onClose,
}: {
  message: ChatMessage | null;
  onClose: () => void;
}): JSX.Element {
  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-panel">
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-ui font-medium text-text">{t('inside.title')}</h2>
          <p className="text-meta text-text-3">{t('inside.subtitle')}</p>
        </div>
        <IconButton icon={X} label={t('inside.close')} onClick={onClose} />
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto">
        <InsideContent message={message} />
      </div>
    </aside>
  );
}
