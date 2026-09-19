import { SDK_NAME, SDK_VERSION } from "./version.js";

export class EntitleHubError extends Error {
  readonly status: number;
  /** SDK-level category: config | auth | http | network | no_fetch. */
  readonly code: string;
  /**
   * The API's own machine-readable code, when it sent one (e.g. "entitlement_exists",
   * "ambiguous_product", "rate_limited"). Branch on this, not on the message text.
   */
  readonly apiCode?: string;
  /** The full error body, for context the API attaches: `existing`, `candidates`, `unknown`, `grants`… */
  readonly body?: Record<string, unknown>;
  constructor(message: string, status: number, code = "error", body?: Record<string, unknown>) {
    super(message);
    this.name = "EntitleHubError";
    this.status = status;
    this.code = code;
    this.body = body;
    this.apiCode = typeof body?.code === "string" ? body.code : undefined;
  }
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface HttpOptions {
  baseUrl: string;
  apiKey: string;
  /** Network-error retries for idempotent reads (default 2). */
  retries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Identifies the calling SDK, e.g. "react-native/0.1.5". Reported to the dashboard. */
  client?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Small typed fetch wrapper: bearer auth, timeout, retry-on-network-error for GETs. */
export async function request<T>(
  opts: HttpOptions,
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<T> {
  const f = opts.fetchImpl ?? globalThis.fetch;
  if (!f) throw new EntitleHubError("No fetch implementation available. On Node <18, pass fetchImpl.", 0, "no_fetch");
  const url = `${opts.baseUrl.replace(/\/$/, "")}${path}`;
  const retries = method === "GET" ? opts.retries ?? 2 : 0;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : undefined;
    try {
      const res = await f(url, {
        method,
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "X-EntitleHub-Client": opts.client ?? `${SDK_NAME}/${SDK_VERSION}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      const data = text ? safeJson(text) : {};
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        const errBody = data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
        if (errBody && "error" in errBody) msg = String(errBody.error);
        throw new EntitleHubError(msg, res.status, res.status === 401 || res.status === 403 ? "auth" : "http", errBody);
      }
      return data as T;
    } catch (e) {
      lastErr = e;
      // Don't retry auth/HTTP errors: only transient network/abort failures.
      if (e instanceof EntitleHubError) throw e;
      if (attempt < retries) await sleep(250 * (attempt + 1));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw new EntitleHubError(`Network request failed: ${String((lastErr as Error)?.message ?? lastErr)}`, 0, "network");
}

function safeJson(t: string): unknown {
  try { return JSON.parse(t); } catch { return {}; }
}
