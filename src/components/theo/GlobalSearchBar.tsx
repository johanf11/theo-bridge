import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveEffectiveCustomerId } from "@/lib/customer";
import { useSearch } from "@/contexts/SearchContext";
import { useT } from "@/lib/i18n";
import { useLocale } from "@/lib/locale";
import {
  type SearchNavItem,
  buildEntitySearchUrl,
  INTERNAL_PAYOUT_MEMOS,
  matchNavItems,
  parseSearchParams,
  sanitizeIlike,
  SEARCH_FILTER_PAGES,
} from "@/lib/search";
import { fmtUSDC } from "@/lib/format";

type TxResult = { id: string; reference_number: string; usdc_amount: number; status: string; created_at: string };
type WalletResult = { id: string; label: string | null; stellar_address: string };
type PayoutResult = { id: string; recipient_name: string; amount_usdc: number; status: string; memo: string | null; created_at: string };
type InvoiceResult = { id: string; invoice_number: string; client_name: string; total: number; status: string; created_at: string };

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "hsl(var(--theo-mid))", padding: "8px 12px 4px" }}>
      {label}
    </div>
  );
}

function ResultRow({
  active, onSelect, onHover, left, right, sub,
}: {
  active: boolean; onSelect: () => void; onHover: () => void;
  left: React.ReactNode; right?: React.ReactNode; sub?: string;
}) {
  return (
    <button
      onMouseDown={onSelect}
      onMouseEnter={onHover}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", padding: "8px 12px", border: "none",
        background: active ? "hsl(var(--theo-blue-soft))" : "transparent",
        cursor: "pointer", fontFamily: "inherit", textAlign: "left",
        transition: "background 80ms", gap: 8,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-ink))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{left}</div>
        {sub && <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 1 }}>{sub}</div>}
      </div>
      {right && <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))", flexShrink: 0 }}>{right}</span>}
    </button>
  );
}

function LoadingRows() {
  return (
    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ height: 32, borderRadius: 6, background: "hsl(var(--theo-blue-soft))", opacity: 0.6 }} />
      ))}
    </div>
  );
}

type AnyResult =
  | { type: "nav"; item: SearchNavItem }
  | { type: "tx"; item: TxResult }
  | { type: "payout"; item: PayoutResult }
  | { type: "wallet"; item: WalletResult }
  | { type: "invoice"; item: InvoiceResult };

export function GlobalSearchBar({ nav }: { nav: SearchNavItem[] }) {
  const { query, setQuery } = useSearch();
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [txResults, setTxResults] = useState<TxResult[]>([]);
  const [payoutResults, setPayoutResults] = useState<PayoutResult[]>([]);
  const [walletResults, setWalletResults] = useState<WalletResult[]>([]);
  const [invoiceResults, setInvoiceResults] = useState<InvoiceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchGenRef = useRef(0);

  const isFilterPage = (SEARCH_FILTER_PAGES as readonly string[]).includes(location.pathname);

  // Sync query from URL on filter pages; clear elsewhere unless URL has q
  useEffect(() => {
    const { q } = parseSearchParams(location.search);
    if (isFilterPage || q) {
      setQuery(q);
    } else {
      setQuery("");
    }
    setTxResults([]);
    setPayoutResults([]);
    setWalletResults([]);
    setInvoiceResults([]);
  }, [location.pathname, location.search, isFilterPage, setQuery]);

  // ⌘K / Ctrl+K to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setFocused(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Debounced Supabase entity search
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setTxResults([]);
      setPayoutResults([]);
      setWalletResults([]);
      setInvoiceResults([]);
      setLoading(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const gen = ++fetchGenRef.current;
      setLoading(true);

      const customerId = await resolveEffectiveCustomerId();
      if (!customerId || gen !== fetchGenRef.current) {
        if (gen === fetchGenRef.current) setLoading(false);
        return;
      }

      const q = sanitizeIlike(trimmed);
      if (!q) {
        setLoading(false);
        return;
      }

      // All entity queries scoped to the effective org customer — never cross-org.
      const [{ data: txs }, { data: pays }, { data: ws }, { data: invs }] = await Promise.all([
        supabase
          .from("orders")
          .select("id, reference_number, usdc_amount, status, created_at")
          .eq("customer_id", customerId)
          .or(`reference_number.ilike.%${q}%,stellar_tx_hash.ilike.%${q}%`)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("payouts")
          .select("id, recipient_name, amount_usdc, status, memo, created_at")
          .eq("customer_id", customerId)
          .not("memo", "eq", INTERNAL_PAYOUT_MEMOS[0])
          .not("memo", "eq", INTERNAL_PAYOUT_MEMOS[1])
          .or(`recipient_name.ilike.%${q}%,memo.ilike.%${q}%,recipient_address.ilike.%${q}%,stellar_tx_hash.ilike.%${q}%`)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("wallets")
          .select("id, label, stellar_address")
          .eq("customer_id", customerId)
          .or(`label.ilike.%${q}%,stellar_address.ilike.%${q}%`)
          .limit(4),
        supabase
          .from("invoices")
          .select("id, invoice_number, client_name, total, status, created_at")
          .eq("customer_id", customerId)
          .or(`invoice_number.ilike.%${q}%,client_name.ilike.%${q}%,client_email.ilike.%${q}%`)
          .order("created_at", { ascending: false })
          .limit(4),
      ]);

      if (gen !== fetchGenRef.current) return;

      setTxResults((txs ?? []) as TxResult[]);
      setPayoutResults((pays ?? []) as PayoutResult[]);
      setWalletResults((ws ?? []) as WalletResult[]);
      setInvoiceResults((invs ?? []) as InvoiceResult[]);
      setActiveIdx(0);
      setLoading(false);
    }, 180);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) setFocused(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const navMatches = matchNavItems(nav, query);
  const quickLinks = nav.slice(0, 6);

  const entityResults: AnyResult[] = [
    ...payoutResults.map((p) => ({ type: "payout" as const, item: p })),
    ...txResults.map((tx) => ({ type: "tx" as const, item: tx })),
    ...invoiceResults.map((inv) => ({ type: "invoice" as const, item: inv })),
    ...walletResults.map((w) => ({ type: "wallet" as const, item: w })),
  ];

  const allResults: AnyResult[] = query.trim()
    ? [
        ...navMatches.map((n) => ({ type: "nav" as const, item: n })),
        ...entityResults,
      ]
    : quickLinks.map((n) => ({ type: "nav" as const, item: n }));

  const hasResults = allResults.length > 0;
  const showDropdown = focused && (query.trim().length >= 1 || !query.trim());
  const showQuickLinks = !query.trim() && focused;
  const showNoResults = query.trim().length >= 2 && !loading && !hasResults;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });

  const fmtShortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { month: "short", day: "numeric" });

  const selectResult = (r: AnyResult) => {
    setFocused(false);
    const q = query.trim();

    if (r.type === "nav") {
      setQuery("");
      navigate(r.item.to);
      return;
    }

    if (r.type === "tx") {
      setQuery("");
      navigate(`/orders/${r.item.id}`);
      return;
    }
    if (r.type === "payout") {
      navigate(buildEntitySearchUrl("/payout", q || r.item.recipient_name, r.item.id));
      return;
    }
    if (r.type === "invoice") {
      navigate(buildEntitySearchUrl("/invoices", q || r.item.invoice_number, r.item.id));
      return;
    }
    if (r.type === "wallet") {
      navigate(buildEntitySearchUrl("/balance", q || r.item.label || r.item.stellar_address, r.item.id));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setQuery("");
      setFocused(false);
      return;
    }

    if (!showDropdown || !hasResults) return;

    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, allResults.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && allResults[activeIdx]) { e.preventDefault(); selectResult(allResults[activeIdx]); }
  };

  const placeholder = location.pathname === "/transactions"
    ? t("nav.search.tx")
    : location.pathname === "/payout"
    ? t("nav.search.payout")
    : location.pathname === "/invoices"
    ? t("nav.search.invoices")
    : t("nav.search.default");

  const divider = (show: boolean) => show ? <div style={{ height: 1, background: "hsl(var(--theo-light))" }} /> : null;

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div style={{ position: "relative", flex: 1, maxWidth: 380 }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "hsl(var(--theo-cream))",
          border: `1px solid ${focused ? "hsl(var(--theo-blue))" : "hsl(var(--theo-light))"}`,
          borderRadius: 8, padding: "7px 12px",
          transition: "border-color 130ms",
        }}
      >
        <Search style={{ width: 13, height: 13, stroke: "hsl(var(--theo-mid))", fill: "none", strokeWidth: 2, flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          aria-label={t("nav.search.default")}
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          style={{
            border: "none", background: "transparent", outline: "none",
            fontFamily: "inherit", fontSize: 13, color: "hsl(var(--theo-ink))", width: "100%",
          }}
        />
        {!query && !focused && (
          <span style={{ fontSize: 10, color: "hsl(var(--theo-mid))", flexShrink: 0, padding: "2px 5px", borderRadius: 4, border: "1px solid hsl(var(--theo-light))", background: "#fff" }}>
            {isMac ? "⌘K" : "Ctrl+K"}
          </span>
        )}
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => { setQuery(""); inputRef.current?.focus(); }}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "hsl(var(--theo-mid))", fontSize: 16, lineHeight: 1, flexShrink: 0 }}
          >
            ×
          </button>
        )}
      </div>

      {showDropdown && (
        <div
          ref={dropdownRef}
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
            background: "#fff", borderRadius: 10, zIndex: 200,
            boxShadow: "0 8px 32px rgba(51,53,154,0.14), 0 1px 4px rgba(0,0,0,0.08)",
            border: "1px solid hsl(var(--theo-light))",
            overflow: "hidden", maxHeight: 420, overflowY: "auto",
          }}
        >
          {showQuickLinks && (
            <>
              <SectionLabel label={t("nav.search.quickLinks")} />
              {quickLinks.map((n, i) => {
                const Icon = n.icon;
                return (
                  <button
                    key={n.to}
                    type="button"
                    onMouseDown={() => selectResult({ type: "nav", item: n })}
                    onMouseEnter={() => setActiveIdx(i)}
                    style={{
                      display: "flex", alignItems: "center", gap: 9,
                      width: "100%", padding: "8px 12px", border: "none",
                      background: activeIdx === i ? "hsl(var(--theo-blue-soft))" : "transparent",
                      cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                      transition: "background 80ms",
                    }}
                  >
                    <Icon style={{ width: 13, height: 13, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{n.label}</span>
                  </button>
                );
              })}
              <div style={{ padding: "6px 12px 8px", borderTop: "1px solid hsl(var(--theo-light))" }}>
                <span style={{ fontSize: 10, color: "hsl(var(--theo-mid))" }}>{t("nav.search.hintWithShortcut")}</span>
              </div>
            </>
          )}

          {query.trim().length >= 1 && (
            <>
              {showNoResults && (
                <div style={{ padding: "14px 12px", fontSize: 13, color: "hsl(var(--theo-mid))" }}>
                  {t("nav.search.noResults")} &ldquo;{query.trim()}&rdquo;
                </div>
              )}

              {loading && !hasResults && <LoadingRows />}

              {navMatches.length > 0 && (
                <>
                  <SectionLabel label={t("nav.search.section.navigate")} />
                  {navMatches.map((n, i) => {
                    const Icon = n.icon;
                    const gIdx = i;
                    return (
                      <button
                        key={n.to}
                        type="button"
                        onMouseDown={() => selectResult({ type: "nav", item: n })}
                        onMouseEnter={() => setActiveIdx(gIdx)}
                        style={{
                          display: "flex", alignItems: "center", gap: 9,
                          width: "100%", padding: "8px 12px", border: "none",
                          background: activeIdx === gIdx ? "hsl(var(--theo-blue-soft))" : "transparent",
                          cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                          transition: "background 80ms",
                        }}
                      >
                        <Icon style={{ width: 13, height: 13, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 2, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{n.label}</span>
                        <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginLeft: "auto" }}>↵</span>
                      </button>
                    );
                  })}
                </>
              )}

              {payoutResults.length > 0 && (
                <>
                  {divider(navMatches.length > 0)}
                  <SectionLabel label={t("nav.search.section.payouts")} />
                  {payoutResults.map((p, i) => {
                    const gIdx = navMatches.length + i;
                    return (
                      <ResultRow
                        key={p.id}
                        active={activeIdx === gIdx}
                        onSelect={() => selectResult({ type: "payout", item: p })}
                        onHover={() => setActiveIdx(gIdx)}
                        left={p.recipient_name}
                        sub={`${fmtShortDate(p.created_at)}${p.memo ? ` · ${p.memo}` : ""}`}
                        right={`$${Number(p.amount_usdc).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`}
                      />
                    );
                  })}
                </>
              )}

              {txResults.length > 0 && (
                <>
                  {divider(navMatches.length + payoutResults.length > 0)}
                  <SectionLabel label={t("nav.search.section.conversions")} />
                  {txResults.map((tx, i) => {
                    const gIdx = navMatches.length + payoutResults.length + i;
                    return (
                      <ResultRow
                        key={tx.id}
                        active={activeIdx === gIdx}
                        onSelect={() => selectResult({ type: "tx", item: tx })}
                        onHover={() => setActiveIdx(gIdx)}
                        left={<span style={{ fontFamily: "monospace" }}>{tx.reference_number}</span>}
                        sub={fmtDate(tx.created_at)}
                        right={`$${Number(tx.usdc_amount).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`}
                      />
                    );
                  })}
                </>
              )}

              {invoiceResults.length > 0 && (
                <>
                  {divider(navMatches.length + payoutResults.length + txResults.length > 0)}
                  <SectionLabel label={t("nav.search.section.invoices")} />
                  {invoiceResults.map((inv, i) => {
                    const gIdx = navMatches.length + payoutResults.length + txResults.length + i;
                    return (
                      <ResultRow
                        key={inv.id}
                        active={activeIdx === gIdx}
                        onSelect={() => selectResult({ type: "invoice", item: inv })}
                        onHover={() => setActiveIdx(gIdx)}
                        left={<span style={{ fontFamily: "monospace" }}>{inv.invoice_number}</span>}
                        sub={inv.client_name}
                        right={fmtUSDC(inv.total)}
                      />
                    );
                  })}
                </>
              )}

              {walletResults.length > 0 && (
                <>
                  {divider(navMatches.length + payoutResults.length + txResults.length + invoiceResults.length > 0)}
                  <SectionLabel label={t("nav.search.section.accounts")} />
                  {walletResults.map((w, i) => {
                    const gIdx = navMatches.length + payoutResults.length + txResults.length + invoiceResults.length + i;
                    return (
                      <ResultRow
                        key={w.id}
                        active={activeIdx === gIdx}
                        onSelect={() => selectResult({ type: "wallet", item: w })}
                        onHover={() => setActiveIdx(gIdx)}
                        left={w.label ?? t("nav.search.unnamedAccount")}
                        right={`${w.stellar_address.slice(0, 6)}…${w.stellar_address.slice(-4)}`}
                      />
                    );
                  })}
                </>
              )}

              {hasResults && (
                <div style={{ padding: "6px 12px 8px", borderTop: "1px solid hsl(var(--theo-light))" }}>
                  <span style={{ fontSize: 10, color: "hsl(var(--theo-mid))" }}>{t("nav.search.hintWithShortcut")}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
