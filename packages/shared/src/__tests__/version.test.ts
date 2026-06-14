import { describe, expect, it } from 'vitest';
import { UNKNOWN_VERSION, readBuildVersion } from '../version.js';

describe('readBuildVersion', () => {
  it('returns the injected version when provided', () => {
    expect(readBuildVersion('1.2.3')).toBe('1.2.3');
  });

  it('falls back to the unknown version for missing or blank values', () => {
    expect(readBuildVersion(undefined)).toBe(UNKNOWN_VERSION);
    expect(readBuildVersion('')).toBe(UNKNOWN_VERSION);
    expect(readBuildVersion('   ')).toBe(UNKNOWN_VERSION);
  });
});
