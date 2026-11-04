import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@polli/platform-contracts';
export type { AppRouter };
export function createPlatformClient(url: string, getAccessToken: () => Promise<string | undefined>, options: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {}) {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({
    url: `${url.replace(/\/$/, '')}/trpc`,
    headers: async () => { const token = await getAccessToken(); return token ? { Authorization: `Bearer ${token}` } : {}; },
    fetch: async (input, init) => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      init?.signal?.addEventListener('abort', cancel, { once: true });
      if (init?.signal?.aborted) controller.abort();
      const timer = setTimeout(cancel, options.timeoutMs ?? 30_000);
      try { return await (options.fetch ?? globalThis.fetch)(input, { ...init, signal: controller.signal }); }
      finally { clearTimeout(timer); init?.signal?.removeEventListener('abort', cancel); }
    },
  })] });
}

