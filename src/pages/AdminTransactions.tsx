import React, { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Activity, ArrowDownLeft, ArrowUpRight, RefreshCw, ExternalLink,
  Download, ChevronDown, ChevronRight, Repeat, Coins,
} from "lucide-react";

// ── Kind mapping ────────────────────────────────────────────────
type Direction = "in" | "out" | "internal";
type KindMeta = { label: string; direction: Direction; treasury?: boolean };

const KIND_META: Record<string, KindMeta> = {
  SPIH_CASH_IN:         { label: "HTG received",              direction: "in" },
  FX_CONVERSION:        { label: "HTG → USDC conversion",     direction: "internal" },
  USDC_PAYOUT:          { label: "USDC released to customer", direction: "out" },
  PAYOUT_USDC:          { label: "USDC payment sent",         direction: "out" },
  BLEND_DEPOSIT:        { label: "Yield deposit",             direction: "internal" },
  BLEND_WITHDRAW:       { label: "Yield withdraw",            direction: "internal" },
  HTGC_MINT:            { label: "HTG-C mint",                direction: "internal", treasury: true },
  HTGC_BURN:            { label: "HTG-C burn",                direction: "internal", treasury: true },
  DISTRIBUTOR_AUTO_MINT:{ label: "Distributor auto-mint",     direction: "internal", treasury: true },
  DISTRIBUTOR_TOPUP:    { label: "Distributor top-up",        direction: "internal", treasury: true },
  DISTRIBUTOR_REFUND:   { label: "Distributor refund",        direction: "internal", treasury: true },
};

function metaFor(kind: string): KindMeta {
  return KIND_META[kind] ?? { label: kind, direction: "internal", treasury: true };
}

// ── Types ───────────────────────────────────────────────────────
type Tx = {
  id: string;
  kind: string;
  description: string | null;
  order_id: string | null;
  stellar_tx_hash: string | null;
  created_at: string;
};
type Entry = {
  transaction_id: string;
  account_id: string;
  currency: "HTG" | "USDC";
  debit: number;
  credit: number;
  customer_id: string | null;
};
type Acct = { id: string; code: string; name: string };
type Order = {
  id: string;
  reference_number: string;
  htg_amount: number | null;
  usdc_amount: number | null;
  status: string;
  customer_id: string;
};
type Customer = { id: string; company_name: string; email: string };

type Row = {
  tx: Tx;
  entries: Entry[];
  order: Order | null;
  customer: Customer | null;
  htg: number;
  usdc: number;
  meta: KindMeta;
};

// ── Helpers ─────────────────────────────────────────────────────
function timeAgo(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function fmtHTG(n: number) {
  if (!n) return "—";
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} HTG`;
}
function fmtUSDC(n: number) {
  if (!n) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PAGE = 500;

export default function AdminTransactions() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // filters
  const [range, setRange] = useState<"24h" | "7d" | "30d" | "all">("30d");
  const [customerId, setCustomerId] = useState<string>("");
  const [kindLabel, setKindLabel] = useState<string>("");
  const [query, setQuery] = useState("");
  const [showTreasury, setShowTreasury] = useState(true);

  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);

  async function load(before?: string) {
    setLoading(true);
    try {
      let txQ = supabase
        .from("ledger_transactions")
        .select("id, kind, description, order_id, stellar_tx_hash, created_at")
        .order("created_at", { ascending: false })
        .limit(PAGE);
      if (before) txQ = txQ.lt("created_at", before);
      const { data: txs, error: txErr } = await txQ;
      if (txErr) throw txErr;

      const txList = (txs ?? []) as Tx[];
      if (txList.length < PAGE) setReachedEnd(true);

      const txIds = txList.map(t => t.id);
      const orderIds = Array.from(new Set(txList.map(t => t.order_id).filter(Boolean) as string[]));

      const [{ data: entries }, { data: orders }, { data: accts }] = await Promise.all([
        txIds.length
          ? supabase.from("ledger_entries")
              .select("transaction_id, account_id, currency, debit, credit, customer_id")
              .in("transaction_id", txIds)
          : Promise.resolve({ data: [] as Entry[] }),
        orderIds.length
          ? supabase.from("orders")
              .select("id, reference_number, htg_amount, usdc_amount, status, customer_id")
              .in("id", orderIds)
          : Promise.resolve({ data: [] as Order[] }),
        supabase.from("ledger_accounts").select("id, code, name"),
      ]);

      const entryList = (entries ?? []) as Entry[];
      const orderList = (orders ?? []) as Order[];
      const acctList = (accts ?? []) as Acct[];

      const customerIds = new Set<string>();
      entryList.forEach(e => { if (e.customer_id) customerIds.add(e.customer_id); });
      orderList.forEach(o => { if (o.customer_id) customerIds.add(o.customer_id); });

      const { data: customers } = customerIds.size
        ? await supabase.from("customers").select("id, company_name, email").in("id", Array.from(customerIds))
        : { data: [] as Customer[] };
      const customerList = (customers ?? []) as Customer[];
      const customerMap = new Map(customerList.map(c => [c.id, c]));
      const orderMap = new Map(orderList.map(o => [o.id, o]));
      const acctMap = new Map(acctList.map(a => [a.id, a]));
      // stash acct map on window-less ref via closure: attach to row via lookup later
      _acctCache = acctMap;

      const byTx = new Map<string, Entry[]>();
      entryList.forEach(e => {
        const arr = byTx.get(e.transaction_id) ?? [];
        arr.push(e);
        byTx.set(e.transaction_id, arr);
      });

      const newRows: Row[] = txList.map(tx => {
        const es = byTx.get(tx.id) ?? [];
        const order = tx.order_id ? orderMap.get(tx.order_id) ?? null : null;
        const entryCustomer = es.find(e => e.customer_id)?.customer_id ?? null;
        const cid = entryCustomer ?? order?.customer_id ?? null;
        const customer = cid ? customerMap.get(cid) ?? null : null;

        // Amount derivation: pick the gross HTG / USDC magnitude in the tx.
        // Use the larger of (sum debits, sum credits) per currency so it
        // represents the gross movement rather than a netted zero.
        const sums: Record<"HTG" | "USDC", { d: number; c: number }> = {
          HTG: { d: 0, c: 0 }, USDC: { d: 0, c: 0 },
        };
        es.forEach(e => {
          sums[e.currency].d += Number(e.debit);
          sums[e.currency].c += Number(e.credit);
        });
        const htg = Math.max(sums.HTG.d, sums.HTG.c);
        const usdc = Math.max(sums.USDC.d, sums.USDC.c);

        return { tx, entries: es, order, customer, htg, usdc, meta: metaFor(tx.kind) };
      });

      // ── Merge in raw blend_positions ───────────────────────────────
      // Some blend deposits were posted on-chain before the ledger entry
      // path tagged customer_id (or before ledger posting existed). Surface
      // them as synthetic rows so admins still see the activity.
      // Only added on the first page load (before === undefined) — avoids
      // duplicating them across paginated fetches.
      let blendRows: Row[] = [];
      if (!before) {
        const { data: positions } = await supabase
          .from("blend_positions")
          .select("id, customer_id, deposited_usdc, deposited_at, last_tx_hash")
          .order("deposited_at", { ascending: false });
        const posList = (positions ?? []) as Array<{
          id: string; customer_id: string; deposited_usdc: number;
          deposited_at: string; last_tx_hash: string | null;
        }>;
        const extraCustomerIds = posList
          .map(p => p.customer_id)
          .filter(cid => !customerMap.has(cid));
        if (extraCustomerIds.length) {
          const { data: extra } = await supabase
            .from("customers").select("id, company_name, email").in("id", extraCustomerIds);
          (extra ?? []).forEach((c: Customer) => {
            customerList.push(c);
            customerMap.set(c.id, c);
          });
        }
        const txHashes = new Set(txList.filter(t => t.kind === "BLEND_DEPOSIT").map(t => t.stellar_tx_hash));
        blendRows = posList
          .filter(p => !p.last_tx_hash || !txHashes.has(p.last_tx_hash))
          .map(p => ({
            tx: {
              id: `blend-pos:${p.id}`,
              kind: "BLEND_DEPOSIT",
              description: `Yield principal ${Number(p.deposited_usdc).toFixed(2)} USDC (from blend_positions)`,
              order_id: null,
              stellar_tx_hash: p.last_tx_hash,
              created_at: p.deposited_at,
            },
            entries: [],
            order: null,
            customer: customerMap.get(p.customer_id) ?? null,
            htg: 0,
            usdc: Number(p.deposited_usdc),
            meta: metaFor("BLEND_DEPOSIT"),
          }));
      }

      const merged = [...newRows, ...blendRows].sort(
        (a, b) => new Date(b.tx.created_at).getTime() - new Date(a.tx.created_at).getTime(),
      );
      setRows(prev => before ? [...prev, ...newRows] : merged);

      // Build the customer dropdown set
      const seen = new Map<string, Customer>(allCustomers.map(c => [c.id, c]));
      customerList.forEach(c => seen.set(c.id, c));
      setAllCustomers(Array.from(seen.values()).sort((a, b) => a.company_name.localeCompare(b.company_name)));
    } catch (e) {
      toast.error(`Failed to load transactions: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { setReachedEnd(false); load(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff =
      range === "24h" ? now - 86_400_000 :
      range === "7d"  ? now - 7  * 86_400_000 :
      range === "30d" ? now - 30 * 86_400_000 :
      0;
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (!showTreasury && r.meta.treasury) return false;
      if (cutoff && new Date(r.tx.created_at).getTime() < cutoff) return false;
      if (customerId && r.customer?.id !== customerId) return false;
      if (kindLabel && r.meta.label !== kindLabel) return false;
      if (q) {
        const hay = [
          r.order?.reference_number ?? "",
          r.tx.stellar_tx_hash ?? "",
          r.customer?.company_name ?? "",
          r.customer?.email ?? "",
          r.tx.kind,
          r.meta.label,
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, range, customerId, kindLabel, query, showTreasury]);

  const kindOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => {
      if (!showTreasury && r.meta.treasury) return;
      s.add(r.meta.label);
    });
    return Array.from(s).sort();
  }, [rows, showTreasury]);

  function exportCsv() {
    const header = [
      "time", "kind", "label", "direction", "customer", "email",
      "reference", "htg", "usdc", "stellar_tx_hash",
    ];
    const lines = [header.join(",")];
    filtered.forEach(r => {
      const cells = [
        new Date(r.tx.created_at).toISOString(),
        r.tx.kind,
        r.meta.label,
        r.meta.direction,
        r.customer?.company_name ?? "",
        r.customer?.email ?? "",
        r.order?.reference_number ?? "",
        r.htg ? r.htg.toFixed(0) : "",
        r.usdc ? r.usdc.toFixed(7) : "",
        r.tx.stellar_tx_hash ?? "",
      ].map(v => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `theo-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <AppLayout>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "hsl(var(--theo-cyan))" }}>
              Admin · Activity
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: "hsl(var(--theo-ink))", margin: "6px 0 2px" }}>
              Transactions log
            </h1>
            <p style={{ fontSize: 13, color: "hsl(var(--theo-mid))", maxWidth: 680, margin: 0 }}>
              Unified stream of every customer-impacting movement — on/off-ramp, payouts, and yield.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={() => { setReachedEnd(false); load(); }} disabled={loading}
              style={btnOutlined}>
              <RefreshCw style={{ width: 13, height: 13 }} /> Refresh
            </button>
            <button onClick={exportCsv} disabled={!filtered.length} style={btnOutlined}>
              <Download style={{ width: 13, height: 13 }} /> Export CSV
            </button>
          </div>
        </div>
        {/* Gold divider */}
        <div style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginBottom: 20 }} />

        {/* Filters */}
        <div style={{ ...card, padding: "14px 20px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            {/* Segmented time range */}
            <div style={{ display: "flex", gap: 2, background: "hsl(var(--theo-cream))", padding: 3, borderRadius: 8 }}>
              {(["24h", "7d", "30d", "all"] as const).map(r => (
                <button key={r} onClick={() => setRange(r)} style={{
                  padding: "5px 11px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                  border: "none", cursor: "pointer", fontFamily: "inherit",
                  background: range === r ? "#fff" : "transparent",
                  color: range === r ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
                  boxShadow: range === r ? "0 1px 2px rgba(0,0,0,0.07)" : "none",
                  transition: "all 0.1s",
                }}>{r === "all" ? "All time" : r.toUpperCase()}</button>
              ))}
            </div>

            <select value={customerId} onChange={e => setCustomerId(e.target.value)} style={selectStyle}>
              <option value="">All customers</option>
              {allCustomers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>

            <select value={kindLabel} onChange={e => setKindLabel(e.target.value)} style={selectStyle}>
              <option value="">All types</option>
              {kindOptions.map(k => <option key={k} value={k}>{k}</option>)}
            </select>

            <input
              type="text" placeholder="Search reference, hash, customer…"
              value={query} onChange={e => setQuery(e.target.value)}
              style={{ ...selectStyle, flex: 1, minWidth: 220 }}
            />

            {/* Treasury ops toggle — shown by default, click to hide */}
            <button
              onClick={() => setShowTreasury(v => !v)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                fontFamily: "inherit", cursor: "pointer", transition: "all 0.1s",
                border: showTreasury ? "1.5px solid hsl(var(--theo-blue))" : "1px solid hsl(var(--theo-light))",
                background: showTreasury ? "hsl(var(--theo-blue-soft))" : "#fff",
                color: showTreasury ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
              }}
            >
              {showTreasury ? "Treasury ops ✓" : "Treasury ops hidden"}
            </button>
          </div>
        </div>

        {/* Table */}
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "hsl(var(--theo-cream))", borderBottom: "1px solid hsl(var(--theo-light))" }}>
                  {["", "Time", "Customer", "Type", "Amount HTG", "Amount USDC", "Reference", "Stellar", "Status"].map((h, i) => (
                    <th key={i} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr><td colSpan={9} style={emptyCell}>Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} style={emptyCell}>No transactions match these filters.</td></tr>
                ) : filtered.map(r => {
                  const isOpen = expanded === r.tx.id;
                  const DirIcon =
                    r.meta.direction === "in" ? ArrowDownLeft :
                    r.meta.direction === "out" ? ArrowUpRight :
                    r.tx.kind.startsWith("BLEND") ? Coins : Repeat;
                  const dirColor =
                    r.meta.direction === "in" ? "#1A7F37" :
                    r.meta.direction === "out" ? "#B91C1C" :
                    "hsl(var(--theo-blue))";
                  return (
                    <React.Fragment key={r.tx.id}>
                      <tr key={r.tx.id} onClick={() => setExpanded(isOpen ? null : r.tx.id)}
                        style={{ borderTop: "1px solid hsl(var(--theo-light))", cursor: "pointer" }}>
                        <td style={{ ...td, width: 26 }}>
                          {isOpen ? <ChevronDown style={{ width: 13, height: 13, color: "hsl(var(--theo-mid))" }} />
                                  : <ChevronRight style={{ width: 13, height: 13, color: "hsl(var(--theo-mid))" }} />}
                        </td>
                        <td style={td} title={new Date(r.tx.created_at).toLocaleString()}>{timeAgo(r.tx.created_at)}</td>
                        <td style={td}>
                          {r.customer ? (
                            <div>
                              <div style={{ fontWeight: 600, color: "hsl(var(--theo-ink))" }}>{r.customer.company_name}</div>
                              <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{r.customer.email}</div>
                            </div>
                          ) : <span style={{ color: "hsl(var(--theo-mid))" }}>—</span>}
                        </td>
                        <td style={td}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: dirColor, fontWeight: 600 }}>
                            <DirIcon style={{ width: 13, height: 13 }} />
                            {r.meta.label}
                          </span>
                        </td>
                        <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{fmtHTG(r.htg)}</td>
                        <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{fmtUSDC(r.usdc)}</td>
                        <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>
                          {r.order?.reference_number ?? <span style={{ color: "hsl(var(--theo-mid))" }}>—</span>}
                        </td>
                        <td style={td}>
                          {r.tx.stellar_tx_hash ? (
                            <a href={`https://stellar.expert/explorer/testnet/tx/${r.tx.stellar_tx_hash}`}
                              target="_blank" rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "hsl(var(--theo-cyan))", textDecoration: "none", fontFamily: "monospace", fontSize: 12 }}>
                              {r.tx.stellar_tx_hash.slice(0, 6)}…{r.tx.stellar_tx_hash.slice(-4)}
                              <ExternalLink style={{ width: 11, height: 11 }} />
                            </a>
                          ) : <span style={{ color: "hsl(var(--theo-mid))" }}>—</span>}
                        </td>
                        <td style={td}><StatusBadge status={r.order?.status ?? "POSTED"} /></td>
                      </tr>
                      {isOpen && (
                        <tr key={`${r.tx.id}-x`} style={{ background: "hsl(var(--theo-blue-soft))" }}>
                          <td></td>
                          <td colSpan={8} style={{ padding: "12px 16px 16px" }}>
                            {r.tx.description && (
                              <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginBottom: 8 }}>
                                {r.tx.description}
                              </div>
                            )}
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                              <thead>
                                <tr style={{ color: "hsl(var(--theo-mid))", textAlign: "left" }}>
                                  <th style={tdSmall}>Account</th>
                                  <th style={tdSmall}>Currency</th>
                                  <th style={{ ...tdSmall, textAlign: "right" }}>Debit</th>
                                  <th style={{ ...tdSmall, textAlign: "right" }}>Credit</th>
                                  <th style={tdSmall}>Customer</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.entries.map((e, i) => {
                                  const acct = _acctCache.get(e.account_id);
                                  return (
                                    <tr key={i}>
                                      <td style={tdSmall}>
                                        <span style={{ fontFamily: "monospace", color: "hsl(var(--theo-ink))" }}>{acct?.code ?? e.account_id.slice(0, 8)}</span>
                                        {acct?.name && <span style={{ color: "hsl(var(--theo-mid))", marginLeft: 6 }}>{acct.name}</span>}
                                      </td>
                                      <td style={tdSmall}>{e.currency}</td>
                                      <td style={{ ...tdSmall, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.debit ? Number(e.debit).toLocaleString() : ""}</td>
                                      <td style={{ ...tdSmall, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.credit ? Number(e.credit).toLocaleString() : ""}</td>
                                      <td style={{ ...tdSmall, fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                                        {e.customer_id
                                          ? (r.customer?.company_name ?? e.customer_id.slice(0, 8))
                                          : "—"}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!reachedEnd && rows.length > 0 && (
            <div style={{ padding: 14, textAlign: "center", borderTop: "1px solid hsl(var(--theo-light))" }}>
              <button
                onClick={() => load(rows[rows.length - 1].tx.created_at)}
                disabled={loading}
                style={btnSecondary}
              >
                {loading ? "Loading…" : "Load older"}
              </button>
            </div>
          )}
        </div>

        <div style={{ marginTop: 14, fontSize: 11, color: "hsl(var(--theo-mid))", display: "flex", alignItems: "center", gap: 6 }}>
          <Activity style={{ width: 12, height: 12 }} />
          Showing {filtered.length} of {rows.length} loaded transactions{!showTreasury ? " — treasury ops hidden" : ""}.
        </div>
      </div>
    </AppLayout>
  );
}

// Closure-scoped account map populated on each load. Kept simple — only used
// by the inline entry breakdown, never read before load() completes.
let _acctCache = new Map<string, Acct>();

// ── Styles ──────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: "#fff", border: "1px solid hsl(var(--theo-light))",
  borderRadius: 16, padding: 20, marginBottom: 16,
};
const th: React.CSSProperties = {
  padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: "0.10em", color: "hsl(var(--theo-mid))",
};
const td: React.CSSProperties = {
  padding: "12px 14px", color: "hsl(var(--theo-ink))", verticalAlign: "top",
};
const tdSmall: React.CSSProperties = { padding: "6px 10px", verticalAlign: "top" };
const emptyCell: React.CSSProperties = {
  padding: 48, textAlign: "center", color: "hsl(var(--theo-mid))", fontSize: 13,
};
const selectStyle: React.CSSProperties = {
  padding: "7px 10px", border: "1px solid hsl(var(--theo-light))",
  borderRadius: 8, fontSize: 12, fontFamily: "inherit",
  color: "hsl(var(--theo-ink))", background: "#fff",
};
const btnOutlined: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "7px 13px", background: "transparent", color: "hsl(var(--theo-blue))",
  border: "1.5px solid hsl(var(--theo-blue))", borderRadius: 8,
  fontWeight: 600, fontSize: 12, fontFamily: "inherit", cursor: "pointer",
};

// ── StatusBadge ─────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const config: Record<string, { label: string; bg: string; color: string }> = {
    COMPLETED: { label: "Completed", bg: "#DCFCE7", color: "#15803D" },
    FUNDED:    { label: "Processing", bg: "#FEF9C3", color: "#854D0E" },
    RELEASING: { label: "Processing", bg: "#FEF9C3", color: "#854D0E" },
    QUOTED:    { label: "Quoted",     bg: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))" },
    FAILED:    { label: "Failed",     bg: "#FEE2E2", color: "#B91C1C" },
    POSTED:    { label: "Posted",     bg: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))" },
  };
  const c = config[s] ?? { label: status, bg: "hsl(var(--theo-cream))", color: "hsl(var(--theo-mid))" };
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 20,
      fontSize: 11, fontWeight: 700, background: c.bg, color: c.color,
      letterSpacing: "0.02em",
    }}>{c.label}</span>
  );
}
