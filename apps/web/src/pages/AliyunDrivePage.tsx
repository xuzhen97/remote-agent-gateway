import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Form, Input, InputNumber, QRCode, Space, Table, Tag, Typography } from 'antd';
import type { Api } from '../api/http';
import { completeAliyunDriveOAuth, getAliyunDriveStatus, saveAliyunDriveConfig, startAliyunDriveOAuth, type AliyunDriveStatus } from '../api/aliyundrive';

interface Props { api: Api }

export function AliyunDrivePage({ api }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [codeForm] = Form.useForm();
  const [status, setStatus] = useState<AliyunDriveStatus | null>(null);
  const [oauth, setOauth] = useState<{ state: string; authorizationUrl: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const next = await getAliyunDriveStatus(api);
    setStatus(next);
    form.setFieldsValue({
      clientId: next.clientId,
      scope: next.scope ?? 'user:base,file:all:read,file:all:write',
      openapiBase: next.openapiBase ?? 'https://openapi.alipan.com',
      redirectUri: next.redirectUri ?? 'oob',
      transferFolder: next.transferFolder ?? 'RemoteAgentGatewayTransfers',
      cleanupTtlHours: Math.round((next.cleanupTtlMs ?? 86400000) / 3600000),
    });
  }

  useEffect(() => { void refresh(); }, []);

  async function saveConfig(values: any) {
    setLoading(true);
    try {
      const payload = {
        clientId: values.clientId,
        clientSecret: values.clientSecret || undefined,
        scope: values.scope,
        openapiBase: values.openapiBase,
        redirectUri: values.redirectUri,
        transferFolder: values.transferFolder,
        cleanupTtlMs: Number(values.cleanupTtlHours ?? 24) * 3600000,
      };
      await saveAliyunDriveConfig(api, payload);
      message.success('阿里云盘配置已保存');
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally { setLoading(false); }
  }

  async function startOAuth() {
    setLoading(true);
    try { setOauth(await startAliyunDriveOAuth(api)); }
    finally { setLoading(false); }
  }

  async function completeOAuth(values: { code: string }) {
    if (!oauth) return;
    setLoading(true);
    try {
      setStatus(await completeAliyunDriveOAuth(api, { state: oauth.state, code: values.code }));
      setOauth(null);
      codeForm.resetFields();
      message.success('阿里云盘授权完成');
    } finally { setLoading(false); }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="阿里云盘状态">
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="配置状态">{status?.configured ? <Tag color="blue">已配置</Tag> : <Tag>未配置</Tag>}</Descriptions.Item>
          <Descriptions.Item label="授权状态">{status?.authorized ? <Tag color="green">已授权</Tag> : <Tag color="red">未授权</Tag>}</Descriptions.Item>
          <Descriptions.Item label="Drive ID">{status?.driveId ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="过期时间">{status?.expiresAt ? new Date(status.expiresAt).toLocaleString() : '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="应用配置">
        <Form form={form} layout="vertical" onFinish={saveConfig}>
          <Form.Item name="clientId" label="client_id" rules={[{ required: true, message: '请输入 client_id' }]}><Input /></Form.Item>
          <Form.Item name="clientSecret" label="client_secret（可选）"><Input.Password /></Form.Item>
          <Form.Item name="scope" label="scope"><Input /></Form.Item>
          <Form.Item name="openapiBase" label="openapi_base" rules={[{ type: 'url', message: '请输入有效的 URL' }]}><Input /></Form.Item>
          <Form.Item name="redirectUri" label="redirect_uri"><Input /></Form.Item>
          <Form.Item name="transferFolder" label="中转目录"><Input /></Form.Item>
          <Form.Item name="cleanupTtlHours" label="清理 TTL（小时）"><InputNumber min={1} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>保存配置</Button>
        </Form>
      </Card>

      <Card title="OAuth 授权">
        <Space direction="vertical">
          <Button onClick={startOAuth} loading={loading}>生成授权二维码</Button>
          {oauth
            ? <>
                <QRCode value={oauth.authorizationUrl} />
                <Typography.Text copyable>授权链接：{oauth.authorizationUrl}</Typography.Text>
                <Form form={codeForm} layout="inline" onFinish={completeOAuth}>
                  <Form.Item name="code" rules={[{ required: true, message: '请输入授权 code' }]}>
                    <Input placeholder="粘贴授权 code" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={loading}>完成授权</Button>
                </Form>
              </>
            : <Alert type="info" message="生成授权二维码后，扫码或打开链接完成授权，再粘贴 code。" />
          }
        </Space>
      </Card>

      <Card title="Transfer 监控">
        <Table rowKey="id" dataSource={[]} columns={[
          { title: 'ID', dataIndex: 'id' },
          { title: 'Client', dataIndex: 'clientId' },
          { title: '文件名', dataIndex: 'filename' },
          { title: '状态', dataIndex: 'status' },
          { title: '上传', dataIndex: 'uploadedBytes' },
          { title: '下载', dataIndex: 'downloadedBytes' },
          { title: '清理', dataIndex: 'cleanupStatus' },
        ]} />
      </Card>
    </Space>
  );
}
