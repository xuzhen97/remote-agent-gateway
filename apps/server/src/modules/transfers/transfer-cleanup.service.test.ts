import { describe, expect, it } from 'vitest';
import { computeCleanupAfter } from './transfer-cleanup.service.js';

describe('transfer cleanup', () => {
  it('computes cleanup time from completion and ttl', () => {
    expect(computeCleanupAfter(1000, 24 * 60 * 60 * 1000)).toBe(86_401_000);
  });
});
