interface UpdateHandlerContext {
  message: { type: string; payload: unknown };
  updater: { run(input: unknown): Promise<{ phase: string; errorCode?: string; errorMessage?: string }> };
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

  ctx.send({
    type: 'client.update.status',
    requestId: `update_${payload.attemptId}`,
    payload: {
      campaignId: payload.campaignId,
      targetId: payload.targetId,
      attemptId: payload.attemptId,
      phase: 'downloading',
      currentVersion: ctx.currentVersion,
      targetVersion: payload.version,
    },
  });

  ctx.updater.run(payload).catch(() => {
    // Errors are handled inside the updater
  });

  return true;
}
