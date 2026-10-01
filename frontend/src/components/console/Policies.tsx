import clsx from 'clsx';
import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { type MessageKey, t } from '@/i18n';
import { dateTime } from '@/lib/format';
import { policyKind, policyValue, validatePolicy } from '@/lib/policies';
import { transport } from '@/transport';
import type { Policy } from '@/transport/types';

type Draft = { value: unknown; error: string | null; saving: boolean; saved: boolean };

export function Policies(): JSX.Element {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);

  const load = (): void => {
    setLoading(true);
    transport
      .consolePolicies()
      .then((rows) => {
        setPolicies(rows);
        setDrafts(
          Object.fromEntries(
            rows.map((row) => [row.key, { value: policyValue(row), error: null, saving: false, saved: false }]),
          ),
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const patch = (key: string, next: Partial<Draft>): void =>
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...next } }));

  const save = (policy: Policy): void => {
    const draft = drafts[policy.key];
    const problem = validatePolicy(policy.key, draft.value);
    if (problem) {
      patch(policy.key, { error: problem, saved: false });
      return;
    }
    patch(policy.key, { saving: true, error: null, saved: false });
    transport
      .consoleUpdatePolicy(policy.key, draft.value)
      .then(() => {
        patch(policy.key, { saving: false, saved: true });
        transport.consolePolicies().then(setPolicies);
      })
      .catch((failure: Error) => patch(policy.key, { saving: false, error: failure.message }));
  };

  if (loading) return <p className="text-meta text-text-3">{t('common.loading')}</p>;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-2">
      {policies.map((policy) => {
        const draft = drafts[policy.key];
        if (!draft) return null;
        const dirty = JSON.stringify(draft.value) !== JSON.stringify(policyValue(policy));
        return (
          <section key={policy.key} className="rounded-card border border-border bg-panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-ui font-medium text-text">{policyText('title', policy.key) ?? policy.key}</h3>
                <p className="font-mono text-meta text-text-3">{policy.key}</p>
                <p className="mt-1 text-meta text-text-2">{policyText('text', policy.key) ?? policy.description}</p>
              </div>
              <div className="shrink-0">
                <PolicyEditor
                  policyKey={policy.key}
                  value={draft.value}
                  onChange={(value) => patch(policy.key, { value, error: null, saved: false })}
                />
              </div>
            </div>

            {draft.error ? <p className="mt-2 text-meta text-bad">{draft.error}</p> : null}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-meta text-text-3">
                {policy.updated_by
                  ? t('policies.updatedBy', {
                      name: policy.updated_by,
                      date: dateTime(policy.updated_at),
                    })
                  : t('policies.never')}
              </p>
              <div className="flex items-center gap-2">
                {draft.saved && !dirty ? (
                  <Badge tone="ok">
                    <Check size={11} strokeWidth={2.5} aria-hidden />
                    {t('common.saved')}
                  </Badge>
                ) : null}
                <Button variant="primary" disabled={!dirty || draft.saving} onClick={() => save(policy)}>
                  {draft.saving ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** PT-BR title and explanation for known policies; unknown keys fall back to the stored text. */
function policyText(kind: 'title' | 'text', key: string): string | null {
  const id = `policy.${kind}.${key}` as MessageKey;
  const value = t(id);
  return value === id ? null : value;
}

function PolicyEditor({
  policyKey,
  value,
  onChange,
}: {
  policyKey: string;
  value: unknown;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const kind = policyKind(policyKey);

  if (kind === 'switch') {
    const on = value === true;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={policyKey}
        onClick={() => onChange(!on)}
        className="flex items-center gap-2"
      >
        <span
          className={clsx(
            'relative h-5 w-9 rounded-full border transition-colors',
            on ? 'border-transparent bg-brand' : 'border-border bg-surface',
          )}
        >
          <span
            className={clsx(
              'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all',
              on ? 'left-[18px]' : 'left-0.5',
            )}
          />
        </span>
        <span className={clsx('text-meta', on ? 'text-brand' : 'text-text-3')}>
          {on ? t('policies.on') : t('policies.off')}
        </span>
      </button>
    );
  }

  if (kind === 'mode') {
    return (
      <select
        aria-label={policyKey}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-control border border-border bg-surface px-2 py-1.5 text-ui text-text outline-none focus:border-brand"
      >
        <option value="warn">{t('policies.mode.warn')}</option>
        <option value="block">{t('policies.mode.block')}</option>
      </select>
    );
  }

  if (kind === 'tags') {
    const tags = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="w-full max-w-[320px]">
        <ul className="flex flex-wrap justify-end gap-1">
          {tags.map((tag) => (
            <li key={tag}>
              <Badge>
                {tag}
                <button
                  type="button"
                  aria-label={`${t('common.remove')} ${tag}`}
                  onClick={() => onChange(tags.filter((item) => item !== tag))}
                  className="ml-0.5 text-text-3 hover:text-text"
                >
                  <X size={11} strokeWidth={2} aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
        <input
          aria-label={policyKey}
          placeholder={t('policies.addTopic')}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const next = event.currentTarget.value.trim();
            if (!next || tags.includes(next)) return;
            onChange([...tags, next]);
            event.currentTarget.value = '';
          }}
          className="mt-1 w-full rounded-control border border-border bg-surface px-2 py-1.5 text-right text-ui text-text outline-none placeholder:text-text-3 focus:border-brand"
        />
      </div>
    );
  }

  return (
    <input
      type="number"
      aria-label={policyKey}
      value={typeof value === 'number' ? value : ''}
      onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
      className="tnum w-32 rounded-control border border-border bg-surface px-2 py-1.5 text-right text-ui text-text outline-none focus:border-brand"
    />
  );
}
