import { useState } from "react";
import { Leaf, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Mode = "sign-in" | "sign-up";

/** Login / register gate for the app (better-auth email + password). */
export function LoginScreen() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !email.trim() || password.length < 8) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "sign-up") {
        const { error: err } = await authClient.signUp.email({
          name: name.trim() || email.split("@")[0],
          email: email.trim(),
          password,
        });
        if (err) throw err;
      } else {
        const { error: err } = await authClient.signIn.email({
          email: email.trim(),
          password,
        });
        if (err) throw err;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative z-10 flex min-h-svh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card/95 p-6 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-2 text-primary">
          <Leaf className="size-5" />
          <span className="text-lg font-semibold">TagTeam</span>
        </div>
        <h1 className="mt-3 text-xl font-semibold">
          {mode === "sign-in" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Practice real Japanese phone calls with a live avatar coach.
        </p>

        <div className="mt-5 flex flex-col gap-3">
          {mode === "sign-up" && (
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              autoComplete="name"
            />
          )}
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
          />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (8+ characters)"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />

          {error && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button onClick={() => void submit()} disabled={busy || !email.trim() || password.length < 8} size="lg">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
        </div>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          {mode === "sign-in" ? (
            <>
              New here?{" "}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => {
                  setMode("sign-up");
                  setError(null);
                }}
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => {
                  setMode("sign-in");
                  setError(null);
                }}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
