import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AliyunDrivePage } from './AliyunDrivePage.js';

describe('AliyunDrivePage', () => {
  it('renders status and starts oauth', async () => {
    const api = {
      get: vi.fn().mockResolvedValueOnce({ configured: false, authorized: false }),
      post: vi.fn().mockResolvedValueOnce({ state: 'state-1', authorizationUrl: 'https://openapi.alipan.com/oauth/authorize?client_id=app', expiresAt: 123 }),
      put: vi.fn(),
      delete: vi.fn(),
    } as any;
    render(<AliyunDrivePage api={api} />);
    expect(await screen.findByText(/未授权/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /生成授权二维码/ }));
    expect(await screen.findByText(/授权链接/)).toBeInTheDocument();
    expect(screen.getByText(/openapi.alipan.com/)).toBeInTheDocument();
  });
});
