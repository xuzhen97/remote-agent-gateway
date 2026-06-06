import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, QRCode, Space, Table, Tag, Typography } from 'antd';
import type { Api } from '../api/http';
import { completeAliyunDriveOAuth, getAliyunDriveStatus, saveAliyunDriveConfig, startAliyunDriveOAuth, testAliyunDriveAuthorization, listTransfers, getTransferEvents, type AliyunDriveAuthorizationTestResult, type AliyunDriveStatus, type TransferEventItem, type TransferListItem } from '../api/aliyundrive';
import { StatusTag } from '../components/StatusTag';

interface Props { api: Api }

export function AliyunDrivePage({ api }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [codeForm] = Form.useForm();
  const [status, setStatus] = useState<AliyunDriveStatus | null>(null);
  const [oauth, setOauth] = useState<{ state: string; authorizationUrl: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [testingAuthorization, setTestingAuthorization] = useState(false);
  const [authTest, setAuthTest] = useState<AliyunDriveAuthorizationTestResult | null>(null);
  const [transfers, setTransfers] = useState<TransferListItem[]>([]);
  const [transferEvents, setTransferEvents] = useState<TransferEventItem[]>([]);
  const [selectedTransfer, setSelectedTransfer] = useState<TransferListItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function runAuthorizationTest(showSuccessMessage = false) {
    setTestingAuthorization(true);
    try {
      const result = await testAliyunDriveAuthorization(api);
      setAuthTest(result);
      setStatus((prev) => prev ? {
        ...prev,
        driveId: result.driveId ?? prev.driveId,
        authorizedAccountName: result.authorizedAccountName ?? prev.authorizedAccountName,
      } : prev);
      if (showSuccessMessage) message.success(result.message);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '测试授权失败';
      setAuthTest({ state: 'network_error', message: msg, checkedAt: Date.now() });
      if (showSuccessMessage) message.error(msg);
    } finally {
      setTestingAuthorization(false);
    }
  }

  async function loadTransfers() {
    setTransfers(await listTransfers(api, 20));
  }

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
    await loadTransfers();
    if (next.authorizationState === 'authorized') {
      void runAuthorizationTest(false);
    } else {
      setAuthTest(null);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void loadTransfers(); }, 3000);
    return () => window.clearInterval(timer);
  }, []);

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
      <Card title="阿里云盘状态" extra={<Button onClick={() => void runAuthorizationTest(true)} loading={testingAuthorization} disabled={!status || status.authorizationState === 'unauthorized'}>测试授权</Button>}>
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="配置状态">{status?.configured ? <Tag color="blue">已配置</Tag> : <Tag>未配置</Tag>}</Descriptions.Item>
          <Descriptions.Item label="授权记录状态">{
            status?.authorizationState === 'authorized'
              ? <Tag color="green">已授权</Tag>
              : status?.authorizationState === 'expired'
                ? <Tag color="orange">已过期</Tag>
                : <Tag color="red">未授权</Tag>
          }</Descriptions.Item>
          <Descriptions.Item label="远程校验状态">{
            testingAuthorization
              ? <Tag color="processing">检测中</Tag>
              : authTest?.state === 'valid'
                ? <Tag color="green">有效</Tag>
                : authTest?.state === 'invalid'
                  ? <Tag color="red">已失效</Tag>
                  : authTest?.state === 'expired'
                    ? <Tag color="orange">已过期</Tag>
                    : authTest?.state === 'network_error'
                      ? <Tag color="default">网络异常</Tag>
                      : <Tag>未检测</Tag>
          }</Descriptions.Item>
          <Descriptions.Item label="校验说明">{authTest?.message ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="账户名">{status?.authorizedAccountName ?? authTest?.authorizedAccountName ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Drive ID">{status?.driveId ?? authTest?.driveId ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="过期时间">{status?.expiresAt ? new Date(status.expiresAt).toLocaleString() : '-'}</Descriptions.Item>
          <Descriptions.Item label="最近检测时间">{authTest?.checkedAt ? new Date(authTest.checkedAt).toLocaleString() : '-'}</Descriptions.Item>
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

      <Card title="Transfer 监控" extra={<Button onClick={() => void loadTransfers()}>刷新</Button>}>
        <Table rowKey="id" dataSource={transfers} size="small" columns={[
          { title: 'ID', dataIndex: 'id', render: (value: string) => <Typography.Text code>{value.slice(0, 12)}</Typography.Text> },
          { title: 'Client', dataIndex: 'clientId' },
          { title: '文件名', dataIndex: 'filename' },
          { title: '模式', dataIndex: 'mode' },
          { title: '状态', dataIndex: 'status', render: (value: string) => <StatusTag status={value} /> },
          { title: '上传', key: 'uploaded', render: (_: unknown, row: TransferListItem) => `${row.uploadedBytes}/${row.totalBytes}` },
          { title: '下载', key: 'downloaded', render: (_: unknown, row: TransferListItem) => `${row.downloadedBytes}/${row.totalBytes}` },
          { title: '清理', dataIndex: 'cleanupStatus' },
          { title: '更新时间', key: 'updatedAt', render: (_: unknown, row: TransferListItem) => new Date(row.updatedAt).toLocaleString() },
          {
            title: '操作', key: 'actions', render: (_: unknown, row: TransferListItem) => (
              <Button size="small" onClick={async () => {
                setSelectedTransfer(row);
                setTransferEvents(await getTransferEvents(api, row.id));
                setDrawerOpen(true);
              }}>查看事件</Button>
            ),
          },
        ]} />
      </Card>

      <Drawer title="Transfer 事件" open={drawerOpen} width={720} onClose={() => setDrawerOpen(false)}>
        {selectedTransfer ? (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <div>
              <Typography.Text strong>ID</Typography.Text>
              <pre>{selectedTransfer.id}</pre>
            </div>
            <div>
              <Typography.Text strong>状态</Typography.Text>
              <pre>{JSON.stringify(selectedTransfer, null, 2)}</pre>
            </div>
            <div>
              <Typography.Text strong>事件流</Typography.Text>
              <pre>{JSON.stringify(transferEvents, null, 2)}</pre>
            </div>
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
