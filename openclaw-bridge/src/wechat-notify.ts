export interface WechatContact {
  canonicalId: string;
  originalId: string;
  contextToken?: string;
}

let current: WechatContact | null = null;
let wechatPushRequested = false;

// Track which sessions already have their reply delivered via bridge HTTP
// (wechat → bridge → agent → HTTP response → wcc — no push needed)
const sessionsWithHttpReply = new Set<string>();

export function setLastWechatContact(contact: WechatContact): void {
  current = contact;
}

export function getLastWechatContact(): WechatContact | null {
  return current;
}

/** Mark that the next agent_end should be pushed to WeChat */
export function markWechatPush(): void {
  wechatPushRequested = true;
}

/** Consume the push mark (returns contact if marked, null otherwise) */
export function consumeWechatPush(): WechatContact | null {
  if (!wechatPushRequested || !current) return null;
  wechatPushRequested = false;
  return current;
}

/** Mark that this session's reply will be delivered via bridge HTTP (no push needed) */
export function markSessionHttpReply(sessionKey: string): void {
  sessionsWithHttpReply.add(sessionKey);
}

/** Check and consume the HTTP reply mark */
export function consumeSessionHttpReply(sessionKey: string): boolean {
  return sessionsWithHttpReply.delete(sessionKey);
}
