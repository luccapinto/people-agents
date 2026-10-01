import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge, IconButton } from '@/components/ui';
import { t } from '@/i18n';
import { transport } from '@/transport';

const ACCEPT = 'application/pdf,image/png,image/jpeg,text/plain';

export interface Attachment {
  upload_id: string;
  filename: string;
  readable?: boolean;
}

export function Composer({
  streaming,
  onSend,
  onStop,
}: {
  streaming: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const submit = (): void => {
    if (!text.trim() || streaming) return;
    onSend(text, attachments);
    setText('');
    setAttachments([]);
    if (areaRef.current) areaRef.current.style.height = 'auto';
  };

  return (
    <div className="space-y-1.5">
      {attachments.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {attachments.map((file) => (
            <li key={file.upload_id}>
              <Badge>
                <Paperclip size={11} strokeWidth={2} aria-hidden />
                {file.filename}
                {file.readable === false ? ` (${t('chat.unreadable')})` : ''}
                <button
                  type="button"
                  aria-label={t('chat.removeAttachment')}
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.upload_id !== file.upload_id),
                    )
                  }
                  className="ml-0.5 text-text-3 hover:text-text"
                >
                  <X size={11} strokeWidth={2} aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {uploadError ? <p className="text-meta text-bad">{uploadError}</p> : null}
      <div className="flex items-end gap-2 rounded-panel border border-border bg-panel px-2 py-2 focus-within:border-brand">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setUploadError(null);
            transport
              .upload(file)
              .then((result) =>
                setAttachments((current) => [
                  ...current,
                  { upload_id: result.upload_id, filename: result.filename, readable: result.readable },
                ]),
              )
              .catch(() => setUploadError(t('chat.uploadFailed')));
          }}
        />
        <IconButton
          icon={Paperclip}
          label={`${t('chat.attach')} — ${t('chat.attachHint')}`}
          onClick={() => fileRef.current?.click()}
        />
        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.placeholder')}
          onChange={(event) => {
            setText(event.target.value);
            const area = event.target;
            area.style.height = 'auto';
            area.style.height = `${Math.min(area.scrollHeight, 180)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          className="scroll-thin max-h-[180px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-chat text-text outline-none placeholder:text-text-3"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={t('chat.stop')}
            title={t('chat.stop')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-control border border-border text-text-2 transition-colors hover:border-brand hover:text-brand"
          >
            <Square size={13} strokeWidth={2.5} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            aria-label={t('chat.send')}
            title={t('chat.send')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-brand text-white transition-opacity disabled:opacity-30"
          >
            <ArrowUp size={16} strokeWidth={2.25} aria-hidden />
          </button>
        )}
      </div>
      <p className="px-1 text-[11px] text-text-3">{t('chat.hintKeys')}</p>
    </div>
  );
}
