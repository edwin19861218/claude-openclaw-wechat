import http from "node:http";
import type { BridgeMessage, BridgeResponse, HealthResponse } from "./types.js";
import { createLogger } from "./logger.js";

const logger = createLogger("bridge:http");

export type MessageHandler = (msg: BridgeMessage) => Promise<BridgeResponse>;

export interface HttpServerOptions {
  port: number;
  host?: string;
  onMessage: MessageHandler;
}

export function startHttpServer(opts: HttpServerOptions): Promise<http.Server> {
  const { port, host = "127.0.0.1", onMessage } = opts;

  const server = http.createServer(async (req, res) => {
    // CORS for local dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    // GET /health
    if (req.method === "GET" && url.pathname === "/health") {
      const body: HealthResponse = { ok: true, gateway: "running", version: "1.0.0" };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }

    // POST /message
    if (req.method === "POST" && url.pathname === "/message") {
      try {
        const raw = await readBody(req);
        const msg: BridgeMessage = JSON.parse(raw);

        if (!msg.from || !msg.text) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Missing required fields: from, text" }));
          return;
        }

        logger.info(`message from=${msg.from} text="${msg.text.slice(0, 60)}${msg.text.length > 60 ? "..." : ""}"`);
        const result = await onMessage(msg);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`error handling /message: ${message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: message }));
      }
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      logger.info(`listening on ${host}:${port}`);
      resolve(server);
    });
  });
}

export function stopHttpServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
