import { useState, type FormEvent } from "react";
import { Leaf } from "lucide-react";
import type { AuthResult } from "@/state/connect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LoginProps = {
  auth: AuthResult;
  onSuccess: () => void;
};

export function Login({ auth, onSuccess }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await auth.login(email, password);
    onSuccess();
  };

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="rounded-full bg-primary p-4 text-primary-foreground">
          <Leaf className="size-8" />
        </div>
        <h1 className="text-3xl font-semibold text-primary">TagTeam</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Practice Japanese bureaucracy phone calls with a live co-pilot — understand every word,
          ask for help, and leave the call confident.
        </p>
      </div>

      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Perxona Connect email
          </label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </div>
        <Button type="submit" disabled={auth.busy} size="lg">
          {auth.busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
