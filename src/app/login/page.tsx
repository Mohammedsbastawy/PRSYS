"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Icon } from "@/components/ui";

function MicrosoftLogo() {
  return (
    <svg height="20" viewBox="0 0 21 21" width="20" xmlns="http://www.w3.org/2000/svg">
      <rect fill="#f25022" height="9" width="9" x="1" y="1"></rect>
      <rect fill="#7fba00" height="9" width="9" x="11" y="1"></rect>
      <rect fill="#00a4ef" height="9" width="9" x="1" y="11"></rect>
      <rect fill="#ffb900" height="9" width="9" x="11" y="11"></rect>
    </svg>
  );
}

export default function LoginPage() {
  const { login, token, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ssoNote, setSsoNote] = useState(false);

  useEffect(() => {
    if (!loading && token) router.push("/");
  }, [loading, token, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Incorrect username or password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface p-4 md:p-8">
      <main className="flex w-full max-w-[440px] flex-col gap-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <Icon name="account_balance" filled className="text-5xl text-primary-dark" />
          <h1 className="text-4xl font-bold tracking-tight text-ink">PRSYS</h1>
          <p className="text-base text-ink-soft">Procurement Request System</p>
        </div>

        <div className="card flex flex-col gap-6 p-6 shadow-sm md:p-8">
          <button
            type="button"
            onClick={() => setSsoNote(true)}
            className="flex h-10 w-full items-center justify-center gap-2 rounded border border-surface-border bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface"
          >
            <MicrosoftLogo />
            <span>Sign in with Microsoft 365</span>
          </button>
          {ssoNote && (
            <div className="flex items-start gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              <Icon name="info" className="mt-0.5 text-[16px]" />
              <span>
                Microsoft 365 sign-in isn&apos;t configured for this workspace yet. Please use your
                local account below.
              </span>
            </div>
          )}

          <div className="relative flex items-center">
            <div className="flex-grow border-t border-surface-border"></div>
            <span className="mx-2 flex-shrink-0 text-[11px] font-medium text-ink-soft">
              or sign in with local account
            </span>
            <div className="flex-grow border-t border-surface-border"></div>
          </div>

          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-ink" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                className="input h-10"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-ink" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                className="input h-10"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {error && <span className="mt-1 text-xs font-medium text-danger">{error}</span>}
            </div>
            <button type="submit" disabled={busy} className="btn-primary mt-1 h-10 w-full">
              {busy ? "Signing in..." : "Login"}
            </button>
          </form>
        </div>

        <div className="text-center text-xs text-ink-soft">
          © {new Date().getFullYear()} PRSYS | Need help?{" "}
          <Link href="/help" className="text-primary-dark hover:underline">
            Contact IT Support
          </Link>
        </div>
      </main>
    </div>
  );
}
