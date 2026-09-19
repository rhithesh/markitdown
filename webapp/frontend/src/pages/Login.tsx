import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

export default function Login() {
  const { hasAccount, login, register } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!hasAccount && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (!hasAccount && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      if (hasAccount) {
        await login(username.trim(), password);
      } else {
        await register(username.trim(), password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-foreground">
      <Card className="w-full max-w-[380px] p-0 shadow-sm">
        <div className="h-1.5 w-full bg-primary" />
        <div className="p-6">
          <h1 className="text-lg font-semibold tracking-tight">
            {hasAccount ? "Log in" : "Create your account"}
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {hasAccount
              ? "This instance is protected by a single local account."
              : "This is a one-time setup — the first account created here becomes the only login for this instance."}
          </p>

          <form className="mt-6 flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                maxLength={100}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={hasAccount ? "current-password" : "new-password"}
                minLength={8}
                required
              />
            </div>

            {!hasAccount && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" disabled={submitting || !username.trim() || !password}>
              {submitting && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              )}
              {hasAccount ? "Log in" : "Create account"}
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
