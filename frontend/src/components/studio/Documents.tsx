import { FileText, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, CardFrame, ScrollArea } from '@/components/ui';
import { t } from '@/i18n';
import { transport } from '@/transport';
import type { StudioDocument } from '@/transport/types';

export function Documents({ agentId, canEdit }: { agentId: string; canEdit: boolean }): JSX.Element {
  const [documents, setDocuments] = useState<StudioDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (): void => {
    transport
      .studioDocuments(agentId)
      .then(setDocuments)
      .catch((failure: Error) => setError(failure.message));
  };

  useEffect(load, [agentId]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <CardFrame
        icon={FileText}
        title={t('studio.tab.knowledge')}
        agentName={t('documents.hint')}
        action={
          canEdit ? (
            <Button disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload size={14} strokeWidth={1.75} aria-hidden />
              {busy ? t('common.loading') : t('documents.upload')}
            </Button>
          ) : undefined
        }
      >
        <input
          ref={fileRef}
          type="file"
          accept=".md,.txt,.pdf,.docx"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setBusy(true);
            setError(null);
            transport
              .studioUpload(agentId, file)
              .then(load)
              .catch((failure: Error) => setError(failure.message))
              .finally(() => setBusy(false));
          }}
        />
        {error ? <p className="text-meta text-bad">{error}</p> : null}
        {documents.length ? (
          <ScrollArea>
            <table className="w-full min-w-[420px] border-collapse text-ui">
              <thead>
                <tr className="text-left text-meta text-text-3">
                  <th className="py-1 pr-4 font-medium">{t('documents.title')}</th>
                  <th className="py-1 pr-4 font-medium">Base</th>
                  <th className="py-1 pr-4 text-right font-medium">{t('documents.chunks')}</th>
                  <th className="py-1 font-medium" />
                </tr>
              </thead>
              <tbody>
                {documents.map((document, i) => (
                  <tr key={i} className="border-t border-border-subtle">
                    <td className="py-1.5 pr-4 text-text-2">{document.title}</td>
                    <td className="py-1.5 pr-4 font-mono text-meta text-text-3">{document.kb}</td>
                    <td className="tnum py-1.5 pr-4 text-right">{document.chunks}</td>
                    <td className="py-1.5">
                      {document.quarantined ? (
                        <Badge tone="bad" className="whitespace-nowrap">
                          {t('documents.quarantined')}
                        </Badge>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        ) : (
          <p className="text-meta text-text-3">{t('documents.empty')}</p>
        )}
        {documents.some((document) => document.quarantined) ? (
          <p className="text-meta text-warn">{t('documents.quarantineHint')}</p>
        ) : null}
      </CardFrame>
    </div>
  );
}
