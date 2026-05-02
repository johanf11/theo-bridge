import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Clock,
  ShieldCheck,
  Globe2,
  DollarSign,
  FileText,
  Lock,
} from "lucide-react";

const features = [
  {
    icon: Clock,
    title: "Settle in Minutes",
    body: "Once your SPIH transfer arrives, USDC lands in your wallet within minutes — not days. Real-time confirmation on every transaction.",
  },
  {
    icon: ShieldCheck,
    title: "KYB-First Compliance",
    body: "Built for businesses. Full KYB verification, audit trails, and per-transaction limits up to $50,000. Every transfer documented, every dollar traceable.",
  },
  {
    icon: Globe2,
    title: "Global Reach",
    body: "Once on Stellar, your USDC connects to suppliers, marketplaces, and exchanges worldwide — without extra conversion steps or surprise fees.",
  },
  {
    icon: DollarSign,
    title: "Locked-In Rates",
    body: "Quote locks for 15 minutes — enough time to authorize your SPIH transfer. What you see is what you get. No spread surprises at settlement.",
  },
  {
    icon: FileText,
    title: "Bank-Grade Reconciliation",
    body: "Download full audit trails as CSV or PDF. Categorized by date, counterparty, and amount. Built for your accountant and your regulator.",
  },
  {
    icon: Lock,
    title: "1:1 Verified Reserves",
    body: "Every USDC in your Theo wallet is backed by a real dollar — segregated, independently verified, and redeemable on-demand. Transparency by default.",
  },
];

const steps = [
  {
    n: "01",
    title: "Get a Locked Quote",
    body: "Enter the USDC amount you need. Theo instantly shows your HTG cost at a locked rate — valid for 15 minutes. No account required for the quote.",
  },
  {
    n: "02",
    title: "Send Your SPIH Transfer",
    body: "Authorize a SPIH transfer from your Haitian bank. We monitor your payment in real time and confirm the moment it clears — no manual follow-up needed.",
  },
  {
    n: "03",
    title: "USDC Lands Instantly",
    body: "Within minutes of confirmation, USDC arrives in your Stellar wallet — ready to pay suppliers, convert to USD, or hold as a stable store of value.",
  },
];

const stats = [
  { v: "$650M+", l: "Annual DR–Haiti Corridor" },
  { v: "< 2 min", l: "Settlement Time" },
  { v: "7–14%", l: "Avg Fees We Eliminate" },
  { v: "$50K", l: "Per-Transaction Limit" },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav — sticky, floats over the blue hero */}
      <nav className="bg-primary/80 text-primary-foreground sticky top-0 z-40 backdrop-blur-md border-b border-primary-foreground/10">
        <div className="container flex items-center justify-between h-20">
          <Link to="/" aria-label="Theo home" className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 items-center justify-center bg-secondary text-secondary-foreground font-extrabold"
              style={{ borderRadius: "22%" }}
            >
              T
            </span>
            <span className="font-extrabold text-xl tracking-tightest text-primary-foreground">
              Theo
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium text-primary-foreground/80 hover:text-primary-foreground transition-colors">
              Features
            </a>
            <a href="#how-it-works" className="text-sm font-medium text-primary-foreground/80 hover:text-primary-foreground transition-colors">
              How It Works
            </a>
            <a href="#compliance" className="text-sm font-medium text-primary-foreground/80 hover:text-primary-foreground transition-colors">
              Compliance
            </a>
          </div>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground rounded-[10px]"
            >
              <Link to="/login">Sign In</Link>
            </Button>
            <Button
              asChild
              className="bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded-[10px] font-semibold"
            >
              <Link to="/register">Open a Business Account</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="bg-primary text-primary-foreground">
        <div className="container pt-12 pb-24 md:pt-16 md:pb-32 grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6 animate-fade-in">
            <p className="eyebrow eyebrow-on-dark">Built for Haitian Businesses</p>
            <h1 className="text-5xl md:text-7xl font-extrabold leading-[1.02] tracking-tightest text-balance text-primary-foreground">
              Effortless.
              <br />
              <span className="font-display italic font-extrabold text-secondary">
                Settlement.
              </span>
            </h1>
            <p className="tagline text-xl md:text-2xl !text-secondary">
              Money that moves at business speed.
            </p>
            <hr className="gold-rule" />
            <p className="text-lg text-primary-foreground/80 max-w-lg leading-relaxed">
              Convert Haitian Gourdes to USDC on Stellar with locked-in rates,
              transparent pricing, and bank-grade reconciliation. No crypto
              experience required.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                asChild
                size="lg"
                className="bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded-[10px] font-semibold"
              >
                <Link to="/register">Open a Business Account</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="bg-transparent text-primary-foreground border-primary-foreground/40 hover:bg-primary-foreground/10 hover:text-primary-foreground rounded-[10px]"
              >
                <a href="#how-it-works">See How It Works</a>
              </Button>
            </div>
            <div className="flex items-center gap-3 pt-4 text-sm text-primary-foreground/70">
              <span className="h-2 w-2 rounded-full bg-accent animate-pulse-soft" />
              Regulated · Stellar network · 1:1 verified reserves
            </div>
          </div>

          {/* Live quote card */}
          <div className="md:justify-self-end w-full max-w-md">
            <div className="bg-card text-card-foreground rounded-2xl p-7 shadow-lg-soft">
              <div className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-accent animate-pulse-soft" />
                <span className="eyebrow">Live Quote</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-eyebrow font-semibold">
                    USDC Requested
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-2xl font-extrabold text-primary">$</span>
                    <span className="text-3xl font-extrabold tracking-tightest text-primary">
                      10,000
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">USDC · Stellar</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-eyebrow font-semibold">
                    HTG Due
                  </div>
                  <div className="mt-2 text-3xl font-extrabold tracking-tightest text-foreground">
                    1,350,000
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Haitian Gourdes</div>
                </div>
              </div>
              <hr className="my-5 border-border" />
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-eyebrow font-semibold">Rate</div>
                  <div className="font-bold mt-1 text-foreground">135.00</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-eyebrow font-semibold">Locked For</div>
                  <div className="font-bold mt-1 text-foreground">15 min</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-eyebrow font-semibold">Network</div>
                  <div className="font-bold mt-1 text-foreground">Stellar</div>
                </div>
              </div>
              <Button
                asChild
                className="w-full mt-6 bg-primary text-primary-foreground hover:bg-primary/90 rounded-[10px] font-semibold h-12"
              >
                <Link to="/register">Get This Rate →</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip — gold */}
      <div className="bg-secondary text-secondary-foreground">
        <div className="container py-8 grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((s) => (
            <div key={s.l} className="text-center md:text-left">
              <div className="text-2xl md:text-3xl font-extrabold tracking-tightest">
                {s.v}
              </div>
              <div className="text-xs md:text-sm font-semibold mt-1 opacity-80 uppercase tracking-eyebrow">
                {s.l}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Features */}
      <section id="features" className="container py-20 md:py-28">
        <div className="max-w-2xl mb-12">
          <p className="eyebrow">Why Theo</p>
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tightest mt-3">
            Built different.
            <br />
            For this corridor.
          </h2>
          <p className="tagline text-xl md:text-2xl mt-3">
            Sovereignty · Transparency · Dignity.
          </p>
          <hr className="gold-rule mt-4" />
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="bg-card rounded-2xl p-7 border border-border shadow-sm-soft transition-shadow hover:shadow-md-soft"
            >
              <div
                className="h-12 w-12 bg-theo-blue-soft text-primary flex items-center justify-center mb-5"
                style={{ borderRadius: "22%" }}
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <h3 className="text-xl font-bold mb-2">{title}</h3>
              <p className="text-muted-foreground leading-relaxed text-sm">
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works — blue surface */}
      <section id="how-it-works" className="bg-primary text-primary-foreground">
        <div className="container py-20 md:py-28">
          <div className="max-w-2xl mb-12">
            <p className="eyebrow eyebrow-on-dark">The Process</p>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tightest mt-3 text-primary-foreground">
              Three steps.
              <br />
              No surprises.
            </h2>
            <p className="tagline text-xl md:text-2xl mt-3 !text-secondary">
              Simple. Sound. Borderless.
            </p>
            <hr className="gold-rule mt-4" />
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {steps.map((s) => (
              <div
                key={s.n}
                className="bg-primary-foreground/5 border border-primary-foreground/10 rounded-2xl p-7"
              >
                <div className="font-display italic font-extrabold text-5xl text-secondary leading-none mb-4">
                  {s.n}
                </div>
                <h3 className="text-xl font-bold mb-2 text-primary-foreground">
                  {s.title}
                </h3>
                <p className="text-primary-foreground/70 leading-relaxed text-sm">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance / Trust */}
      <section id="compliance" className="container py-20 md:py-28">
        <div className="max-w-2xl mb-12">
          <p className="eyebrow">Compliance & Trust</p>
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tightest mt-3">
            Built on trust.
            <br />
            Verified by design.
          </h2>
          <p className="tagline text-xl md:text-2xl mt-3">
            Your money. Your keys. Your future.
          </p>
          <hr className="gold-rule mt-4" />
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="md:row-span-2 bg-card border border-border rounded-2xl p-8 shadow-sm-soft flex flex-col justify-between">
            <div>
              <p className="eyebrow">Sovereignty · Transparency · Dignity</p>
              <h3 className="text-3xl font-extrabold tracking-tightest mt-3">
                Your money.
                <br />
                Fully yours.
              </h3>
              <p className="text-muted-foreground leading-relaxed mt-4">
                Theo holds no fractional reserves. Every dollar in your wallet
                is matched 1:1 to real USD — segregated from Theo's operational
                funds and independently audited. We make money on the spread,
                not on your savings.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 mt-6">
              {["KYB Verified", "Stellar Network", "Audit Trails", "1:1 Reserves"].map(
                (b) => (
                  <span
                    key={b}
                    className="text-xs font-semibold uppercase tracking-eyebrow px-3 py-1.5 rounded-full bg-theo-blue-soft text-primary"
                  >
                    {b}
                  </span>
                ),
              )}
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-7 shadow-sm-soft">
            <p className="eyebrow">Regulation</p>
            <h3 className="text-xl font-bold mt-2 mb-3">
              DR-Compliant Operations
            </h3>
            <p className="text-muted-foreground leading-relaxed text-sm">
              Licensed and compliant with Dominican Republic financial
              regulations. Every transfer reported to BANCENTRAL in real time.
            </p>
          </div>
          <div className="bg-card border border-border rounded-2xl p-7 shadow-sm-soft">
            <p className="eyebrow">Infrastructure</p>
            <h3 className="text-xl font-bold mt-2 mb-3">
              Powered by Stellar + MoneyGram
            </h3>
            <p className="text-muted-foreground leading-relaxed text-sm">
              Settlement runs on Stellar — the same network trusted by
              MoneyGram, Flutterwave, and global central banks for cross-border
              payments.
            </p>
          </div>
        </div>
      </section>

      {/* CTA — blue */}
      <section className="bg-primary text-primary-foreground">
        <div className="container py-20 md:py-24 text-center">
          <p className="eyebrow eyebrow-on-dark">Get Started Today</p>
          <h2 className="text-4xl md:text-6xl font-extrabold tracking-tightest mt-3 text-primary-foreground">
            From charcoal
            <br />
            <span className="font-display italic text-secondary">to digital gold.</span>
          </h2>
          <p className="tagline text-lg md:text-xl mt-4 !text-secondary">
            Theo builds cross-border financial infrastructure, one corridor at a time.
          </p>
          <hr className="gold-rule mt-5 mx-auto" />
          <div className="flex flex-wrap gap-3 justify-center mt-10">
            <Button
              asChild
              size="lg"
              className="bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded-[10px] font-semibold"
            >
              <Link to="/register">Open a Business Account</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="bg-transparent text-primary-foreground border-primary-foreground/40 hover:bg-primary-foreground/10 hover:text-primary-foreground rounded-[10px]"
            >
              <a href="mailto:sales@theo.app">Talk to Sales</a>
            </Button>
          </div>
          <p className="text-sm text-primary-foreground/60 mt-6">
            No crypto experience required · Full KYB in under 10 minutes
          </p>
        </div>
      </section>

      {/* Footer — dark ink */}
      <footer className="bg-theo-ink text-white">
        <div className="container py-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-flex h-8 w-8 items-center justify-center bg-secondary text-secondary-foreground font-extrabold"
              style={{ borderRadius: "22%" }}
            >
              T
            </span>
            <span className="font-extrabold text-lg tracking-tightest">Theo</span>
          </div>
          <div className="text-sm text-white/60 text-center">
            © {new Date().getFullYear()} Theo. Banking the Unbanked of the Global South.
          </div>
          <div className="flex items-center gap-6 text-sm">
            <a href="#" className="text-white/70 hover:text-white transition-colors">Privacy</a>
            <a href="#" className="text-white/70 hover:text-white transition-colors">Terms</a>
            <a href="#" className="text-white/70 hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
