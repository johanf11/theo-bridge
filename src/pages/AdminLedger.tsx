import { Fragment, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { fetchHorizonBalances } from "@/lib/balance";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, RefreshCw, RotateCcw } from "lucide-react";

const DISTRIBUTOR_PUBLIC = "GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X";

type Account = {
  id: string;
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  currency: "HTG" | "USDC";
};

type FailureRow = {
  id: string;
  source: string;
  reason: string;
  stellar_tx_hash: string | null;
  order_id: string | null;
  resolved_at: string | null;
  created_at: string;
};

type TxRow = {
  id: string;
  order_id: string | null;
  kind: string;
  description: string | null;
  stellar_tx_hash: string | null;
  created_at: string;
};

type EntryRow = {
  id: string;
  transaction_id: string;
  account_id: string;
  currency: "HTG" | "USDC";
  debit: number;
  credit: number;
  customer_id: string | null;
};

type CustomerRow = {
  id: string;
  company_name: string;
  email: string;
};

type AccountAgg = {
  account: Account;
  debit: number;
  credit: number;
};

const fmt = (n: number, currency: string) =>
  n.toLocaleString("en-US", { minimumFractionDigits: currency === "HTG" ? 2 : 7, maximumFractionDigits: 7 });

const card: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  border: "1px solid hsl(var(--theo-light))",
  padding: 20,
};

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.18em",
  color: "hsl(var(--theo-cyan))",
  marginBottom: 6,
};

export default function AdminLedger() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterKind, setFilterKind] = useState("");
  const [filterOrder, setFilterOrder] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("");
  const [failures, setFailures] = useState<FailureRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<Record<string, string>>({});
  const [distChain, setDistChain] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 50>(20);

  const load = async () => {
    setLoading(true);
    const [{ data: a }, { data: e }, { data: t }, { data: f }, { data: c }] = await Promise.all([
      supabase.from("ledger_accounts").select("*").order("code"),
      supabase.from("ledger_entries").select("*"),
      supabase.from("ledger_transactions").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("ledger_posting_failures").select("*").is("resolved_at", null).order("created_at", { ascending: false }),
      supabase.from("customers").select("id, company_name, email").order("company_name"),
    ]);
    setAccounts((a ?? []) as Account[]);
    setEntries(((e ?? []) as unknown) as EntryRow[]);
    setTxs((t ?? []) as TxRow[]);
    setFailures((f ?? []) as FailureRow[]);
    setCustomers((c ?? []) as CustomerRow[]);
    setLoading(false);
    const bal = await fetchHorizonBalances(DISTRIBUTOR_PUBLIC);
    setDistChain(bal.usdc);
  };

  const handleRetry = async (failureId: string) => {
    setRetryingId(failureId);
    setRetryError((prev) => { const n = { ...prev }; delete n[failureId]; return n; });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/replay-ledger-failure`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token}`,
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ failureId }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Retry failed");
      setFailures((prev) => prev.filter((f) => f.id !== failureId));
    } catch (e) {
      setRetryError((prev) => ({ ...prev, [failureId]: (e as Error).message }));
    } finally {
      setRetryingId(null);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // ── Trial balance ───────────────────────────────────────
  const trial: AccountAgg[] = useMemo(() => {
    const map = new Map<string, AccountAgg>();
    for (const acc of accounts) map.set(acc.id, { account: acc, debit: 0, credit: 0 });
    for (const e of entries) {
      const row = map.get(e.account_id);
      if (row) {
        row.debit += Number(e.debit);
        row.credit += Number(e.credit);
      }
    }
    return Array.from(map.values());
  }, [accounts, entries]);

  const byCurrency = (cur: "HTG" | "USDC") => trial.filter((t) => t.account.currency === cur);

  const totals = (cur: "HTG" | "USDC") => {
    const list = byCurrency(cur);
    const d = list.reduce((s, r) => s + r.debit, 0);
    const c = list.reduce((s, r) => s + r.credit, 0);
    return { d, c, balanced: Math.abs(d - c) < 1e-7 };
  };

  const htgTotals = totals("HTG");
  const usdcTotals = totals("USDC");


  // Outstanding HTG in SPIH pool from SPIH_BANK_HTG asset balance
  const spihAgg = trial.find((r) => r.account.code === "SPIH_BANK_HTG");
  const spihPoolHtg = spihAgg ? spihAgg.debit - spihAgg.credit : 0;

  // ── Filtered transactions ───────────────────────────────
  const filteredTxs = txs.filter((t) => {
    if (filterKind && !t.kind.toLowerCase().includes(filterKind.toLowerCase())) return false;
    if (filterOrder && !(t.order_id ?? "").includes(filterOrder)) return false;
    if (filterCustomer) {
      const txEntries = entries.filter((e) => e.transaction_id === t.id);
      if (!txEntries.some((e) => e.customer_id === filterCustomer)) return false;
    }
    if (filterFrom) {
      const from = new Date(filterFrom);
      from.setHours(0, 0, 0, 0);
      if (new Date(t.created_at) < from) return false;
    }
    if (filterTo) {
      const to = new Date(filterTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(t.created_at) > to) return false;
    }
    return true;
  });

  // Reset to page 1 whenever any filter changes
  useEffect(() => { setCurrentPage(1); }, [filterKind, filterOrder, filterFrom, filterTo, filterCustomer]);

  const totalPages = Math.max(1, Math.ceil(filteredTxs.length / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedTxs = filteredTxs.slice(pageStart, pageStart + pageSize);

  // ── CSV export (one row per entry line, QB-importable) ─
  const handleExportCSV = () => {
    const headers = [
      "Date", "Transaction ID", "Kind", "Order ID", "Description",
      "Account Code", "Account Name", "Account Type", "Currency",
      "Debit", "Credit", "Customer ID", "Customer", "Stellar TX Hash",
    ];
    const rows: string[][] = [];
    for (const t of filteredTxs) {
      const txEntries = entries.filter((e) => e.transaction_id === t.id);
      for (const e of txEntries) {
        const acc = accounts.find((a) => a.id === e.account_id);
        const cust = e.customer_id ? customers.find((c) => c.id === e.customer_id) : null;
        rows.push([
          new Date(t.created_at).toISOString(),
          t.id,
          t.kind,
          t.order_id ?? "",
          t.description ?? "",
          acc?.code ?? e.account_id,
          acc?.name ?? "",
          acc?.type ?? "",
          e.currency,
          Number(e.debit) > 0 ? Number(e.debit).toFixed(7) : "",
          Number(e.credit) > 0 ? Number(e.credit).toFixed(7) : "",
          e.customer_id ?? "",
          cust?.company_name ?? "",
          t.stellar_tx_hash ?? "",
        ]);
      }
    }
    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Reconciliation: book balance for DISTRIBUTOR_USDC ──
  const distAccount = accounts.find((a) => a.code === "DISTRIBUTOR_USDC");
  const distAgg = distAccount ? trial.find((t) => t.account.id === distAccount.id) : null;
  // ASSET: balance = debit - credit
  const distBook = distAgg ? distAgg.debit - distAgg.credit : 0;
  const distDelta = distChain !== null ? distChain - distBook : null;

  return (
    <AppLayout>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div>
            <div style={eyebrow}>Internal Ledger</div>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", color: "hsl(var(--theo-ink))", margin: 0 }}>
              Double-Entry Shadow Ledger
            </h1>
            <p style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 6, maxWidth: 720 }}>
              Every order processed through SPIH simulation and USDC release posts paired
              debit/credit entries. The trial balance must net to zero in each currency.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleExportCSV}
              disabled={loading || filteredTxs.length === 0}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 10,
                background: "#fff", color: "hsl(var(--theo-blue))",
                border: "1px solid hsl(var(--theo-blue) / 0.35)",
                cursor: loading || filteredTxs.length === 0 ? "not-allowed" : "pointer",
                fontSize: 13, fontWeight: 600, opacity: filteredTxs.length === 0 ? 0.4 : 1,
              }}
            >
              <Download style={{ width: 13, height: 13 }} /> Export CSV
            </button>
            <button
              onClick={load}
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 10,
                background: "hsl(var(--theo-blue))", color: "#fff",
                border: "none", cursor: loading ? "wait" : "pointer",
                fontSize: 13, fontWeight: 600,
              }}
            >
              <RefreshCw style={{ width: 13, height: 13 }} /> Refresh
            </button>
          </div>
        </div>

        {/* Trial Balance */}
        <div style={card}>
          <div style={eyebrow}>Trial Balance</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            {(["HTG", "USDC"] as const).map((cur) => {
              const list = byCurrency(cur);
              const t = totals(cur);
              return (
                <div key={cur}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))", marginBottom: 8 }}>
                    {cur} accounts
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: "hsl(var(--theo-mid))", textAlign: "right" }}>
                        <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600 }}>Account</th>
                        <th style={{ padding: "6px 8px", fontWeight: 600 }}>Debit</th>
                        <th style={{ padding: "6px 8px", fontWeight: 600 }}>Credit</th>
                        <th style={{ padding: "6px 8px", fontWeight: 600 }}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => {
                        const bal = r.account.type === "LIABILITY" || r.account.type === "REVENUE" || r.account.type === "EQUITY"
                          ? r.credit - r.debit
                          : r.debit - r.credit;
                        return (
                          <tr key={r.account.id} style={{ borderTop: "1px solid hsl(var(--theo-light))" }}>
                            <td style={{ padding: "6px 8px" }}>
                              <div style={{ fontWeight: 600, color: "hsl(var(--theo-ink))" }}>{r.account.name}</div>
                              <div style={{ fontSize: 10, color: "hsl(var(--theo-mid))", textTransform: "uppercase", letterSpacing: "0.08em" }}>{r.account.type}</div>
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(r.debit, cur)}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(r.credit, cur)}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(bal, cur)}</td>
                          </tr>
                        );
                      })}
                      <tr style={{
                        borderTop: "2px solid hsl(var(--theo-ink))",
                        background: t.balanced ? "hsl(var(--theo-gold) / 0.15)" : "rgba(220,38,38,0.08)",
                      }}>
                        <td style={{ padding: "8px", fontWeight: 700 }}>Totals</td>
                        <td style={{ padding: "8px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(t.d, cur)}</td>
                        <td style={{ padding: "8px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(t.c, cur)}</td>
                        <td style={{ padding: "8px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                          {t.balanced ? "Balanced ✓" : fmt(t.d - t.c, cur)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>

        {/* Reconciliation */}
        <div style={card}>
          <div style={eyebrow}>Reconciliation — Distributor USDC</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 8 }}>
            <ReconCell label="Book balance" value={`${fmt(distBook, "USDC")} USDC`} />
            <ReconCell label="Chain balance (Horizon)" value={distChain === null ? "—" : `${fmt(distChain, "USDC")} USDC`} />
            <ReconCell
              label="Delta (chain − book)"
              value={distDelta === null ? "—" : `${fmt(distDelta, "USDC")} USDC`}
              warn={distDelta !== null && Math.abs(distDelta) > 1e-7}
            />
          </div>
          <p style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginTop: 12 }}>
            The distributor wallet reconciles in real time against Horizon. Any drift here indicates a ledger posting failure — check the Posting Failures panel below.
          </p>
        </div>

        {/* SPIH Pool */}
        <div style={card}>
          <div style={eyebrow}>SPIH Segregated Pool</div>
          <p style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 0, marginBottom: 16 }}>
            Real-time HTG pool balance. Increases automatically on every HTG→USDC deposit;
            decreases on every USDC→HTG payout and HTG-C withdrawal.
            No manual entries required.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            <ReconCell
              label="Pool balance (book)"
              value={`${spihPoolHtg.toLocaleString("en-US", { maximumFractionDigits: 0 })} HTG`}
              warn={spihPoolHtg < 0}
            />
            <ReconCell
              label="Total deposits"
              value={spihAgg ? `${spihAgg.debit.toLocaleString("en-US", { maximumFractionDigits: 0 })} HTG` : "—"}
            />
            <ReconCell
              label="Total outflows"
              value={spihAgg ? `${spihAgg.credit.toLocaleString("en-US", { maximumFractionDigits: 0 })} HTG` : "—"}
            />
          </div>
        </div>

        {/* Transactions */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={eyebrow}>
                Transactions ({filteredTxs.length === 0 ? "0" : `${pageStart + 1}–${Math.min(pageStart + pageSize, filteredTxs.length)} of ${filteredTxs.length}`})
              </div>
              {filterCustomer && (
                <span style={{
                  fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-blue))",
                  background: "hsl(var(--theo-blue-soft))", padding: "2px 10px", borderRadius: 10,
                  border: "1px solid hsl(var(--theo-blue) / 0.2)",
                  cursor: "pointer",
                }}
                  onClick={() => setFilterCustomer("")}
                  title="Clear customer filter"
                >
                  {customers.find((c) => c.id === filterCustomer)?.company_name ?? filterCustomer.slice(0, 8)} ✕
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select
                value={filterCustomer}
                onChange={(e) => setFilterCustomer(e.target.value)}
                style={{ ...inputStyle, color: filterCustomer ? "hsl(var(--theo-ink))" : "hsl(var(--theo-mid))" }}
              >
                <option value="">All customers…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </select>
              <input
                placeholder="Filter by kind…"
                value={filterKind}
                onChange={(e) => setFilterKind(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder="Filter by order id…"
                value={filterOrder}
                onChange={(e) => setFilterOrder(e.target.value)}
                style={inputStyle}
              />
              <input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                title="From date"
                style={{ ...inputStyle, color: filterFrom ? "hsl(var(--theo-ink))" : "hsl(var(--theo-mid))" }}
              />
              <input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                title="To date"
                style={{ ...inputStyle, color: filterTo ? "hsl(var(--theo-ink))" : "hsl(var(--theo-mid))" }}
              />
              {(filterFrom || filterTo) && (
                <button
                  onClick={() => { setFilterFrom(""); setFilterTo(""); }}
                  style={{
                    fontSize: 12, padding: "6px 10px", borderRadius: 8,
                    border: "1px solid hsl(var(--theo-light))", background: "#fff",
                    cursor: "pointer", color: "hsl(var(--theo-mid))", fontFamily: "inherit",
                  }}
                >
                  Clear dates
                </button>
              )}
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "hsl(var(--theo-mid))" }}>
                <th style={{ padding: "6px 8px", textAlign: "left", width: 24 }}></th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>When</th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>Kind</th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>Order</th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>Description</th>
                <th style={{ padding: "6px 8px", textAlign: "center", fontWeight: 600, width: 80 }}>On-chain</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTxs.map((t) => {
                const isOpen = expanded.has(t.id);
                const txEntries = entries.filter((e) => e.transaction_id === t.id);
                return (
                  <Fragment key={t.id}>
                    <tr
                      style={{ borderTop: "1px solid hsl(var(--theo-light))", cursor: "pointer" }}
                      onClick={() => {
                        const next = new Set(expanded);
                        if (isOpen) next.delete(t.id); else next.add(t.id);
                        setExpanded(next);
                      }}
                    >
                      <td style={{ padding: "8px" }}>
                        {isOpen ? <ChevronDown style={{ width: 12, height: 12 }} /> : <ChevronRight style={{ width: 12, height: 12 }} />}
                      </td>
                      <td style={{ padding: "8px", color: "hsl(var(--theo-mid))" }}>
                        {new Date(t.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td style={{ padding: "8px", fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{t.kind}</td>
                      <td style={{ padding: "8px", fontFamily: "monospace", fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                        {t.order_id ? t.order_id.slice(0, 8) + "…" : "—"}
                      </td>
                      <td style={{ padding: "8px", color: "hsl(var(--theo-ink))" }}>{t.description ?? ""}</td>
                      <td style={{ padding: "8px", textAlign: "center" }}>
                        {t.stellar_tx_hash ? (
                          <a
                            href={`https://stellar.expert/explorer/testnet/tx/${t.stellar_tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(ev) => ev.stopPropagation()}
                            title={t.stellar_tx_hash}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: 11, fontWeight: 600,
                              color: "hsl(var(--theo-cyan))",
                              textDecoration: "none",
                              padding: "3px 7px", borderRadius: 6,
                              border: "1px solid hsl(var(--theo-cyan) / 0.35)",
                              background: "hsl(var(--theo-cyan) / 0.07)",
                            }}
                          >
                            <ExternalLink style={{ width: 10, height: 10 }} />
                            View
                          </a>
                        ) : (
                          <span style={{ color: "hsl(var(--theo-light))", fontSize: 11 }}>—</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr style={{ background: "hsl(var(--theo-cream))" }}>
                        <td colSpan={6} style={{ padding: 12 }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                            <thead>
                              <tr style={{ color: "hsl(var(--theo-mid))" }}>
                                <th style={{ padding: 4, textAlign: "left", fontWeight: 600 }}>Account</th>
                                <th style={{ padding: 4, textAlign: "left", fontWeight: 600 }}>Cur</th>
                                <th style={{ padding: 4, textAlign: "right", fontWeight: 600 }}>Debit</th>
                                <th style={{ padding: 4, textAlign: "right", fontWeight: 600 }}>Credit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {txEntries.map((e) => {
                                const acc = accounts.find((a) => a.id === e.account_id);
                                const cust = e.customer_id ? customers.find((c) => c.id === e.customer_id) : null;
                                return (
                                  <tr key={e.id}>
                                    <td style={{ padding: 4 }}>
                                      <span>{acc?.name ?? e.account_id}</span>
                                      {cust && (
                                        <span style={{
                                          marginLeft: 6, fontSize: 10, fontWeight: 600,
                                          color: "hsl(var(--theo-blue))",
                                          background: "hsl(var(--theo-blue-soft))",
                                          padding: "1px 6px", borderRadius: 8,
                                          border: "1px solid hsl(var(--theo-blue) / 0.2)",
                                        }}>
                                          {cust.company_name}
                                        </span>
                                      )}
                                    </td>
                                    <td style={{ padding: 4 }}>{e.currency}</td>
                                    <td style={{ padding: 4, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                      {Number(e.debit) > 0 ? fmt(Number(e.debit), e.currency) : ""}
                                    </td>
                                    <td style={{ padding: 4, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                      {Number(e.credit) > 0 ? fmt(Number(e.credit), e.currency) : ""}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filteredTxs.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "hsl(var(--theo-mid))" }}>
                  No ledger transactions yet. Run an order through SPIH simulation to post the first entries.
                </td></tr>
              )}
            </tbody>
          </table>

          {/* Pagination controls */}
          {filteredTxs.length > 0 && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginTop: 14, paddingTop: 12, borderTop: "1px solid hsl(var(--theo-light))",
            }}>
              <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                Page {currentPage} of {totalPages}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                    border: "1px solid hsl(var(--theo-light))", background: "#fff",
                    color: currentPage === 1 ? "hsl(var(--theo-light))" : "hsl(var(--theo-ink))",
                    cursor: currentPage === 1 ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <ChevronLeft style={{ width: 13, height: 13 }} /> Prev
                </button>

                {/* Page number pills */}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                  .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && (arr[idx - 1] as number) < p - 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, idx) =>
                    p === "…" ? (
                      <span key={`ellipsis-${idx}`} style={{ padding: "5px 6px", fontSize: 12, color: "hsl(var(--theo-mid))" }}>…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p as number)}
                        style={{
                          padding: "5px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                          border: "1px solid",
                          borderColor: currentPage === p ? "hsl(var(--theo-blue))" : "hsl(var(--theo-light))",
                          background: currentPage === p ? "hsl(var(--theo-blue))" : "#fff",
                          color: currentPage === p ? "#fff" : "hsl(var(--theo-ink))",
                          cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        {p}
                      </button>
                    )
                  )}

                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                    border: "1px solid hsl(var(--theo-light))", background: "#fff",
                    color: currentPage === totalPages ? "hsl(var(--theo-light))" : "hsl(var(--theo-ink))",
                    cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Next <ChevronRight style={{ width: 13, height: 13 }} />
                </button>

                <div style={{ width: 1, height: 20, background: "hsl(var(--theo-light))", margin: "0 4px" }} />

                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value) as 20 | 50); setCurrentPage(1); }}
                  style={{ ...inputStyle, color: "hsl(var(--theo-ink))", minWidth: 84 }}
                  title="Rows per page"
                >
                  <option value={20}>20 / page</option>
                  <option value={50}>50 / page</option>
                </select>
              </div>
            </div>
          )}
        </div>
        {/* Posting Failures */}
        <div style={{ ...card, borderColor: failures.length > 0 ? "rgba(220,38,38,0.3)" : "hsl(var(--theo-light))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            {failures.length > 0 && <AlertTriangle style={{ width: 14, height: 14, color: "#dc2626" }} />}
            <div style={{ ...eyebrow, color: failures.length > 0 ? "#dc2626" : "hsl(var(--theo-cyan))" }}>
              Posting Failures ({failures.length})
            </div>
          </div>
          {failures.length === 0 ? (
            <p style={{ fontSize: 13, color: "hsl(var(--theo-mid))", margin: 0 }}>
              No unresolved posting failures. All ledger entries posted successfully.
            </p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: "hsl(var(--theo-mid))" }}>
                  <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>When</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>Source</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>Error</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>Order</th>
                  <th style={{ padding: "6px 8px", textAlign: "center", fontWeight: 600, width: 90 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr key={f.id} style={{ borderTop: "1px solid hsl(var(--theo-light))" }}>
                    <td style={{ padding: "8px", color: "hsl(var(--theo-mid))", whiteSpace: "nowrap" }}>
                      {new Date(f.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td style={{ padding: "8px", fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{f.source}</td>
                    <td style={{ padding: "8px", color: "#dc2626", maxWidth: 400 }}>
                      <div style={{ fontFamily: "monospace", fontSize: 11, lineHeight: 1.4 }}>{f.reason}</div>
                      {retryError[f.id] && (
                        <div style={{ marginTop: 4, color: "#dc2626", fontStyle: "italic" }}>
                          Retry failed: {retryError[f.id]}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px", fontFamily: "monospace", fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                      {f.order_id ? f.order_id.slice(0, 8) + "…" : "—"}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <button
                        onClick={() => handleRetry(f.id)}
                        disabled={retryingId === f.id}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          fontSize: 11, fontWeight: 600,
                          color: retryingId === f.id ? "hsl(var(--theo-mid))" : "hsl(var(--theo-blue))",
                          background: "hsl(var(--theo-blue-soft))",
                          border: "1px solid hsl(var(--theo-blue) / 0.25)",
                          borderRadius: 6, padding: "4px 10px",
                          cursor: retryingId === f.id ? "wait" : "pointer",
                        }}
                      >
                        <RotateCcw style={{ width: 10, height: 10 }} />
                        {retryingId === f.id ? "Retrying…" : "Retry"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function ReconCell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ padding: 14, borderRadius: 12, background: "hsl(var(--theo-cream))" }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums", color: warn ? "#dc2626" : "hsl(var(--theo-ink))" }}>
        {value}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 12, padding: "6px 10px", borderRadius: 8,
  border: "1px solid hsl(var(--theo-light))", background: "#fff",
  fontFamily: "inherit", outline: "none",
};
