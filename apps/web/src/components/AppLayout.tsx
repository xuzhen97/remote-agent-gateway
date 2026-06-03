import type { ReactNode } from 'react';
import { Layout, Menu, Button } from 'antd';
import {
  DashboardOutlined,
  CloudServerOutlined,
  LinkOutlined,
  LogoutOutlined,
} from '@ant-design/icons';

const { Sider, Content } = Layout;

interface AppLayoutProps {
  current: string;
  onNavigate: (key: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

const menuItems = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: 'clients', icon: <CloudServerOutlined />, label: '客户端' },
  { key: 'mappings', icon: <LinkOutlined />, label: '端口映射' },
];

export function AppLayout({ current, onNavigate, onLogout, children }: AppLayoutProps) {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="dark">
        <div style={{ padding: '16px', color: '#fff', fontWeight: 700, fontSize: 16, borderBottom: '1px solid #303030' }}>
          RAG 控制台
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[current]}
          items={menuItems}
          onClick={({ key }) => onNavigate(key)}
          style={{ borderRight: 0 }}
        />
        <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16 }}>
          <Button type="text" icon={<LogoutOutlined />} onClick={onLogout} block danger>
            退出登录
          </Button>
        </div>
      </Sider>
      <Layout>
        <Content style={{ padding: 24, background: '#0f1117', overflow: 'auto' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
