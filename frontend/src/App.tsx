import type { ReactNode } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DemoBanner } from '@/components/DemoBanner';
import { ChatPage } from '@/pages/ChatPage';
import { ConsolePage } from '@/pages/ConsolePage';
import { LoginPage } from '@/pages/LoginPage';
import { StudioAgentPage } from '@/pages/StudioAgentPage';
import { StudioPage } from '@/pages/StudioPage';
import { SessionProvider, useSession } from '@/state/session';

function Routed(): JSX.Element {
  const { me, ready } = useSession();
  if (!ready) {
    return <div className="flex h-full items-center justify-center text-meta text-text-3">…</div>;
  }
  if (!me) {
    return (
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }
  const governance = me.roles.includes('governance_admin');
  const author = governance || me.roles.includes('agent_author');
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/chat" replace />} />
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/console" element={governance ? <ConsolePage /> : <Navigate to="/chat" replace />} />
      <Route path="/studio" element={author ? <StudioPage /> : <Navigate to="/chat" replace />} />
      <Route
        path="/studio/novo"
        element={author ? <StudioPage creating /> : <Navigate to="/chat" replace />}
      />
      <Route
        path="/studio/:agentId"
        element={author ? <StudioAgentPage /> : <Navigate to="/chat" replace />}
      />
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}

/** Static hosts such as GitHub Pages have no SPA fallback: a reload of /<repo>/chat would be a
 *  404. The demo therefore keeps the route in the hash (/<repo>/#/chat); the real app, served by
 *  nginx with a fallback, uses clean paths. */
function Router({ children }: { children: ReactNode }): JSX.Element {
  return import.meta.env.VITE_DEMO ? (
    <HashRouter>{children}</HashRouter>
  ) : (
    <BrowserRouter basename={import.meta.env.BASE_URL}>{children}</BrowserRouter>
  );
}

export function App(): JSX.Element {
  return (
    <SessionProvider>
      <Router>
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <Routed />
          </div>
          <DemoBanner />
        </div>
      </Router>
    </SessionProvider>
  );
}
