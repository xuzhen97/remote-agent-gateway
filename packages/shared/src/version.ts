export const UNKNOWN_VERSION = '0.0.0';

export function readBuildVersion(version: string | undefined | null): string {
  const normalized = version?.trim();
  return normalized ? normalized : UNKNOWN_VERSION;
}
