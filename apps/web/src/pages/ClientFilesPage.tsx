import { useEffect, useState } from 'react';
import { Table, Button, Input, Modal, Typography, Breadcrumb, Space, message, Spin, Upload, Alert, Select } from 'antd';
import {
  FolderOutlined,
  FileOutlined,
  ArrowLeftOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DownloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { Api } from '../api/http';
import { getClient } from '../api/clients';

const { Title, Text } = Typography;

interface FileEntry { name: string; path: string; type: string; size: number; mtimeMs: number }

interface Root { id: string; label: string; path: string }

interface ClientFilesPageProps {
  api: Api;
  clientId: string;
  clientName: string;
  onBack: () => void;
}

export function ClientFilesPage({ api, clientId, clientName, onBack }: ClientFilesPageProps) {
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [roots, setRoots] = useState<Root[]>([]);
  const [rootId, setRootId] = useState('');
  const [currentPath, setCurrentPath] = useState('.');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [initLoading, setInitLoading] = useState(true);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [writeOpen, setWriteOpen] = useState(false);
  const [writePath, setWritePath] = useState('');
  const [writeContent, setWriteContent] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Discover client HTTP endpoint
  useEffect(() => {
    getClient(api, clientId).then((c) => {
      if (c.clientHttpBaseUrl && c.clientHttpToken) {
        setBaseUrl(c.clientHttpBaseUrl);
        setToken(c.clientHttpToken);
      }
      setInitLoading(false);
    }).catch(() => setInitLoading(false));
  }, [api, clientId]);

  // Load roots
  useEffect(() => {
    if (!baseUrl || !token) return;
    setLoading(true);
    fetch(`${baseUrl}/files/roots`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        const list: Root[] = d?.data?.roots ?? d?.roots ?? [];
        setRoots(list);
        if (list.length > 0 && !rootId) setRootId(list[0].id);
      })
      .catch(() => message.error('Failed to load roots'))
      .finally(() => setLoading(false));
  }, [baseUrl, token]);

  // Load entries on rootId or currentPath change
  useEffect(() => {
    if (!baseUrl || !token || !rootId) return;
    setLoading(true);
    fetch(`${baseUrl}/files?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(currentPath)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setEntries(d?.data?.entries ?? d?.entries ?? []))
      .catch(() => message.error('Failed to list directory'))
      .finally(() => setLoading(false));
  }, [baseUrl, token, rootId, currentPath, reloadKey]);

  const handleNavigate = (dir: FileEntry) => {
    if (dir.type === 'directory') {
      setCurrentPath(currentPath === '.' ? dir.name : `${currentPath}/${dir.name}`);
    }
  };

  const handleDownload = (entry: FileEntry) => {
    if (!baseUrl || !token) return;
    const url = `${baseUrl}/files/download?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(entry.path)}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = entry.name;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
      })
      .catch(() => message.error('Download failed'));
  };

  const handleDelete = async (entry: FileEntry) => {
    if (!confirm(`Delete ${entry.name}?`)) return;
    try {
      const res = await fetch(`${baseUrl}/files?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(entry.path)}&recursive=${entry.type === 'directory'}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error?.message ?? 'Delete failed'); }
      message.success('Deleted');
      setReloadKey((k) => k + 1);
    } catch (err: any) { message.error(err.message); }
  };

  const handleMkdir = async () => {
    if (!mkdirName) return;
    try {
      const res = await fetch(`${baseUrl}/files/mkdir`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootId, path: currentPath === '.' ? mkdirName : `${currentPath}/${mkdirName}`, recursive: true }),
      });
      if (!res.ok) throw new Error('Failed');
      message.success('Created');
      setMkdirOpen(false);
      setMkdirName('');
      setReloadKey((k) => k + 1);
    } catch { message.error('Failed to create directory'); }
  };

  const handleWrite = async () => {
    const p = writePath || (currentPath === '.' ? 'new.txt' : `${currentPath}/new.txt`);
    try {
      const res = await fetch(`${baseUrl}/files/write?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(p)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: writeContent,
      });
      if (!res.ok) throw new Error('Failed');
      message.success('Written');
      setWriteOpen(false);
      setWriteContent('');
      setWritePath('');
      setReloadKey((k) => k + 1);
    } catch { message.error('Write failed'); }
  };

  if (initLoading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!baseUrl || !token) return <Alert type="error" message="Client HTTP endpoint is not ready" showIcon />;

  const pathParts = currentPath === '.' ? [] : currentPath.split('/');

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={onBack} style={{ marginBottom: 16 }}>返回</Button>
      <Title level={3} style={{ color: 'rgba(255,255,255,0.85)' }}>文件管理 — {clientName}</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{baseUrl}</Text>

      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          value={rootId || undefined}
          placeholder="选择根目录"
          style={{ minWidth: 260 }}
          options={roots.map((root) => ({
            value: root.id,
            label: `${root.label} (${root.path})`,
          }))}
          onChange={(value) => {
            setRootId(value);
            setCurrentPath('.');
          }}
        />
        <Button icon={<PlusOutlined />} onClick={() => setMkdirOpen(true)}>新建目录</Button>
        <Button icon={<EditOutlined />} onClick={() => setWriteOpen(true)}>写入文件</Button>
        <Button icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>上传文件</Button>
      </Space>

      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Button type="link" size="small" onClick={() => setCurrentPath('.')} style={{ padding: 0 }}>根目录</Button> },
          ...pathParts.map((part, i) => ({
            title: <Button type="link" size="small" onClick={() => setCurrentPath(pathParts.slice(0, i + 1).join('/'))} style={{ padding: 0 }}>{part}</Button>,
          })),
        ]}
      />

      <Table
        dataSource={entries}
        rowKey="name"
        loading={loading}
        size="small"
        onRow={(record) => ({ style: { cursor: 'pointer' }, onDoubleClick: () => handleNavigate(record) })}
        columns={[
          { title: '名称', dataIndex: 'name', key: 'name', render: (v: string, r: FileEntry) => (
            <Space>
              {r.type === 'directory' ? <FolderOutlined /> : <FileOutlined />}
              <Button type="link" size="small" onClick={() => handleNavigate(r)} style={{ padding: 0 }}>{v}</Button>
            </Space>
          )},
          { title: '类型', dataIndex: 'type', key: 'type', width: 80 },
          { title: '大小', key: 'size', width: 100, render: (_: unknown, r: FileEntry) => r.type === 'directory' ? '-' : String(r.size) },
          {
            title: '操作', key: 'actions', width: 160,
            render: (_: unknown, r: FileEntry) => (
              <Space>
                {r.type === 'file' && <Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(r)} />}
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)} />
              </Space>
            ),
          },
        ]}
      />

      <Modal title="新建目录" open={mkdirOpen} onOk={handleMkdir} onCancel={() => setMkdirOpen(false)}>
        <Input placeholder="目录名" value={mkdirName} onChange={(e) => setMkdirName(e.target.value)} />
      </Modal>

      <Modal title="写入文件" open={writeOpen} onOk={handleWrite} onCancel={() => setWriteOpen(false)} width={700}>
        <Input placeholder="路径 (可选，留空用当前目录)" value={writePath} onChange={(e) => setWritePath(e.target.value)} style={{ marginBottom: 8 }} />
        <Input.TextArea rows={8} placeholder="文件内容" value={writeContent} onChange={(e) => setWriteContent(e.target.value)} />
      </Modal>

      <Modal title="上传文件" open={uploadOpen} onCancel={() => setUploadOpen(false)} footer={null}>
        <Upload
          customRequest={async ({ file, onSuccess, onError }) => {
            try {
              const f = file as File;
              const res = await fetch(`${baseUrl}/files/upload?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(currentPath)}&filename=${encodeURIComponent(f.name)}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: f,
              });
              if (!res.ok) throw new Error('Upload failed');
              message.success('Uploaded');
              setUploadOpen(false);
              setReloadKey((k) => k + 1);
              (onSuccess as any)?.();
            } catch (err: any) {
              message.error(err.message);
              (onError as any)?.(err);
            }
          }}
        >
          <Button icon={<UploadOutlined />}>选择文件</Button>
        </Upload>
      </Modal>
    </div>
  );
}
