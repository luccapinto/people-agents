import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { applyTheme, persistTheme, storedTheme, systemTheme, type Theme } from '@/lib/theme';
import { transport } from '@/transport';
import type { Me } from '@/transport/types';

interface SessionValue {
  me: Me | null;
  ready: boolean;
  theme: Theme;
  toggleTheme: () => void;
  signIn: (employeeId: string) => Promise<void>;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (storedTheme()) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent): void => setTheme(event.matches ? 'dark' : 'light');
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    let cancelled = false;
    transport
      .me()
      .then((value) => {
        if (!cancelled) setMe(value);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (employeeId: string) => {
    await transport.login(employeeId);
    setMe(await transport.me());
  }, []);

  const signOut = useCallback(() => {
    transport.logout();
    setMe(null);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      persistTheme(next);
      return next;
    });
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ me, ready, theme, toggleTheme, signIn, signOut }),
    [me, ready, theme, toggleTheme, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession precisa de um SessionProvider');
  return value;
}
