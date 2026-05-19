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
  { icon: icons.dollar,  title: "Locked-In Rates",             body: "Quote locks for 15 minutes at the official BRH reference rate — enough time to authorize your bank transfer. What you see is what you get. No spread surprises at settlement." },
  { icon: icons.monitor, title: "Bank-Grade Reconciliation",   body: "Download full audit trails as CSV or PDF. Categorized by date, counterparty, and amount. Built for your accountant and your regulator." },
  { icon: icons.lock,    title: "1:1 Backed Reserves",         body: "Every USDC in your Theo wallet is backed by a real dollar — segregated from Theo's operational funds and redeemable on-demand. Transparency by default." },
];

const STATS = [
  { v: "$4B+",    l: "Haiti Remittance Corridor" },
  { v: "< 5 min", l: "Settlement Time" },
  { v: "3–5%",    l: "Avg Fees We Eliminate" },
  { v: "$50K",    l: "Per-Transaction Limit" },
];

const BAR_HEIGHTS = [42,28,36,55,30,48,22,38,60,35,50,27,45,58,40,33,52,30,46,42,38,55,28,50,44,36,60,42,48,35,78];
const SCREEN_URLS = ["/dashboard", "/transactions", "/balance", "/compliance"];

const SPOTLIGHT_PANELS = [
  {
    num: "01", label: "Home",
    title: "Everything in one place.",
    body: "Your USDC balance, monthly volume, recent activity, and quick actions — all live, all on a single screen. The first thing your finance team sees every morning.",
    points: ["Total balance and converted-this-month at a glance.", "Gross volume chart with today's bar highlighted.", "One-tap shortcuts to conversions, payouts, and KYB."],
  },
  {
    num: "02", label: "Transactions",
    title: "Full transaction history.",
    body: "Every conversion and payout, filterable by type, status, and date, exportable to CSV in one click. Built for the way your accountant actually works.",
    points: ["Date, type, amount, rate, network, status, reference.", "Color-coded status chips — Settled, Paid, Processing.", "Click any row for the on-chain receipt and audit trail."],
  },
  {
    num: "03", label: "Balance",
    title: "Multi-wallet, multi-purpose.",
    body: "Create separate wallets for Operations, Payroll, and Reserves — all on Stellar, all verified on-chain. Move funds between wallets without ever leaving Theo.",
    points: ["Hero balance card with live reserve attestation.", "Side-by-side wallet cards with independent ledgers.", "Internal transfers settle instantly, off-chain."],
  },
  {
    num: "04", label: "Compliance",
    title: "Built-in compliance.",
    body: "KYB verified on day one. Every transaction signed, timestamped, and exportable as an audit-ready report. No third-party tools, no manual reconciliation.",
    points: ["KYB status badge — verified or pending — always visible.", "Immutable audit trail for every conversion and payout.", "Regulator-ready PDF + CSV exports, with one click."],
  },
];

// Mini-app nav icon SVGs
const NAV_ICONS: Record<string, React.ReactNode> = {
  home: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  tx:   <svg viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
  bal:  <svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  pay:  <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  comp: <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
};

function MiniSidebar({ active }: { active: string }) {
  const items = [
    { key: "home", label: "Home",         icon: "home" },
    { key: "tx",   label: "Transactions", icon: "tx"   },
    { key: "bal",  label: "Balance",      icon: "bal"  },
    { key: "pay",  label: "Payout",       icon: "pay"  },
    { key: "comp", label: "Compliance",   icon: "comp" },
  ];
  return (
    <aside className="lp-mini-sidebar">
      <div className="lp-mini-logo">
        <div className="lp-mini-logo-tile">T</div>
        <div className="lp-mini-logo-name">Theo</div>
      </div>
      <div className="lp-mini-nav">
        {items.map(({ key, label, icon }) => (
          <div key={key} className={`lp-mini-nav-item${active === key ? " active" : ""}`}>
            {NAV_ICONS[icon]}{label}
          </div>
        ))}
      </div>
      <div className="lp-mini-nav-section-label">Account</div>
      <div className="lp-mini-nav">
        <div className="lp-mini-nav-item">
          <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Billing
        </div>
      </div>
    </aside>
  );
}

function MiniTopbar() {
  return (
    <div className="lp-mini-topbar">
      <div className="lp-mini-search">Search transactions, wallets…</div>
      <div className="lp-mini-avatar">JB</div>
    </div>
  );
}

function ScreenDashboard() {
  return (
    <div className="lp-mini-app">
      <MiniSidebar active="home" />
      <div className="lp-mini-main">
        <MiniTopbar />
        <div className="lp-mini-content">
          <div>
            <div className="lp-mini-h1">Good morning, Jean-Baptiste.</div>
            <div className="lp-mini-sub">Wednesday, May 14, 2026 · All systems normal</div>
          </div>
          <div className="lp-mini-kpi-grid">
            <div className="lp-mini-kpi gold">
              <div className="lp-mini-kpi-eye">Total USDC Balance</div>
              <div className="lp-mini-kpi-val">$24,310</div>
              <div className="lp-mini-kpi-unit">USDC · Stellar</div>
            </div>
            <div className="lp-mini-kpi">
              <div className="lp-mini-kpi-eye">Converted this month</div>
              <div className="lp-mini-kpi-val">$18,500</div>
              <div className="lp-mini-kpi-unit">USDC</div>
            </div>
            <div className="lp-mini-kpi">
              <div className="lp-mini-kpi-eye">Transactions</div>
              <div className="lp-mini-kpi-val">24</div>
              <div className="lp-mini-kpi-unit">This month</div>
            </div>
            <div className="lp-mini-kpi">
              <div className="lp-mini-kpi-eye">Avg settlement</div>
              <div className="lp-mini-kpi-val">1.4 min</div>
              <div className="lp-mini-kpi-unit">From bank</div>
            </div>
          </div>
          <div className="lp-mini-chart-card">
            <div className="lp-mini-chart-head">
              <div className="lp-mini-chart-title">Gross volume · HTG → USDC</div>
              <div className="lp-mini-chart-meta">Last 30 days · today highlighted</div>
            </div>
            <div className="lp-mini-chart">
              {BAR_HEIGHTS.map((h, i) => (
                <div key={i} className={`lp-mini-bar${i === BAR_HEIGHTS.length - 1 ? " gold" : ""}`} style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
          <div className="lp-mini-row">
            <div className="lp-mini-card">
              <div className="lp-mini-card-title">Quick actions</div>
              <div className="lp-mini-list">
                {["Start a conversion", "Send a payout", "View balances", "Complete KYB"].map((a) => (
                  <div key={a} className="lp-mini-list-item">
                    <svg viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/></svg>
                    {a}
                    <span style={{ marginLeft: "auto", color: "#6B6B8A" }}>→</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="lp-mini-card">
              <div className="lp-mini-card-title">Recent transactions</div>
              <table className="lp-mini-table">
                <tbody>
                  <tr><td className="muted">May 01</td><td>Conversion</td><td className="num">$5,000</td><td><span className="lp-mini-pill green"><span className="lp-mini-pill-dot"/>&nbsp;Settled</span></td></tr>
                  <tr><td className="muted">Apr 28</td><td>Conversion</td><td className="num">$3,000</td><td><span className="lp-mini-pill green"><span className="lp-mini-pill-dot"/>&nbsp;Settled</span></td></tr>
                  <tr><td className="muted">Apr 22</td><td>Payout</td><td className="num">$1,500</td><td><span className="lp-mini-pill green"><span className="lp-mini-pill-dot"/>&nbsp;Paid</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScreenTransactions() {
  const rows = [
    { date: "May 12", type: "Conversion", desc: "HTG → USDC", amt: "$8,000",  htg: "1,079,760", rate: "134.97", status: "Settled",    ref: "THEO-5X2K9A" },
    { date: "May 10", type: "Payout",     desc: "Caribe Imports", amt: "$2,450",  htg: "—",         rate: "—",      status: "Paid",       ref: "THEO-M7P3TQ" },
    { date: "May 08", type: "Conversion", desc: "HTG → USDC", amt: "$5,200",  htg: "701,844",   rate: "134.97", status: "Settled",    ref: "THEO-NR8C6W" },
    { date: "May 06", type: "Conversion", desc: "HTG → USDC", amt: "$3,000",  htg: "404,910",   rate: "134.97", status: "Processing", ref: "THEO-4Y1LJD" },
    { date: "May 03", type: "Payout",     desc: "Payroll — May", amt: "$6,800",  htg: "—",         rate: "—",      status: "Paid",       ref: "THEO-B9Z7KE" },
    { date: "May 01", type: "Conversion", desc: "HTG → USDC", amt: "$5,000",  htg: "674,850",   rate: "134.97", status: "Settled",    ref: "THEO-QF5A2R" },
    { date: "Apr 28", type: "Conversion", desc: "HTG → USDC", amt: "$3,000",  htg: "404,820",   rate: "134.94", status: "Settled",    ref: "THEO-DX4N8M" },
  ];
  return (
    <div className="lp-mini-app">
      <MiniSidebar active="tx" />
      <div className="lp-mini-main">
        <MiniTopbar />
        <div className="lp-mini-content">
          <div>
            <div className="lp-mini-h1">Transactions</div>
            <div className="lp-mini-sub">Full history of conversions and payouts.</div>
          </div>
          <div className="lp-mini-filters">
            <div className="lp-mini-filter">All types</div>
            <div className="lp-mini-filter">All statuses</div>
            <div className="lp-mini-filter">Last 30 days</div>
            <div style={{ marginLeft: "auto", fontSize: 10, color: "#6B6B8A" }}>7 of 124</div>
            <div className="lp-mini-filter" style={{ color: "#33359A" }}>Export CSV</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAEAF2", borderRadius: 9, overflow: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ overflow: "auto", flex: 1 }}>
              <table className="lp-mini-table">
                <thead>
                  <tr>
                    <th>Date</th><th>Type</th><th>Description</th>
                    <th className="num">Amount</th><th className="num">HTG sent</th>
                    <th>Rate</th><th>Status</th><th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ref}>
                      <td className="muted">{r.date}</td>
                      <td>{r.type}</td>
                      <td>{r.desc}</td>
                      <td className="num">{r.amt}</td>
                      <td className="num muted">{r.htg}</td>
                      <td className="muted">{r.rate}</td>
                      <td><span className={`lp-mini-pill ${r.status === "Processing" ? "amber" : "green"}`}><span className="lp-mini-pill-dot"/>&nbsp;{r.status}</span></td>
                      <td className="ref">{r.ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScreenBalance() {
  return (
    <div className="lp-mini-app">
      <MiniSidebar active="bal" />
      <div className="lp-mini-main">
        <MiniTopbar />
        <div className="lp-mini-content">
          <div>
            <div className="lp-mini-h1">Balance</div>
            <div className="lp-mini-sub">Multi-wallet and multi-account overview.</div>
          </div>
          <div className="lp-mini-balance-hero">
            <div style={{ position: "relative", zIndex: 1 }}>
              <div className="lp-mini-balance-eye">Total USDC Balance</div>
              <div className="lp-mini-balance-val">$24,310.00<span className="lp-mini-balance-unit">USDC</span></div>
              <div className="lp-mini-balance-meta">
                <span>Stellar network · <b>Live</b></span>
                <span>1:1 backed · <b>Attested 12 min ago</b></span>
              </div>
            </div>
          </div>
          <div className="lp-mini-wallet-grid">
            {[
              { eye: "Primary",   name: "Operations", val: "$18,750" },
              { eye: "Secondary", name: "Payroll",     val: "$4,200"  },
              { eye: "Reserve",   name: "Savings",     val: "$1,360"  },
            ].map((w) => (
              <div key={w.name} className="lp-mini-wallet">
                <div className="lp-mini-wallet-eye">{w.eye}</div>
                <div className="lp-mini-wallet-name">{w.name}</div>
                <div className="lp-mini-wallet-val">{w.val}<span className="lp-mini-wallet-unit">USDC</span></div>
              </div>
            ))}
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAEAF2", borderRadius: 9, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #EAEAF2", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#33359A" }}>Account ledger</div>
              <div style={{ fontSize: 9.5, color: "#6B6B8A" }}>Operations wallet · GA3X…7N9P</div>
            </div>
            <div style={{ overflow: "auto", flex: 1 }}>
              <table className="lp-mini-table">
                <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  <tr><td className="muted">May 12</td><td>HTG → USDC conversion</td><td className="num">+$8,000</td><td><span className="lp-mini-pill green"><span className="lp-mini-pill-dot"/>&nbsp;Settled</span></td></tr>
                  <tr><td className="muted">May 10</td><td>Payout · Caribe Imports</td><td className="num" style={{ color: "#C0392B" }}>–$2,450</td><td><span className="lp-mini-pill green"><span className="lp-mini-pill-dot"/>&nbsp;Paid</span></td></tr>
                  <tr><td className="muted">May 08</td><td>HTG → USDC conversion</td><td className="num">+$5,200</td><td><span className="lp-mini-pill green"><span className="lp-mini-pill-dot"/>&nbsp;Settled</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScreenCompliance() {
  const checks = [
    { label: "KYB Verified",           meta: "Verified · Apr 2, 2026"   },
    { label: "AML Screening",          meta: "Passed · Continuous"      },
    { label: "Transaction Monitoring", meta: "Active · Real-time"       },
    { label: "Audit Trail Export",     meta: "CSV + PDF · Available"    },
    { label: "Stellar Attestation",    meta: "Live · Updated 12 min ago" },
  ];
  return (
    <div className="lp-mini-app">
      <MiniSidebar active="comp" />
      <div className="lp-mini-main">
        <MiniTopbar />
        <div className="lp-mini-content">
          <div>
            <div className="lp-mini-h1">Compliance</div>
            <div className="lp-mini-sub">KYB status, audit trail, and regulatory exports.</div>
          </div>
          <div className="lp-mini-compliance-hero">
            <div className="lp-mini-shield">
              <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div>
              <div className="lp-mini-comp-eye">Compliance Status</div>
              <div className="lp-mini-comp-title">Fully Verified</div>
              <div className="lp-mini-comp-sub">KYB approved · All checks passed · Ready to transact</div>
            </div>
          </div>
          <div className="lp-mini-checks">
            {checks.map((c) => (
              <div key={c.label} className="lp-mini-check-row">
                <div className="lp-mini-check-icon">
                  <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <span className="lp-mini-check-lbl">{c.label}</span>
                <span className="lp-mini-check-meta">{c.meta}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const [activeScreen, setActiveScreen] = useState(0);

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

  // Spotlight scroll driver — IntersectionObserver on each panel
  // rootMargin "-40% 0px -40% 0px" means "only count as intersecting when
  // the panel occupies the middle 20% of the viewport", which reliably
  // identifies the panel the user is currently reading.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.panelIdx ?? 0);
            setActiveScreen(idx);
          }
        });
      },
      { rootMargin: "-40% 0px -40% 0px", threshold: 0 }
    );
    const panels = document.querySelectorAll<HTMLElement>(".lp-narrative-panel[data-panel-idx]");
    panels.forEach((p) => observer.observe(p));
    return () => observer.disconnect();
  }, []);

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
            <span className="lp-hero-proof-text">BRH reference rate · Stellar network · 1:1 backed reserves</span>
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

      {/* ── Dashboard Spotlight ── */}
      <section className="lp-spotlight" id="dashboard">
        <div className="lp-spotlight-header">
          <div className="lp-section-eyebrow">Theo for Business</div>
          <div className="lp-section-headline">A complete workspace.<br />Right after onboarding.</div>
          <div className="lp-section-tagline">Live balances. Full history. Built-in compliance.</div>
          <div className="lp-section-underline" />
        </div>

        <div className="lp-spotlight-grid">
          {/* LEFT: scrollable narrative */}
          <div className="lp-spotlight-narrative">
            {SPOTLIGHT_PANELS.map((panel, i) => (
              <div key={panel.num} data-panel-idx={i} className={`lp-narrative-panel${activeScreen === i ? " is-active" : ""}`}>
                <div className="lp-narrative-step">
                  <span className="lp-narrative-step-num">{panel.num}</span>
                  {panel.label}
                </div>
                <div className="lp-narrative-title">{panel.title}</div>
                <p className="lp-narrative-body">{panel.body}</p>
                <ul className="lp-narrative-points">
                  {panel.points.map((pt) => <li key={pt}>{pt}</li>)}
                </ul>
              </div>
            ))}
          </div>

          {/* RIGHT: sticky browser frame */}
          <div className="lp-spotlight-stage">
            <div className="lp-browser-frame">
              <div className="lp-browser-chrome">
                <div className="lp-browser-dots">
                  <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#FF6058", display: "block" }} />
                  <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#FFBD2D", display: "block" }} />
                  <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#29C940", display: "block" }} />
                </div>
                <div className="lp-browser-url">
                  app.theo.finance
                  <span style={{ color: "var(--lp-cyan)", marginLeft: "auto" }}>
                    {SCREEN_URLS[activeScreen]}
                  </span>
                </div>
              </div>
              <div className="lp-browser-viewport">
                <div className={`lp-screen${activeScreen === 0 ? " is-active" : ""}`}><ScreenDashboard /></div>
                <div className={`lp-screen${activeScreen === 1 ? " is-active" : ""}`}><ScreenTransactions /></div>
                <div className={`lp-screen${activeScreen === 2 ? " is-active" : ""}`}><ScreenBalance /></div>
                <div className={`lp-screen${activeScreen === 3 ? " is-active" : ""}`}><ScreenCompliance /></div>
              </div>
            </div>
          </div>
        </div>
      </section>

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
            { n: "01", title: "Get a Locked Quote",       body: "Enter the USDC amount you need. Theo instantly shows your HTG cost at the official BRH rate — locked for 15 minutes. No surprises at settlement." },
            { n: "02", title: "Transfer from Your Bank",  body: "Send HTG from your Haitian bank account. We confirm receipt and release your USDC the moment funds clear — no manual follow-up needed." },
            { n: "03", title: "USDC Lands in Minutes",    body: "USDC arrives in your Stellar wallet within minutes of confirmation — ready to pay international suppliers, convert to USD, or hold as a stable reserve." },
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
                segregated from Theo's operational funds.
                We make money on the conversion fee, not on your balance.
              </div>
            </div>
            <div className="lp-card-badges">
              {["KYB Verified", "Stellar Network", "Audit Trails", "1:1 Reserves"].map((b) => (
                <span key={b} className="lp-badge">{b}</span>
              ))}
            </div>
          </div>
          <div className="lp-trust-card-small">
            <div className="lp-card-eyebrow">Rate Source</div>
            <div className="lp-card-title">Official BRH Reference Rate</div>
            <div className="lp-card-body">Every conversion uses the official Banque de la République d'Haïti (BRH) reference rate — the same rate your central bank publishes daily. No hidden spread.</div>
          </div>
          <div className="lp-trust-card-small">
            <div className="lp-card-eyebrow">Infrastructure</div>
            <div className="lp-card-title">Powered by Stellar</div>
            <div className="lp-card-body">Settlement runs on Stellar — the same network trusted by Circle, Flutterwave, and global institutions for cross-border USDC payments. Native USDC, no wrapping.</div>
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
          © {new Date().getFullYear()} Theo AI Finance S.A. Cross-border financial infrastructure for the Global South.
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
