import { Link } from "react-router-dom";

const ENDPOINT_BASE = `${import.meta.env.VITE_SUPABASE_URL || "https://nlbnmsiqfywskuxhqjon.supabase.co"}/functions/v1`;

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre style={{
      background: "hsl(var(--theo-blue-soft))",
      border: "1px solid hsl(var(--theo-blue-chip, var(--theo-light)))",
      borderRadius: 10,
      padding: 14,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      color: "hsl(var(--theo-ink))",
      overflowX: "auto",
      whiteSpace: "pre-wrap",
    }}>{children}</pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "hsl(var(--theo-blue))", marginBottom: 10 }}>{title}</h2>
      {children}
    </section>
  );
}

export default function DocsOdoo() {
  return (
    <div style={{ minHeight: "100vh", background: "hsl(var(--theo-cream))", padding: "48px 24px" }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <div style={{ marginBottom: 8 }}>
          <Link to="/settings" style={{ fontSize: 12, color: "hsl(var(--theo-cyan))", textDecoration: "none" }}>← Back to Settings</Link>
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em", marginBottom: 6 }}>
          Theo for Odoo
        </h1>
        <p style={{ fontSize: 14, color: "hsl(var(--theo-mid))", marginBottom: 24 }}>
          Pay vendor bills directly from Odoo using your Theo balance.
        </p>

        <Section title="1. Generate an API key">
          <p style={{ fontSize: 13, color: "hsl(var(--theo-ink))", marginBottom: 10 }}>
            Open <Link to="/settings" style={{ color: "hsl(var(--theo-cyan))" }}>Settings → API & Integrations</Link>,
            click <strong>Generate API key</strong>, and copy the key (shown once).
          </p>
        </Section>

        <Section title="2. Install the Odoo module">
          <p style={{ fontSize: 13, color: "hsl(var(--theo-ink))", marginBottom: 10 }}>
            Drop the <code>theo_payment</code> module folder into your Odoo addons path, restart Odoo,
            and install <strong>Theo Payment</strong> from <em>Apps</em>. Then go to
            <em> Accounting → Configuration → Theo</em> and paste your API key + the endpoint below.
          </p>
        </Section>

        <Section title="3. Endpoint base URL">
          <Code>{ENDPOINT_BASE}</Code>
        </Section>

        <Section title="Test connection">
          <Code>{`curl -X GET "${ENDPOINT_BASE}/theo-api-ping" \\
  -H "Authorization: Bearer theo_live_…"`}</Code>
        </Section>

        <Section title="List wallets and balances">
          <Code>{`curl -X GET "${ENDPOINT_BASE}/theo-api-wallets" \\
  -H "Authorization: Bearer theo_live_…"`}</Code>
        </Section>

        <Section title="Create a quote">
          <Code>{`curl -X POST "${ENDPOINT_BASE}/theo-api-quote" \\
  -H "Authorization: Bearer theo_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "source_wallet_id": "<id from /theo-api-wallets>",
    "amount_usd": 1500,
    "supplier": {
      "name": "Acme Imports",
      "stellar_address": "GABC…",
      "external_ref": "BILL/2026/0001"
    }
  }'`}</Code>
        </Section>

        <Section title="Execute the payment">
          <Code>{`curl -X POST "${ENDPOINT_BASE}/theo-api-pay" \\
  -H "Authorization: Bearer theo_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "quote_id": "<quote_id from /theo-api-quote>",
    "external_invoice_ref": "BILL/2026/0001"
  }'`}</Code>
        </Section>

        <Section title="Error codes">
          <ul style={{ fontSize: 13, color: "hsl(var(--theo-ink))", lineHeight: 1.7, paddingLeft: 18 }}>
            <li><code>401</code> — Missing or invalid API key</li>
            <li><code>403</code> — Missing scope, KYB not approved, or quote belongs to another customer</li>
            <li><code>404</code> — Quote, wallet, or customer not found</li>
            <li><code>409</code> — Quote already used</li>
            <li><code>410</code> — Quote expired (15-min TTL)</li>
            <li><code>502</code> — On-chain payment failed (transient or insufficient funds)</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
