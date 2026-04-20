export interface HealthResult {
  ok: boolean;
  gateway: string;
}

const DEFAULT_BRIDGE_URL = 'http://localhost:3847';
const HEALTH_TIMEOUT_MS = 3000;

export async function bridgeHealthCheck(baseUrl?: string): Promise<HealthResult> {
  const url = `${baseUrl ?? DEFAULT_BRIDGE_URL}/health`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, gateway: 'error' };
    const body = await res.json() as { ok: boolean; gateway: string };
    return { ok: body.ok, gateway: body.gateway };
  } catch {
    return { ok: false, gateway: 'unreachable' };
  }
}
