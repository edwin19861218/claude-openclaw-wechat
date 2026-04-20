import { z } from "zod";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";

import { bridgePlugin, setBridgeRuntime } from "./src/channel.js";
import { getLastWechatContact, markWechatPush, consumeWechatPush, consumeSessionHttpReply } from "./src/wechat-notify.js";

const BridgeConfigSchema = z.object({
  port: z.number().default(3847),
});

const WECHAT_ANNOTATION = "@wechat";

function isBridgeSession(sessionKey: string | undefined): boolean {
  return !!sessionKey && sessionKey.includes("openclaw-bridge:direct:");
}

function extractReplyText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as any;
    if (m.role !== "assistant") continue;
    const content = m.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const block of content) {
        if (block.type === "text" && block.text) texts.push(block.text);
      }
      if (texts.length > 0) return texts.join("\n");
    }
  }
  return "";
}

// Check if any user/system message in the conversation contains @wechat
function inputContainsAnnotation(messages: unknown[]): boolean {
  for (const m of messages as any[]) {
    if (m.role !== "user" && m.role !== "system") continue;
    const content = m.content;
    if (typeof content === "string" && content.includes(WECHAT_ANNOTATION)) return true;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === "string" && block.includes(WECHAT_ANNOTATION)) return true;
        if (block.text && block.text.includes(WECHAT_ANNOTATION)) return true;
      }
    }
  }
  return false;
}

export default {
  id: "openclaw-bridge",
  name: "Bridge",
  description: "Local HTTP bridge channel for external message routing",
  configSchema: buildChannelConfigSchema(BridgeConfigSchema),
  register(api: OpenClawPluginApi) {
    if (api.runtime) {
      setBridgeRuntime(api.runtime);
    }
    api.registerChannel({ plugin: bridgePlugin });

    // Detect @wechat from non-WeChat channels (WebUI, etc.)
    api.on("message_received", (event, ctx) => {
      if (ctx.channelId === "openclaw-bridge") return;
      const content = (event as any).content ?? "";
      if (!content.includes(WECHAT_ANNOTATION)) return;

      const contact = getLastWechatContact();
      if (!contact) {
        console.log(`[wechat-notify] @wechat from ${ctx.channelId} but no wechat contact tracked, skip`);
        return;
      }

      markWechatPush();
      console.log(`[wechat-notify] @wechat detected from ${ctx.channelId}, will push reply to ${contact.originalId}`);
    });

    // Push AI reply to WeChat if:
    // 1. @wechat was requested via message_received from non-bridge channels
    // 2. Bridge session (cron/systemEvent) AND input contains @wechat
    api.on("agent_end", (event, ctx) => {
      // Skip if reply already delivered via bridge HTTP (wechat → bridge → HTTP response)
      if (consumeSessionHttpReply(ctx.sessionKey ?? "")) return;

      const msgs = (event as any).messages;
      if (!(event as any).success || !Array.isArray(msgs)) return;

      // Check push triggers
      const contact = consumeWechatPush();
      if (contact) {
        // Triggered by @wechat from WebUI/other channel
      } else if (isBridgeSession(ctx.sessionKey)) {
        // Bridge session (cron/systemEvent) — only push if input contains @wechat
        if (!inputContainsAnnotation(msgs)) return;
        const c = getLastWechatContact();
        if (!c) return;
        console.log(`[wechat-notify] @wechat in cron/systemEvent input, will push`);
      } else {
        return;
      }

      const replyText = extractReplyText(msgs);
      if (!replyText) return;

      const pushContact = contact ?? getLastWechatContact();
      if (!pushContact) return;

      console.log(`[wechat-notify] forwarding to wechat userId=${pushContact.originalId} text="${replyText.slice(0, 100)}..."`);

      fetch("http://localhost:3848/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toUserId: pushContact.originalId,
          contextToken: pushContact.contextToken,
          text: replyText,
        }),
      }).then((res) => {
        console.log(`[wechat-notify] push response: ${res.status}`);
      }).catch((err) => {
        console.error(`[wechat-notify] push failed: ${err}`);
      });
    });
  },
};
