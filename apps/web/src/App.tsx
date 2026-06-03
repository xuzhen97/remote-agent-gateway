import { useState, useCallback, useRef } from 'react';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { TokenLogin } from './components/TokenLogin';
import { AppLayout } from './components/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { ClientsPage } from './pages/ClientsPage';
import { ClientDetailPage } from './pages/ClientDetailPage';
import { MappingsPage } from './pages/MappingsPage';
import { ClientFilesPage } from './pages/ClientFilesPage';
import { TasksPage } from './pages/TasksPage';
import { createApiClient, type Api } from './api/http';
import { getClient } from './api/clients';

type Route =
  | { page: 'dashboard' }
  | { page: 'clients' }
  | { page: 'client-detail'; clientId: string }
  | { page: 'client-files'; clientId: string; clientName: string }
  | { page: 'tasks'; clientId?: string; clientName?: string }
  | { page: 'mappings'; clientId?: string; clientName?: string };

export function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('rag_token'));
  const [route, setRoute] = useState<Route>({ page: 'dashboard' });
  const apiRef = useRef<Api | null>(null);

  const handleLogin = useCallback((t: string) => {
    localStorage.setItem('rag_token', t);
    setToken(t);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('rag_token');
    setToken(null);
    apiRef.current = null;
  }, []);

  if (!token) {
    return (
      <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }} locale={zhCN}>
        <TokenLogin onLogin={handleLogin} />
      </ConfigProvider>
    );
  }

  if (!apiRef.current) {
    apiRef.current = createApiClient({ getToken: () => token });
  }
  const api = apiRef.current;

  let content: React.ReactNode;
  let navKey: string;

  switch (route.page) {
    case 'dashboard':
      navKey = 'dashboard';
      content = <DashboardPage api={api} />;
      break;
    case 'clients':
      navKey = 'clients';
      content = (
        <ClientsPage
          api={api}
          onViewDetail={(id) => setRoute({ page: 'client-detail', clientId: id })}
          onOpenFiles={(id) => {
            getClient(api, id)
              .then((c) => setRoute({ page: 'client-files', clientId: id, clientName: c.name }))
              .catch(() => setRoute({ page: 'client-files', clientId: id, clientName: id }));
          }}
          onOpenMappings={(id) => {
            getClient(api, id)
              .then((c) => setRoute({ page: 'mappings', clientId: id, clientName: c.name }))
              .catch(() => setRoute({ page: 'mappings', clientId: id, clientName: id }));
          }}
          onOpenTasks={(id, name) => setRoute({ page: 'tasks', clientId: id, clientName: name })}
        />
      );
      break;
    case 'client-detail':
      navKey = 'clients';
      content = (
        <ClientDetailPage
          api={api}
          clientId={route.clientId}
          onBack={() => setRoute({ page: 'clients' })}
        />
      );
      break;
    case 'client-files':
      navKey = 'clients';
      content = (
        <ClientFilesPage
          api={api}
          clientId={route.clientId}
          clientName={route.clientName}
          onBack={() => setRoute({ page: 'clients' })}
        />
      );
      break;
    case 'tasks':
      navKey = 'tasks';
      content = <TasksPage api={api} initialClientId={route.clientId} initialClientName={route.clientName} />;
      break;
    case 'mappings':
      navKey = 'mappings';
      content = (
        <MappingsPage
          api={api}
          clientId={route.clientId}
          clientName={route.clientName}
          onBack={() => setRoute({ page: 'clients' })}
        />
      );
      break;
    default:
      navKey = 'dashboard';
      content = <DashboardPage api={api} />;
  }

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }} locale={zhCN}>
      <AppLayout
        current={navKey}
        onNavigate={(key) => {
          if (key === 'dashboard') setRoute({ page: 'dashboard' });
          else if (key === 'clients') setRoute({ page: 'clients' });
          else if (key === 'tasks') setRoute({ page: 'tasks' });
          else if (key === 'mappings') setRoute({ page: 'mappings' });
        }}
        onLogout={handleLogout}
      >
        {content}
      </AppLayout>
    </ConfigProvider>
  );
}
