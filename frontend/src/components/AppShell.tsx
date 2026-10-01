import clsx from 'clsx';
import { Menu, Shield, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Button, IconButton } from '@/components/ui';
import { t } from '@/i18n';
import { useSession } from '@/state/session';

export interface ShellTab {
  id: string;
  label: string;
}

/** Page chrome shared by the governance console and Agent Studio: the same sidebar as the
 *  chat (drawer on mobile), a header with the page title, optional tabs and actions. */
export function AppShell({
  title,
  subtitle,
  tabs,
  active,
  onTab,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  tabs?: ShellTab[];
  active?: string;
  onTab?: (id: string) => void;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const { me, theme, toggleTheme, signOut } = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const identity = me!;

  const sidebar = (onClose?: () => void): JSX.Element => (
    <Sidebar
      me={identity}
      theme={theme}
      onSwitchPersona={signOut}
      onToggleTheme={toggleTheme}
      onShowPrivacy={() => {
        setNoticeOpen(true);
        onClose?.();
      }}
      onClose={onClose}
    />
  );

  return (
    <div className="flex h-full overflow-hidden">
      <div className="hidden lg:flex">{sidebar()}</div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0">{sidebar(() => setDrawerOpen(false))}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-start gap-2">
            <span className="lg:hidden">
              <IconButton icon={Menu} label={t('nav.menu')} onClick={() => setDrawerOpen(true)} />
            </span>
            <div className="min-w-[10rem] flex-1">
              <h1 className="truncate text-headline font-semibold text-text">{title}</h1>
              {subtitle ? <p className="truncate text-meta text-text-3">{subtitle}</p> : null}
            </div>
            {actions ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">{actions}</div> : null}
          </div>
          {tabs?.length ? (
            <nav className="scroll-thin -mb-3 mt-3 flex gap-1 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTab?.(tab.id)}
                  className={clsx(
                    'shrink-0 rounded-t-control border-b-2 px-3 py-1.5 text-ui transition-colors',
                    tab.id === active
                      ? 'border-brand text-brand'
                      : 'border-transparent text-text-3 hover:text-text',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          ) : null}
        </header>

        <main className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-5">{children}</main>
      </div>

      {noticeOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-panel border border-border bg-panel p-5 shadow-pop">
            <div className="flex items-start gap-2">
              <Shield size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-brand" aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 className="text-ui font-medium text-text">{t('notice.transparencyTitle')}</h2>
                <p className="mt-1 text-meta text-text-2">{identity.transparency_notice}</p>
              </div>
              <IconButton icon={X} label={t('notice.close')} onClick={() => setNoticeOpen(false)} />
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="primary" onClick={() => setNoticeOpen(false)}>
                {t('notice.dismiss')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
