"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Icon } from "@/components/ui";

function MicrosoftLogo() {
  return (
    <svg height="18" viewBox="0 0 21 21" width="18" xmlns="http://www.w3.org/2000/svg">
      <rect fill="#f25022" height="9" width="9" x="1" y="1"></rect>
      <rect fill="#7fba00" height="9" width="9" x="11" y="1"></rect>
      <rect fill="#00a4ef" height="9" width="9" x="1" y="11"></rect>
      <rect fill="#ffb900" height="9" width="9" x="11" y="11"></rect>
    </svg>
  );
}

const FEATURES = [
  {
    icon: "alt_route",
    title: "Multi-Tier SLA Routing",
    text: "Configurable approval matrices with dynamic due timers.",
  },
  {
    icon: "inventory_2",
    title: "Item Catalog & BoQ",
    text: "Line items with catalog pricing, quantities and totals.",
  },
  {
    icon: "verified_user",
    title: "Role-Based Governance",
    text: "Granular permissions for agents, managers and admins.",
  },
];

export default function LoginPage() {
  const { login, token, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ssoNote, setSsoNote] = useState(false);
  const [showPw, setShowPw] = useState(false);

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
    <div className="min-h-screen bg-surface-container-low px-4 py-6 md:px-space-lg md:py-space-lg">
      <div className="grid min-h-[calc(100vh-3rem)] w-full max-w-7xl grid-cols-1 items-stretch gap-space-lg mx-auto lg:grid-cols-12">
        {/* ---------- Left hero & value prop ---------- */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-2xl bg-inverse-surface p-space-lg text-inverse-on-surface shadow-tier3 md:p-space-xl lg:col-span-7">
          {/* ambient glows */}
          <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -right-20 h-[420px] w-[420px] rounded-full bg-secondary-container/15 blur-3xl" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] [background-size:24px_24px]" />

          <div className="relative z-10 flex flex-col gap-space-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-on-primary shadow-md">
                  <Icon name="token" className="text-[24px]" />
                </div>
                <div className="flex flex-col">
                  <span className="font-headline-md text-headline-md font-bold tracking-tight text-surface-container-lowest">
                    PRSYS
                  </span>
                  <span className="font-label-sm text-label-sm uppercase tracking-widest text-primary-fixed">
                    Procurement Core
                  </span>
                </div>
              </div>
              <span className="rounded-full border-0 bg-surface-container-highest/20 px-3 py-1 font-label-sm text-label-sm font-semibold tracking-wide text-primary-fixed shadow-sm">
                PRSYS Enterprise
              </span>
            </div>

            <div className="max-w-xl pt-space-lg">
              <span className="mb-space-xs inline-block font-label-md text-label-md uppercase tracking-wider text-secondary-fixed">
                Governance &amp; Operations
              </span>
              <h1 className="font-headline-xl text-headline-xl font-bold leading-tight text-surface-container-lowest">
                Next-Generation Enterprise Procurement &amp; Workflow Automation
              </h1>
              <p className="mt-space-sm font-body-lg text-body-lg leading-relaxed text-surface-variant/80">
                Streamline multi-tier requisition lifecycles, configurable approval workflows and strict governance
                across your facilities.
              </p>
            </div>
          </div>

          {/* feature mosaic */}
          <div className="relative z-10 my-space-lg grid grid-cols-1 gap-space-sm md:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex flex-col justify-between rounded-lg bg-surface-container-high/10 p-space-md shadow-sm backdrop-blur-md">
                <div className="mb-space-sm flex h-8 w-8 items-center justify-center rounded-lg bg-primary-container/40 text-primary-fixed">
                  <Icon name={f.icon} className="text-[20px]" />
                </div>
                <div>
                  <h4 className="font-headline-sm text-body-md font-semibold text-surface-container-lowest">{f.title}</h4>
                  <p className="mt-1 font-body-sm text-body-sm text-surface-variant/70">{f.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="relative z-10 flex flex-wrap items-center justify-between gap-space-sm pt-space-md">
            <div className="flex items-center gap-space-sm font-label-sm text-label-sm text-surface-variant/70">
              <Icon name="shield_with_heart" className="text-[16px] text-tertiary-fixed" />
              <span>SOC 2 Aligned · ISO 27001 Ready · JWT + RBAC</span>
            </div>
            <div className="flex items-center gap-2 font-label-sm text-label-sm text-primary-fixed">
              <Icon name="dns" className="text-[16px]" />
              <span>Zone: EG-North-01</span>
            </div>
          </div>
        </div>

        {/* ---------- Right auth portal ---------- */}
        <div className="relative flex flex-col justify-between rounded-2xl bg-surface-container-lowest p-space-lg shadow-md md:p-space-xl lg:col-span-5">
          <div>
            <div className="mb-space-md flex items-center justify-between pb-space-md">
              <div className="flex items-center gap-2 rounded-full bg-surface-container px-2.5 py-1 font-label-sm text-label-sm text-on-surface-variant">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tertiary opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-tertiary" />
                </span>
                <span className="font-medium">All Systems Operational</span>
              </div>
              <div className="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant">
                <Icon name="language" className="text-[16px]" />
                <span>English (US)</span>
                <Icon name="expand_more" className="text-[14px]" />
              </div>
            </div>

            <div className="mb-space-lg flex flex-col gap-1">
              <h2 className="font-headline-lg text-headline-lg font-bold tracking-tight text-on-surface">
                Sign in to PRSYS
              </h2>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Enter your enterprise credentials to access your procurement workspace.
              </p>
            </div>

            <form className="flex flex-col gap-space-md" onSubmit={submit}>
              <button
                type="button"
                onClick={() => setSsoNote(true)}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-surface-variant bg-surface-container-lowest font-body-md text-body-md font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
              >
                <MicrosoftLogo />
                <span>Sign in with Microsoft 365</span>
              </button>
              {ssoNote && (
                <div className="flex items-start gap-2 rounded-lg bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
                  <Icon name="info" className="mt-0.5 text-[16px]" />
                  <span>
                    Microsoft 365 sign-in isn&apos;t configured for this workspace yet. Please use your local account
                    below.
                  </span>
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="h-px flex-grow bg-surface-variant" />
                <span className="font-label-sm text-label-sm text-outline">OR LOCAL ACCOUNT</span>
                <div className="h-px flex-grow bg-surface-variant" />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-label-md text-label-md font-semibold uppercase tracking-wider text-on-surface" htmlFor="email">
                  Corporate Email
                </label>
                <div className="relative flex items-center">
                  <Icon name="mail" className="pointer-events-none absolute left-3.5 text-[20px] text-outline" />
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="username"
                    className="h-11 w-full rounded-lg bg-surface-container-lowest pl-11 pr-4 font-body-md text-body-md text-on-surface shadow-sm outline-none transition-colors placeholder:text-outline focus:bg-surface-container-low"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-label-md text-label-md font-semibold uppercase tracking-wider text-on-surface" htmlFor="password">
                  Password
                </label>
                <div className="relative flex items-center">
                  <Icon name="lock" className="pointer-events-none absolute left-3.5 text-[20px] text-outline" />
                  <input
                    id="password"
                    type={showPw ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    className="h-11 w-full rounded-lg bg-surface-container-lowest pl-11 pr-12 font-body-md text-body-md text-on-surface shadow-sm outline-none transition-colors placeholder:text-outline focus:bg-surface-container-low"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3.5 text-outline transition-colors hover:text-on-surface"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    <Icon name={showPw ? "visibility_off" : "visibility"} className="text-[20px]" />
                  </button>
                </div>
                {error && (
                  <span className="mt-1 flex items-center gap-1 font-body-sm text-body-sm text-error">
                    <Icon name="error" className="text-[14px]" />
                    {error}
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={busy}
                className="mt-space-xs flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary font-headline-sm text-body-md font-semibold text-on-primary shadow-cta transition-all hover:bg-primary-light disabled:opacity-60"
              >
                {busy ? (
                  <Icon name="progress_activity" className="animate-spin text-[18px]" />
                ) : (
                  <Icon name="login" className="text-[18px]" />
                )}
                {busy ? "Signing in..." : "Sign in"}
              </button>
            </form>
          </div>

          <div className="mt-space-lg border-t border-surface-variant pt-space-md text-center font-body-sm text-body-sm text-on-surface-variant">
            © {new Date().getFullYear()} PRSYS · Need help?{" "}
            <Link href="/help" className="font-semibold text-primary hover:underline">
              Contact IT Support
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
