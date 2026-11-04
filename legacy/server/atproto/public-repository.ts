import { createDidResolver } from '@atproto/oauth-client-node';
import { safeFetchWrap } from '@atproto-labs/fetch-node';
import { didSchema } from '../../shared/atproto.js';
import type { ReconciliationAgent } from './reconcile.js';

// Public repair does not restore sessions or require OAuth encryption/signing keys.
// DID methods and DID-document validation are supplied by the installed AT SDK;
// all DID/PDS HTTP requests additionally reject private networks and redirects.
const publicFetch = safeFetchWrap({ responseMaxSize: 14_000_000, timeout: 15_000 });
const fetch = (input: RequestInfo | URL, init?: RequestInit) =>
  publicFetch(input, { ...init, redirect: 'error' });
const resolver = createDidResolver({ fetch });

export async function publicRepositoryAgent(
  did: string,
  signal: AbortSignal,
): Promise<ReconciliationAgent> {
  didSchema.parse(did);
  const document = await resolver.resolve(did as `did:${string}:${string}`, {
    signal,
    noCache: true,
  });
  if (document.id !== did) throw new Error('DID document does not match requested repository');
  const service = document.service?.find(
    (entry) =>
      (entry.id === '#atproto_pds' || entry.id === `${did}#atproto_pds`) &&
      entry.type === 'AtprotoPersonalDataServer',
  );
  if (typeof service?.serviceEndpoint !== 'string') throw new Error('DID has no public PDS');
  const endpoint = new URL(service.serviceEndpoint);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error('Invalid public PDS origin');
  async function request(method: string, params: Record<string, string | number>) {
    const url = new URL(`/xrpc/${method}`, endpoint);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Public PDS request failed (${response.status})`);
    return { data: await response.json() };
  }
  return {
    com: {
      atproto: {
        sync: { getLatestCommit: (params) => request('com.atproto.sync.getLatestCommit', params) },
        repo: { listRecords: (params) => request('com.atproto.repo.listRecords', params) },
      },
    },
  };
}
