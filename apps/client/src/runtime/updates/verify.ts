import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { createReadStream } from 'node:fs';

export async function calculateSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

export async function verifyArtifact(filePath: string, expectedSha256: string, expectedSize: number): Promise<void> {
  const actualSize = statSync(filePath).size;
  if (actualSize !== expectedSize) {
    throw new Error(`size mismatch: expected ${expectedSize}, got ${actualSize}`);
  }

  const actualSha256 = await calculateSha256(filePath);
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`sha256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }
}
