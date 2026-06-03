import { useState } from 'react';
import { Card, Input, Button, Typography, Space } from 'antd';
import { LockOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

interface TokenLoginProps {
  onLogin: (token: string) => void;
}

export function TokenLogin({ onLogin }: TokenLoginProps) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!token.trim()) return;
    try {
      setError('');
      const res = await fetch('/api/health');
      if (!res.ok) { setError('无法连接服务器'); return; }
      const check = await fetch('/api/clients', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (check.status === 401) { setError('令牌无效'); return; }
      onLogin(token.trim());
    } catch {
      setError('连接失败');
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <Card style={{ width: 400, textAlign: 'center' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Title level={3}>Remote Agent Gateway</Title>
          <Text type="secondary">输入 API Token 登录管理控制台</Text>
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="管理员令牌"
            value={token}
            onChange={(e) => { setToken(e.target.value); setError(''); }}
            onPressEnter={handleLogin}
          />
          {error && <Text type="danger">{error}</Text>}
          <Button type="primary" block onClick={handleLogin}>
            登 录
          </Button>
        </Space>
      </Card>
    </div>
  );
}
