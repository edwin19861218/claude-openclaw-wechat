import { logger } from '../logger.js';

export interface BridgeMessage {
  from: string;
  text: string;
  media?: {
    type: 'image' | 'voice' | 'file';
    data: string;
    mimeType?: string;
    fileName?: string;
  };
  timestamp: number;
  contextToken?: string;
}

export interface BridgeResponse {
  ok: boolean;
  reply?: {
    text: string;
    media?: { url: string; type: string }[];
  };
  error?: string;
}

const DEFAULT_BRIDGE_URL = 'http://localhost:3847';
const DEFAULT_TIMEOUT_MS = 120_000;

export class BridgeClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, timeoutMs?: number) {
    this.baseUrl = baseUrl ?? DEFAULT_BRIDGE_URL;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(msg: BridgeMessage): Promise<BridgeResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      logger.info(`bridge: sending message from=${msg.from} text="${msg.text.slice(0, 60)}${msg.text.length > 60 ? '...' : ''}"`);
      const res = await fetch(`${this.baseUrl}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
        signal: controller.signal,
      });

      const body = await res.json() as BridgeResponse;
      logger.info(`bridge: response ok=${body.ok} hasReply=${Boolean(body.reply)}`);
      return body;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`bridge: send failed: ${message}`);
      return { ok: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
