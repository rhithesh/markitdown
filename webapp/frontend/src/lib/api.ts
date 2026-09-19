export const API_BASE = "http://localhost:8000";

// Fired whenever a request comes back 401, so the auth context can drop back
// to the login screen without every call site having to check for it.
export const UNAUTHORIZED_EVENT = "auth:unauthorized";

/** fetch() wrapped to always send the httpOnly auth cookie and to broadcast
 * 401s so the app can react (e.g. bounce to the login screen). */
export async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return res;
}
