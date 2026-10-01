import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ChipInput, Field, inputClass } from '@/components/studio/common';
import { Badge, Button, CardFrame, RiskBadge } from '@/components/ui';
import { t } from '@/i18n';
import { AGENT_ICON_NAMES, agentIcon } from '@/lib/icons';
import { type AgentForm, specFromForm, validateForm } from '@/lib/studioSpec';
import type { AgentSpec, EvaluationCase, StudioCatalog } from '@/transport/types';

const KIND_LABELS: Record<EvaluationCase['kind'], string> = {
  routing: t('editor.kind.routing'),
  citation: t('editor.kind.citation'),
  refusal: t('editor.kind.refusal'),
};

export function AgentEditor({
  form,
  onChange,
  catalog,
  onSubmit,
  submitLabel,
  busy,
  error,
  disabled,
}: {
  form: AgentForm;
  onChange: (form: AgentForm) => void;
  catalog: StudioCatalog;
  onSubmit: (spec: AgentSpec) => void;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  disabled?: boolean;
}): JSX.Element {
  const [problems, setProblems] = useState<string[]>([]);
  const set = (patch: Partial<AgentForm>): void => onChange({ ...form, ...patch });
  const Icon = agentIcon(form.icon);
  const highRisk = form.tools.some(
    (name) => catalog.tools.find((tool) => tool.name === name)?.requires_governance_review,
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <CardFrame icon={Icon} title={form.name || t('studio.new')} agentName={t('studio.tab.config')}>
        <Field label={t('editor.name')}>
          <input
            className={inputClass}
            value={form.name}
            disabled={disabled}
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <Field label={t('editor.description')} hint={t('editor.descriptionHint')}>
          <textarea
            className={clsx(inputClass, 'resize-y')}
            rows={2}
            value={form.description}
            disabled={disabled}
            onChange={(event) => set({ description: event.target.value })}
          />
        </Field>
        <Field label={t('editor.instructions')} hint={t('editor.instructionsHint')}>
          <textarea
            className={clsx(inputClass, 'resize-y')}
            rows={5}
            value={form.instructions}
            disabled={disabled}
            onChange={(event) => set({ instructions: event.target.value })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('editor.tone')}>
            <input
              className={inputClass}
              value={form.tone}
              disabled={disabled}
              onChange={(event) => set({ tone: event.target.value })}
            />
          </Field>
          <Field label={t('editor.icon')}>
            <select
              className={inputClass}
              value={form.icon}
              disabled={disabled}
              onChange={(event) => set({ icon: event.target.value })}
            >
              {AGENT_ICON_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </CardFrame>

      <CardFrame icon={Icon} title={t('editor.audience')}>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['all', t('editor.audience.all')],
              ['managers', t('editor.audience.managers')],
              ['hrbps', t('editor.audience.hrbps')],
              ['units', t('editor.audience.units')],
            ] as const
          ).map(([id, label]) => {
            const active =
              id === 'units'
                ? form.audienceType === 'units'
                : id === 'all'
                  ? form.audienceType === 'all'
                  : form.audienceType === 'roles' &&
                    form.audienceRoles.includes(id === 'managers' ? 'manager' : 'hrbp');
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (id === 'all') set({ audienceType: 'all' });
                  else if (id === 'units') set({ audienceType: 'units' });
                  else set({ audienceType: 'roles', audienceRoles: [id === 'managers' ? 'manager' : 'hrbp'] });
                }}
                className={clsx(
                  'rounded-control border px-3 py-1.5 text-ui transition-colors',
                  active ? 'border-brand bg-brand-soft text-brand' : 'border-border text-text-2 hover:border-brand',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        {form.audienceType === 'units' ? (
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {catalog.units.map((unit) => (
              <label key={unit.id} className="flex items-center gap-2 text-ui text-text-2">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={form.audienceUnits.includes(unit.id)}
                  onChange={(event) =>
                    set({
                      audienceUnits: event.target.checked
                        ? [...form.audienceUnits, unit.id]
                        : form.audienceUnits.filter((id) => id !== unit.id),
                    })
                  }
                />
                <span className="truncate">
                  {unit.name} <span className="font-mono text-meta text-text-3">{unit.id}</span>
                </span>
              </label>
            ))}
          </div>
        ) : null}
      </CardFrame>

      <CardFrame icon={Icon} title={t('editor.tools')} notes={[t('editor.toolsHint')]}>
        {highRisk ? <Badge tone="bad">{t('studio.risk.high')}</Badge> : null}
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {catalog.tools.map((tool) => (
            <label
              key={tool.name}
              title={tool.allowed_in_studio ? tool.description : t('editor.toolBlocked')}
              className={clsx(
                'flex items-start gap-2 text-ui',
                tool.allowed_in_studio ? 'text-text-2' : 'cursor-not-allowed text-text-3 opacity-60',
              )}
            >
              <input
                type="checkbox"
                className="mt-1"
                disabled={disabled || !tool.allowed_in_studio}
                checked={form.tools.includes(tool.name)}
                onChange={(event) =>
                  set({
                    tools: event.target.checked
                      ? [...form.tools, tool.name]
                      : form.tools.filter((name) => name !== tool.name),
                  })
                }
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate">{tool.title}</span>
                  <RiskBadge risk={tool.risk} />
                </span>
                <span className="block font-mono text-[11px] text-text-3">{tool.name}</span>
              </span>
            </label>
          ))}
        </div>
      </CardFrame>

      <CardFrame icon={Icon} title={t('editor.knowledge')} notes={[t('editor.knowledgeHint')]}>
        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {catalog.knowledge_bases
            .filter((kb) => !kb.id.startsWith('agente-'))
            .map((kb) => (
              <label key={kb.id} className="flex items-center gap-2 text-ui text-text-2">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={form.knowledge.includes(kb.id)}
                  onChange={(event) =>
                    set({
                      knowledge: event.target.checked
                        ? [...form.knowledge, kb.id]
                        : form.knowledge.filter((id) => id !== kb.id),
                    })
                  }
                />
                <span className="truncate">{kb.name}</span>
              </label>
            ))}
        </div>
      </CardFrame>

      <CardFrame icon={Icon} title={t('editor.routing')}>
        <Field label={t('editor.routing')}>
          <ChipInput
            label={t('editor.routing')}
            values={form.keywords}
            onChange={(keywords) => set({ keywords })}
          />
        </Field>
        <Field label={t('editor.examples')}>
          <ChipInput
            label={t('editor.examples')}
            values={form.examples}
            onChange={(examples) => set({ examples })}
          />
        </Field>
      </CardFrame>

      <CardFrame icon={Icon} title={t('editor.evaluation')} notes={[t('editor.evaluationHint')]}>
        <ul className="space-y-2">
          {form.evaluation.map((item, index) => (
            <li key={index} className="rounded-card border border-border-subtle bg-surface/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={t('editor.evaluation')}
                  className="rounded-control border border-border bg-panel px-2 py-1 text-meta text-text"
                  value={item.kind}
                  disabled={disabled}
                  onChange={(event) =>
                    set({
                      evaluation: form.evaluation.map((row, i) =>
                        i === index ? { ...row, kind: event.target.value as EvaluationCase['kind'] } : row,
                      ),
                    })
                  }
                >
                  {(['routing', 'citation', 'refusal'] as const).map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={t('editor.question')}
                  className={clsx(inputClass, 'min-w-0 flex-1')}
                  placeholder={t('editor.question')}
                  value={item.question}
                  disabled={disabled}
                  onChange={(event) =>
                    set({
                      evaluation: form.evaluation.map((row, i) =>
                        i === index ? { ...row, question: event.target.value } : row,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={t('common.remove')}
                  disabled={disabled}
                  onClick={() => set({ evaluation: form.evaluation.filter((_, i) => i !== index) })}
                  className="text-text-3 hover:text-bad"
                >
                  <Trash2 size={15} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <Button
          disabled={disabled}
          onClick={() => set({ evaluation: [...form.evaluation, { kind: 'routing', question: '' }] })}
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden />
          {t('common.add')}
        </Button>
      </CardFrame>

      {problems.length ? (
        <ul className="space-y-1 rounded-card border border-[var(--bad)]/40 bg-[var(--bad)]/10 px-3 py-2">
          {problems.map((problem, i) => (
            <li key={i} className="text-meta text-bad">
              {problem}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-meta text-bad">{error}</p> : null}

      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={busy || disabled}
          onClick={() => {
            const found = validateForm(form);
            setProblems(found);
            if (found.length === 0) onSubmit(specFromForm(form));
          }}
        >
          {busy ? t('common.saving') : submitLabel}
        </Button>
      </div>
    </div>
  );
}
