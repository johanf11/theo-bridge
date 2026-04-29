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
          <Button asChild variant="ghost"><Link to="/login">Sign in</Link></Button>
          <Button asChild><Link to="/register">Get started</Link></Button>
        </nav>
      </header>

      <section className="bg-gradient-hero text-white">
        <div className="container py-20 md:py-28 grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6 animate-fade-in">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur px-3 py-1 text-xs font-medium border border-white/20">
              <span className="h-2 w-2 rounded-full bg-theo-gold animate-pulse-soft" />
              Built for Haitian businesses
            </span>
            <h1 className="font-display text-5xl md:text-6xl font-bold leading-[1.05] text-balance">
              HTG to USDC.<br/>
              <span className="text-theo-gold">Effortless.</span> Compliant.
            </h1>
            <p className="text-lg text-white/85 max-w-lg">
              Convert Haitian Gourdes to USDC on Stellar with locked-in rates, transparent pricing,
              and bank-grade reconciliation. No crypto experience required.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button asChild size="lg" className="bg-theo-gold hover:bg-theo-gold/90 text-theo-blue-deep font-semibold">
                <Link to="/register">Open a business account</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="bg-white/0 text-white border-white/40 hover:bg-white/10">
                <Link to="/login">Sign in</Link>
              </Button>
            </div>
          </div>
          <div className="hidden md:block">
            <div className="relative">
              <div className="absolute inset-0 bg-theo-cyan/20 blur-3xl rounded-full" />
              <div className="relative bg-white/95 text-foreground rounded-2xl p-8 shadow-elegant">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Live quote</div>
                <div className="mt-2 flex items-baseline justify-between">
                  <div>
                    <div className="font-display text-4xl font-bold text-theo-blue-deep">$10,000</div>
                    <div className="text-sm text-muted-foreground">USDC requested</div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-2xl font-semibold">1,350,000</div>
                    <div className="text-sm text-muted-foreground">HTG due</div>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-3 gap-4 text-sm">
                  <div><div className="text-muted-foreground">Rate</div><div className="font-semibold">135.00</div></div>
                  <div><div className="text-muted-foreground">Locked for</div><div className="font-semibold">15 min</div></div>
                  <div><div className="text-muted-foreground">Network</div><div className="font-semibold">Stellar</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container py-20 grid md:grid-cols-3 gap-8">
        {[
          { icon: Zap, title: "Settle in minutes", body: "Once your SPIH transfer arrives, USDC lands in your wallet within minutes — not days." },
          { icon: ShieldCheck, title: "KYB-first", body: "Built for businesses. Full KYB, audit trails, and per-transaction limits up to $50,000." },
          { icon: Globe2, title: "Global reach", body: "Once on Stellar, your USDC connects to suppliers, marketplaces, and exchanges worldwide." },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-gradient-card rounded-2xl p-6 shadow-card border">
            <div className="h-10 w-10 rounded-lg bg-theo-blue-soft text-theo-blue flex items-center justify-center mb-4">
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="font-display text-xl font-semibold mb-2">{title}</h3>
            <p className="text-muted-foreground">{body}</p>
          </div>
        ))}
      </section>

      <footer className="container py-10 text-sm text-muted-foreground border-t">
        © {new Date().getFullYear()} Theo · B2B HTG to USDC on-ramp · Stellar network
      </footer>
    </div>
  );
}
