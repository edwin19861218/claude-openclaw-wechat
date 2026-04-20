/** Message sent from wechat-claude-code to the bridge. */
export interface BridgeMessage {
  from: string;
  text: string;
  media?: {
    type: "image" | "voice" | "file";
    data: string; // base64 or URL
    mimeType?: string;
    fileName?: string;
  };
  timestamp: number;
  contextToken?: string;
  metadata?: Record<string, string>;
}

/** Response returned from the bridge to wechat-claude-code. */
export interface BridgeResponse {
  ok: boolean;
  reply?: {
    text: string;
    media?: { url: string; type: string }[];
  };
  error?: string;
}

/** Health check response. */
export interface HealthResponse {
  ok: boolean;
  gateway: "running" | "stopped";
  version: string;
}

/** Resolved account for the bridge channel (simplified — no WeChat login needed). */
export interface ResolvedBridgeAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  port: number;
}
