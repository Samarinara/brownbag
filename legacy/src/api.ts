import { clearDeviceData } from './offline-storage';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let demoTransport: ((path: string, options: RequestInit) => Promise<unknown>) | undefined;
export function setDemoTransport(transport: typeof demoTransport) {
  demoTransport = transport;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (demoTransport) return (await demoTransport(path, options)) as T;
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, {
    cache: 'no-store',
    ...options,
    headers,
  });
  const data = await response.json().catch((error: unknown) => {
    if (response.ok) throw error;
    return undefined;
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      typeof data?.error === 'string' && data.error ? data.error : 'Request failed.',
    );
  if (path === '/auth/logout') {
    await clearDeviceData().catch(() => {
      /* Sign-out still succeeds if browser storage is blocked. */
    });
  }
  return data as T;
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });

let demoRecipeImage: ((uri: string, index: number) => string | undefined) | undefined;
let demoBlobImage: ((ref: string) => string | undefined) | undefined;
export function setDemoImages(recipe: typeof demoRecipeImage, blob: typeof demoBlobImage) {
  demoRecipeImage = recipe;
  demoBlobImage = blob;
}
export function recipeImageUrl(uri: string, index: number) {
  return demoRecipeImage
    ? demoRecipeImage(uri, index)
    : `/api/recipe-image?${new URLSearchParams({ uri, index: String(index) })}`;
}
export function blobImageUrl(ref: string) {
  return demoBlobImage ? demoBlobImage(ref) : `/api/images/${encodeURIComponent(ref)}`;
}
