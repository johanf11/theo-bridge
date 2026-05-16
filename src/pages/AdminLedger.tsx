import { useEffect, useState, useCallback, useRef } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import {
  RefreshCw, Download, ChevronRight, AlertTriangle, CheckCircle2,
  X, ChevronLeft, RotateCcw, BookOpen,
} from "lucide-react";
import { toast } from "sonner";

// ── Palette ────────────────────────────────────────────────────────────────────
const N   = "hsl(var(--theo-blue))";
const MID = "hsl(var(--theo-mid))";
const LT  = "hsl(var(--theo-light))";
const INK = "hsl(var(--theo-ink))";
const CR  = "hsl(var(--theo-cream))";
const SFT = "hsl(var(--theo-blue-soft))";
const MONO = "'JetBrains Mono', 'Fira Code', monospace";

// ── Stellar / Horizon ──────────────────────────────────────────────────────────
const HORIZON_URL      = "https://horizon-testnet.stellar.org";
const HTGC_ISSUER      = "GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT";
const DISTRIBUTOR_ADDR = "GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X";
const TREASURY_ADDR    = "GAO2RZ2T67Z5HJKQHWJXR6TSGEOEOWAAHJBT76DZBAV4W3YUETGMZZMA";

type HorizonBalance = { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string };

function fmtN(n: number, dp = 2) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── On-chain helpers ───────────────────────────────────────────────────────────
async function fetchUsdcBalance(address: string, usdcIssuer: string): Promise<number> {
  try {
    const r = await fetch(`${HORIZON_URL}/accounts/${address}`);
    if (!r.ok) return 0;
    const j = await r.json() as { balances: HorizonBalance[] };
    const b = j.balances.find(b => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer);
    return b ? Number(b.balance) : 0;
  } catch { return 0; }
}
async function fetchHtgcSupply(): Promise<number> {
  try {
    const r = await fetch(`${HORIZON_URL}/assets?asset_code=HTGC&asset_issuer=${HTGC_ISSUER}&limit=1`);
    const j = await r.json() as { _embedded?: { records?: Array<{ amount?: string }> } };
    return Number(j._embedded?.records?.[0]?.amount ?? 0);
  } catch { return 0; }
}

// ── Types ──────────────────────────────────────────────────────────────────────
type LedgerAccount = { id: string; code: string; currency: string; balance: number; customer_id: string | null };
type LedgerTx = {
  id: string;
  source_key: string;
  description: string;
  posted_by: string | null;
  created_at: string;
  entries: Array<{ id: string; account_id: string; account_code: string; amount: number; side: string; currency: string }>;
};
type FailureRow = { id: string; source_key: string; error: string; created_at: string };
type Customer = { id: string; company_name: string };

// ── Panel ──────────────────────────────────────────────────────────────────────
function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 12, border: `1px solid ${LT}`,
      padding: "20px 24px", ...style,
    }}>
      {children}
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: N, marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.08em" }}>
      {children}
    </div>
  );
}

function Badge({ ok }: { ok: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: ok ? "#EFFBF3" : "#FEF2F2",
      color: ok ? "#1A7F37" : "#B91C1C",
    }}>
      {ok
        ? <CheckCircle2 style={{ width: 10, height: 10 }} />
        : <AlertTriangle style={{ width: 10, height: 10 }} />}
      {ok ? "OK" : "DRIFT"}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminLedger() {
  // ── Supabase USDC issuer (needed for Horizon lookups) ─────────────────────
  const usdcIssuer = import.meta.env.VITE_STELLAR_USDC_ISSUER ?? "";

  // ── A. Reconciliation state ───────────────────────────────────────────────
  type ReconRow = {
    code: string; label: string; currency: string;
    book: number; onChain: number | null; drift: number | null;
  };
  const [reconRows, setReconRows] = useState<ReconRow[]>([]);
  const [reconLoading, setReconLoading] = useState(false);

  const loadRecon = useCallback(async () => {
    setReconLoading(true);
    try {
      const { data: accounts } = await supabase
        .from("ledger_accounts")
        .select("code, currency, balance")
        .in("code", ["DISTRIBUTOR_USDC", "TREASURY_USDC", "BLEND_DEPOSITS_USDC", "HTGC_ISSUED"])
        .is("customer_id", null);

      const bookMap: Record<string, { currency: string; balance: number }> = {};
      for (const a of accounts ?? []) {
        bookMap[(a as { code: string; currency: string; balance: number }).code] = {
          currency: (a as { currency: string }).currency,
          balance:  Number((a as { balance: string }).balance),
        };
      }

      const [distOnChain, treasOnChain, htgcOnChain] = await Promise.all([
        fetchUsdcBalance(DISTRIBUTOR_ADDR, usdcIssuer),
        fetchUsdcBalance(TREASURY_ADDR, usdcIssuer),
        fetchHtgcSupply(),
      ]);

      const rows: ReconRow[] = [
        {
          code: "DISTRIBUTOR_USDC", label: "Distributor USDC", currency: "USDC",
          book: bookMap["DISTRIBUTOR_USDC"]?.balance ?? 0,
          onChain: distOnChain,
          drift: distOnChain - (bookMap["DISTRIBUTOR_USDC"]?.balance ?? 0),
        },
        {
          code: "TREASURY_USDC", label: "Treasury USDC", currency: "USDC",
          book: bookMap["TREASURY_USDC"]?.balance ?? 0,
          onChain: treasOnChain,
          drift: treasOnChain - (bookMap["TREASURY_USDC"]?.balance ?? 0),
        },
        {
          code: "BLEND_DEPOSITS_USDC", label: "Blend Deposits", currency: "USDC",
          book: bookMap["BLEND_DEPOSITS_USDC"]?.balance ?? 0,
          onChain: null, // Blend positions tracked off-chain
          drift: null,
        },
        {
          code: "HTGC_ISSUED", label: "HTG-C Issued", currency: "HTG",
          book: bookMap["HTGC_ISSUED"]?.balance ?? 0,
          onChain: htgcOnChain,
          drift: htgcOnChain - (bookMap["HTGC_ISSUED"]?.balance ?? 0),
        },
      ];
      setReconRows(rows);
    } finally {
      setReconLoading(false);
    }
  }, [usdcIssuer]);

  useEffect(() => { loadRecon(); }, [loadRecon]);

  // ── B. Transaction history state ───────────────────────────────────────────
  const [txns, setTxns] = useState<LedgerTx[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE = 50;
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterCode, setFilterCode] = useState("");
  const [accountCodes, setAccountCodes] = useState<string[]>([]);

  const loadAccountCodes = useCallback(async () => {
    const { data } = await supabase.from("chart_of_accounts").select("id").order("id");
    setAccountCodes((data ?? []).map((r: { id: string }) => r.id));
  }, []);

  const loadTxns = useCallback(async () => {
    setTxLoading(true);
    try {
      let q = supabase
        .from("ledger_transactions")
        .select(`id, source_key, description, posted_by, created_at,
          ledger_entries(id, account_id, amount, side, currency,
            ledger_accounts(code))`)
        .order("created_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);

      if (filterFrom) q = q.gte("created_at", filterFrom);
      if (filterTo)   q = q.lte("created_at", filterTo + "T23:59:59");

      const { data } = await q;
      const rows: LedgerTx[] = (data ?? []).map((tx: Record<string, unknown>) => ({
        id:          tx.id as string,
        source_key:  tx.source_key as string,
        description: tx.description as string,
        posted_by:   tx.posted_by as string | null,
        created_at:  tx.created_at as string,
        entries: ((tx.ledger_entries as Record<string, unknown>[]) ?? [])
          .filter(e => !filterCode || (e.ledger_accounts as { code: string } | null)?.code === filterCode)
          .map(e => ({
            id:           e.id as string,
            account_id:   e.account_id as string,
            account_code: (e.ledger_accounts as { code: string } | null)?.code ?? "",
            amount:       Number(e.amount),
            side:         e.side as string,
            currency:     e.currency as string,
          })),
      }));
      setTxns(filterCode ? rows.filter(t => t.entries.length > 0) : rows);
    } finally {
      setTxLoading(false);
    }
  }, [page, filterFrom, filterTo, filterCode]);

  useEffect(() => { loadAccountCodes(); }, [loadAccountCodes]);
  useEffect(() => { loadTxns(); }, [loadTxns]);

  // CSV export
  const handleExportCsv = async () => {
    // Fetch all matching (respects filters, no pagination)
    let q = supabase
      .from("ledger_transactions")
      .select(`id, source_key, description, created_at,
        ledger_entries(account_id, amount, side, currency, ledger_accounts(code))`)
      .order("created_at", { ascending: false });
    if (filterFrom) q = q.gte("created_at", filterFrom);
    if (filterTo)   q = q.lte("created_at", filterTo + "T23:59:59");

    const { data } = await q;
    if (!data?.length) { toast.error("No transactions to export"); return; }

    const lines: string[] = ["date,source_key,description,account_code,side,amount,currency"];
    for (const tx of data as Record<string, unknown>[]) {
      for (const e of (tx.ledger_entries as Record<string, unknown>[]) ?? []) {
        const code = (e.ledger_accounts as { code: string } | null)?.code ?? "";
        if (filterCode && code !== filterCode) continue;
        lines.push([
          (tx.created_at as string).slice(0, 19),
          `"${tx.source_key}"`,
          `"${tx.description}"`,
          code,
          e.side,
          e.amount,
          e.currency,
        ].join(","));
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `ledger-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── C. Per-customer trial balance drawer ───────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [custAccount, setCustAccount] = useState<LedgerAccount | null>(null);
  const [custEntries, setCustEntries] = useState<LedgerTx["entries"]>([]);

  useEffect(() => {
    supabase.from("customers").select("id, company_name").order("company_name")
      .then(({ data }) => setCustomers((data ?? []) as Customer[]));
  }, []);

  const openDrawer = useCallback(async (c: Customer) => {
    setSelectedCustomer(c);
    setDrawerOpen(true);
    setCustAccount(null);
    setCustEntries([]);

    const { data: acct } = await supabase
      .from("ledger_accounts")
      .select("id, code, currency, balance, customer_id")
      .eq("code", "CUSTOMER_USDC")
      .eq("customer_id", c.id)
      .maybeSingle();
    if (!acct) return;
    setCustAccount(acct as LedgerAccount);

    const { data: entries } = await supabase
      .from("ledger_entries")
      .select("id, account_id, amount, side, currency, transaction_id, ledger_accounts(code)")
      .eq("account_id", (acct as { id: string }).id)
      .order("created_at", { ascending: false })
      .limit(100);
    setCustEntries(((entries ?? []) as Record<string, unknown>[]).map(e => ({
      id:           e.id as string,
      account_id:   e.account_id as string,
      account_code: (e.ledger_accounts as { code: string } | null)?.code ?? "",
      amount:       Number(e.amount),
      side:         e.side as string,
      currency:     e.currency as string,
    })));
  }, []);

  // ── D. Posting failures ────────────────────────────────────────────────────
  const [failures, setFailures] = useState<FailureRow[]>([]);
  const [failuresLoading, setFailuresLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const loadFailures = useCallback(async () => {
    setFailuresLoading(true);
    const { data } = await supabase
      .from("ledger_posting_failures")
      .select("id, source_key, error, created_at")
      .order("created_at", { ascending: false });
    setFailures((data ?? []) as FailureRow[]);
    setFailuresLoading(false);
  }, []);

  useEffect(() => { loadFailures(); }, [loadFailures]);

  const handleRetry = async (failure: FailureRow) => {
    setRetryingId(failure.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/replay-ledger-failure`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ failure_id: failure.id }),
        },
      );
      const j = await res.json();
      if (j.ok) {
        toast.success("Retry succeeded");
        setFailures(prev => prev.filter(f => f.id !== failure.id));
      } else {
        toast.error(`Retry failed: ${j.error}`);
      }
    } catch (e) {
      toast.error(`Retry error: ${(e as Error).message}`);
    } finally {
      setRetryingId(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const TH: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: MID, textTransform: "uppercase",
    letterSpacing: "0.08em", padding: "8px 12px", textAlign: "left",
    borderBottom: `1px solid ${LT}`, background: CR, whiteSpace: "nowrap",
  };
  const TD: React.CSSProperties = { fontSize: 13, padding: "10px 12px", borderBottom: `1px solid ${LT}`, color: INK };

  return (
    <AppLayout>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <BookOpen style={{ width: 20, height: 20, color: N }} />
          <h1 style={{ fontSize: 24, fontWeight: 800, color: N, letterSpacing: "-0.5px" }}>
            Ledger
          </h1>
        </div>
        <p style={{ fontSize: 13, color: MID }}>Double-entry journal, reconciliation, and posting health.</p>
        <div style={{ height: 3, width: 36, background: "hsl(var(--theo-gold))", marginTop: 8 }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── A. Reconciliation ──────────────────────────────────────────── */}
        <Panel>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <PanelTitle>Reconciliation</PanelTitle>
            <button
              onClick={loadRecon}
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: N, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}
            >
              <RefreshCw style={{ width: 13, height: 13, ...(reconLoading ? { animation: "spin 1s linear infinite" } : {}) }} />
              Refresh
            </button>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Account", "Book Balance", "On-Chain Balance", "Drift", "Status"].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reconRows.map(r => {
                  const driftOk = r.drift === null || Math.abs(r.drift) < 0.01;
                  return (
                    <tr key={r.code}>
                      <td style={TD}>
                        <div style={{ fontWeight: 700, fontFamily: MONO, fontSize: 12 }}>{r.code}</div>
                        <div style={{ fontSize: 11, color: MID }}>{r.currency}</div>
                      </td>
                      <td style={{ ...TD, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                        {fmtN(r.book, r.currency === "HTG" ? 0 : 2)}
                      </td>
                      <td style={{ ...TD, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                        {r.onChain === null ? <span style={{ color: MID }}>—</span> : fmtN(r.onChain, r.currency === "HTG" ? 0 : 2)}
                      </td>
                      <td style={{ ...TD, fontFamily: MONO, fontVariantNumeric: "tabular-nums", color: driftOk ? INK : "#B91C1C" }}>
                        {r.drift === null ? <span style={{ color: MID }}>—</span> : (r.drift >= 0 ? "+" : "") + fmtN(r.drift, 4)}
                      </td>
                      <td style={TD}><Badge ok={driftOk} /></td>
                    </tr>
                  );
                })}
                {reconRows.length === 0 && (
                  <tr><td colSpan={5} style={{ ...TD, color: MID, textAlign: "center", padding: 24 }}>No data — run backfill first</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* ── B. Transaction history ─────────────────────────────────────── */}
        <Panel>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <PanelTitle>Transaction History</PanelTitle>
            <button
              onClick={handleExportCsv}
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: N, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}
            >
              <Download style={{ width: 13, height: 13 }} /> Export CSV
            </button>
          </div>

          {/* Filters */}
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: MID }}>From</label>
              <input type="date" value={filterFrom} onChange={e => { setFilterFrom(e.target.value); setPage(0); }}
                style={{ fontSize: 12, padding: "5px 8px", border: `1px solid ${LT}`, borderRadius: 6, color: INK }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: MID }}>To</label>
              <input type="date" value={filterTo} onChange={e => { setFilterTo(e.target.value); setPage(0); }}
                style={{ fontSize: 12, padding: "5px 8px", border: `1px solid ${LT}`, borderRadius: 6, color: INK }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: MID }}>Account</label>
              <select value={filterCode} onChange={e => { setFilterCode(e.target.value); setPage(0); }}
                style={{ fontSize: 12, padding: "5px 8px", border: `1px solid ${LT}`, borderRadius: 6, color: INK, background: "#fff" }}>
                <option value="">All accounts</option>
                {accountCodes.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {(filterFrom || filterTo || filterCode) && (
              <button
                onClick={() => { setFilterFrom(""); setFilterTo(""); setFilterCode(""); setPage(0); }}
                style={{ alignSelf: "flex-end", fontSize: 12, color: MID, background: "none", border: "none", cursor: "pointer", padding: "5px 0" }}
              >
                Clear filters
              </button>
            )}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Date", "Description", "Source Key", "Account", "Side", "Amount", "Currency"].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txLoading ? (
                  <tr><td colSpan={7} style={{ ...TD, color: MID, textAlign: "center", padding: 24 }}>Loading…</td></tr>
                ) : txns.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...TD, color: MID, textAlign: "center", padding: 24 }}>No transactions</td></tr>
                ) : txns.flatMap(tx =>
                  tx.entries.map((e, i) => (
                    <tr key={e.id} style={{ background: i % 2 === 0 ? "#fff" : CR }}>
                      <td style={{ ...TD, fontSize: 11, color: MID, whiteSpace: "nowrap" }}>{i === 0 ? fmtDate(tx.created_at) : ""}</td>
                      <td style={{ ...TD, fontSize: 12 }}>{i === 0 ? tx.description : ""}</td>
                      <td style={{ ...TD, fontFamily: MONO, fontSize: 10, color: MID }}>{i === 0 ? tx.source_key : ""}</td>
                      <td style={{ ...TD, fontFamily: MONO, fontSize: 11 }}>{e.account_code}</td>
                      <td style={{ ...TD, fontWeight: 700, color: e.side === "DEBIT" ? "#1A7F37" : N }}>{e.side}</td>
                      <td style={{ ...TD, fontFamily: MONO, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                        {fmtN(e.amount, e.currency === "HTG" ? 0 : 2)}
                      </td>
                      <td style={{ ...TD, color: MID, fontSize: 11 }}>{e.currency}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: page === 0 ? MID : N, background: "none", border: "none", cursor: page === 0 ? "default" : "pointer" }}
            >
              <ChevronLeft style={{ width: 14, height: 14 }} /> Prev
            </button>
            <span style={{ fontSize: 12, color: MID }}>Page {page + 1}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={txns.length < PAGE}
              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: txns.length < PAGE ? MID : N, background: "none", border: "none", cursor: txns.length < PAGE ? "default" : "pointer" }}
            >
              Next <ChevronRight style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </Panel>

        {/* ── C. Per-customer trial balance ──────────────────────────────── */}
        <Panel>
          <PanelTitle>Customer Trial Balance</PanelTitle>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <select
              onChange={e => {
                const c = customers.find(x => x.id === e.target.value);
                if (c) openDrawer(c);
              }}
              value={selectedCustomer?.id ?? ""}
              style={{ fontSize: 13, padding: "7px 10px", border: `1px solid ${LT}`, borderRadius: 8, color: INK, background: "#fff", minWidth: 240 }}
            >
              <option value="">Select a customer…</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
            {selectedCustomer && (
              <button
                onClick={() => setDrawerOpen(true)}
                style={{ fontSize: 12, color: N, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}
              >
                Open →
              </button>
            )}
          </div>
        </Panel>

        {/* ── D. Posting failures ────────────────────────────────────────── */}
        <Panel>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <PanelTitle>Posting Failures</PanelTitle>
            <button
              onClick={loadFailures}
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: N, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}
            >
              <RefreshCw style={{ width: 13, height: 13, ...(failuresLoading ? { animation: "spin 1s linear infinite" } : {}) }} />
              Refresh
            </button>
          </div>

          {failures.length === 0 ? (
            <div style={{ fontSize: 13, color: MID, display: "flex", alignItems: "center", gap: 6 }}>
              <CheckCircle2 style={{ width: 14, height: 14, color: "#1A7F37" }} /> No posting failures
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Date", "Source Key", "Error", ""].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {failures.map(f => (
                    <tr key={f.id}>
                      <td style={{ ...TD, fontSize: 11, color: MID, whiteSpace: "nowrap" }}>{fmtDate(f.created_at)}</td>
                      <td style={{ ...TD, fontFamily: MONO, fontSize: 11 }}>{f.source_key}</td>
                      <td style={{ ...TD, fontSize: 12, color: "#B91C1C", maxWidth: 340 }}>{f.error}</td>
                      <td style={TD}>
                        <button
                          onClick={() => handleRetry(f)}
                          disabled={retryingId === f.id}
                          style={{
                            display: "flex", alignItems: "center", gap: 5, fontSize: 12,
                            color: "#fff", background: N, border: "none", borderRadius: 6,
                            padding: "4px 10px", cursor: retryingId === f.id ? "default" : "pointer",
                            opacity: retryingId === f.id ? 0.6 : 1, fontWeight: 600,
                          }}
                        >
                          <RotateCcw style={{ width: 11, height: 11 }} />
                          {retryingId === f.id ? "Retrying…" : "Retry"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

      </div>

      {/* ── Customer drawer ──────────────────────────────────────────────── */}
      {drawerOpen && selectedCustomer && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setDrawerOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(26,26,46,0.4)", zIndex: 40 }}
          />
          {/* Drawer */}
          <div style={{
            position: "fixed", top: 0, right: 0, bottom: 0, width: 480,
            background: "#fff", zIndex: 50, boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
            display: "flex", flexDirection: "column", overflowY: "auto",
          }}>
            {/* Drawer header */}
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${LT}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: N }}>{selectedCustomer.company_name}</div>
                <div style={{ fontSize: 11, color: MID, marginTop: 2 }}>CUSTOMER_USDC sub-account</div>
              </div>
              <button onClick={() => setDrawerOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: MID }}>
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            {/* Balance summary */}
            <div style={{ padding: "16px 24px", borderBottom: `1px solid ${LT}`, background: SFT }}>
              {custAccount ? (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: MID, textTransform: "uppercase", letterSpacing: "0.08em" }}>Book Balance</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: N, letterSpacing: "-1px", marginTop: 4, fontFamily: MONO }}>
                    ${fmtN(custAccount.balance)}
                    <span style={{ fontSize: 13, fontWeight: 600, color: MID, marginLeft: 6 }}>USDC</span>
                  </div>
                </div>
              ) : (
                <div style={{ color: MID, fontSize: 13 }}>No ledger account yet for this customer.</div>
              )}
            </div>

            {/* Entries list */}
            <div style={{ padding: "16px 24px", flex: 1, overflowY: "auto" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: MID, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Recent Entries
              </div>
              {custEntries.length === 0 ? (
                <div style={{ fontSize: 13, color: MID }}>No entries found.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {custEntries.map(e => (
                    <div key={e.id} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 12px", borderRadius: 8, background: CR, border: `1px solid ${LT}`,
                    }}>
                      <div style={{ fontSize: 12, color: MID }}>{e.side}</div>
                      <div style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: e.side === "DEBIT" ? "#1A7F37" : N }}>
                        {e.side === "DEBIT" ? "+" : "-"}${fmtN(e.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </AppLayout>
  );
}
