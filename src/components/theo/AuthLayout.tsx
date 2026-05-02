import { Link, useLocation } from "react-router-dom";
import { Logo } from "./Logo";
import { ShieldCheck, Clock, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

const features = [
  { icon: ShieldCheck, title: "KYB Verified", desc: "Full business identity check" },
  { icon: Clock, title: "Settle in < 2 min", desc: "Stellar network" },
  { icon: DollarSign, title: "1:1 Reserves", desc: "Fully segregated, audited" },
];

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const isRegister = pathname.startsWith("/register");

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Left brand panel */}
      <div className="hidden lg:flex relative bg-primary text-primary-foreground p-12 xl:p-16 flex-col justify-between overflow-hidden">
        {/* Decorative concentric arcs */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-40 h-[520px] w-[520px] rounded-full border border-primary-foreground/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-56 -left-56 h-[680px] w-[680px] rounded-full border border-primary-foreground/5"
        />

        <Logo variant="light" />

        <div className="relative z-10 max-w-lg">
          <div className="eyebrow eyebrow-on-dark">Business Banking</div>
          <h1 className="mt-6 text-5xl xl:text-6xl font-extrabold leading-[1.05] text-primary-foreground tracking-tightest">
            Open your<br />
            <span className="text-secondary">business</span><br />
            account.
          </h1>
          <div className="mt-6 tagline text-2xl">
            Banking the Unbanked of the Global South.
          </div>
          <hr className="gold-rule mt-4" />
          <p className="mt-8 text-primary-foreground/75 leading-relaxed max-w-md">
            Convert Haitian Gourdes to USDC in minutes. Locked-in rates, full KYB compliance,
            and bank-grade reconciliation — built for the DR–Haiti corridor.
          </p>
        </div>

        <div className="relative z-10 space-y-4">
          {features.map((f) => (
            <div key={f.title} className="flex items-center gap-3">
              <span
                className="inline-flex h-9 w-9 items-center justify-center bg-secondary text-secondary-foreground"
                style={{ borderRadius: "22%" }}
              >
                <f.icon className="h-4 w-4" />
              </span>
              <div className="text-sm">
                <span className="font-semibold text-primary-foreground">{f.title}</span>
                <span className="text-primary-foreground/60"> · {f.desc}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="relative z-10 text-xs text-primary-foreground/50 pt-8">
          © 2026 Theo AI Finance Inc. · Regulated · DR-Licensed
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8"><Logo /></div>

          <div className="bg-card rounded-2xl shadow-md-soft border border-border p-8 md:p-10">
            {/* Tabs */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-xl mb-8">
              <Link
                to="/register"
                className={cn(
                  "text-center text-sm font-semibold py-2.5 rounded-lg transition-colors",
                  isRegister ? "bg-card text-primary shadow-xs" : "text-muted-foreground hover:text-primary"
                )}
              >
                Create account
              </Link>
              <Link
                to="/login"
                className={cn(
                  "text-center text-sm font-semibold py-2.5 rounded-lg transition-colors",
                  !isRegister ? "bg-card text-primary shadow-xs" : "text-muted-foreground hover:text-primary"
                )}
              >
                Sign in
              </Link>
            </div>

            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
