import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { LanguageToggle } from "@/components/theo/LanguageToggle";
import { useT } from "@/lib/i18n";
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
  const t = useT();
  const [usdcRaw, setUsdcRaw] = useState(10000);
  const [usdcDisplay, setUsdcDisplay] = useState("10,000");
  const [rate, setRate] = useState(135.0);
  const [lockSecs, setLockSecs] = useState(15 * 60);

  // Fetch live BRH reference rate
  useEffect(() => {
    supabase
      .from("rate_snapshots")
      .select("spot_rate")
      .eq("source", "brh")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.spot_rate) setRate(Number(data.spot_rate));
      });
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

  const FEATURES = [
    { icon: icons.clock,   title: t("landing.feat.settle.title"), body: t("landing.feat.settle.body") },
    { icon: icons.shield,  title: t("landing.feat.kyb.title"),    body: t("landing.feat.kyb.body") },
    { icon: icons.globe,   title: t("landing.feat.global.title"), body: t("landing.feat.global.body") },
    { icon: icons.dollar,  title: t("landing.feat.rates.title"),  body: t("landing.feat.rates.body") },
    { icon: icons.monitor, title: t("landing.feat.recon.title"),  body: t("landing.feat.recon.body") },
    { icon: icons.lock,    title: t("landing.feat.reserve.title"),body: t("landing.feat.reserve.body") },
  ];

  const STATS = [
    { v: "$4B+",    l: t("landing.stats.corridor") },
    { v: "< 5 min", l: t("landing.stats.settlement") },
    { v: "3–5%",    l: t("landing.stats.fees") },
    { v: "$50K",    l: t("landing.stats.limit") },
  ];

  return (
    <div className="lp">
      {/* ── Nav ── */}
      <nav className="lp-nav">
        <a href="https://theokingdom.com" className="lp-nav-wordmark">
          <div className="lp-nav-logo-tile">T</div>
          <span className="lp-nav-brand">Theo</span>
        </a>
        <div className="lp-nav-links">
          <a href="#features" className="lp-nav-link">{t("landing.nav.features")}</a>
          <a href="#how-it-works" className="lp-nav-link">{t("landing.nav.howItWorks")}</a>
          <a href="#compliance" className="lp-nav-link">{t("landing.nav.compliance")}</a>
          <LanguageToggle />
        </div>
        <div className="lp-nav-actions">
          <Link to="/login" className="lp-btn lp-btn-ghost-white">{t("landing.nav.signIn")}</Link>
          <Link to="/register" className="lp-btn lp-btn-gold">{t("landing.nav.openAccount")}</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-hero-left">
          <div className="lp-hero-devbadge">
            <span className="lp-hero-devbadge-dot" />
            {t("landing.hero.devBadge")}
          </div>
          <div className="lp-hero-eyebrow">{t("landing.hero.eyebrow")}</div>
          <h1 className="lp-hero-headline">
            {t("landing.hero.headline1")}<br /><em>{t("landing.hero.headline2")}</em>
          </h1>
          <div className="lp-hero-tagline">{t("landing.hero.tagline")}</div>
          <p className="lp-hero-body">{t("landing.hero.body")}</p>
          <div className="lp-hero-actions">
            <Link to="/register" className="lp-btn lp-btn-gold lp-btn-lg">{t("landing.hero.cta.open")}</Link>
            <a href="#how-it-works" className="lp-btn lp-btn-ghost-white lp-btn-lg">{t("landing.hero.cta.how")}</a>
          </div>
          <div className="lp-hero-proof">
            <div className="lp-hero-proof-dot" />
            <span className="lp-hero-proof-text">{t("landing.hero.proof")}</span>
          </div>
        </div>

        {/* ── Live Quote Card ── */}
        <div className="lp-quote-card-wrap">
          <div className="lp-quote-card">
            <div className="lp-quote-live-badge">
              <div className="lp-quote-live-dot" />
              {t("landing.quote.live")}
            </div>
            <div className="lp-quote-amounts">
              <div>
                <div className="lp-quote-amount-label">{t("landing.quote.usdc")}</div>
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
                <div className="lp-quote-amount-label">{t("landing.quote.htg")}</div>
                <div className="lp-quote-amount-value secondary">{fmt(htg)}</div>
                <div className="lp-quote-amount-currency">{t("landing.quote.gourdes")}</div>
              </div>
            </div>
            <hr className="lp-quote-divider" />
            <div className="lp-quote-meta">
              <div>
                <div className="lp-quote-meta-label">{t("landing.quote.rate")}</div>
                <div className="lp-quote-meta-value">{rate.toFixed(2)}</div>
              </div>
              <div>
                <div className="lp-quote-meta-label">{t("landing.quote.lockedFor")}</div>
                <div className="lp-quote-meta-value">{lockMin}:{lockSecPad}</div>
              </div>
              <div>
                <div className="lp-quote-meta-label">{t("landing.quote.network")}</div>
                <div className="lp-quote-meta-value">Stellar</div>
              </div>
            </div>
            <Link to="/register" className="lp-quote-cta">{t("landing.quote.cta")}</Link>
          </div>
        </div>
      </section>

      {/* ── Stats Strip ── */}
      <div className="lp-stats-strip">
        {STATS.map((s) => (
          <div key={s.v} className="lp-stat-item">
            <div className="lp-stat-value">{s.v}</div>
            <div className="lp-stat-label">{s.l}</div>
          </div>
        ))}
      </div>

      {/* ── Features ── */}
      <section className="lp-section lp-features" id="features">
        <div className="lp-section-eyebrow">{t("landing.features.eyebrow")}</div>
        <div className="lp-section-headline">
          {t("landing.features.headline").split("\n").map((line, i, arr) => (
            <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
          ))}
        </div>
        <div className="lp-section-tagline">{t("landing.features.tagline")}</div>
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
        <div className="lp-section-eyebrow">{t("landing.how.eyebrow")}</div>
        <div className="lp-section-headline">
          {t("landing.how.headline").split("\n").map((line, i, arr) => (
            <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
          ))}
        </div>
        <div className="lp-section-tagline">{t("landing.how.tagline")}</div>
        <div className="lp-section-underline lp-section-underline--white" />
        <div className="lp-steps-grid">
          {[
            { n: "01", title: t("landing.how.step1.title"), body: t("landing.how.step1.body") },
            { n: "02", title: t("landing.how.step2.title"), body: t("landing.how.step2.body") },
            { n: "03", title: t("landing.how.step3.title"), body: t("landing.how.step3.body") },
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
        <div className="lp-section-eyebrow">{t("landing.trust.eyebrow")}</div>
        <div className="lp-section-headline">
          {t("landing.trust.headline").split("\n").map((line, i, arr) => (
            <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
          ))}
        </div>
        <div className="lp-section-tagline">{t("landing.trust.tagline")}</div>
        <div className="lp-section-underline" />
        <div className="lp-trust-grid">
          <div className="lp-trust-card-large">
            <div>
              <div className="lp-card-eyebrow">{t("landing.trust.card1.eyebrow")}</div>
              <div className="lp-card-headline">
                {t("landing.trust.card1.headline").split("\n").map((line, i, arr) => (
                  <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
                ))}
              </div>
              <div className="lp-card-body">{t("landing.trust.card1.body")}</div>
            </div>
            <div className="lp-card-badges">
              {([
                t("landing.trust.badge.kyb"),
                t("landing.trust.badge.stellar"),
                t("landing.trust.badge.audit"),
                t("landing.trust.badge.reserve"),
              ] as const).map((b) => (
                <span key={b} className="lp-badge">{b}</span>
              ))}
            </div>
          </div>
          <div className="lp-trust-card-small">
            <div className="lp-card-eyebrow">{t("landing.trust.card2.eyebrow")}</div>
            <div className="lp-card-title">{t("landing.trust.card2.title")}</div>
            <div className="lp-card-body">{t("landing.trust.card2.body")}</div>
          </div>
          <div className="lp-trust-card-small">
            <div className="lp-card-eyebrow">{t("landing.trust.card3.eyebrow")}</div>
            <div className="lp-card-title">{t("landing.trust.card3.title")}</div>
            <div className="lp-card-body">{t("landing.trust.card3.body")}</div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-cta">
        <div className="lp-cta-eyebrow">{t("landing.cta.eyebrow")}</div>
        <h2 className="lp-cta-headline">{t("landing.cta.headline1")}<br />{t("landing.cta.headline2")}</h2>
        <div className="lp-cta-tagline">{t("landing.cta.tagline")}</div>
        <div className="lp-cta-rule" />
        <div className="lp-cta-actions">
          <Link to="/register" className="lp-btn lp-btn-gold lp-btn-lg">{t("landing.cta.open")}</Link>
          <a href="mailto:johan@theokingdom.com" className="lp-btn lp-btn-ghost-white lp-btn-lg">{t("landing.cta.sales")}</a>
        </div>
        <div className="lp-cta-footnote">{t("landing.cta.footnote")}</div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-top">
          <div className="lp-footer-left">
            <div className="lp-footer-logo">
              <div className="lp-footer-logo-tile">T</div>
              <span className="lp-footer-logo-name">Theo</span>
            </div>
            <div className="lp-footer-divider" />
            <span className="lp-footer-tagline">"Trust is the Original Currency."</span>
          </div>
          <div className="lp-footer-right">
            <div className="lp-footer-socials">
              <a href="https://www.linkedin.com/company/theokingdom/" target="_blank" rel="noreferrer" className="lp-footer-social" aria-label="LinkedIn">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5C4.98 4.881 3.87 6 2.5 6S0 4.881 0 3.5C0 2.12 1.11 1 2.5 1s2.48 1.12 2.48 2.5zM.22 8h4.56v14H.22V8zm7.65 0h4.37v1.92h.06c.61-1.15 2.1-2.36 4.32-2.36 4.62 0 5.48 3.04 5.48 7v7.44h-4.56v-6.6c0-1.57-.03-3.6-2.2-3.6-2.2 0-2.54 1.72-2.54 3.48V22H7.87V8z"/></svg>
              </a>
              <a href="https://x.com/TheoApp_" target="_blank" rel="noreferrer" className="lp-footer-social" aria-label="X">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a href="https://theodorecrown.substack.com/" target="_blank" rel="noreferrer" className="lp-footer-social" aria-label="Substack">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z"/></svg>
              </a>
            </div>
            <div className="lp-footer-divider" />
            <div className="lp-footer-links">
              <a href="https://theokingdom.com/company" target="_blank" rel="noreferrer" className="lp-footer-link">Company</a>
              <a href="https://theokingdom.com/privacy" target="_blank" rel="noreferrer" className="lp-footer-link">{t("landing.footer.privacy")}</a>
              <a href="https://theokingdom.com/terms" target="_blank" rel="noreferrer" className="lp-footer-link">{t("landing.footer.terms")}</a>
              <a href="mailto:johan@theokingdom.com" className="lp-footer-link">{t("landing.footer.contact")}</a>
            </div>
          </div>
        </div>
        <div className="lp-footer-bottom">
          © {new Date().getFullYear()} Theo AI Finance Inc. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
