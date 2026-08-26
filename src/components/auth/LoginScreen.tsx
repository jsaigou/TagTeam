import { useState } from "react";
import { Leaf, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LeafBackdrop } from "@/components/brand/LeafBackdrop";

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
    <div className="relative z-10 flex min-h-svh flex-col items-center justify-center overflow-hidden px-4">
      <LeafBackdrop />
      <div className="flex w-full max-w-4xl flex-col items-center gap-10 xl:flex-row xl:items-center xl:justify-between xl:gap-16">
        {/* Brand panel — desktop only, gives the form room to breathe instead
            of floating alone in a flat viewport. */}
        <div className="hidden max-w-sm flex-col gap-4 xl:flex">
          <div className="flex items-center gap-2 text-primary">
            <Leaf className="size-7" />
            <span className="wordmark text-2xl">
              Tag<span className="accent">Team</span>
            </span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-primary">
            Sound confident before you dial.
          </h1>
          <p className="text-base leading-relaxed text-muted-foreground">
            Practice real Japanese phone calls with a live avatar coach. The
            greeting, the ask, the awkward part, before the real one.
          </p>
        </div>

        <div className="w-full max-w-sm rounded-2xl border bg-card/95 p-6 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-2 text-primary xl:hidden">
            <Leaf className="size-5" />
            <span className="text-lg font-semibold">TagTeam</span>
          </div>
          <h1 className="mt-3 text-xl font-semibold xl:mt-0">
            {mode === "sign-in" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground xl:hidden">
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
    </div>
  );
}
