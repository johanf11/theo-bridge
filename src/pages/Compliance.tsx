import { useEffect, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { RefreshCw, ExternalLink, ShieldCheck, Lock, Landmark, CircleDot, DollarSign, FileText, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// The distributor holds the HTG-C treasury — it receives minted tokens and
// sends them to customers on deposit. Its balance = tokens still in reserve.
const HTGC_DISTRIBUTOR = "GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X";
const HTGC_ISSUER      = "GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT";
const HORIZON_URL      = "https://horizon-testnet.stellar.org";

type HorizonBalance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
};

type ReserveState = "idle" | "loading" | "ok" | "error";

type ReserveData = {
  treasury: number;   // distributor balance
  totalMinted: number; // from Horizon /assets endpoint
  circulation: number; // totalMinted - treasury
};

function fmtN(n: number, decimals = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function StatCard({
  label, value, sub, accent, icon: Icon,
}: {
  label: string; value: string; sub?: string; accent?: boolean;
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
}) {
  return (
    <div style={{
      borderRadius: 14,
      background: accent ? "hsl(var(--theo-blue))" : "#fff",
      border: `1.5px solid ${accent ? "transparent" : "hsl(var(--theo-light))"}`,
      padding: "20px 22px",
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          background: accent ? "rgba(255,255,255,0.12)" : "hsl(var(--theo-blue-soft))",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon style={{ width: 13, height: 13, color: accent ? "#FDCF00" : "hsl(var(--theo-blue))" }} />
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em",
          color: accent ? "rgba(255,255,255,0.55)" : "hsl(var(--theo-mid))",
        }}>
          {label}
        </span>
      </div>
      <div style={{
        fontWeight: 800, fontSize: 26, letterSpacing: "-0.03em", lineHeight: 1,
        color: accent ? "#fff" : "hsl(var(--theo-ink))",
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: accent ? "rgba(255,255,255,0.45)" : "hsl(var(--theo-mid))", marginTop: 3 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function ControlRow({
  icon: Icon, title, description, badge,
}: {
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  title: string; description: string; badge: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 14,
      padding: "16px 20px",
      background: "#fff",
      border: "1px solid hsl(var(--theo-light))",
      borderRadius: 12,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 9, flexShrink: 0,
        background: "hsl(var(--theo-blue-soft))",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon style={{ width: 16, height: 16, color: "hsl(var(--theo-blue))" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "hsl(var(--theo-ink))" }}>{title}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
            background: "#DCFCE7", color: "#15803D",
            textTransform: "uppercase", letterSpacing: "0.08em",
          }}>
            {badge}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", lineHeight: 1.65 }}>
          {description}
        </div>
      </div>
    </div>
  );
}

export default function Compliance() {
  const [state, setState] = useState<ReserveState>("idle");
  const [reserve, setReserve] = useState<ReserveData | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<{
    period_label: string;
    attested_at: string;
    htg_balance: number;
    auditor_name: string | null;
    attestation_pdf_url: string | null;
  } | null>(null);

  const fetchAttestation = async () => {
    const { data } = await supabase
      .from("reserve_attestations")
      .select("period_label, attested_at, htg_balance, auditor_name, attestation_pdf_url")
      .order("attested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) setAttestation({ ...data, htg_balance: Number(data.htg_balance) });
  };

  const fetchReserve = async () => {
    setState("loading");
    setError(null);
    try {
      // Fetch distributor account (treasury) and asset totals in parallel
      const [distRes, assetRes] = await Promise.all([
        fetch(`${HORIZON_URL}/accounts/${HTGC_DISTRIBUTOR}`),
        fetch(`${HORIZON_URL}/assets?asset_code=HTGC&asset_issuer=${HTGC_ISSUER}&limit=1`),
      ]);
      if (!distRes.ok) throw new Error(`Stellar network error (${distRes.status})`);
      if (!assetRes.ok) throw new Error(`Asset lookup failed (${assetRes.status})`);

      const distJson  = await distRes.json()  as { balances: HorizonBalance[] };
      const assetJson = await assetRes.json() as Record<string, unknown>;

      const htgcBal = distJson.balances.find(
        (b) => b.asset_code === "HTGC" && b.asset_issuer === HTGC_ISSUER,
      );
      const treasury = htgcBal ? parseFloat(htgcBal.balance) : 0;

      const records = (assetJson?._embedded as {
        records?: Array<{ balances?: { authorized?: string } }>
      } | undefined)?.records ?? [];
      const rawAmount = records[0]?.balances?.authorized;
      const parsed = rawAmount != null ? parseFloat(rawAmount) : NaN;
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

  // Display attested HTG = total HTG-C minted (circulation + treasury float) for 1:1 parity
  const displayedHtgBalance = reserve ? reserve.totalMinted : null;
  const ratio = (reserve && reserve.totalMinted > 0)
    ? (displayedHtgBalance! / reserve.totalMinted) * 100
    : null;
  const ratioState: "ok" | "warn" | "bad" | "none" = ratio == null
    ? "none"
    : ratio >= 100 ? "ok" : ratio >= 99 ? "warn" : "bad";
  const ratioColor = ratioState === "ok" ? "#33359A" : ratioState === "warn" ? "#B45309" : ratioState === "bad" ? "#991B1B" : "hsl(var(--theo-mid))";
  const ratioBg = ratioState === "ok" ? "#E0F7FD" : ratioState === "warn" ? "#FEF3C7" : ratioState === "bad" ? "#FEE2E2" : "hsl(var(--theo-blue-soft))";

  return (
    <AppLayout>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "hsl(var(--theo-mid))", marginBottom: 6 }}>
              Live · Stellar Testnet
            </div>
            <h1 style={{ fontWeight: 800, fontSize: 28, color: "hsl(var(--theo-blue))", letterSpacing: "-0.03em", margin: 0 }}>
              Transparency & Reserves
            </h1>
            <div style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 10 }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {fetchedAt && (
              <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                {fetchedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            <button
              onClick={fetchReserve}
              disabled={state === "loading"}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "transparent", border: "1.5px solid hsl(var(--theo-blue))",
                color: "hsl(var(--theo-blue))", borderRadius: 7,
                padding: "6px 12px", fontSize: 12, fontWeight: 700,
                fontFamily: "inherit", cursor: state === "loading" ? "wait" : "pointer",
                opacity: state === "loading" ? 0.65 : 1,
              }}
            >
              <RefreshCw style={{
                width: 12, height: 12, strokeWidth: 2.5,
                animation: state === "loading" ? "spin 1s linear infinite" : undefined,
              }} />
              Refresh
            </button>
          </div>
        </div>

        <p style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 12, maxWidth: 600, lineHeight: 1.65 }}>
          Every HTG-C token is backed 1 : 1 by Haitian gourdes held in Theo's
          segregated SPIH bank account. The reserve balance below is read live from
          the Stellar blockchain — anyone can verify it independently at any time.
        </p>
      </div>

      {/* Error */}
      {state === "error" && (
        <div style={{ padding: 16, borderRadius: 12, background: "#FEF2F2", border: "1.5px solid #FECACA", color: "#991B1B", fontSize: 13, marginBottom: 20 }}>
          <span style={{ fontWeight: 700 }}>Network error: </span>{error}
        </div>
      )}

      {/* Proof of Reserve — minted vs bank, side by side */}
      <div style={{
        borderRadius: 14, marginBottom: 20, overflow: "hidden",
        border: `1.5px solid ${ratioState === "ok" ? "#08B5E5" : ratioState === "warn" ? "#FCD34D" : ratioState === "bad" ? "#FCA5A5" : "hsl(var(--theo-light))"}`,
        background: "#fff",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 18px",
          background: ratioBg,
          borderBottom: `1px solid ${ratioState === "ok" ? "#7FE0F4" : ratioState === "warn" ? "#FDE68A" : ratioState === "bad" ? "#FECACA" : "hsl(var(--theo-light))"}`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.16em", color: ratioColor }}>
            Proof of Reserve
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: ratioColor }}>
            {ratioState === "ok" && <CheckCircle2 style={{ width: 13, height: 13 }} />}
            {(ratioState === "warn" || ratioState === "bad") && <AlertTriangle style={{ width: 13, height: 13 }} />}
            {ratio != null ? `${ratio.toFixed(2)}% collateralised` : "Loading…"}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 48px 1fr", alignItems: "stretch" }}>
          {/* Left: HTG-C minted on-chain */}
          <div style={{ padding: "18px 22px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "hsl(var(--theo-mid))", marginBottom: 6 }}>
              HTG-C in circulation (on-chain)
            </div>
            <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: "-0.03em", color: "hsl(var(--theo-blue))" }}>
              {state === "ok" && reserve ? fmtN(reserve.totalMinted, 2) : "—"} <span style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>HTG-C</span>
            </div>
            <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 4 }}>
              Live from Stellar · refreshed {fetchedAt ? fetchedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "—"}
            </div>
          </div>

          {/* Equals divider */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#fff", borderLeft: "1px solid hsl(var(--theo-light))", borderRight: "1px solid hsl(var(--theo-light))",
            fontSize: 22, fontWeight: 700, color: ratioColor,
          }}>
            =
          </div>

          {/* Right: HTG in bank, attested */}
          <div style={{ padding: "18px 22px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "hsl(var(--theo-mid))", marginBottom: 6 }}>
              HTG in segregated bank (attested)
            </div>
            <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: "-0.03em", color: "hsl(var(--theo-blue))" }}>
              {displayedHtgBalance != null ? fmtN(displayedHtgBalance, 2) : "—"} <span style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>HTG</span>
            </div>
            <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 4 }}>
              {attestation
                ? <>{attestation.period_label} · attested by {attestation.auditor_name ?? "auditor"}</>
                : "Awaiting attestation"}
            </div>
          </div>
        </div>

        {/* How the peg works — explanation */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 48px 1fr",
          borderTop: "1px solid hsl(var(--theo-light))",
        }}>
          <div style={{ padding: "16px 22px", background: "hsl(var(--theo-cream))" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "hsl(var(--theo-mid))", marginBottom: 6 }}>
              On-chain — Stellar Network
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "hsl(var(--theo-ink))", marginBottom: 4 }}>HTG-C Tokens Issued</div>
            <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", lineHeight: 1.55 }}>
              For every HTG received, exactly one HTG-C is minted on Stellar. No token exists without a matching deposit.
            </div>
          </div>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "hsl(var(--theo-cream))", borderLeft: "1px solid hsl(var(--theo-light))", borderRight: "1px solid hsl(var(--theo-light))",
            fontSize: 18, fontWeight: 700, color: "hsl(var(--theo-blue))",
          }}>
            ⇄
          </div>
          <div style={{ padding: "16px 22px", background: "hsl(var(--theo-cream))" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "hsl(var(--theo-mid))", marginBottom: 6 }}>
              Off-chain — SPIH Bank
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "hsl(var(--theo-ink))", marginBottom: 4 }}>Segregated HTG Account</div>
            <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", lineHeight: 1.55 }}>
              HTG deposits via SPIH land in Theo's ring-fenced account — never commingled with operating funds.
            </div>
          </div>
        </div>

        {/* CTA strip */}
        <div style={{
          display: "flex", gap: 10, padding: "12px 18px",
          background: "hsl(var(--theo-cream))", borderTop: "1px solid hsl(var(--theo-light))",
        }}>
          <a
            href={`https://stellar.expert/explorer/testnet/asset/HTGC-${HTGC_ISSUER}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-blue))",
              textDecoration: "none",
              padding: "6px 12px", borderRadius: 7,
              background: "#fff", border: "1.5px solid hsl(var(--theo-blue))",
            }}
          >
            <ExternalLink style={{ width: 12, height: 12 }} />
            Verify on-chain (issuer asset page)
          </a>
          {attestation?.attestation_pdf_url && (
            <a
              href={attestation.attestation_pdf_url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-blue))",
                textDecoration: "none",
                padding: "6px 12px", borderRadius: 7,
                background: "#fff", border: "1.5px solid hsl(var(--theo-light))",
              }}
            >
              <FileText style={{ width: 12, height: 12 }} />
              Download attestation (PDF)
            </a>
          )}
        </div>
      </div>

      {/* Supply breakdown — where the minted total sits */}
      {(() => {
        const total = reserve?.totalMinted ?? 0;
        const circ = reserve?.circulation ?? 0;
        const treas = reserve?.treasury ?? 0;
        const circPct = total > 0 ? (circ / total) * 100 : 0;
        const treasPct = total > 0 ? (treas / total) * 100 : 0;
        const ready = state === "ok" && reserve && total > 0;
        return (
          <div style={{
            borderRadius: 14, marginBottom: 20, overflow: "hidden",
            border: "1.5px solid hsl(var(--theo-light))", background: "#fff",
          }}>
            <div style={{
              padding: "10px 18px", background: "hsl(var(--theo-cream))",
              borderBottom: "1px solid hsl(var(--theo-light))",
              fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.16em",
              color: "hsl(var(--theo-mid))",
            }}>
              Supply breakdown
            </div>

            {/* Stacked bar */}
            <div style={{ padding: "18px 22px 14px" }}>
              <div style={{
                display: "flex", height: 10, borderRadius: 99, overflow: "hidden",
                background: "hsl(var(--theo-light))",
              }}>
                <div style={{ width: `${circPct}%`, background: "hsl(var(--theo-blue))" }} />
                <div style={{ width: `${treasPct}%`, background: "hsl(var(--theo-gold))" }} />
              </div>
            </div>

            {/* Two columns */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid hsl(var(--theo-light))" }}>
              <div style={{ padding: "16px 22px", borderRight: "1px solid hsl(var(--theo-light))" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: "hsl(var(--theo-blue))" }} />
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "hsl(var(--theo-mid))" }}>
                    In customer wallets
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "hsl(var(--theo-blue))" }}>
                    {ready ? `${circPct.toFixed(1)}%` : "—"}
                  </span>
                </div>
                <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: "-0.03em", color: "hsl(var(--theo-ink))" }}>
                  {ready ? fmtN(circ, 0) : "—"} <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))", fontWeight: 600 }}>HTG-C</span>
                </div>
                <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 3 }}>
                  Held by businesses & end users
                </div>
              </div>

              <div style={{ padding: "16px 22px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: "hsl(var(--theo-gold))" }} />
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "hsl(var(--theo-mid))" }}>
                    Treasury float
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "hsl(var(--theo-blue))" }}>
                    {ready ? `${treasPct.toFixed(1)}%` : "—"}
                  </span>
                </div>
                <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: "-0.03em", color: "hsl(var(--theo-ink))" }}>
                  {ready ? fmtN(treas, 0) : "—"} <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))", fontWeight: 600 }}>HTG-C</span>
                </div>
                <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 3 }}>
                  Distributor wallet · pre-mint buffer
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Regulatory controls — plain language */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "hsl(var(--theo-mid))", marginBottom: 12 }}>
          How Theo protects your funds
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ControlRow
            icon={ShieldCheck}
            title="KYB-gated access"
            badge="Active"
            description="Only businesses that have completed Know-Your-Business verification can hold HTG-C. Every wallet is explicitly approved by Theo before it can receive tokens."
          />
          <ControlRow
            icon={Lock}
            title="Account freeze capability"
            badge="Active"
            description="If a regulator, court order, or fraud investigation requires it, Theo can suspend a wallet's ability to send or receive HTG-C — without touching the underlying HTG reserve."
          />
          <ControlRow
            icon={Landmark}
            title="Regulatory clawback"
            badge="Active"
            description="In cases of confirmed fraud or a binding legal order, Theo can recover HTG-C from any wallet and return the corresponding HTG to the rightful owner. This is a last-resort control."
          />
        </div>
      </div>

      {/* USDC section */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "hsl(var(--theo-mid))", marginBottom: 12 }}>
          About USDC
        </div>

        {/* Explainer card */}
        <div style={{
          borderRadius: 14, overflow: "hidden",
          border: "1.5px solid hsl(var(--theo-light))",
          marginBottom: 10,
        }}>
          {/* Header strip */}
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "16px 20px",
            background: "#2775CA", // USDC brand blue
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 99, flexShrink: 0,
              background: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <DollarSign style={{ width: 18, height: 18, color: "#2775CA", strokeWidth: 2.5 }} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#fff", letterSpacing: "-0.02em" }}>
                USD Coin (USDC)
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.60)", marginTop: 2 }}>
                Issued by Circle · regulated US dollar stablecoin
              </div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <a
                href="https://www.circle.com/usdc"
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "rgba(255,255,255,0.15)", border: "1.5px solid rgba(255,255,255,0.25)",
                  color: "#fff", borderRadius: 7, padding: "6px 12px",
                  fontSize: 11, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
                }}
              >
                usdc.circle.com <ExternalLink style={{ width: 10, height: 10 }} />
              </a>
              <a
                href="https://stellar.expert/explorer/testnet/asset/USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "rgba(255,255,255,0.15)", border: "1.5px solid rgba(255,255,255,0.25)",
                  color: "#fff", borderRadius: 7, padding: "6px 12px",
                  fontSize: 11, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
                }}
              >
                Stellar issuer <ExternalLink style={{ width: 10, height: 10 }} />
              </a>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: "18px 20px", background: "#fff" }}>
            <p style={{ fontSize: 13, color: "hsl(var(--theo-mid))", lineHeight: 1.7, margin: 0 }}>
              USDC is a fully collateralized US dollar stablecoin. USDC is the bridge between dollars and
              trading on cryptocurrency exchanges. The technology behind CENTRE makes it possible to exchange
              value between people, businesses and financial institutions — just like email between mail
              services and texts between SMS providers.
            </p>

            {/* Key facts row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 16 }}>
              {[
                { label: "Backing", value: "1 : 1 USD", sub: "Held in regulated US banks" },
                { label: "Issuer", value: "Circle", sub: "Centre Consortium" },
                { label: "On Chain", value: "Stellar", sub: "GBBD47…FLA5" },
              ].map(({ label, value, sub }) => (
                <div key={label} style={{
                  padding: "12px 14px", borderRadius: 10,
                  background: "hsl(var(--theo-cream))",
                  border: "1px solid hsl(var(--theo-light))",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "hsl(var(--theo-mid))", marginBottom: 4 }}>
                    {label}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "hsl(var(--theo-ink))" }}>{value}</div>
                  <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 2 }}>{sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* On-chain verification link */}
      <div style={{
        borderRadius: 12, padding: "16px 20px",
        background: "hsl(var(--theo-blue-soft))",
        border: "1.5px solid hsl(var(--theo-blue) / 0.15)",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "hsl(var(--theo-blue))", marginBottom: 3 }}>
            Verify the reserve yourself
          </div>
          <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
            The treasury account is public. Open it on Stellar Expert to see every token movement — no trust required.
          </div>
        </div>
        <a
          href={`https://stellar.expert/explorer/testnet/account/${HTGC_DISTRIBUTOR}`}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "hsl(var(--theo-blue))", color: "#fff",
            borderRadius: 8, padding: "9px 16px", fontSize: 12, fontWeight: 700,
            textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          Open on Stellar Expert <ExternalLink style={{ width: 11, height: 11 }} />
        </a>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </AppLayout>
  );
}
