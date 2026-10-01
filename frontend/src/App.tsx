import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ChatPage } from '@/pages/ChatPage';
import { LoginPage } from '@/pages/LoginPage';
import { SessionProvider, useSession } from '@/state/session';

function Routed(): JSX.Element {
  const { me, ready } = useSession();
  if (!ready) {
    return <div className="flex h-full items-center justify-center text-meta text-text-3">…</div>;
  }
  return (
    <Routes>
      <Route path="/" element={me ? <Navigate to="/chat" replace /> : <LoginPage />} />
      <Route path="/chat" element={me ? <ChatPage /> : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
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
