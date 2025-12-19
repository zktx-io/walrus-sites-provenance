import { getFullnodeUrl, SuiClient, SuiHTTPTransport } from '@mysten/sui/client';

import type { SiteConfig } from '../types';

const withTimeoutFetch =
  (timeoutMs: number) =>
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const signal = init?.signal;
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
    }
  };

export const createSuiClient = (config: SiteConfig): SuiClient => {
  const url =
    config.sui_rpc_url?.trim() || process.env.SUI_RPC_URL?.trim() || getFullnodeUrl(config.network);
  const timeoutMs =
    config.sui_rpc_timeout_ms ??
    (process.env.SUI_RPC_TIMEOUT_MS ? Number(process.env.SUI_RPC_TIMEOUT_MS) : undefined);

  if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return new SuiClient({
      transport: new SuiHTTPTransport({
        url,
        fetch: withTimeoutFetch(timeoutMs),
      }),
    });
  }

  return new SuiClient({ url });
};
