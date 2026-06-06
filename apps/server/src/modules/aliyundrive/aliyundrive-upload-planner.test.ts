import { describe, expect, it } from 'vitest';
import { buildPartInfoList, resolvePartSize } from './aliyundrive-upload-planner.js';

describe('aliyundrive upload planner', () => {
  it('uses one part for small files', () => {
    expect(buildPartInfoList(1024, 64 * 1024 * 1024)).toEqual([{ part_number: 1 }]);
  });

  it('creates multiple part numbers for files larger than part size', () => {
    expect(buildPartInfoList(130 * 1024 * 1024, 64 * 1024 * 1024)).toHaveLength(3);
  });

  it('rejects too many parts', () => {
    expect(() => buildPartInfoList(10001 * 8 * 1024 * 1024, 8 * 1024 * 1024)).toThrow('exceeds Aliyun Drive part limit');
  });

  it('resolves last part size', () => {
    expect(resolvePartSize(130, 64, 3)).toBe(2);
  });
});
