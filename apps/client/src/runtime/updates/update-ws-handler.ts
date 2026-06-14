import type { ClientUpdatePhase } from './update-types.js';

type UpdateRunner = { run(input: unknown): Promise<{ phase: string; errorCode?: string; errorMessage?: string }> };

interface UpdateHandlerContext {
  message: { type: string; payload: unknown };
  updater?: UpdateRunner;
  createUpdater?: (onPhase: (phase: ClientUpdatePhase, extra?: Record<string, unknown>) => void | Promise<void>) => UpdateRunner;
  send: (msg: Record<string, unknown>) => void;
  currentVersion: string;
}

export async function handleUpdateWsMessage(ctx: UpdateHandlerContext): Promise<boolean> {
  if (ctx.message.type !== 'server.update.run') return false;

  const payload = ctx.message.payload as {
    campaignId: string;
    targetId: string;
    attemptId: string;
    version: string;
  };

  const sendStatus = async (phase: ClientUpdatePhase, extra: Record<string, unknown> = {}) => {
    ctx.send({
      type: 'client.update.status',
      requestId: `update_${payload.attemptId}`,
      payload: {
        campaignId: payload.campaignId,
        targetId: payload.targetId,
        attemptId: payload.attemptId,
        phase,
        currentVersion: ctx.currentVersion,
        targetVersion: payload.version,
        ...extra,
      },
    });
  };

  const updater = ctx.createUpdater?.(sendStatus) ?? ctx.updater;
  if (!updater) throw new Error('update runner unavailable');

  if (!ctx.createUpdater) await sendStatus('downloading');

  try {
    const result = await updater.run(payload);
    if (result.phase !== 'downloading') {
      await sendStatus(result.phase as ClientUpdatePhase, {
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
    }
  } catch (err) {
    await sendStatus('failed', {
      errorCode: 'INSTALL_FAILED',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }

  return true;
}
