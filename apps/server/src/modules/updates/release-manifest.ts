import type { ReleaseManifest, ReleaseArtifact } from '@rag/shared';

export function parseReleaseManifest(input: string): ReleaseManifest {
  const parsed = JSON.parse(input) as ReleaseManifest;
  if (!parsed.version || !Array.isArray(parsed.artifacts) || !parsed.artifacts.length) {
    throw new Error('Invalid release manifest');
  }
  return parsed;
}

export function selectArtifact(
  manifest: ReleaseManifest,
  match: { targetType: 'server' | 'client'; platform: 'windows' | 'linux'; arch: string },
): ReleaseArtifact {
  const artifact = manifest.artifacts.find(
    (item) =>
      item.enabled &&
      item.targetType === match.targetType &&
      item.platform === match.platform &&
      item.arch === match.arch,
  );
  if (!artifact) throw new Error(`No matching artifact for ${match.targetType}/${match.platform}/${match.arch}`);
  return artifact;
}
