import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, UNAUTHORIZED_EVENT } from "./api";

type AuthStatus = "loading" | "anon" | "authed";

interface AuthState {
  status: AuthStatus;
  hasAccount: boolean;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function errorDetail(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.detail || "Something went wrong.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [hasAccount, setHasAccount] = useState(false);
  const [username, setUsername] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const statusRes = await apiFetch("/api/auth/status");
      const { has_account: hasAcct } = await statusRes.json();
      setHasAccount(hasAcct);
      if (!hasAcct) {
        setUsername(null);
        setStatus("anon");
        return;
      }
      const meRes = await apiFetch("/api/auth/me");
      if (meRes.ok) {
        const me = await meRes.json();
        setUsername(me.username);
        setStatus("authed");
      } else {
        setUsername(null);
        setStatus("anon");
      }
    } catch {
      // Backend unreachable -- treat as logged out rather than hanging forever.
      setStatus("anon");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => {
      setUsername(null);
      setStatus("anon");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refresh]);

  const submit = useCallback(
    async (path: string, user: string, password: string) => {
      const res = await apiFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password }),
      });
      if (!res.ok) {
        throw new Error(await errorDetail(res));
      }
      const data = await res.json();
      setUsername(data.username);
      setHasAccount(true);
      setStatus("authed");
    },
    []
  );

  const login = useCallback(
    (user: string, password: string) => submit("/api/auth/login", user, password),
    [submit]
  );
  const register = useCallback(
    (user: string, password: string) => submit("/api/auth/register", user, password),
    [submit]
  );

  const logout = useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setUsername(null);
    setStatus("anon");
  }, []);

  return (
    <AuthContext.Provider
      value={{ status, hasAccount, username, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
