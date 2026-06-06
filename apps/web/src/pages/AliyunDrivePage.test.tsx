import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    QRCode: ({ value }: { value: string }) => React.createElement('div', { 'data-testid': 'mock-qrcode' }, value),
  };
});

import { App } from 'antd';
import { AliyunDrivePage } from './AliyunDrivePage.js';

describe('AliyunDrivePage', () => {
  it('renders status and starts oauth', async () => {
    const api = {
      get: vi.fn().mockResolvedValueOnce({ configured: false, authorized: false, authorizationState: 'unauthorized' }),
      post: vi.fn().mockResolvedValueOnce({ state: 'state-1', authorizationUrl: 'https://openapi.alipan.com/oauth/authorize?client_id=app', expiresAt: 123 }),
      put: vi.fn(),
      delete: vi.fn(),
    } as any;
    render(<App><AliyunDrivePage api={api} /></App>);
    expect(await screen.findByText(/未授权/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /生成授权二维码/ }));
    expect(await screen.findByText(/授权链接/)).toBeInTheDocument();
    expect(screen.getAllByText(/openapi.alipan.com/).length).toBeGreaterThan(0);
  });

  it('auto-tests authorization when local status is authorized', async () => {
    const api = {
      get: vi.fn().mockResolvedValueOnce({
        configured: true,
        authorized: true,
        authorizationState: 'authorized',
        expiresAt: Date.now() + 3600_000,
      }),
      post: vi
        .fn()
        .mockResolvedValueOnce({ state: 'valid', message: '授权有效', checkedAt: 123 })
        .mockResolvedValueOnce({ state: 'valid', message: '授权有效', checkedAt: 123 }),
      put: vi.fn(),
      delete: vi.fn(),
    } as any;
    render(<App><AliyunDrivePage api={api} /></App>);

    expect(await screen.findByText('授权记录状态')).toBeInTheDocument();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/aliyundrive/test', {}));
    expect(await screen.findByText(/远程校验状态/)).toBeInTheDocument();
    expect(screen.getAllByText(/有效/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '测试授权' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  });
});
