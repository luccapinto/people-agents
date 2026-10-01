import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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

export function App(): JSX.Element {
  return (
    <SessionProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routed />
      </BrowserRouter>
    </SessionProvider>
  );
}
