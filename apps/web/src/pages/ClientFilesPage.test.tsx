import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClientFilesPage } from './ClientFilesPage.js';

const getClientMock = vi.fn();
const uploadClientFileMock = vi.fn();
const uploadClientFileViaRelayMock = vi.fn();

vi.mock('../api/clients', () => ({
  getClient: (...args: unknown[]) => getClientMock(...args),
}));

vi.mock('./client-file-upload.js', () => ({
  uploadClientFile: (...args: unknown[]) => uploadClientFileMock(...args),
}));

vi.mock('./client-file-relay-upload.js', () => ({
  uploadClientFileViaRelay: (...args: unknown[]) => uploadClientFileViaRelayMock(...args),
}));

describe('ClientFilesPage', () => {
  function mockClientDiscovery() {
    getClientMock.mockResolvedValue({
      clientHttpBaseUrl: 'http://client:20000',
      clientHttpToken: 'client-token',
      httpReady: true,
    });

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { roots: [{ id: 'root-0', label: 'Workspace', path: 'D:/workspace' }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { entries: [] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { entries: [] } }), { status: 200 }))
    );
  }

  it('shows mode select and uses direct upload helper', async () => {
    const api = {} as any;
    mockClientDiscovery();
    uploadClientFileMock.mockResolvedValue({ uploadId: 'upl_1', rootId: 'root-0', path: 'demo.jar', size: 12 });

    render(<ClientFilesPage api={api} clientId="client-1" clientName="Client 1" onBack={vi.fn()} />);

    expect(await screen.findByText('文件管理 — Client 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /上传文件/ }));
    expect(screen.getByText('自动（推荐）')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getAllByLabelText('上传模式').at(-1)!);
    fireEvent.click(await screen.findByText('直传'));

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello world'], 'demo.jar', { type: 'application/java-archive' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(uploadClientFileMock).toHaveBeenCalled());
    expect(uploadClientFileMock).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'http://client:20000',
      token: 'client-token',
      rootId: 'root-0',
      path: '.',
      file,
      onProgress: expect.any(Function),
    }));
    expect(uploadClientFileViaRelayMock).not.toHaveBeenCalled();
  });

  it('uses relay helper and renders fallback message from auto mode', async () => {
    const api = {} as any;
    mockClientDiscovery();
    uploadClientFileViaRelayMock.mockImplementation(async ({ onStateChange }: any) => {
      onStateChange({
        requestedMode: 'auto',
        resolvedMode: 'direct',
        overallPercent: 5,
        overallStatusText: '阿里云中转不可用，已自动回退为直传',
        stages: [],
      });
      return { kind: 'fallback_to_direct', reason: 'server_returned_frps_chunked' };
    });
    uploadClientFileMock.mockImplementation(async ({ onProgress }: any) => {
      onProgress({
        filename: 'demo.bin',
        uploadedBytes: 2,
        totalBytes: 5,
        partNumber: 0,
        partCount: 1,
        attempt: 1,
        rateBytesPerSecond: 1024,
        elapsedMs: 1,
      });
      return await new Promise(() => {});
    });

    render(<ClientFilesPage api={api} clientId="client-1" clientName="Client 1" onBack={vi.fn()} />);
    expect(await screen.findByText('文件管理 — Client 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /上传文件/ }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['hello'], 'demo.bin')] } });

    expect(await screen.findByText(/已自动回退为直传/)).toBeInTheDocument();
    await waitFor(() => expect(uploadClientFileViaRelayMock).toHaveBeenCalled());
  });

  it('renders relay stage details', async () => {
    const api = {} as any;
    mockClientDiscovery();
    uploadClientFileViaRelayMock.mockImplementation(async ({ onStateChange }: any) => {
      onStateChange({
        requestedMode: 'aliyundrive',
        resolvedMode: 'aliyundrive',
        overallPercent: 72,
        overallStatusText: '客户端正在下载',
        stages: [
          { key: 'create', label: '创建 transfer', status: 'completed', percent: 100, detailText: 'tr_1' },
          { key: 'aliyun', label: '上传到阿里云', status: 'completed', percent: 100, detailText: '5/5' },
          { key: 'download', label: '客户端下载', status: 'running', percent: 48, detailText: '48/100' },
          { key: 'write', label: '客户端写入完成', status: 'waiting', percent: 0, detailText: '等待中' },
        ],
      });
      return await new Promise(() => {});
    });

    render(<ClientFilesPage api={api} clientId="client-1" clientName="Client 1" onBack={vi.fn()} />);
    expect(await screen.findByText('文件管理 — Client 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /上传文件/ }));
    fireEvent.mouseDown(screen.getAllByLabelText('上传模式').at(-1)!);
    fireEvent.click(await screen.findByText('阿里云中转'));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['hello'], 'demo.bin')] } });

    expect(await screen.findByText(/客户端正在下载/)).toBeInTheDocument();
    expect(await screen.findByText('创建 transfer')).toBeInTheDocument();
    expect(await screen.findByText('上传到阿里云')).toBeInTheDocument();
    expect(await screen.findByText('客户端下载')).toBeInTheDocument();
    expect(await screen.findByText('客户端写入完成')).toBeInTheDocument();
  });
});
