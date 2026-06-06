const MAX_PARTS = 10000;
export const DEFAULT_ALIYUN_PART_SIZE = 64 * 1024 * 1024;
export const MIN_ALIYUN_PART_SIZE = 8 * 1024 * 1024;

export function resolveAliyunPartSize(fileSize: number): number {
  const candidates = [DEFAULT_ALIYUN_PART_SIZE, 128 * 1024 * 1024, 256 * 1024 * 1024, 512 * 1024 * 1024];
  for (const size of candidates) {
    if (Math.ceil(fileSize / size) <= MAX_PARTS) return size;
  }
  throw new Error('File exceeds Aliyun Drive part limit');
}

export function buildPartInfoList(fileSize: number, partSize = resolveAliyunPartSize(fileSize)): Array<{ part_number: number }> {
  if (!Number.isInteger(fileSize) || fileSize < 0) throw new Error('fileSize must be a non-negative integer');
  if (!Number.isInteger(partSize) || partSize < MIN_ALIYUN_PART_SIZE) throw new Error('partSize is too small');
  const count = Math.max(1, Math.ceil(fileSize / partSize));
  if (count > MAX_PARTS) throw new Error('File exceeds Aliyun Drive part limit');
  return Array.from({ length: count }, (_, index) => ({ part_number: index + 1 }));
}

export function resolvePartSize(fileSize: number, partSize: number, partNumber: number): number {
  const offset = (partNumber - 1) * partSize;
  return Math.min(partSize, Math.max(0, fileSize - offset));
}
