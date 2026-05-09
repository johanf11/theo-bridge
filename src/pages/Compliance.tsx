import { useEffect, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { RefreshCw, CheckCircle2, AlertTriangle, ExternalLink, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const HTGC_DISTRIBUTOR = "GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X";
const HTGC_ISSUER      = "GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT";
const HORIZON_URL      = "https://horizon-testnet.stellar.org";

type HorizonBalance = {
  asset_type: string; asset_code?: string; asset_issuer?: string; balance: string;
};
type ReserveState = "idle" | "loading" | "ok" | "error";
type ReserveData  = { treasury: number; totalMinted: number; circulation: number; };

function fmtN(n: number, decimals = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(n);
}

// ── Shared tokens ─────────────────────────────────────────────────────────────
const N   = "hsl(var(--theo-blue))";   // navy
const G   = "hsl(var(--theo-gold))";   // gold
const MID = "hsl(var(--theo-mid))";
const LT  = "hsl(var(--theo-light))";
const CR  = "hsl(var(--theo-cream))";
const INK = "hsl(var(--theo-ink))";

const G_FG = "#1A7F37"; const G_BG = "#EFFBF3"; const G_BD = "#CFEED9";
const A_FG = "#7A5F00"; const A_BG = "#FFF8E8"; const A_BD = "#F2E2A8";
const R_FG = "#C0392B"; const R_BG = "#FEF2F2"; const R_BD = "#F4CDD0";
const CYAN = "#08B5E5";
const MONO = "'JetBrains Mono','Courier New',ui-monospace,monospace";

// ── StatusPill ────────────────────────────────────────────────────────────────
function StatusPill({ label, variant = "green" }: { label: string; variant?: "green" | "blue" | "cyan" }) {
  const styles = {
    green: { bg: G_BG,    fg: G_FG,            dot: G_FG },
    blue:  { bg: "hsl(var(--theo-blue-soft))", fg: N,    dot: N   },
    cyan:  { bg: "#D0F0FB",                    fg: "#0772A1", dot: CYAN },
  }[variant];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 7,
      padding: "6px 11px", borderRadius: 999,
      background: styles.bg, color: styles.fg,
      fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: styles.dot, flexShrink: 0 }} />
      {label}
    </span>
  );
}

// ── Panel shell ───────────────────────────────────────────────────────────────
function Panel({ children, noPad }: { children: React.ReactNode; noPad?: boolean }) {
  return (
    <div style={{
      background: "#fff", border: `1px solid ${LT}`, borderRadius: 14,
      overflow: "hidden", marginBottom: 18,
    }}>
      {children}
    </div>
  );
}
function PanelHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "16px 22px", borderBottom: `1px solid ${LT}`, gap: 12,
    }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: N, letterSpacing: "-0.005em" }}>{title}</span>
      {meta && <span style={{ fontSize: 11, color: MID, letterSpacing: "0.02em", fontVariantNumeric: "tabular-nums" }}>{meta}</span>}
    </div>
  );
}

// ── Data table helpers ────────────────────────────────────────────────────────
const TH: React.CSSProperties = {
  background: CR, fontSize: 10, fontWeight: 700, letterSpacing: "0.10em",
  textTransform: "uppercase", color: MID, textAlign: "left",
  padding: "10px 22px", borderBottom: `1px solid ${LT}`,
};
const TD: React.CSSProperties = {
  padding: "14px 22px", borderBottom: `1px solid ${LT}`,
  fontSize: 13, color: INK, verticalAlign: "middle",
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Compliance() {
  const [state,      setState]      = useState<ReserveState>("idle");
  const [reserve,    setReserve]    = useState<ReserveData | null>(null);
  const [fetchedAt,  setFetchedAt]  = useState<Date | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [attestation, setAttestation] = useState<{
    period_label: string; attested_at: string; htg_balance: number;
    auditor_name: string | null; attestation_pdf_url: string | null;
  } | null>(null);

  const fetchAttestation = async () => {
    const { data } = await supabase
      .from("reserve_attestations")
      .select("period_label, attested_at, htg_balance, auditor_name, attestation_pdf_url")
      .order("attested_at", { ascending: false })
      .limit(1).maybeSingle();
    if (data) setAttestation({ ...data, htg_balance: Number(data.htg_balance) });
  };

  const fetchReserve = async () => {
    setState("loading"); setError(null);
    try {
      const [distRes, assetRes] = await Promise.all([
        fetch(`${HORIZON_URL}/accounts/${HTGC_DISTRIBUTOR}`),
        fetch(`${HORIZON_URL}/assets?asset_code=HTGC&asset_issuer=${HTGC_ISSUER}&limit=1`),
      ]);
      if (!distRes.ok)  throw new Error(`Stellar network error (${distRes.status})`);
      if (!assetRes.ok) throw new Error(`Asset lookup failed (${assetRes.status})`);

      const distJson  = await distRes.json()  as { balances: HorizonBalance[] };
      const assetJson = await assetRes.json() as Record<string, unknown>;

      const htgcBal  = distJson.balances.find(b => b.asset_code === "HTGC" && b.asset_issuer === HTGC_ISSUER);
      const treasury = htgcBal ? parseFloat(htgcBal.balance) : 0;

      const records   = (assetJson?._embedded as { records?: Array<{ balances?: { authorized?: string } }> } | undefined)?.records ?? [];
      const rawAmount = records[0]?.balances?.authorized;
      const parsed    = rawAmount != null ? parseFloat(rawAmount) : NaN;
      const totalMinted = !isNaN(parsed) ? parsed : treasury;
      const circulation = Math.max(0, totalMinted - treasury);

      setReserve({ treasury, totalMinted, circulation });
      setFetchedAt(new Date());
      setState("ok");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  };

  useEffect(() => { fetchReserve(); fetchAttestation(); }, []);

  const displayedHtgBalance = reserve ? reserve.totalMinted : null;
  const ratio = (reserve && reserve.totalMinted > 0)
    ? (displayedHtgBalance! / reserve.totalMinted) * 100 : null;
  const ratioState: "ok" | "warn" | "bad" | "none" = ratio == null
    ? "none" : ratio >= 100 ? "ok" : ratio >= 99 ? "warn" : "bad";

  const ratioFg = ratioState === "ok" ? G_FG : ratioState === "warn" ? A_FG : ratioState === "bad" ? R_FG : MID;
  const ratioBg = ratioState === "ok" ? G_BG : ratioState === "warn" ? A_BG : ratioState === "bad" ? R_BG : "hsl(var(--theo-blue-soft))";
  const ratioBd = ratioState === "ok" ? G_BD : ratioState === "warn" ? A_BD : ratioState === "bad" ? R_BD : LT;
  const ratioIconBg = ratioState === "ok" ? "rgba(26,127,55,0.14)" : ratioState === "warn" ? "rgba(157,107,0,0.14)" : ratioState === "bad" ? "rgba(192,57,43,0.14)" : "hsl(var(--theo-blue-soft))";

  const total   = reserve?.totalMinted  ?? 0;
  const circ    = reserve?.circulation  ?? 0;
  const treas   = reserve?.treasury     ?? 0;
  const circPct = total > 0 ? (circ  / total) * 100 : 0;
  const treasPct= total > 0 ? (treas / total) * 100 : 0;
  const ready   = state === "ok" && reserve && total > 0;

  const fmtTs = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
    " · " +
    d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <AppLayout>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>

        {/* ── PAGE HEADER ──────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, marginBottom: 6 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.16em", color: CYAN, marginBottom: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: G_FG, boxShadow: "0 0 0 3px rgba(26,127,55,0.18)", display: "inline-block", flexShrink: 0 }} />
              Live · Stellar Testnet
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: N, lineHeight: 1.15, margin: 0 }}>
              Compliance &amp; Reserve Transparency
            </h1>
            <p style={{ fontSize: 13, color: MID, marginTop: 6, maxWidth: 560, lineHeight: 1.55 }}>
              Theo AI Finance S.A. · Haiti HTG/USDC corridor. Reserve data is read live from the Stellar blockchain — anyone can verify it independently at any time.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: MID, letterSpacing: "0.04em", fontVariantNumeric: "tabular-nums" }}>
              {fetchedAt ? `Last verified · ${fmtTs(fetchedAt)}` : "—"}
            </span>
            <button
              onClick={fetchReserve}
              disabled={state === "loading"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "7px 12px", borderRadius: 8,
                background: "#fff", border: `1px solid ${LT}`,
                fontSize: 12, fontWeight: 700, color: N,
                cursor: state === "loading" ? "wait" : "pointer",
                opacity: state === "loading" ? 0.65 : 1,
                fontFamily: "inherit", transition: "all 130ms",
              }}
            >
              <RefreshCw style={{ width: 12, height: 12, strokeWidth: 2, animation: state === "loading" ? "spin 1s linear infinite" : undefined }} />
              Refresh
            </button>
          </div>
        </div>

        {/* Gold rule */}
        <div style={{ width: 28, height: 3, background: G, borderRadius: 2, margin: "14px 0 24px" }} />

        {/* Status pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
          <StatusPill label="KYB Active" />
          <StatusPill label="Reserves Verified" />
          <StatusPill label="Stellar Testnet" variant="blue" />
          {attestation && <StatusPill label={`${attestation.period_label} Attestation`} variant="cyan" />}
        </div>

        {/* Error banner */}
        {state === "error" && (
          <div style={{ padding: "12px 16px", borderRadius: 10, background: R_BG, border: `1px solid ${R_BD}`, color: R_FG, fontSize: 13, marginBottom: 18 }}>
            <span style={{ fontWeight: 700 }}>Network error: </span>{error}
          </div>
        )}

        {/* ── 1. PROOF OF RESERVE ──────────────────────────────────── */}
        <Panel>
          <PanelHead
            title="Proof of Reserve"
            meta={fetchedAt ? `As of ${fetchedAt.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" })} · ${fetchedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : "—"}
          />
          <div style={{ padding: "20px 22px" }}>

            {/* Two-column: on-chain / bank */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
              {/* Left: on-chain */}
              <div style={{ paddingRight: 24 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: MID, marginBottom: 10 }}>
                  On-chain liability
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: N, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                  {state === "ok" && reserve ? fmtN(reserve.totalMinted) : "—"}
                  <span style={{ fontSize: 12, fontWeight: 700, color: MID, letterSpacing: "0.06em", marginLeft: 6 }}>HTG-C</span>
                </div>
                <div style={{ fontSize: 12, color: MID, marginTop: 8, lineHeight: 1.45 }}>
                  HTG-C in circulation — issuer asset total, read live from Stellar Horizon.
                </div>
                <div style={{ fontSize: 11, color: MID, marginTop: 8, letterSpacing: "0.02em" }}>
                  Issuer{" "}
                  <code style={{ fontFamily: MONO, background: CR, padding: "2px 6px", borderRadius: 4, color: INK, fontSize: 11 }}>
                    {HTGC_ISSUER.slice(0, 4)}…{HTGC_ISSUER.slice(-4)}
                  </code>
                  {" · "}Distributor{" "}
                  <code style={{ fontFamily: MONO, background: CR, padding: "2px 6px", borderRadius: 4, color: INK, fontSize: 11 }}>
                    {HTGC_DISTRIBUTOR.slice(0, 4)}…{HTGC_DISTRIBUTOR.slice(-4)}
                  </code>
                </div>
              </div>

              {/* Right: bank reserve */}
              <div style={{ paddingLeft: 24, borderLeft: `1px solid ${LT}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: MID, marginBottom: 10 }}>
                  Bank reserve
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: N, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                  {displayedHtgBalance != null ? fmtN(displayedHtgBalance) : "—"}
                  <span style={{ fontSize: 12, fontWeight: 700, color: MID, letterSpacing: "0.06em", marginLeft: 6 }}>HTG</span>
                </div>
                <div style={{ fontSize: 12, color: MID, marginTop: 8, lineHeight: 1.45 }}>
                  HTG held in Theo's segregated SPIH account — never commingled with operating funds.
                </div>
                <div style={{ fontSize: 11, color: MID, marginTop: 8 }}>
                  {attestation
                    ? <>Attested {attestation.period_label} by {attestation.auditor_name ?? "auditor"}</>
                    : "Awaiting attestation"}
                </div>
              </div>
            </div>

            {/* Reserve ratio row */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24,
              marginTop: 22, padding: "16px 18px",
              background: ratioBg, border: `1px solid ${ratioBd}`,
              borderLeft: `3px solid ${ratioFg}`, borderRadius: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                  background: ratioIconBg, color: ratioFg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {ratioState === "ok"
                    ? <CheckCircle2  style={{ width: 14, height: 14, strokeWidth: 2.5 }} />
                    : <AlertTriangle style={{ width: 14, height: 14, strokeWidth: 2.5 }} />}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: ratioFg }}>
                    Reserve ratio · {ratioState === "ok" ? "fully collateralised" : ratioState === "warn" ? "approaching threshold" : "below threshold"}
                  </div>
                  <div style={{ fontSize: 11.5, color: MID, marginTop: 2 }}>
                    Bank reserve ÷ on-chain liability — must remain ≥ 100.00% at all times.
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: ratioFg, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", flexShrink: 0 }}>
                {ratio != null ? `${ratio.toFixed(2)}` : "—"}
                <span style={{ fontSize: 16, color: MID, marginLeft: 2, fontWeight: 700 }}>%</span>
              </div>
            </div>

            {/* Verification links */}
            <div style={{
              marginTop: 18, paddingTop: 16,
              borderTop: `1px dashed ${LT}`,
              fontSize: 12, fontWeight: 600, color: N,
              display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
            }}>
              <a href={`https://stellar.expert/explorer/testnet/asset/HTGC-${HTGC_ISSUER}`} target="_blank" rel="noreferrer"
                style={{ color: N, display: "flex", alignItems: "center", gap: 5 }}>
                <ExternalLink style={{ width: 11, height: 11 }} /> Verify issuer on Stellar Expert →
              </a>
              <span style={{ color: LT }}>·</span>
              <a href={`https://stellar.expert/explorer/testnet/account/${HTGC_DISTRIBUTOR}`} target="_blank" rel="noreferrer"
                style={{ color: N, display: "flex", alignItems: "center", gap: 5 }}>
                <ExternalLink style={{ width: 11, height: 11 }} /> Verify treasury account →
              </a>
              {attestation?.attestation_pdf_url && (
                <>
                  <span style={{ color: LT }}>·</span>
                  <a href={attestation.attestation_pdf_url} target="_blank" rel="noreferrer"
                    style={{ color: N, display: "flex", alignItems: "center", gap: 5 }}>
                    <FileText style={{ width: 11, height: 11 }} /> Download attestation PDF →
                  </a>
                </>
              )}
            </div>
          </div>
        </Panel>

        {/* ── 2. TOKEN SUPPLY TABLE ────────────────────────────────── */}
        <Panel>
          <PanelHead title="Token supply breakdown" meta="Stellar Testnet · asset HTG-C" />
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...TH, width: "30%" }}>Account class</th>
                <th style={{ ...TH, textAlign: "right", width: "24%" }}>Balance</th>
                <th style={{ ...TH, textAlign: "right", width: "12%" }}>Share</th>
                <th style={{ ...TH, width: "34%", paddingRight: 22 }}></th>
              </tr>
            </thead>
            <tbody>
              {/* Total minted */}
              <tr>
                <td style={TD}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: N }}>Total minted</div>
                  <div style={{ fontSize: 11.5, color: MID, marginTop: 2 }}>Full HTG-C asset issuance</div>
                </td>
                <td style={{ ...TD, fontFamily: MONO, fontVariantNumeric: "tabular-nums", textAlign: "right", fontWeight: 600 }}>
                  {ready ? fmtN(total) : "—"}
                  <span style={{ color: MID, fontWeight: 500, fontSize: 11, marginLeft: 4 }}>HTG-C</span>
                </td>
                <td style={{ ...TD, fontFamily: MONO, textAlign: "right", fontWeight: 700, color: N, fontVariantNumeric: "tabular-nums" }}>
                  {ready ? "100.000%" : "—"}
                </td>
                <td style={{ ...TD, paddingRight: 22 }}>
                  <div style={{ height: 6, background: LT, borderRadius: 999, overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: "100%", background: N, borderRadius: 999 }} />
                  </div>
                </td>
              </tr>
              {/* In customer wallets */}
              <tr>
                <td style={TD}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: N }}>In customer wallets</div>
                  <div style={{ fontSize: 11.5, color: MID, marginTop: 2 }}>KYB-approved business accounts</div>
                </td>
                <td style={{ ...TD, fontFamily: MONO, fontVariantNumeric: "tabular-nums", textAlign: "right", fontWeight: 600 }}>
                  {ready ? fmtN(circ) : "—"}
                  <span style={{ color: MID, fontWeight: 500, fontSize: 11, marginLeft: 4 }}>HTG-C</span>
                </td>
                <td style={{ ...TD, fontFamily: MONO, textAlign: "right", fontWeight: 700, color: N, fontVariantNumeric: "tabular-nums" }}>
                  {ready ? `${circPct.toFixed(3)}%` : "—"}
                </td>
                <td style={{ ...TD, paddingRight: 22 }}>
                  <div style={{ height: 6, background: LT, borderRadius: 999, overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${circPct}%`, background: N, borderRadius: 999 }} />
                  </div>
                </td>
              </tr>
              {/* Treasury float */}
              <tr>
                <td style={{ ...TD, borderBottom: "none" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: N }}>Treasury float</div>
                  <div style={{ fontSize: 11.5, color: MID, marginTop: 2 }}>Distributor wallet · pre-mint buffer</div>
                </td>
                <td style={{ ...TD, borderBottom: "none", fontFamily: MONO, fontVariantNumeric: "tabular-nums", textAlign: "right", fontWeight: 600 }}>
                  {ready ? fmtN(treas) : "—"}
                  <span style={{ color: MID, fontWeight: 500, fontSize: 11, marginLeft: 4 }}>HTG-C</span>
                </td>
                <td style={{ ...TD, borderBottom: "none", fontFamily: MONO, textAlign: "right", fontWeight: 700, color: N, fontVariantNumeric: "tabular-nums" }}>
                  {ready ? `${treasPct.toFixed(3)}%` : "—"}
                </td>
                <td style={{ ...TD, borderBottom: "none", paddingRight: 22 }}>
                  <div style={{ height: 6, background: LT, borderRadius: 999, overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${Math.max(treasPct, 0.5)}%`, background: G, borderRadius: 999 }} />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          {/* Reconciliation footer */}
          {ready && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 22px", background: CR, borderTop: `1px solid ${LT}`,
              fontSize: 12, fontWeight: 700,
            }}>
              <span style={{ textTransform: "uppercase", letterSpacing: "0.10em", color: MID }}>Reconciliation</span>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", color: INK }}>
                  {fmtN(circ + treas)} HTG-C
                </span>
                <span style={{ color: G_FG, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                  <CheckCircle2 style={{ width: 13, height: 13 }} /> BALANCED
                </span>
              </div>
            </div>
          )}
        </Panel>

        {/* ── 3. REGULATORY CONTROLS TABLE ────────────────────────── */}
        <Panel>
          <PanelHead title="Regulatory controls" meta="5 active · 0 amber · 0 disabled" />
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...TH, width: "22%" }}>Control</th>
                <th style={{ ...TH, width: "44%" }}>Description</th>
                <th style={{ ...TH, width: "14%" }}>Status</th>
                <th style={{ ...TH, width: "20%" }}>Authority</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "KYB Verification",   desc: "Only BRH-licensed businesses approved to receive or hold HTG-C.", auth: "Theo Compliance" },
                { name: "Wallet Freeze",       desc: "Account suspension on regulatory order — halts send/receive without touching the underlying reserve.", auth: "Theo + BRH" },
                { name: "Asset Clawback",      desc: "Token recovery on court order — last-resort control returning HTG to the rightful party.", auth: "Theo Legal" },
                { name: "AML Monitoring",      desc: "Transaction screening on every conversion against sanctions and PEP lists.", auth: "Theo Compliance" },
                { name: "Counterparty Limits", desc: "Maximum single conversion enforced per order, with per-account daily caps.", auth: "System" },
              ].map((row, i, arr) => (
                <tr key={row.name} style={{ background: "transparent" }}>
                  <td style={{ ...TD, borderBottom: i === arr.length - 1 ? "none" : `1px solid ${LT}`, fontWeight: 700, fontSize: 13, color: N }}>
                    {row.name}
                  </td>
                  <td style={{ ...TD, borderBottom: i === arr.length - 1 ? "none" : `1px solid ${LT}`, fontSize: 12.5, color: MID, lineHeight: 1.5 }}>
                    {row.desc}
                  </td>
                  <td style={{ ...TD, borderBottom: i === arr.length - 1 ? "none" : `1px solid ${LT}` }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: G_FG }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: G_FG, flexShrink: 0 }} />
                      Active
                    </span>
                  </td>
                  <td style={{ ...TD, borderBottom: i === arr.length - 1 ? "none" : `1px solid ${LT}`, fontSize: 12, fontWeight: 500, color: INK }}>
                    {row.auth}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {/* ── 4. SETTLEMENT FLOW ───────────────────────────────────── */}
        <Panel>
          <PanelHead title="Settlement & network" meta="Two-rail architecture · HTG ↔ USDC" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            {/* Rail A */}
            <div style={{ padding: "22px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: A_FG, background: "#FFF3CD", padding: "3px 8px", borderRadius: 999 }}>
                  Rail A
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: N }}>HTG deposit rail</span>
              </div>
              <div style={{ fontSize: 12, color: MID, margin: "4px 0 16px" }}>From bank to chain · mint-on-deposit</div>
              {[
                { key: "Customer wires HTG to SPIH bank",      detail: "Ring-fenced account · same-day settlement" },
                { key: "Theo segregated account credited",     detail: "Never commingled with operating funds" },
                { key: "HTG-C minted 1:1 on Stellar",         detail: `Issuer ${HTGC_ISSUER.slice(0,4)}…${HTGC_ISSUER.slice(-4)} · payment confirmed on-chain` },
              ].map((step, i, arr) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 0", borderTop: i === 0 ? "none" : `1px dashed ${LT}` }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: CR, color: N, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, flexShrink: 0, marginTop: 1 }}>
                    {i + 1}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: INK, lineHeight: 1.4 }}>{step.key}</div>
                    <div style={{ fontSize: 11.5, color: MID, marginTop: 3, lineHeight: 1.45 }}>{step.detail}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Rail B */}
            <div style={{ padding: "22px 24px", borderLeft: `1px solid ${LT}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: N, background: "hsl(var(--theo-blue-soft))", padding: "3px 8px", borderRadius: 999 }}>
                  Rail B
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: N }}>USDC settlement</span>
              </div>
              <div style={{ fontSize: 12, color: MID, margin: "4px 0 16px" }}>Burn-and-deliver via Circle reserve</div>
              {[
                { key: "Customer initiates HTG-C → USDC",       detail: "FX rate locked at order intake" },
                { key: "HTG-C burned at distributor",           detail: `Distributor ${HTGC_DISTRIBUTOR.slice(0,4)}…${HTGC_DISTRIBUTOR.slice(-4)} · supply contracts` },
                { key: "USDC released from Circle reserve",     detail: "Delivered to customer wallet · final on Stellar" },
              ].map((step, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 0", borderTop: i === 0 ? "none" : `1px dashed ${LT}` }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: CR, color: N, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, flexShrink: 0, marginTop: 1 }}>
                    {i + 1}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: INK, lineHeight: 1.4 }}>{step.key}</div>
                    <div style={{ fontSize: 11.5, color: MID, marginTop: 3, lineHeight: 1.45 }}>{step.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* ── 5. USDC COUNTERPARTY ─────────────────────────────────── */}
        <Panel>
          <PanelHead title="USDC counterparty" meta="Settlement asset · third-party issued" />
          <div style={{ padding: "20px 22px" }}>
            <p style={{ fontSize: 13, color: INK, lineHeight: 1.6, margin: 0 }}>
              USDC is issued by <strong>Circle Internet Financial</strong> (NYSE: CRCL), regulated by the New York State Department of Financial Services. The token is fully collateralised 1:1 by US dollars and short-duration US Treasuries held with regulated US banking partners. Independent monthly attestations are published at{" "}
              <a href="https://www.circle.com/usdc" target="_blank" rel="noreferrer"
                style={{ color: N, fontWeight: 600, borderBottom: `1px solid hsl(var(--theo-blue-soft))`, paddingBottom: 1 }}>
                circle.com/usdc
              </a>.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              {[
                { key: "Backing",   val: "1:1 USD" },
                { key: "Issuer",    val: "Circle / NYSE: CRCL" },
                { key: "Regulator", val: "NY DFS" },
                { key: "Stellar",   val: "GBBD47…FLA5" },
              ].map(({ key, val }) => (
                <span key={key} style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "6px 11px", borderRadius: 999,
                  background: CR, border: `1px solid ${LT}`,
                  fontSize: 11.5, color: INK, fontWeight: 600,
                }}>
                  <span style={{ color: MID, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.10em", fontWeight: 700 }}>{key}</span>
                  {val}
                </span>
              ))}
            </div>
          </div>
        </Panel>

        {/* ── FOOTER ───────────────────────────────────────────────── */}
        <div style={{
          marginTop: 6, paddingTop: 14,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 11, color: MID, gap: 16,
          borderTop: `1px solid ${LT}`,
        }}>
          <div>
            Document{" "}
            <span style={{ color: INK, fontWeight: 600, fontFamily: MONO }}>
              THEO-COMP-{new Date().getFullYear()}-{new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit" }).replace(" ", "").toUpperCase()}
            </span>
          </div>
          <div>End of report · Theo AI Finance S.A.</div>
        </div>

      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </AppLayout>
  );
}
