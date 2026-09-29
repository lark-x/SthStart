// Version-pinned adapter for @deepseek-ai/dsh-sdk-jsonrpc-server 0.1.7-rc.2.
// Upstream's SDK server calls agents.create() for every new process, even when
// the same session is already persisted. Keep the wire protocol unchanged and
// resume that one specific collision through DSH's public AgentRegistry API.
import { HarnessSdkJsonRpcServer } from '@deepseek-ai/dsh-sdk-jsonrpc-server';
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol';

export const name = 'sthstart-story-sdk-server';
export const inject = ['agents', 'compaction'];

class ResumableStorySdkServer extends HarnessSdkJsonRpcServer {
  async handleRequest(method, params) {
    if (method !== 'session/compact') return super.handleRequest(method, params);
    const sessionId = params?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId.startsWith('session-')) throw new Error('invalid session id');
    if (!this.ctx.compaction) throw new Error('story compaction is not configured');
    const record = await this.getOrCreateSession(sessionId);
    const result = await this.ctx.compaction.compactNow(record.handle.agent, AbortSignal.timeout(120_000));
    return { compacted: result !== null, replacedItems: result?.shadowedSeqs.length ?? 0, estimatedSourceTokens: result?.shadowedTokenCount ?? 0 };
  }

  async createSession(sessionId) {
    const agentOptions = {
      provider: this.provider,
      model: this.model,
      ...(this.reasoningEffort === undefined ? {} : { reasoningEffort: this.reasoningEffort }),
      ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
    };
    let handle;
    try {
      handle = await this.ctx.agents.create({ sessionId, meta: { cwd: this.cwd }, agentOptions });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== `session "${sessionId}" already exists`) throw error;
      handle = await this.ctx.agents.resume({ resumeSessionId: sessionId, agentOptions });
    }
    const record = { handle };
    this.sessions.set(sessionId, record);
    return record;
  }
}

export function apply(ctx) {
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout);
  const server = new ResumableStorySdkServer(ctx, transport, { maxTokensAsSuccess: false });
  let exitTask;
  const disposeAndExit = () => {
    exitTask ??= (async () => {
      await Promise.allSettled([transport.flush()]);
      await Promise.allSettled([ctx.root.fiber.dispose()]);
      process.exit(0);
    })();
    return exitTask;
  };
  transport.onRequest(async (method, params) => {
    if (method === 'initialize') await ctx.get('loader')?.await();
    const result = await server.handleRequest(method, params);
    if (method === 'shutdown') setImmediate(() => { void disposeAndExit(); });
    return result;
  });
  ctx.effect(() => {
    transport.start();
    return async () => {
      await server.shutdown();
      transport.close();
    };
  }, 'story-jsonrpc.serve');
}
