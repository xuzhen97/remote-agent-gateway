import { ReleaseManifestSchema, type ReleaseManifest, type ReleaseArtifact } from '@rag/shared';

export function parseReleaseManifest(input: string): ReleaseManifest {
  const parsed = ReleaseManifestSchema.safeParse(JSON.parse(input));
  if (!parsed.success) {
    throw new Error(`Invalid release manifest: ${parsed.error.message}`);
  }
  return parsed.data;
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
