import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClientFilesPage } from './ClientFilesPage.js';

const getClientMock = vi.fn();
const uploadClientFileMock = vi.fn();

vi.mock('../api/clients', () => ({
  getClient: (...args: unknown[]) => getClientMock(...args),
}));

vi.mock('./client-file-upload.js', () => ({
  uploadClientFile: (...args: unknown[]) => uploadClientFileMock(...args),
}));

describe('ClientFilesPage', () => {
  it('uses chunked upload helper from the upload modal', async () => {
    const api = {} as any;
    const onBack = vi.fn();

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

    uploadClientFileMock.mockResolvedValue({ uploadId: 'upl_1', rootId: 'root-0', path: 'demo.jar', size: 12 });

    render(<ClientFilesPage api={api} clientId="client-1" clientName="Client 1" onBack={onBack} />);

    expect(await screen.findByText('文件管理 — Client 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /上传文件/ }));

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
  });
});
