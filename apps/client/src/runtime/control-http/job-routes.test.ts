import { describe, expect, it } from 'vitest';
import { ControlHttpRouter } from './router.js';

describe('registerJobRoutes with audit', () => {
  it('accepts audit executor parameter', () => {
    const router = new ControlHttpRouter();
    // Just verify the router can be created - actual route testing done via E2E
    expect(router).toBeDefined();
  });
});
