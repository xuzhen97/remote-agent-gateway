import { App } from 'antd';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UpdatesPage } from './UpdatesPage.js';

describe('UpdatesPage', () => {
  it('renders the releases tab and shows version entries with delete button', async () => {
    const api = {
      get: vi.fn().mockResolvedValue({ ok: true, data: [{ version: 'v1.4.0', enabled: true }] }),
      post: vi.fn(),
      delete: vi.fn(),
    } as any;

    render(<App><UpdatesPage api={api} /></App>);

    expect(await screen.findByText('v1.4.0')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '删除' })).toBeInTheDocument();
  });
});
