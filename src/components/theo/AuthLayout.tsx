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
      <div className="hidden lg:flex relative bg-primary text-primary-foreground flex-col justify-between overflow-hidden"
        style={{ padding: "40px 56px 48px" }}>
        {/* Decorative circles — sized and positioned per design */}
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{
            bottom: "-140px", left: "-100px",
            width: "480px", height: "480px",
            border: "1.5px solid rgba(253,207,0,0.10)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{
            bottom: "-80px", left: "-50px",
            width: "300px", height: "300px",
            border: "1.5px solid rgba(253,207,0,0.07)",
          }}
        />

        <Logo variant="light" />

        <div className="relative z-10">
          <div className="eyebrow eyebrow-on-dark">Business Banking</div>
          <h1 className="mt-5 font-extrabold leading-[1.05] text-primary-foreground tracking-tightest"
            style={{ fontSize: "clamp(40px, 3.5vw, 56px)", letterSpacing: "-0.03em" }}>
            Open your<br />
            <span className="text-secondary">business</span><br />
            account.
          </h1>
          <div className="mt-4 tagline" style={{ fontSize: "19px" }}>
            Banking the Unbanked of the Global South.
          </div>
          <hr className="gold-rule mt-3 mb-8" />
          <p className="text-primary-foreground/60 leading-relaxed max-w-sm mb-10" style={{ fontSize: "15px" }}>
            Convert Haitian Gourdes to USDC in minutes. Locked-in rates, full KYB compliance,
            and bank-grade reconciliation — built for the DR–Haiti corridor.
          </p>

          <div className="space-y-3">
            {features.map((f) => (
              <div key={f.title} className="flex items-center gap-3">
                <span
                  className="inline-flex h-8 w-8 items-center justify-center flex-shrink-0"
                  style={{
                    borderRadius: "8px",
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  <f.icon
                    className="h-4 w-4"
                    style={{ stroke: "hsl(var(--theo-gold))", fill: "none", strokeWidth: 1.8 }}
                  />
                </span>
                <span className="text-sm">
                  <span className="font-bold text-primary-foreground">{f.title}</span>
                  <span className="text-primary-foreground/60"> · {f.desc}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-primary-foreground/30" style={{ fontSize: "12px" }}>
          © 2026 Theo AI Finance Inc. · Regulated · DR-Licensed
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex items-center justify-center" style={{ background: "hsl(var(--theo-cream))", padding: "40px 48px" }}>
        <div className="w-full" style={{ maxWidth: "440px" }}>
          <div className="lg:hidden mb-8"><Logo /></div>

          <div className="bg-card border border-border shadow-md-soft" style={{ borderRadius: "20px", padding: "48px 44px" }}>
            {/* Tabs */}
            <div className="flex p-[3px] mb-7 gap-[2px]"
              style={{ background: "hsl(var(--theo-blue-soft))", borderRadius: "10px" }}>
              <Link
                to="/register"
                className={cn(
                  "flex-1 text-center text-sm font-bold py-2 transition-all",
                  isRegister
                    ? "bg-card text-primary shadow-xs"
                    : "text-muted-foreground hover:text-primary"
                )}
                style={{ borderRadius: "8px" }}
              >
                Create account
              </Link>
              <Link
                to="/login"
                className={cn(
                  "flex-1 text-center text-sm font-bold py-2 transition-all",
                  !isRegister
                    ? "bg-card text-primary shadow-xs"
                    : "text-muted-foreground hover:text-primary"
                )}
                style={{ borderRadius: "8px" }}
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
