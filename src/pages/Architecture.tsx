import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SYSTEM_DIAGRAM = `
flowchart LR
  U[Customer Browser<br/>React SPA]:::client
  A[Admin Browser]:::client
  AUTH[(Auth + Profiles)]:::db
  KYB[(kyb_submissions)]:::db
  ORD[(orders)]:::db
  ROLES[(user_roles)]:::db
  CQ[create-quote]:::fn
  SIM[simulate-spih-payment<br/>planned]:::fnp
  REL[release-usdc<br/>planned]:::fnp
  ST[Stellar Horizon<br/>testnet]:::ext

  U -->|sign in| AUTH
  U -->|submit| KYB
  U -->|POST| CQ
  CQ -->|insert| ORD
  U -.realtime.- ORD
  A -->|review| KYB
  A -->|trigger| SIM
  SIM -->|FUNDED| ORD
  SIM --> REL
  REL -->|payment op| ST
  REL -->|tx hash| ORD
  AUTH --- ROLES

  classDef client fill:#EEF0FB,stroke:#33359A,color:#1A1A2E;
  classDef db fill:#FFF3CD,stroke:#FDCF00,color:#33359A;
  classDef fn fill:#D0F0FB,stroke:#08B5E5,color:#1A1A2E;
  classDef fnp fill:#FFFFFF,stroke:#08B5E5,color:#6B6B8A,stroke-dasharray: 4 3;
  classDef ext fill:#33359A,stroke:#33359A,color:#FFFFFF;
`;

const STATE_DIAGRAM = `
stateDiagram-v2
  [*] --> QUOTED: create-quote
  QUOTED --> FUNDED: SPIH match
  QUOTED --> EXPIRED: 15 min timeout
  FUNDED --> RELEASING: release-usdc
  RELEASING --> COMPLETED: Stellar tx ok
  RELEASING --> FAILED: Stellar error
  COMPLETED --> [*]
  EXPIRED --> [*]
  FAILED --> [*]
`;

function MermaidBlock({ chart, id }: { chart: string; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: "base",
          themeVariables: {
            fontFamily: "Inter, sans-serif",
            primaryColor: "#EEF0FB",
            primaryTextColor: "#1A1A2E",
            primaryBorderColor: "#33359A",
            lineColor: "#33359A",
            secondaryColor: "#FFF3CD",
            tertiaryColor: "#FFFFFF",
          },
        });
        const { svg } = await mermaid.render(id, chart);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to render diagram");
      }
    })();
    return () => { cancelled = true; };
  }, [chart, id]);

  if (err) return <pre className="text-xs text-destructive whitespace-pre-wrap">{err}</pre>;
  return <div ref={ref} className="w-full overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto" />;
}

const TABLES: { name: string; purpose: string; rls: string }[] = [
  { name: "profiles", purpose: "Per-user profile, joined to auth.users by id", rls: "Owner can read/update self" },
  { name: "user_roles", purpose: "App roles (admin, user) — separate from profiles for security", rls: "Read self; admin checks via has_role()" },
  { name: "kyb_submissions", purpose: "Business verification documents and review status", rls: "Owner CRUD; admins read all + update status" },
  { name: "orders", purpose: "HTG → USDC orders with status, rate, reference, stellar_tx_hash", rls: "Owner read/insert; admins read all" },
];

const FUNCTIONS: { name: string; status: "deployed" | "planned"; desc: string }[] = [
  { name: "create-quote", status: "deployed", desc: "Validates KYB approved, locks rate, creates QUOTED order with 15-min expiry and unique reference." },
  { name: "simulate-spih-payment", status: "planned", desc: "Admin-only debug fn. Flips QUOTED → FUNDED and enqueues release." },
  { name: "release-usdc", status: "planned", desc: "Signs Stellar payment op with distributor key, submits to Horizon testnet, writes tx hash, transitions to COMPLETED." },
];

export default function Architecture() {
  return (
    <AppLayout>
      <div className="mb-8">
        <p className="eyebrow text-theo-cyan">System map</p>
        <h1 className="font-display text-4xl md:text-5xl font-extrabold tracking-tightest mt-2">Architecture</h1>
        <p className="font-serif italic text-theo-cyan font-bold mt-2">How Theo turns gourdes into dollars.</p>
        <div className="mt-3 h-[3px] w-10 bg-secondary" />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <p className="eyebrow text-theo-cyan">Overview</p>
          <CardTitle className="font-display">Customer, admin and Stellar</CardTitle>
        </CardHeader>
        <CardContent>
          <MermaidBlock chart={SYSTEM_DIAGRAM} id="theo-arch-overview" />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <p className="eyebrow text-theo-cyan">Order lifecycle</p>
          <CardTitle className="font-display">State machine</CardTitle>
        </CardHeader>
        <CardContent>
          <MermaidBlock chart={STATE_DIAGRAM} id="theo-arch-states" />
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <p className="eyebrow text-theo-cyan">Data model</p>
            <CardTitle className="font-display">Core tables</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {TABLES.map((t) => (
              <div key={t.name} className="border-b border-border last:border-0 pb-3 last:pb-0">
                <code className="text-sm font-bold text-primary">{t.name}</code>
                <p className="text-sm mt-1">{t.purpose}</p>
                <p className="text-xs text-muted-foreground mt-1">RLS: {t.rls}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className="eyebrow text-theo-cyan">Backend functions</p>
            <CardTitle className="font-display">Edge functions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {FUNCTIONS.map((f) => (
              <div key={f.name} className="border-b border-border last:border-0 pb-3 last:pb-0">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-bold text-primary">{f.name}</code>
                  <Badge variant={f.status === "deployed" ? "default" : "outline"} className="text-[10px]">
                    {f.status}
                  </Badge>
                </div>
                <p className="text-sm mt-1">{f.desc}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <p className="eyebrow text-theo-cyan">Configuration</p>
          <CardTitle className="font-display">Secrets & environment</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li><code className="text-primary font-bold">LOVABLE_API_KEY</code> — auto-provisioned by Lovable Cloud for AI gateway.</li>
            <li><code className="text-primary font-bold">STELLAR_DISTRIBUTOR_SECRET</code> — <span className="text-muted-foreground">planned.</span> Secret key for the testnet distributor account.</li>
            <li><code className="text-primary font-bold">STELLAR_USDC_ISSUER</code> — <span className="text-muted-foreground">planned.</span> Public key of the testnet USDC issuer.</li>
            <li><code className="text-primary font-bold">SUPABASE_URL / SERVICE_ROLE_KEY</code> — auto-provided to edge functions.</li>
          </ul>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
