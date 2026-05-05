import { useEffect, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { ShieldCheck, RefreshCw, ExternalLink, CheckCircle2, AlertCircle } from "lucide-react";

const HTGC_ISSUER = "GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT";
const HORIZON_URL = "https://horizon-testnet.stellar.org";

type IssuerFlags = {
  auth_required: boolean;
  auth_revocable: boolean;
  auth_clawback_enabled: boolean;
  auth_immutable: boolean;
};

type IssuerData = {
  flags: IssuerFlags;
  balances: Array<{ asset_type: string; balance: string }>;
  sequence: string;
  last_modified_ledger: number;
};

type FetchState = "idle" | "loading" | "ok" | "error";

function Flag({ label, enabled, description }: { label: string; enabled: boolean; description: string }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: 14,
        padding: "16px 20px",
        background: enabled ? "#F0FDF4" : "#FFF",
        border: `1.5px solid ${enabled ? "#86EFAC" : "hsl(var(--theo-light))"}`,
        borderRadius: 12,
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: enabled ? "#DCFCE7" : "hsl(var(--theo-cream))",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {enabled
          ? <CheckCircle2 style={{ width: 16, height: 16, color: "#16A34A" }} />
          : <AlertCircle style={{ width: 16, height: 16, color: "hsl(var(--theo-mid))" }} />
        }
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "hsl(var(--theo-ink))" }}>{label}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99,
            background: enabled ? "#16A34A" : "hsl(var(--theo-light))",
            color: enabled ? "#fff" : "hsl(var(--theo-mid))",
            textTransform: "uppercase", letterSpacing: "0.08em",
          }}>
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", lineHeight: 1.5 }}>
          {description}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-ink))", fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}

export default function Compliance() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<IssuerData | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchIssuer = async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`${HORIZON_URL}/accounts/${HTGC_ISSUER}`);
      if (!res.ok) throw new Error(`Horizon returned ${res.status}`);
      const json = await res.json();
      setData(json as IssuerData);
      setFetchedAt(new Date());
      setState("ok");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  };

  useEffect(() => { fetchIssuer(); }, []);

  const flags = data?.flags;

  return (
    <AppLayout>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "hsl(var(--theo-mid))", marginBottom: 6 }}>
              Issuer controls
            </div>
            <h1 style={{ fontWeight: 800, fontSize: 28, color: "hsl(var(--theo-blue))", letterSpacing: "-0.03em", margin: 0 }}>
              Compliance
            </h1>
            <div style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 10 }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {fetchedAt && (
              <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                Live · {fetchedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            <button
              onClick={fetchIssuer}
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
              <RefreshCw style={{ width: 12, height: 12, strokeWidth: 2.5, animation: state === "loading" ? "spin 1s linear infinite" : undefined }} />
              Refresh
            </button>
          </div>
        </div>

        <p style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 12, maxWidth: 580, lineHeight: 1.6 }}>
          Live read from Horizon testnet — showing the current auth flags on the HTG-C issuer account.
          These flags control trustline authorisation and clawback, giving Theo full regulatory control over the token supply.
        </p>
      </div>

      {/* Loading / error states */}
      {state === "loading" && (
        <div style={{ padding: "48px 0", textAlign: "center", color: "hsl(var(--theo-mid))", fontSize: 13 }}>
          <RefreshCw style={{ width: 20, height: 20, margin: "0 auto 12px", display: "block", opacity: 0.5, animation: "spin 1s linear infinite" }} />
          Fetching issuer account from Stellar testnet…
        </div>
      )}
      {state === "error" && (
        <div style={{ padding: 20, borderRadius: 12, background: "#FEF2F2", border: "1.5px solid #FECACA", color: "#991B1B", fontSize: 13, marginBottom: 20 }}>
          <span style={{ fontWeight: 700 }}>Could not reach Horizon: </span>{error}
        </div>
      )}

      {state === "ok" && flags && (
        <>
          {/* Issuer identity card */}
          <div style={{
            background: "hsl(var(--theo-blue))", borderRadius: 16,
            padding: "20px 24px", marginBottom: 20,
            display: "flex", alignItems: "center", gap: 16,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: "rgba(255,255,255,0.10)", border: "1.5px solid rgba(255,255,255,0.18)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <ShieldCheck style={{ width: 22, height: 22, color: "#FDCF00" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(255,255,255,0.50)", marginBottom: 4 }}>
                HTG-C Issuer Account · Stellar Testnet
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600, color: "#fff", wordBreak: "break-all" }}>
                {HTGC_ISSUER}
              </div>
            </div>
            <a
              href={`https://stellar.expert/explorer/testnet/account/${HTGC_ISSUER}`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "flex", alignItems: "center", gap: 5,
                background: "rgba(255,255,255,0.10)", border: "1.5px solid rgba(255,255,255,0.20)",
                color: "#fff", borderRadius: 8, padding: "8px 14px",
                fontSize: 12, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              View on Stellar Expert <ExternalLink style={{ width: 11, height: 11 }} />
            </a>
          </div>

          {/* Auth flags */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "hsl(var(--theo-mid))", marginBottom: 12 }}>
              Account Flags
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Flag
                label="auth_required"
                enabled={flags.auth_required}
                description="Every counterparty must have an explicitly authorised trustline before they can hold HTG-C. Theo approves each holder during KYB."
              />
              <Flag
                label="auth_revocable"
                enabled={flags.auth_revocable}
                description="Theo can freeze a holder's trustline at any time — for example, in response to a regulatory order, AML flag, or dispute resolution."
              />
              <Flag
                label="auth_clawback_enabled"
                enabled={flags.auth_clawback_enabled}
                description="Theo can reclaim HTG-C from any wallet. This enables error correction, regulatory compliance, and enforced redemption without holder cooperation."
              />
              <Flag
                label="auth_immutable"
                enabled={flags.auth_immutable}
                description="When enabled the issuer account can no longer be modified. Currently disabled — Theo retains the ability to update flags as the protocol matures."
              />
            </div>
          </div>

          {/* Meta */}
          <div style={{
            marginTop: 20, borderRadius: 12,
            border: "1px solid hsl(var(--theo-light))",
            background: "#fff", padding: "16px 20px",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "hsl(var(--theo-mid))", marginBottom: 14 }}>
              Account Details
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
              <InfoRow label="Sequence" value={data!.sequence} mono />
              <InfoRow label="Last Modified Ledger" value={String(data!.last_modified_ledger)} mono />
              <InfoRow label="Network" value="Stellar Testnet" />
            </div>
          </div>

          {/* Audit note */}
          <div style={{
            marginTop: 14, borderRadius: 12, padding: "14px 18px",
            background: "hsl(var(--theo-blue-soft))",
            border: "1.5px solid hsl(var(--theo-blue) / 0.15)",
            fontSize: 12, color: "hsl(var(--theo-mid))", lineHeight: 1.6,
          }}>
            <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>Audit trail: </span>
            All flag changes are permanently recorded on the Stellar blockchain and can be independently verified at any time.
            The HTG-C asset is publicly inspectable — issuance, trustline authorisations, and balance movements are fully transparent on-chain.
          </div>
        </>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </AppLayout>
  );
}
