import { z } from 'zod';

export const UpdateTargetTypeSchema = z.enum(['server', 'client']);
export const UpdatePlatformSchema = z.enum(['linux', 'windows']);
export const UpdateChannelSchema = z.enum(['stable', 'beta']);
export const UpdateInstallerTypeSchema = z.enum(['archive', 'binary']);

export const ClientUpdatePhaseSchema = z.enum([
  'queued',
  'dispatched',
  'downloading',
  'downloaded',
  'installing',
  'installed',
  'restarting',
  'verifying',
  'succeeded',
  'failed',
  'rolled_back',
  'offline_skipped',
  'cancelled',
]);

export const ReleaseArtifactSchema = z.object({
  targetType: UpdateTargetTypeSchema,
  platform: UpdatePlatformSchema,
  arch: z.string().min(1),
  fileName: z.string().min(1).refine((value) => !value.includes('/') && !value.includes('\\'), {
    message: 'fileName must be a plain file name',
  }),
  downloadPath: z.string().min(1),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  size: z.number().int().positive(),
  entrypoint: z.string().min(1),
  installerType: UpdateInstallerTypeSchema,
  mandatory: z.boolean().optional(),
  enabled: z.boolean(),
});

export const ReleaseManifestSchema = z.object({
  version: z.string().min(1),
  releaseTime: z.string().datetime(),
  notes: z.string(),
  minUpdaterVersion: z.string().min(1),
  channel: UpdateChannelSchema,
  compatibleFrom: z.array(z.string().min(1)),
  artifacts: z.array(ReleaseArtifactSchema).min(1),
});

export const ClientUpdateCommandPayloadSchema = z.object({
  campaignId: z.string().min(1),
  targetId: z.string().min(1),
  attemptId: z.string().min(1),
  version: z.string().min(1),
  artifact: ReleaseArtifactSchema.optional(),
  downloadUrl: z.string().url(),
  expectedSha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  expectedSize: z.number().int().positive(),
});

export const ClientUpdateStatusPayloadSchema = z.object({
  campaignId: z.string().min(1),
  targetId: z.string().min(1),
  attemptId: z.string().min(1),
  phase: ClientUpdatePhaseSchema,
  currentVersion: z.string().min(1),
  targetVersion: z.string().min(1),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
});

export type ReleaseArtifactInput = z.infer<typeof ReleaseArtifactSchema>;
export type ReleaseManifestInput = z.infer<typeof ReleaseManifestSchema>;
export type ClientUpdateCommandPayloadInput = z.infer<typeof ClientUpdateCommandPayloadSchema>;
export type ClientUpdateStatusPayloadInput = z.infer<typeof ClientUpdateStatusPayloadSchema>;
