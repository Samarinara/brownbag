import { createClient } from "@workos-inc/authkit-js";
const clientId = process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID;
export const configured = !!clientId;
let client: ReturnType<typeof createClient> | undefined;
function getClient() {
  if (!clientId)
    throw new Error("Polli sign-in is not configured in this build.");
  return (client ??= createClient(clientId, {
    redirectUri: process.env.EXPO_PUBLIC_REDIRECT_URI ?? window.location.origin,
    apiHostname: process.env.EXPO_PUBLIC_WORKOS_API_HOSTNAME || undefined,
    devMode: !process.env.EXPO_PUBLIC_WORKOS_API_HOSTNAME,
  }));
}
export async function getToken() {
  if (!configured) return;
  const sdk = await getClient();
  return (await sdk.getAccessToken()) ?? undefined;
}
export async function signIn() {
  const sdk = await getClient();
  await sdk.signIn();
}
export async function signOut() {
  const sdk = await getClient();
  await sdk.signOut();
}
