import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { logger } from '../logger.js';
import { saveContact, loadContact } from './contact-store.js';

const MAX_MESSAGE_LENGTH = 2048;
const MAX_BODY_SIZE = 1 << 20; // 1 MB

function splitMessage(text: string, maxLen: number = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen * 0.3) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n+/, '');
  }
  return chunks;
}

export interface PushHandler {
  sendText(toUserId: string, contextToken: string, text: string): Promise<void>;
  getLastContextToken(): string;
}

export function startPushServer(
  handler: PushHandler,
  port: number = 3848,
): Promise<void> {
  // Load persisted contact as fallback
  const persisted = loadContact();
  if (persisted) {
    logger.info('push-server: loaded persisted contact', { originalId: persisted.originalId });
  }

  return new Promise((resolve) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Only allow requests from localhost
      const remoteAddr = req.socket.remoteAddress ?? '';
      if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Forbidden' }));
        return;
      }

      if (req.method !== 'POST' || req.url !== '/push') {
        res.writeHead(404);
        res.end('not found');
        return;
      }

      let body = '';
      let bodySize = 0;
      let bodyTooLarge = false;
      req.on('data', (chunk) => {
        if (bodyTooLarge) return;
        bodySize += chunk.length;
        if (bodySize > MAX_BODY_SIZE) {
          bodyTooLarge = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'request body too large' }));
          req.destroy();
          return;
        }
        body += chunk;
      });
      req.on('end', async () => {
        if (bodyTooLarge) return;
        try {
          const data = JSON.parse(body) as {
            toUserId?: string;
            contextToken?: string;
            text: string;
          };

          if (!data.text) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'missing text' }));
            return;
          }

          // Resolve userId: from request > persisted contact
          const toUserId = data.toUserId || persisted?.originalId;
          if (!toUserId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'no wechat contact available' }));
            return;
          }

          const contextToken = data.contextToken || handler.getLastContextToken() || persisted?.contextToken || '';

          // Save contact on each successful push
          saveContact(toUserId, contextToken);

          const chunks = splitMessage(data.text);
          for (const chunk of chunks) {
            await handler.sendText(toUserId, contextToken, chunk);
          }

          logger.info('push-server: forwarded to wechat', {
            toUserId,
            textLength: data.text.length,
            chunks: chunks.length,
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          logger.error('push-server: error', { error: err instanceof Error ? err.message : String(err) });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'internal error' }));
        }
      });
    });

    server.listen(port, '127.0.0.1', () => {
      logger.info(`push-server: listening on 127.0.0.1:${port}`);
      resolve();
    });
  });
}
