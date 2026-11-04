import {
  AuthRequest,
  ResponseType,
  CodeChallengeMethod,
} from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
const clientId = process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID;
const endpoint = "https://api.workos.com/user_management";
const redirectUri = "brownbag://callback";
const key = "brownbag.workos.refresh";
let accessToken: string | undefined;
let expiresAt = 0;
let refreshing: Promise<string | undefined> | undefined;
WebBrowser.maybeCompleteAuthSession();
export const configured = !!clientId;
async function exchange(body: Record<string, string>) {
  const res = await fetch(`${endpoint}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, ...body }),
  });
  if (!res.ok) throw new Error("Polli sign-in failed. Try signing in again.");
  const data = await res.json();
  if (
    typeof data.access_token !== "string" ||
    typeof data.refresh_token !== "string"
  )
    throw new Error("Polli returned an incomplete session.");
  // Persist the rotated refresh credential before using the new access token.
  await SecureStore.setItemAsync(key, data.refresh_token);
  accessToken = data.access_token;
  expiresAt = Date.now() + Number(data.expires_in ?? 300) * 1000 - 30000;
  return accessToken;
}
export async function getToken() {
  if (accessToken && Date.now() < expiresAt) return accessToken;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refresh = await SecureStore.getItemAsync(key);
    if (!refresh) return;
    return exchange({ grant_type: "refresh_token", refresh_token: refresh });
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = undefined;
  }
}
export async function signIn() {
  if (!clientId)
    throw new Error("Polli sign-in is not configured in this build.");
  const request = new AuthRequest({
    clientId,
    redirectUri,
    responseType: ResponseType.Code,
    usePKCE: true,
    codeChallengeMethod: CodeChallengeMethod.S256,
    extraParams: { provider: "authkit" },
  });
  await request.makeAuthUrlAsync({
    authorizationEndpoint: `${endpoint}/authorize`,
  });
  const result = await request.promptAsync({
    authorizationEndpoint: `${endpoint}/authorize`,
  });
  if (result.type !== "success") throw new Error("Sign-in cancelled.");
  if (!request.codeVerifier || !result.params.code)
    throw new Error("Sign-in did not return a code.");
  // AuthRequest checks the returned state before reporting success.
  await exchange({
    grant_type: "authorization_code",
    code: result.params.code,
    code_verifier: request.codeVerifier,
    redirect_uri: redirectUri,
  });
}
export async function signOut() {
  const old = accessToken;
  await SecureStore.deleteItemAsync(key);
  accessToken = undefined;
  expiresAt = 0;
  if (old) {
    try {
      const payload = JSON.parse(
        atob(old.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (payload.sid)
        await WebBrowser.openBrowserAsync(
          `${endpoint}/sessions/logout?session_id=${encodeURIComponent(payload.sid)}`,
        );
    } catch {
      /* Local credentials are already removed. */
    }
  }
}
