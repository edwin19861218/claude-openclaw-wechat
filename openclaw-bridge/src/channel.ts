import type { ChannelPlugin, OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";
import type { OutboundReplyPayload } from "openclaw/plugin-sdk/reply-payload";

import { startHttpServer, stopHttpServer } from "./http-server.js";
import type { BridgeMessage, BridgeResponse, ResolvedBridgeAccount } from "./types.js";
import { createLogger } from "./logger.js";
import { setLastWechatContact, markSessionHttpReply } from "./wechat-notify.js";

const logger = createLogger("bridge:channel");

const DEFAULT_PORT = 3847;

let savedRuntime: PluginRuntime | null = null;

export function setBridgeRuntime(runtime: PluginRuntime): void {
  savedRuntime = runtime;
}

function resolvePort(cfg: OpenClawConfig): number {
  const val = (cfg as Record<string, unknown>)["channels.openclaw-bridge"];
  if (val && typeof val === "object" && "port" in val) {
    return (val as { port: number }).port;
  }
  return DEFAULT_PORT;
}

export const bridgePlugin: ChannelPlugin<ResolvedBridgeAccount> = {
  id: "openclaw-bridge",
  meta: {
    id: "openclaw-bridge",
    label: "openclaw-bridge",
    selectionLabel: "openclaw-bridge",
    docsPath: "/channels/openclaw-bridge",
    docsLabel: "openclaw-bridge",
    blurb: "Local HTTP bridge for external message routing",
    order: 80,
  },
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  capabilities: { chatTypes: ["direct"], media: true, blockStreaming: true },
  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 200, idleMs: 3000 },
  },
  messaging: {
    targetResolver: { looksLikeId: () => true },
  },
  agentPrompt: { messageToolHints: () => [] },
  reload: { configPrefixes: ["channels.openclaw-bridge"] },

  config: {
    listAccountIds: () => ["bridge-default"],
    resolveAccount: (_cfg: OpenClawConfig, _accountId?: string | null | undefined): ResolvedBridgeAccount => ({
      accountId: "bridge-default",
      name: "Bridge Default",
      enabled: true,
      configured: true,
      port: DEFAULT_PORT,
    }),
    isConfigured: () => true,
    describeAccount: (account: ResolvedBridgeAccount) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
    }),
  },

  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    sendText: async () => ({ channel: "openclaw-bridge", messageId: `msg-${Date.now()}` }),
    sendMedia: async () => ({ channel: "openclaw-bridge", messageId: `msg-${Date.now()}` }),
  },

  status: {
    defaultRuntime: { accountId: "", lastError: null, lastInboundAt: null, lastOutboundAt: null },
    collectStatusIssues: () => [],
    buildChannelSummary: () => ({
      configured: true,
      lastError: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    }),
    buildAccountSnapshot: ({ account }: { account: ResolvedBridgeAccount }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      if (!ctx) return;
      const { cfg, abortSignal } = ctx;
      const port = resolvePort(cfg);

      const runtime = savedRuntime;
      if (!runtime?.channel) {
        throw new Error("bridge: PluginRuntime not available — was register() called?");
      }
      const channelRuntime = runtime.channel;

      ctx.setStatus?.({ accountId: "bridge-default", running: true, lastStartAt: Date.now() });
      ctx.log?.info?.(`starting bridge HTTP server on port ${port}`);

      const server = await startHttpServer({
        port,
        onMessage: (msg: BridgeMessage) => handleMessage(msg, channelRuntime, cfg),
      });

      ctx.log?.info?.(`bridge HTTP server listening on 127.0.0.1:${port}`);

      if (abortSignal) {
        await new Promise<void>((resolve) => {
          abortSignal.addEventListener("abort", () => {
            logger.info("abort signal received, stopping HTTP server");
            stopHttpServer(server);
            resolve();
          }, { once: true });
        });
      }
    },
  },
};

async function handleMessage(
  msg: BridgeMessage,
  channelRuntime: PluginRuntime["channel"],
  cfg: OpenClawConfig,
): Promise<BridgeResponse> {
  const accountId = "bridge-default";

  try {
    const from = msg.from;

    // Track original userId for @wechat forwarding
    setLastWechatContact({
      canonicalId: from.toLowerCase(),
      originalId: from,
      contextToken: msg.contextToken,
    });

    const ctx: Record<string, unknown> = {
      Body: msg.text,
      From: from,
      To: from,
      AccountId: accountId,
      OriginatingChannel: "openclaw-bridge",
      OriginatingTo: from,
      MessageSid: `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      Provider: "openclaw-bridge",
      ChatType: "direct",
      Timestamp: msg.timestamp,
      CommandBody: msg.text,
      CommandAuthorized: true,
    };

    const route = channelRuntime.routing.resolveAgentRoute({
      cfg,
      channel: "openclaw-bridge",
      accountId,
      peer: { kind: "direct", id: from },
    });

    if (!route.agentId) {
      return { ok: false, error: "No agent configured for openclaw-bridge" };
    }

    ctx.SessionKey = route.sessionKey;

    // Mark that reply will go via HTTP — no push to WeChat needed
    if (route.sessionKey) markSessionHttpReply(route.sessionKey);

    const storePath = channelRuntime.session.resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    });

    await channelRuntime.session.recordInboundSession({
      storePath,
      sessionKey: route.sessionKey,
      ctx: ctx as Parameters<typeof channelRuntime.session.recordInboundSession>[0]["ctx"],
      updateLastRoute: {
        sessionKey: route.mainSessionKey,
        channel: "openclaw-bridge",
        to: from,
        accountId,
      },
      onRecordError: (err: unknown) => logger.error(`recordInboundSession: ${String(err)}`),
    });

    const finalized = channelRuntime.reply.finalizeInboundContext(
      ctx as Parameters<typeof channelRuntime.reply.finalizeInboundContext>[0],
    );

    // Collect response text via deliver callback
    const replyChunks: string[] = [];
    const mediaUrls: { url: string; type: string }[] = [];

    const deliver = async (payload: OutboundReplyPayload) => {
      if (payload.text) replyChunks.push(payload.text);
      const urls = payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
      for (const u of urls) mediaUrls.push({ url: u, type: "file" });
    };

    const { dispatcher } = channelRuntime.reply.createReplyDispatcherWithTyping({
      humanDelay: { minMs: 0, maxMs: 0 },
      typingCallbacks: { onReplyStart: async () => {} },
      deliver,
      onError: (err: unknown, info: { kind: string }) => {
        logger.error(`reply error (${info.kind}): ${String(err)}`);
      },
    });

    await channelRuntime.reply.withReplyDispatcher({
      dispatcher,
      run: () =>
        channelRuntime.reply.dispatchReplyFromConfig({
          ctx: finalized,
          cfg,
          dispatcher,
        }),
    });

    const replyText = replyChunks.join("\n");
    if (!replyText && mediaUrls.length === 0) {
      return { ok: true, reply: { text: "(empty response)" } };
    }

    const reply: BridgeResponse["reply"] = { text: replyText };
    if (mediaUrls.length > 0) reply.media = mediaUrls;
    return { ok: true, reply };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`handleMessage error: ${message}`);
    return { ok: false, error: message };
  }
}
