import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/theo/Logo";
import { ShieldCheck, Zap, Globe2 } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="container flex items-center justify-between py-6">
        <Logo />
        <nav className="flex items-center gap-3">
          <Button asChild variant="ghost">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild className="bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded-[10px]">
            <Link to="/register">Get started</Link>
          </Button>
        </nav>
      </header>

      {/* Hero — flat blue surface */}
      <section className="bg-primary text-primary-foreground">
        <div className="container py-20 md:py-28 grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6 animate-fade-in">
            <p className="eyebrow eyebrow-on-dark">Built for Haitian businesses</p>
            <h1 className="text-5xl md:text-6xl font-extrabold leading-[1.05] tracking-tightest text-balance">
              HTG to USDC.<br />
              <span className="text-secondary">Effortless.</span> Compliant.
            </h1>
            <hr className="gold-rule" />
            <p className="text-lg text-primary-foreground/85 max-w-lg">
              Convert Haitian Gourdes to USDC on Stellar with locked-in rates, transparent pricing,
              and bank-grade reconciliation. No crypto experience required.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                asChild
                size="lg"
                className="bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded-[10px] font-semibold"
              >
                <Link to="/register">Open a business account</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="bg-transparent text-primary-foreground border-primary-foreground/40 hover:bg-primary-foreground/10 hover:text-primary-foreground rounded-[10px]"
              >
                <Link to="/login">Sign in</Link>
              </Button>
            </div>
          </div>

          {/* Live quote card */}
          <div className="hidden md:block">
            <div className="bg-card text-card-foreground rounded-2xl p-8 shadow-md-soft">
              <p className="eyebrow">Live quote</p>
              <div className="mt-4 flex items-baseline justify-between">
                <div>
                  <div className="text-4xl font-extrabold tracking-tightest text-primary">$10,000</div>
                  <div className="text-sm text-muted-foreground mt-1">USDC requested</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold tracking-tightest text-foreground">1,350,000</div>
                  <div className="text-sm text-muted-foreground mt-1">HTG due</div>
                </div>
              </div>
              <hr className="my-6 border-border" />
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs">Rate</div>
                  <div className="font-semibold mt-1">135.00</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Locked for</div>
                  <div className="font-semibold mt-1">15 min</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Network</div>
                  <div className="font-semibold mt-1">Stellar</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container py-20 md:py-24">
        <div className="max-w-2xl mb-12">
          <p className="eyebrow">Why Theo</p>
          <p className="tagline text-2xl md:text-3xl mt-3">Money that moves at business speed.</p>
          <hr className="gold-rule mt-4" />
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: Zap, title: "Settle in minutes", body: "Once your SPIH transfer arrives, USDC lands in your wallet within minutes — not days." },
            { icon: ShieldCheck, title: "KYB-first", body: "Built for businesses. Full KYB, audit trails, and per-transaction limits up to $50,000." },
            { icon: Globe2, title: "Global reach", body: "Once on Stellar, your USDC connects to suppliers, marketplaces, and exchanges worldwide." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-card rounded-2xl p-7 border border-border shadow-sm-soft">
              <div
                className="h-11 w-11 bg-theo-blue-soft text-primary flex items-center justify-center mb-5"
                style={{ borderRadius: "22%" }}
              >
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="text-xl font-bold mb-2">{title}</h3>
              <p className="text-muted-foreground leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="container py-10 text-sm text-muted-foreground border-t border-border">
        © {new Date().getFullYear()} Theo · B2B HTG to USDC on-ramp · Stellar network
      </footer>
    </div>
  );
}
