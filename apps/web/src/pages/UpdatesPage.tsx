import { useEffect, useState, useCallback } from 'react';
import {
  Typography, Tabs, Card, Button, Modal, Input, Table, Select,
  Space, Tag, Popconfirm, message, Empty, Descriptions, InputNumber,
  Upload, Progress, Alert,
} from 'antd';
import {
  CloudUploadOutlined, RocketOutlined, ReloadOutlined, PlusOutlined,
  InboxOutlined, CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import type { Api } from '../api/http';
import { ApiError } from '../api/http';
import {
  listReleases, registerRelease, getRelease, uploadArtifact, createCampaign, getCampaign,
  listCampaigns, listTargets, listTargetAttempts, retryCampaign, buildReleaseManifest,
  deleteRelease, deleteCampaign,
  type ReleaseSummary, type ReleaseDetail, type CampaignRecord, type TargetRecord, type UploadedArtifact, type AttemptRecord,
} from '../api/updates';
import { StatusTag } from '../components/StatusTag';
import { startCampaign } from '../api/updates';

const { Title, Text } = Typography;
const { Dragger } = Upload;

interface UpdatesPageProps { api: Api; }

export function UpdatesPage({ api }: UpdatesPageProps) {
  return (
    <div>
      <Title level={3} style={{ color: 'rgba(255,255,255,0.85)' }}>更新管理</Title>
      <Tabs
        defaultActiveKey="releases"
        items={[
          { key: 'releases', label: <span><CloudUploadOutlined /> 版本发布</span>, children: <ReleasesTab api={api} /> },
          { key: 'campaigns', label: <span><RocketOutlined /> 更新编排</span>, children: <CampaignsTab api={api} /> },
        ]}
      />
    </div>
  );
}

// ==================== Releases Tab ====================

function ReleasesTab({ api }: { api: Api }) {
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<ReleaseDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReleases(await listReleases(api)); } catch { /* ignore */ }
    setLoading(false);
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const handleViewDetail = async (version: string) => {
    try {
      setDetail(await getRelease(api, version));
      setDetailOpen(true);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '获取详情失败');
    }
  };

  const handleDeleteRelease = async (version: string, force = false) => {
    try {
      const result = await deleteRelease(api, version, force ? { force: true } : undefined);
      message.success(`已删除 ${result.version}`);
      if (detail?.version === version) {
        setDetail(null);
        setDetailOpen(false);
      }
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RELEASE_IN_USE' && !force) {
        return new Promise<void>((resolve) => {
          Modal.confirm({
            title: '该版本已被编排引用',
            content: '强制删除会级联删除关联 campaign、targets 和 attempts。确定继续吗？',
            okText: '强制删除',
            okButtonProps: { danger: true },
            onOk: async () => {
              await handleDeleteRelease(version, true);
              resolve();
            },
            onCancel: () => resolve(),
          });
        });
      }
      message.error(error instanceof Error ? error.message : '删除版本失败');
    }
  };

  return (
    <Card
      title="已发布版本"
      extra={<Button icon={<PlusOutlined />} type="primary" onClick={() => setPublishOpen(true)}>发布新版本</Button>}
      styles={{ header: { color: 'rgba(255,255,255,0.85)' } }}
    >
      <Table
        dataSource={releases}
        rowKey="version"
        loading={loading}
        size="small"
        pagination={false}
        columns={[
          { title: '版本', dataIndex: 'version', key: 'version', render: (v: string) => <Text code>{v}</Text> },
          {
            title: '状态', dataIndex: 'enabled', key: 'enabled', width: 100,
            render: (v: boolean) => v ? <Tag color="green">已启用</Tag> : <Tag color="default">已禁用</Tag>,
          },
          {
            title: '操作', key: 'actions', width: 180,
            render: (_: unknown, record: ReleaseSummary) => (
              <Space size="small">
                <Button type="link" size="small" onClick={() => handleViewDetail(record.version)}>查看详情</Button>
                <Popconfirm
                  title={`确定删除版本 ${record.version} 吗？`}
                  okText="确定"
                  cancelText="取消"
                  onConfirm={() => handleDeleteRelease(record.version)}
                >
                  <Button type="link" size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
        locale={{ emptyText: <Empty description="暂无版本发布，点击右上角发布新版本" /> }}
      />

      {/* ====== Publish Wizard ====== */}
      <PublishWizard
        open={publishOpen}
        api={api}
        onClose={() => setPublishOpen(false)}
        onPublished={() => { setPublishOpen(false); load(); }}
      />

      {/* ====== Detail Modal ====== */}
      <Modal
        title={detail ? `版本详情: ${detail.version}` : '加载中...'}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={720}
      >
        {detail && (
          <Table
            dataSource={detail.artifacts}
            rowKey="fileName"
            size="small"
            pagination={false}
            columns={[
              { title: '文件名', dataIndex: 'fileName', key: 'fileName', render: (v: string) => <Text code>{v}</Text> },
              { title: '目标', key: 'target', render: (_: unknown, r: ReleaseDetail['artifacts'][0]) => `${r.targetType}/${r.platform}/${r.arch}` },
              { title: 'SHA256', dataIndex: 'sha256', key: 'sha256', render: (v: string) => <Text code style={{ fontSize: 10 }}>{v.slice(0, 16)}...</Text> },
              { title: '大小', dataIndex: 'size', key: 'size', render: (v: number) => formatSize(v) },
              { title: '启用', dataIndex: 'enabled', key: 'enabled', width: 80, render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag color="default">否</Tag> },
            ]}
          />
        )}
      </Modal>
    </Card>
  );
}

// ==================== Publish Wizard ====================

type WizardStep = 'upload' | 'review' | 'publishing';

function PublishWizard({ open, api, onClose, onPublished }: { open: boolean; api: Api; onClose: () => void; onPublished: () => void }) {
  const [step, setStep] = useState<WizardStep>('upload');
  const [version, setVersion] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState<UploadedArtifact[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [publishError, setPublishError] = useState<string | null>(null);

  const resetState = () => {
    setStep('upload');
    setVersion('');
    setFiles([]);
    setUploaded([]);
    setUploading(false);
    setUploadProgress({ current: 0, total: 0 });
    setPublishError(null);
  };

  const handleClose = () => { resetState(); onClose(); };

  const handleUpload = async () => {
    if (!version.trim() || files.length === 0) {
      message.warning('请填写版本号并选择要上传的安装包');
      return;
    }

    setUploading(true);
    setUploadProgress({ current: 0, total: files.length });
    const results: UploadedArtifact[] = [];

    for (let i = 0; i < files.length; i++) {
      try {
        results.push(await uploadArtifact(api, version.trim(), files[i]));
        setUploadProgress({ current: i + 1, total: files.length });
      } catch (e: unknown) {
        setPublishError(`${files[i].name}: ${e instanceof Error ? e.message : '上传失败'}`);
        setUploading(false);
        return;
      }
    }

    setUploaded(results);
    setUploading(false);
    setStep('review');
  };

  const handlePublish = async () => {
    setPublishError(null);
    const manifest = JSON.stringify(buildReleaseManifest(version, uploaded));

    try {
      await registerRelease(api, manifest);
      message.success(`v${version.trim()} 发布成功！`);
      resetState();
      onPublished();
    } catch (e: unknown) {
      setPublishError(e instanceof Error ? e.message : '发布失败');
    }
  };

  const footer = () => {
    if (step === 'upload') {
      return (
        <Space>
          <Button onClick={handleClose}>取消</Button>
          <Button type="primary" onClick={handleUpload} loading={uploading} disabled={!version.trim() || files.length === 0}>
            上传并继续
          </Button>
        </Space>
      );
    }
    if (step === 'review') {
      return (
        <Space>
          <Button onClick={() => { setStep('upload'); setPublishError(null); }}>返回修改</Button>
          <Button type="primary" icon={<RocketOutlined />} onClick={handlePublish}>
            确认发布
          </Button>
        </Space>
      );
    }
    return null;
  };

  // Generate manifest preview from uploaded artifacts
  const manifestPreview = uploaded.length > 0
    ? JSON.stringify(buildReleaseManifest(version, uploaded, '2026-01-01T00:00:00.000Z'), null, 2)
    : '';

  return (
    <Modal
      title="发布新版本"
      open={open}
      onCancel={handleClose}
      footer={footer()}
      width={680}
    >
      {publishError && (
        <Alert type="error" message={publishError} closable onClose={() => setPublishError(null)} style={{ marginBottom: 16 }} />
      )}

      {step === 'upload' && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text strong>版本号</Text>
            <Input
              placeholder="例如: v1.4.0"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              style={{ marginTop: 4 }}
              size="large"
            />
          </div>
          <div>
            <Text strong>上传安装包</Text>
            <Text type="secondary" style={{ marginLeft: 8 }}>
              文件名需包含 server/client 和 win/linux 标识（如 server-linux-x64.tar.gz）
            </Text>
            <Dragger
              multiple
              fileList={files.map((f) => ({ uid: f.name, name: f.name, status: 'done' } as any))}
              beforeUpload={(file) => { setFiles((prev) => [...prev, file]); return false; }}
              onRemove={(f) => { setFiles((prev) => prev.filter((x) => x.name !== f.name)); }}
              style={{ marginTop: 8 }}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">点击或拖拽安装包到此区域</p>
              <p className="ant-upload-hint">支持 .tar.gz、.zip 等格式</p>
            </Dragger>
          </div>
          {uploading && (
            <Progress percent={Math.round((uploadProgress.current / uploadProgress.total) * 100)} />
          )}
        </Space>
      )}

      {step === 'review' && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Alert
            type="success"
            message={`${uploaded.length} 个文件上传成功`}
            description="SHA256 和文件大小已自动计算，请确认以下信息后点击发布"
          />
          <Table
            dataSource={uploaded}
            rowKey="fileName"
            size="small"
            pagination={false}
            columns={[
              { title: '文件名', dataIndex: 'fileName', key: 'fileName', render: (v: string) => <Text code>{v}</Text> },
              { title: '目标', key: 'target', render: (_: unknown, r: UploadedArtifact) => <Tag>{r.targetType}/{r.platform}/{r.arch}</Tag> },
              { title: 'SHA256', dataIndex: 'sha256', key: 'sha256', render: (v: string) => <Text code style={{ fontSize: 10 }}>{v.slice(0, 16)}...</Text> },
              { title: '大小', dataIndex: 'size', key: 'size', render: (v: number) => formatSize(v) },
            ]}
          />
          <Card size="small" title="将自动生成的 Manifest">
            <pre style={{ fontSize: 11, maxHeight: 200, overflow: 'auto', color: '#8b949e', margin: 0 }}>
              {manifestPreview}
            </pre>
          </Card>
        </Space>
      )}
    </Modal>
  );
}

// ==================== Campaigns Tab ====================

function CampaignsTab({ api }: { api: Api }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [targetVersion, setTargetVersion] = useState('');
  const [includeServer, setIncludeServer] = useState(false);
  const [batchSize, setBatchSize] = useState(10);
  const [concurrency, setConcurrency] = useState(5);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [releasesForSelect, setReleasesForSelect] = useState<ReleaseSummary[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignRecord | null>(null);
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);

  const loadCampaigns = useCallback(async () => {
    try { setCampaigns(await listCampaigns(api)); } catch { /* ignore */ }
  }, [api]);

  useEffect(() => {
    listReleases(api).then(setReleasesForSelect).catch(() => {});
    loadCampaigns();
  }, [api, loadCampaigns]);

  useEffect(() => {
    if (!selectedCampaign || !['server_updating', 'client_updating'].includes(selectedCampaign.status)) return;
    const timer = window.setInterval(async () => {
      try {
        setSelectedCampaign(await getCampaign(api, selectedCampaign.id));
        setTargets(await listTargets(api, selectedCampaign.id));
        loadCampaigns();
      } catch { /* ignore */ }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [api, loadCampaigns, selectedCampaign]);

  const handleCreate = async () => {
    try {
      const result = await createCampaign(api, {
        targetVersion,
        includeServer,
        batchSize,
        maxConcurrency: concurrency,
        scope: { all: true },
        createdBy: 'web-ui',
      });
      message.success(`编排创建成功: ${result.campaignId.slice(0, 8)}... (${result.targets.length} 个对象)`);
      setCreateOpen(false);
      loadCampaigns();
      setCampaignLoading(true);
      try {
        setSelectedCampaign(await getCampaign(api, result.campaignId));
        setTargets(await listTargets(api, result.campaignId));
      } catch { /* ignore */ }
      setCampaignLoading(false);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '创建失败');
    }
  };

  const handleSelectCampaign = async (id: string) => {
    setCampaignLoading(true);
    try {
      setSelectedCampaign(await getCampaign(api, id));
      setTargets(await listTargets(api, id));
      setAttempts([]);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '查询失败');
    }
    setCampaignLoading(false);
  };

  const handleRetry = async (campaignId: string, mode: 'failed' | 'offline_skipped' | 'all') => {
    try {
      const res = await retryCampaign(api, campaignId, mode);
      message.success(`已重试 ${res.retried} 个对象`);
      setTargets(await listTargets(api, campaignId));
      loadCampaigns();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '重试失败');
    }
  };

  const handleStart = async (campaignId: string) => {
    try {
      const res = await startCampaign(api, campaignId);
      message.success(`编排已启动，状态: ${res.phase}`);
      setSelectedCampaign(await getCampaign(api, campaignId));
      setTargets(await listTargets(api, campaignId));
      loadCampaigns();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '启动失败');
    }
  };

  const handleViewAttempts = async (targetId: string) => {
    try {
      setAttempts(await listTargetAttempts(api, targetId));
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '获取尝试记录失败');
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    try {
      const result = await deleteCampaign(api, campaignId);
      message.success(`已删除编排 ${result.campaignId}`);
      if (selectedCampaign?.id === campaignId) {
        setSelectedCampaign(null);
        setTargets([]);
        setAttempts([]);
      }
      await loadCampaigns();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除编排失败');
    }
  };

  const phaseColor = (phase: string) => {
    if (phase === 'succeeded' || phase === 'verifying') return 'green';
    if (phase === 'failed' || phase === 'rolled_back') return 'red';
    if (phase === 'queued' || phase === 'downloading') return 'blue';
    if (phase === 'offline_skipped') return 'orange';
    return 'default';
  };

  return (
    <Card
      title="更新编排"
      extra={<Button icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建编排</Button>}
      styles={{ header: { color: 'rgba(255,255,255,0.85)' } }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Card size="small" title="最近编排">
          <Table
            dataSource={campaigns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 5 }}
            columns={[
              { title: 'ID', dataIndex: 'id', key: 'id', render: (v: string) => <Text code>{v.slice(0, 12)}</Text> },
              { title: '目标版本', dataIndex: 'targetVersion', key: 'targetVersion', render: (v: string) => <Text code>{v}</Text> },
              { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Tag>{v}</Tag> },
              { title: '对象', key: 'server', render: (_: unknown, r: CampaignRecord) => r.includeServer ? 'Server + Client' : 'Client' },
              { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: number) => new Date(v).toLocaleString() },
              { title: '操作', key: 'actions', render: (_: unknown, r: CampaignRecord) => (
                <Space size="small">
                  <Button type="link" size="small" onClick={() => handleSelectCampaign(r.id)}>查看</Button>
                  <Popconfirm
                    title={`确定删除编排 ${r.id.slice(0, 12)}... 吗？`}
                    okText="确定"
                    cancelText="取消"
                    onConfirm={() => handleDeleteCampaign(r.id)}
                  >
                    <Button type="link" size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              ), },
            ]}
            locale={{ emptyText: <Empty description="暂无编排" /> }}
          />
        </Card>

        <Card size="small" title="查询已有编排">
          <Space>
            <Input.Search
              placeholder="输入 Campaign ID"
              enterButton="查询"
              onSearch={handleSelectCampaign}
              style={{ width: 360 }}
              loading={campaignLoading}
            />
          </Space>
        </Card>

        {selectedCampaign && (
          <>
            <Card size="small" title={`编排 ${selectedCampaign.id.slice(0, 12)}...`}>
              <Descriptions column={4} size="small">
                <Descriptions.Item label="目标版本"><Text code>{selectedCampaign.targetVersion}</Text></Descriptions.Item>
                <Descriptions.Item label="状态"><Tag>{selectedCampaign.status}</Tag></Descriptions.Item>
                <Descriptions.Item label="包含 Server">{selectedCampaign.includeServer ? '是' : '否'}</Descriptions.Item>
                <Descriptions.Item label="批次大小">{selectedCampaign.batchSize}</Descriptions.Item>
                <Descriptions.Item label="并发数">{selectedCampaign.maxConcurrency}</Descriptions.Item>
                <Descriptions.Item label="创建者">{selectedCampaign.createdBy}</Descriptions.Item>
                <Descriptions.Item label="创建时间">{new Date(selectedCampaign.createdAt).toLocaleString()}</Descriptions.Item>
              </Descriptions>
              <Space style={{ marginTop: 12 }}>
                {selectedCampaign.status === 'draft' && (
                  <Popconfirm title="确定启动此编排? 将先更新 Server 再向在线客户端推送更新命令" onConfirm={() => handleStart(selectedCampaign.id)}>
                    <Button type="primary" size="small" icon={<RocketOutlined />}>启动编排</Button>
                  </Popconfirm>
                )}
                <Popconfirm title="确定重试所有失败项?" onConfirm={() => handleRetry(selectedCampaign.id, 'failed')}>
                  <Button size="small" icon={<ReloadOutlined />}>重试失败</Button>
                </Popconfirm>
                <Popconfirm title="确定重试离线跳过项?" onConfirm={() => handleRetry(selectedCampaign.id, 'offline_skipped')}>
                  <Button size="small" icon={<ReloadOutlined />}>重试离线</Button>
                </Popconfirm>
                <Button size="small" onClick={() => { setTargetsLoading(true); listTargets(api, selectedCampaign.id).then(setTargets).finally(() => setTargetsLoading(false)); }}>刷新状态</Button>
              </Space>
            </Card>

            <Card size="small" title={`更新对象 (${targets.length})`}>
              <Table
                dataSource={targets}
                rowKey="id"
                size="small"
                loading={targetsLoading}
                pagination={false}
                columns={[
                  { title: '类型', dataIndex: 'targetType', key: 'targetType', width: 80, render: (v: string) => v === 'server' ? <Tag color="purple">Server</Tag> : <Tag color="cyan">Client</Tag> },
                  { title: '客户端', dataIndex: 'clientId', key: 'clientId', render: (v: string | null) => v ? <Text code>{v.slice(0, 12)}</Text> : '-' },
                  { title: '平台', dataIndex: 'platform', key: 'platform', width: 80 },
                  { title: '当前版本', dataIndex: 'currentVersion', key: 'currentVersion', render: (v: string | null) => v ? <Text code>{v}</Text> : '-' },
                  { title: '目标版本', dataIndex: 'targetVersion', key: 'targetVersion', render: (v: string) => <Text code>{v}</Text> },
                  { title: '阶段', dataIndex: 'phase', key: 'phase', width: 120, render: (v: string) => <Tag color={phaseColor(v)}>{v}</Tag> },
                  { title: '尝试', dataIndex: 'attemptCount', key: 'attemptCount', width: 60 },
                  { title: '错误', key: 'error', render: (_: unknown, r: TargetRecord) => r.lastErrorCode ? <Text type="danger">{r.lastErrorCode}: {r.lastErrorMessage}</Text> : '-' },
                  { title: '完成时间', dataIndex: 'finishedAt', key: 'finishedAt', render: (v: number | null) => v ? new Date(v).toLocaleString() : '-' },
                  { title: '操作', key: 'actions', render: (_: unknown, r: TargetRecord) => <Button type="link" size="small" onClick={() => handleViewAttempts(r.id)}>尝试记录</Button> },
                ]}
                locale={{ emptyText: <Empty description="暂无更新对象" /> }}
              />
            </Card>

            {attempts.length > 0 && (
              <Card size="small" title={`尝试记录 (${attempts.length})`}>
                <Table
                  dataSource={attempts}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: 'ID', dataIndex: 'id', key: 'id', render: (v: string) => <Text code>{v.slice(0, 16)}</Text> },
                    { title: '序号', dataIndex: 'attemptNo', key: 'attemptNo', width: 80 },
                    { title: '结果', dataIndex: 'result', key: 'result', render: (v: string) => <Tag>{v}</Tag> },
                    { title: '错误', key: 'error', render: (_: unknown, r: AttemptRecord) => r.errorCode ? <Text type="danger">{r.errorCode}: {r.errorMessage}</Text> : '-' },
                    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', render: (v: number) => new Date(v).toLocaleString() },
                  ]}
                />
              </Card>
            )}
          </>
        )}
      </Space>

      <Modal
        title="新建更新编排"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        okText="创建"
        okButtonProps={{ disabled: !targetVersion }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text strong>目标版本</Text>
            <Select
              style={{ width: '100%', marginTop: 4 }}
              placeholder="选择已发布的版本"
              value={targetVersion || undefined}
              onChange={(v) => setTargetVersion(v)}
              options={releasesForSelect.map((r) => ({ label: r.version, value: r.version }))}
              notFoundContent={<Empty description="暂无已发布版本，请先在「版本发布」Tab 中发布" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            />
          </div>
          <Space>
            <Button
              type={includeServer ? 'primary' : 'default'}
              onClick={() => setIncludeServer(!includeServer)}
            >{includeServer ? '✓ 更新 Server' : '更新 Server'}</Button>
          </Space>
          <Space>
            <Text>批次大小</Text>
            <InputNumber min={1} max={100} value={batchSize} onChange={(v) => setBatchSize(v ?? 10)} />
            <Text>并发数</Text>
            <InputNumber min={1} max={50} value={concurrency} onChange={(v) => setConcurrency(v ?? 5)} />
          </Space>
        </Space>
      </Modal>
    </Card>
  );
}

// ==================== Helpers ====================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
