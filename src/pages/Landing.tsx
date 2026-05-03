import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "../landing.css";

// Inline SVG icons matching the design exactly
const icons = {
  clock: (
    <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  ),
  dollar: (
    <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  monitor: (
    <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
};

const FEATURES = [
  { icon: icons.clock,   title: "Settle in Minutes",           body: "Once your SPIH transfer arrives, USDC lands in your wallet within minutes — not days. Real-time confirmation on every transaction." },
  { icon: icons.shield,  title: "KYB-First Compliance",        body: "Built for businesses. Full KYB verification, audit trails, and per-transaction limits up to $50,000. Every transfer documented, every dollar traceable." },
  { icon: icons.globe,   title: "Global Reach",                body: "Once on Stellar, your USDC connects to suppliers, marketplaces, and exchanges worldwide — without extra conversion steps or surprise fees." },
  { icon: icons.dollar,  title: "Locked-In Rates",             body: "Quote locks for 15 minutes — enough time to authorize your SPIH transfer. What you see is what you get. No spread surprises at settlement." },
  { icon: icons.monitor, title: "Bank-Grade Reconciliation",   body: "Download full audit trails as CSV or PDF. Categorized by date, counterparty, and amount. Built for your accountant and your regulator." },
  { icon: icons.lock,    title: "1:1 Verified Reserves",       body: "Every USDC in your Theo wallet is backed by a real dollar — segregated, independently verified, and redeemable on-demand. Transparency by default." },
];

const STATS = [
  { v: "$650M+", l: "Annual DR–Haiti Corridor" },
  { v: "< 2 min", l: "Settlement Time" },
  { v: "7–14%",   l: "Avg Fees We Eliminate" },
  { v: "$50K",    l: "Per-Transaction Limit" },
];

function fmt(n: number) {
  return n ? n.toLocaleString("en-US") : "";
}

function useScrollReveal(selector: string) {
  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>(selector);
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            const delay = Number(el.dataset.delay ?? 0);
            setTimeout(() => {
              el.style.opacity = "1";
              el.style.transform = "translateY(0)";
            }, delay);
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.08 }
    );
    elements.forEach((el, i) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(16px)";
      el.style.transition = "opacity 360ms cubic-bezier(0.16,1,0.3,1), transform 360ms cubic-bezier(0.16,1,0.3,1)";
      el.dataset.delay = String(i * 65);
      observer.observe(el);
    });
    return () => observer.disconnect();
  }, [selector]);
}

export default function Landing() {
  const [usdcRaw, setUsdcRaw] = useState(10000);
  const [usdcDisplay, setUsdcDisplay] = useState("10,000");
  const [rate, setRate] = useState(135.0);
  const [lockSecs, setLockSecs] = useState(15 * 60);

  // Live rate ticker
  useEffect(() => {
    const id = setInterval(() => {
      const jitter = (Math.random() - 0.5) * 0.1;
      setRate(parseFloat((135 + jitter).toFixed(2)));
    }, 4000);
    return () => clearInterval(id);
  }, []);

  // Countdown timer
  useEffect(() => {
    const id = setInterval(() => {
      setLockSecs((s) => {
        if (s <= 1) return 15 * 60;
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const htg = Math.round(usdcRaw * rate);
  const lockMin = Math.floor(lockSecs / 60);
  const lockSecPad = String(lockSecs % 60).padStart(2, "0");

  const handleUsdcInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d]/g, "");
    const num = parseInt(raw, 10) || 0;
    setUsdcRaw(num);
    setUsdcDisplay(num ? num.toLocaleString("en-US") : "");
  };

  // Scroll reveal hooks
  useScrollReveal(".lp-feature-card");
  useScrollReveal(".lp-step");
  useScrollReveal(".lp-trust-card-large, .lp-trust-card-small");
  useScrollReveal(".lp-stat-item");

  return (
    <div className="lp">
      {/* ── Nav ── */}
      <nav className="lp-nav">
        <Link to="/" className="lp-nav-wordmark">
          <div className="lp-nav-logo-tile">T</div>
          <span className="lp-nav-brand">Theo</span>
        </Link>
        <div className="lp-nav-links">
          <a href="#features" className="lp-nav-link">Features</a>
          <a href="#how-it-works" className="lp-nav-link">How It Works</a>
          <a href="#compliance" className="lp-nav-link">Compliance</a>
        </div>
        <div className="lp-nav-actions">
          <Link to="/login" className="lp-btn lp-btn-ghost-white">Sign In</Link>
          <Link to="/register" className="lp-btn lp-btn-gold">Open a Business Account</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-hero-left">
          <div className="lp-hero-eyebrow">Built for Haitian Businesses</div>
          <h1 className="lp-hero-headline">
            Effortless.<br /><em>Settlement.</em>
          </h1>
          <div className="lp-hero-tagline">Money that moves at business speed.</div>
          <p className="lp-hero-body">
            Convert Haitian Gourdes to USDC on Stellar with locked-in rates,
            transparent pricing, and bank-grade reconciliation.
            No crypto experience required.
          </p>
          <div className="lp-hero-actions">
            <Link to="/register" className="lp-btn lp-btn-gold lp-btn-lg">Open a Business Account</Link>
            <a href="#how-it-works" className="lp-btn lp-btn-ghost-white lp-btn-lg">See How It Works</a>
          </div>
          <div className="lp-hero-proof">
            <div className="lp-hero-proof-dot" />
            <span className="lp-hero-proof-text">Regulated · Stellar network · 1:1 verified reserves</span>
          </div>
        </div>

        {/* ── Live Quote Card ── */}
        <div className="lp-quote-card-wrap">
          <div className="lp-quote-card">
            <div className="lp-quote-live-badge">
              <div className="lp-quote-live-dot" />
              Live Quote
            </div>
            <div className="lp-quote-amounts">
              <div>
                <div className="lp-quote-amount-label">USDC Requested</div>
                <div className="lp-quote-input-wrap">
                  <span className="lp-quote-input-prefix">$</span>
                  <input
                    className="lp-quote-input"
                    type="text"
                    inputMode="numeric"
                    value={usdcDisplay}
                    onChange={handleUsdcInput}
                    onFocus={(e) => e.target.select()}
                    aria-label="USDC amount"
                  />
                </div>
                <div className="lp-quote-amount-currency">USDC · Stellar</div>
              </div>
              <div>
                <div className="lp-quote-amount-label">HTG Due</div>
                <div className="lp-quote-amount-value secondary">{fmt(htg)}</div>
                <div className="lp-quote-amount-currency">Haitian Gourdes</div>
              </div>
            </div>
            <hr className="lp-quote-divider" />
            <div className="lp-quote-meta">
              <div>
                <div className="lp-quote-meta-label">Rate</div>
                <div className="lp-quote-meta-value">{rate.toFixed(2)}</div>
              </div>
              <div>
                <div className="lp-quote-meta-label">Locked For</div>
                <div className="lp-quote-meta-value">{lockMin}:{lockSecPad}</div>
              </div>
              <div>
                <div className="lp-quote-meta-label">Network</div>
                <div className="lp-quote-meta-value">Stellar</div>
              </div>
            </div>
            <Link to="/register" className="lp-quote-cta">Get This Rate →</Link>
          </div>
        </div>
      </section>

      {/* ── Stats Strip ── */}
      <div className="lp-stats-strip">
        {STATS.map((s) => (
          <div key={s.l} className="lp-stat-item">
            <div className="lp-stat-value">{s.v}</div>
            <div className="lp-stat-label">{s.l}</div>
          </div>
        ))}
      </div>

      {/* ── Features ── */}
      <section className="lp-section lp-features" id="features">
        <div className="lp-section-eyebrow">Why Theo</div>
        <div className="lp-section-headline">Built different.<br />For this corridor.</div>
        <div className="lp-section-tagline">Sovereignty · Transparency · Dignity.</div>
        <div className="lp-section-underline" />
        <div className="lp-features-grid">
          {FEATURES.map(({ icon, title, body }) => (
            <div key={title} className="lp-feature-card">
              <div className="lp-feature-icon">{icon}</div>
              <div className="lp-feature-title">{title}</div>
              <div className="lp-feature-body">{body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="lp-section lp-how" id="how-it-works">
        <div className="lp-section-eyebrow">The Process</div>
        <div className="lp-section-headline">Three steps.<br />No surprises.</div>
        <div className="lp-section-tagline">Simple. Sound. Borderless.</div>
        <div className="lp-section-underline lp-section-underline--white" />
        <div className="lp-steps-grid">
          {[
            { n: "01", title: "Get a Locked Quote",       body: "Enter the USDC amount you need. Theo instantly shows your HTG cost at a locked rate — valid for 15 minutes. No account required for the quote." },
            { n: "02", title: "Send Your SPIH Transfer",  body: "Authorize a SPIH transfer from your Haitian bank. We monitor your payment in real time and confirm the moment it clears — no manual follow-up needed." },
            { n: "03", title: "USDC Lands Instantly",     body: "Within minutes of confirmation, USDC arrives in your Stellar wallet — ready to pay suppliers, convert to USD, or hold as a stable store of value." },
          ].map((s) => (
            <div key={s.n} className="lp-step">
              <div className="lp-step-number">{s.n}</div>
              <div className="lp-step-title">{s.title}</div>
              <div className="lp-step-body">{s.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Compliance / Trust ── */}
      <section className="lp-section lp-trust" id="compliance">
        <div className="lp-section-eyebrow">Compliance &amp; Trust</div>
        <div className="lp-section-headline">Built on trust.<br />Verified by design.</div>
        <div className="lp-section-tagline">Your money. Your keys. Your future.</div>
        <div className="lp-section-underline" />
        <div className="lp-trust-grid">
          <div className="lp-trust-card-large">
            <div>
              <div className="lp-card-eyebrow">Sovereignty · Transparency · Dignity</div>
              <div className="lp-card-headline">Your money.<br />Fully yours.</div>
              <div className="lp-card-body">
                Theo holds no fractional reserves. Every dollar in your wallet is matched 1:1 to real USD —
                segregated from Theo's operational funds and independently audited.
                We make money on the spread, not on your savings.
              </div>
            </div>
            <div className="lp-card-badges">
              {["KYB Verified", "Stellar Network", "Audit Trails", "1:1 Reserves"].map((b) => (
                <span key={b} className="lp-badge">{b}</span>
              ))}
            </div>
          </div>
          <div className="lp-trust-card-small">
            <div className="lp-card-eyebrow">Regulation</div>
            <div className="lp-card-title">DR-Compliant Operations</div>
            <div className="lp-card-body">Licensed and compliant with Dominican Republic financial regulations. Every transfer reported to BANCENTRAL in real time.</div>
          </div>
          <div className="lp-trust-card-small">
            <div className="lp-card-eyebrow">Infrastructure</div>
            <div className="lp-card-title">Powered by Stellar + MoneyGram</div>
            <div className="lp-card-body">Settlement runs on Stellar — the same network trusted by MoneyGram, Flutterwave, and global central banks for cross-border payments.</div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-cta">
        <div className="lp-cta-eyebrow">Get Started Today</div>
        <h2 className="lp-cta-headline">From charcoal<br />to digital gold.</h2>
        <div className="lp-cta-tagline">Theo builds cross-border financial infrastructure, one corridor at a time.</div>
        <div className="lp-cta-rule" />
        <div className="lp-cta-actions">
          <Link to="/register" className="lp-btn lp-btn-gold lp-btn-lg">Open a Business Account</Link>
          <a href="mailto:sales@theo.app" className="lp-btn lp-btn-ghost-white lp-btn-lg">Talk to Sales</a>
        </div>
        <div className="lp-cta-footnote">No crypto experience required · Full KYB in under 10 minutes</div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-logo">
          <div className="lp-footer-logo-tile">T</div>
          <span className="lp-footer-logo-name">Theo</span>
        </div>
        <div className="lp-footer-copy">
          © {new Date().getFullYear()} Theo. Banking the Unbanked of the Global South.
        </div>
        <div className="lp-footer-links">
          <a href="#" className="lp-footer-link">Privacy</a>
          <a href="#" className="lp-footer-link">Terms</a>
          <a href="#" className="lp-footer-link">Contact</a>
        </div>
      </footer>
    </div>
  );
}
