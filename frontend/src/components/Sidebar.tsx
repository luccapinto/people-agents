import clsx from 'clsx';
import { Lock, Moon, Plus, Shield, Sun, UserCog, X } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { t } from '@/i18n';
import { branding } from '@/lib/branding';
import { personaIcon } from '@/lib/icons';
import type { Theme } from '@/lib/theme';
import type { ConversationSummary, Me } from '@/transport/types';

export function Sidebar({
  me,
  conversations,
  currentId,
  theme,
  onSelect,
  onNew,
  onSwitchPersona,
  onToggleTheme,
  onShowPrivacy,
  onClose,
}: {
  me: Me;
  conversations: ConversationSummary[];
  currentId: string | null;
  theme: Theme;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSwitchPersona: () => void;
  onToggleTheme: () => void;
  onShowPrivacy: () => void;
  onClose?: () => void;
}): JSX.Element {
  const PersonaIcon = personaIcon(me.roles.includes('hrbp') ? 'hrbp' : 'colaborador');
  return (
    <nav className="flex h-full w-[272px] shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-control bg-brand text-[13px] font-semibold text-white">
            {branding.productName.slice(0, 1)}
          </span>
          <span className="text-ui font-medium text-text">{branding.productName}</span>
        </div>
        {onClose ? <IconButton icon={X} label={t('nav.close')} onClick={onClose} /> : null}
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={onSwitchPersona}
          title={t('nav.switchPersona')}
          className="flex w-full items-center gap-2 rounded-card border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-brand"
        >
          <PersonaIcon size={16} strokeWidth={1.75} className="shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui text-text">{me.name}</span>
            <span className="block truncate text-meta text-text-3">{me.title}</span>
          </span>
          <UserCog size={14} strokeWidth={1.75} className="shrink-0 text-text-3" aria-hidden />
        </button>
      </div>

      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-control border border-border bg-panel px-3 py-2 text-ui text-text transition-colors hover:border-brand hover:text-brand"
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden />
          {t('nav.newConversation')}
        </button>
      </div>

      <div className="scroll-thin mt-4 min-h-0 flex-1 overflow-y-auto px-3">
        <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-text-3">
          {t('nav.history')}
        </p>
        {conversations.length ? (
          <ul className="space-y-0.5">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className={clsx(
                    'flex w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-left text-meta transition-colors',
                    conversation.id === currentId
                      ? 'bg-brand-soft text-brand'
                      : 'text-text-2 hover:bg-surface',
                  )}
                >
                  {conversation.sensitive ? (
                    <Lock size={12} strokeWidth={2} className="shrink-0" aria-hidden />
                  ) : null}
                  <span className="truncate">
                    {conversation.sensitive ? t('nav.sensitive') : conversation.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 text-meta text-text-3">{t('nav.noHistory')}</p>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={onShowPrivacy}
          className="inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-meta text-text-3 transition-colors hover:text-text"
        >
          <Shield size={14} strokeWidth={1.75} aria-hidden />
          {t('nav.privacy')}
        </button>
        <IconButton
          icon={theme === 'dark' ? Sun : Moon}
          label={theme === 'dark' ? t('nav.theme.light') : t('nav.theme.dark')}
          onClick={onToggleTheme}
        />
      </footer>
    </nav>
  );
}
