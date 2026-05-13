# Stellar Community Fund — Build Award SCF #44

## Products & Services

Theo is building Haiti's first Stellar anchor — a compliant, transparent dollar account for the businesses that keep Haiti's import economy running.

A business deposits Haitian Gourdes and receives USDC in a Stellar wallet they control, settled in 3–5 seconds at a live, published rate. No negotiation. No hidden spread. No correspondent banking delays. Every transaction is recorded on-chain.

**The problem:** The Haitian Gourde has lost 80%+ of its value against the USD in five years. Many SMBs source dollars from the parallel market of informal money changers, who charge 5–15% with no receipts and no recourse. Traditional banks and the central bank of Haiti ration dollar access.

Haiti's medium and large importers — businesses moving $10M–$120M annually — have no formal, transparent alternative.

**Why Stellar:** USDC on Stellar provides a fully-reserved dollar instrument businesses receive directly into a self-custodied wallet. Stellar Classic Assets allow Theo to issue HTG-C — a Haitian Gourde stablecoin — with Clawback, Authorization Required, and Revocable flags that satisfy FATF compliance requirements for the Haitian market. SEP-24 powers Theo's anchor on/off-ramp, making Theo interoperable with every SEP-24-compatible wallet in the ecosystem without rebuilding rails from scratch. At 3–5 second finality and near-zero fees, Stellar is the only network that makes it economically viable to serve a business moving $10,000 and one moving $1M with equal profitability.

Theo's liquidity strategy is purpose-built for the Haiti corridor: a MoneyGram FX partnership for corridor execution at published rates, backed by a dedicated FX swap facility capitalized through IDB financing and angel investment. This gives Theo a funded, documented liquidity source from day one — not a marketplace that requires simultaneous supply and demand to function.

---

## Traction

**Signed MOU — NABATCO.SA / Groupe Acra.** Theo has executed a signed Memorandum of Understanding with NABATCO.SA, a division of Groupe Acra, one of Haiti's largest industrial conglomerates with operations spanning rice, flour, and food imports. Groupe Acra converts an estimated $100–120M annually in HTG to USD to fund international supplier payments. NABATCO has committed to participate in Theo's first live pilot upon mainnet readiness.

→ MOU: https://drive.google.com/file/d/1f8cKrwd_f3f-8pRN6OoRhHXtL86XgZoI/view?usp=sharing

**Founder Market Access.** Valéry Blain, Theo's Port-au-Prince-based co-founder and President, served as Marketing Manager at Caribbean Grain Company — a Groupe Acra subsidiary — from 2021 to 2024. This gives Theo direct, first-hand visibility into how Haiti's largest importers manage FX exposure, supplier payments, and dollar liquidity at scale, and a trusted relationship with the decision-makers Theo needs to close.

**Working Product on Stellar Testnet.** Theo's platform is fully operational on Stellar Testnet today. The MVP was built in 12 days and comprises ~22,000 lines of production code across 121 files — 21 Supabase edge functions, 20 application pages, and a full Stellar integration layer. The complete order lifecycle — HTG deposit → HTG-C mint → USDC release → customer wallet settlement → PDF receipt — runs end-to-end on live Stellar Testnet infrastructure. The HTG-C issuer is deployed, the BRH live rate engine is active, and multi-tenant customer wallets are live.

Built and operational as of this application:

- HTG-C Classic Asset on Stellar Testnet with Clawback, Authorization Required, and Revocable flags configured
- Live BRH (Banque de la République d'Haïti) rate feed — scrapes the official taux du jour page with automatic cache fallback, storing rate snapshots on-chain
- Full order lifecycle: quote (15-minute rate lock) → fund → mint → settle → receipt, with Stellar transaction hashes recorded on every order
- Atomic HTG-C ↔ USDC swap engine with automatic refund on leg-2 failure — no customer funds at risk during conversion
- Multi-tenant customer architecture with isolated wallets, orders, and fee history per client — row-level security enforced on every database table
- Transparent fee model: platform fee (130 bps) + corridor fee (70 bps) = 2% total, stored and auditable on every order record
- Transaction limit enforcement: 1 USDC minimum, 1,000,000 USDC maximum per payment, enforced at the signing layer
- KYB onboarding workflow with order gating by compliance status
- Admin compliance dashboard: mint/burn controls, reserve attestation, KYB management
- Invoice management: USDC and HTG-C invoicing with QR-code payment links
- USDC wallet-to-wallet payouts with automatic trustline verification
- Blend protocol yield integration — treasury earns 7% net APY on idle USDC
- Org-level team permissions (Owner / Treasury Analyst / Viewer) with granular access controls across 5 permission types
- PDF receipt and billing statement generation on every settled transaction
- All Stellar signing isolated to a single shared module — clean migration path to HSM-based custody

**Early Pipeline.** Beyond NABATCO, Theo has identified four additional Haitian import businesses in the $10M–$50M annual FX conversion range as near-term targets, sourced through Valéry's network in Port-au-Prince.

---

## Team

**Johan François — CEO & Co-Founder.** Johan is the builder of Theo. He architected and coded the entire platform — from the Stellar edge function infrastructure and HTG-C issuance logic to the customer-facing dashboard and compliance tooling. Prior to Theo, Johan spent nearly a year as an independent entrepreneur building in the fintech and cross-border payments space, developing direct knowledge of the operational gaps facing Haitian businesses with dollar access needs.

**Valéry Blain — President & Co-Founder.** Valéry is Theo's Port-au-Prince anchor. As former Marketing Manager at Caribbean Grain Company (Groupe Acra subsidiary, 2021–2024), he has direct professional relationships with the executive and board leadership of Haiti's largest industrial importers — including the relationship that produced the NABATCO MOU. Valéry leads business development, client onboarding, and Haiti-side operations. His on-the-ground presence in Port-au-Prince is operationally essential: Haiti's import sector runs on relationships.

**Alexander (Ben) Burns — Lead Blockchain Architect.** Ben brings institutional-grade blockchain engineering experience from Gemini, where he worked on custody and settlement infrastructure. He advises Theo's technical architecture with a focus on key custody, signing security, and production readiness for mainnet. Ben's background in regulated crypto environments directly informs Theo's approach to the signing layer, transaction limits, and the HSM-based custody roadmap planned for Tranche 2.

---

## Tranche 1 — MVP Completion & Mainnet Readiness

**Budget: $44,500**

| Category | Amount | Notes |
|---|---|---|
| Engineering | $28,000 | HTG-C mainnet deployment, order pipeline hardening, fee persistence, signing security layer, KYB workflow |
| Legal & Compliance | $8,000 | HTG-C asset legal documentation, TOML publication, compliance flag attestation |
| Infrastructure | $4,500 | Supabase production environment, Horizon node access, monitoring setup |
| Business Development | $4,000 | NABATCO pilot structuring, onboarding documentation, client dashboard preparation |

### What will you build and deliver?

Theo's core infrastructure is already operational on Stellar Testnet. Tranche 1 funds the hardening work required to bring the platform to production quality and deploy HTG-C on Stellar Mainnet.

**HTG-C Mainnet Deployment.** HTG-C is already issued as a Stellar Classic Asset on Testnet with Clawback, Authorization Required, and Revocable flags active. Tranche 1 completes the legal documentation, TOML publication, and mainnet deployment — making HTG-C a publicly verifiable, compliance-ready asset on Stellar Mainnet.

**Production-Grade Order Pipeline.** The full HTG → HTG-C → USDC order lifecycle is live on testnet. Tranche 1 hardens it for production:

- Fee persistence: every order stores fee_bps, theo_fee_usdc, and corridor_cost on the order record — the foundation of Theo's revenue ledger
- Automated distributor liquidity management with configurable top-up thresholds
- Signed transaction security with per-transaction limits to cap exposure
- Rate engine hardening: BRH rate snapshots with fallback logic and staleness guards

**KYB & Compliance Workflow.** Multi-tenant KYB onboarding with status gating is functional on testnet. Tranche 1 completes the admin workflow — document collection, approval and rejection controls, and order gating by KYB status — to production standard.

**Testnet Documentation.** 50+ end-to-end testnet transactions with publicly documented Stellar transaction hashes, covering the full flow from HTG deposit through USDC settlement and PDF receipt delivery.

### Acceptance Criteria

- HTG-C deployed on Stellar Mainnet with Clawback and Authorization flags verified on-chain
- 50+ completed testnet orders with documented Stellar transaction hashes
- Fee columns populated on every order with revenue query returning non-zero results
- Admin KYB workflow operational with order gating enforced by approval status
- Transaction limit guards active in signing layer

---

## Tranche 2 — Security Hardening, Multi-Client Infrastructure & Liquidity Integration

**Budget: $54,500**

| Category | Amount | Notes |
|---|---|---|
| Engineering | $35,000 | MoneyGram FX API integration, FX swap facility technical integration, multi-tenant wallet architecture, audit logging, KMS + MPC signing architecture |
| Legal & Compliance | $10,000 | FX swap facility term sheet, BSA/AML compliance framework, per-customer KYB legal review |
| Infrastructure | $5,500 | Production hardening, security audit, uptime monitoring, staging environment |
| Business Development | $4,000 | Additional enterprise client pipeline, development finance relationships, MoneyGram partnership finalization |

### What will you build and deliver?

With the core flow validated and mainnet-ready, Tranche 2 funds the infrastructure that makes Theo safe and scalable for multiple enterprise clients simultaneously — and connects it to real, funded liquidity sources.

**Liquidity Rail Integration.** Theo's FX liquidity comes from two complementary sources — not a marketplace model:

1. **MoneyGram FX Partnership** — MoneyGram provides HTG/USD corridor execution at published, documented rates through their existing Haiti network. API integration automates rate fetching, order routing, and settlement instructions. MoneyGram's compliance infrastructure provides a regulated cost basis for the corridor fee passed through to customers.

2. **Structured FX Swap Facility** — Theo is structuring a dedicated FX swap facility capitalized through development finance institutions and angel investment. This gives Theo a direct, funded HTG → USD conversion channel at bank-grade rates — independent of any single corridor partner. Term sheet negotiation is a Tranche 2 deliverable.

**KMS + MPC Signing Architecture.** Theo's current signing architecture stores the distributor keypair as a vault secret, accessed through a single isolated signing module. Tranche 2 replaces this with a non-custodial signing layer where no single party ever holds a complete key:

- **Share 1** stored in AWS Key Management Service — never accessible outside of a signing request
- **Share 2** derived from the authenticated user's session — exists only for the duration of the session; Theo cannot reconstruct it independently
- Both shares combined through an MPC protocol to produce a valid Stellar signature without ever reconstructing the full private key
- Per-transaction and per-customer daily limits enforced at the signing layer

This means Theo cannot unilaterally move client funds — a critical trust and compliance requirement for enterprise clients and a prerequisite for future regulatory engagement. Full technical specification is maintained separately.

**Billing & Compliance Infrastructure.**

- Customer-facing billing portal with itemized fee statements: Theo margin, corridor cost, gross and net USDC — exportable as PDF
- Admin revenue dashboard: total fees earned, margin vs. corridor cost, per-customer volume by period
- Automated compliance reporting suitable for BSA/AML review

**Multi-Client Isolation.** Each enterprise customer operates with a fully isolated Stellar wallet, isolated order ledger, and isolated fee history. Row-level security is enforced on every table in the database — no cross-contamination of data or funds across clients.

### Acceptance Criteria

- MoneyGram FX API integrated with live corridor cost reflected in order fee calculation
- FX swap facility term sheet executed or financing source documented
- KMS + MPC signing architecture deployed — distributor key migrated out of environment variables, raw key material no longer accessible to application layer
- Per-transaction and per-customer daily limits enforced in signing layer with audit log operational
- Billing PDF statement generated correctly for a customer with 10+ completed testnet orders
- Three distinct customer accounts operating concurrently on testnet without data leakage

---

## Tranche 3 — Mainnet Launch, NABATCO Pilot & Stellar Anchor Listing

**Budget: $49,500**

| Category | Amount | Notes |
|---|---|---|
| Engineering | $28,000 | Mainnet deployment, SEP-24 anchor implementation, external wallet interoperability, NABATCO pilot technical execution |
| Legal & Compliance | $8,500 | Mainnet compliance documentation, anchor listing submission, Haiti regulatory engagement |
| Infrastructure | $6,000 | Mainnet operations, distributed key custody groundwork, production monitoring |
| Business Development | $7,000 | NABATCO live pilot execution, anchor ecosystem marketing, second enterprise client activation |

**Total across all tranches: $148,500** | Target Mainnet: Q4 2026

### What constitutes a successful mainnet launch?

Tranche 3 moves Theo from testnet to live production with a named enterprise client and establishes Haiti's first compliant HTG stablecoin and Stellar anchor on Mainnet.

**Full Production Deployment.**

- HTG-C live on Stellar Mainnet with compliance flags active and TOML published
- Distributor funded with initial USDC liquidity
- All edge functions running against mainnet Horizon endpoints
- Customer dashboard live at production domain

**First Live Pilot — NABATCO / Groupe Acra.** Theo has a signed MOU with NABATCO.SA committing to participate in Theo's first live pilot. The pilot will process real HTG → USDC conversions for NABATCO's supplier payment workflow — the first documented, on-chain, enterprise-scale HTG/USD settlement in Haiti's history.

Deliverables:

- Minimum 5 live production orders completed for NABATCO with publicly verifiable on-chain transaction hashes
- Customer billing statement generated and delivered to the NABATCO treasury team

**Compliant HTG-C on Mainnet.**

- Clawback enabled — FATF Travel Rule asset recovery compliance
- Authorization Required — permissioned holder list, KYB-gated trustlines
- Published TOML with legal documentation at asset home domain
- Mint/burn restricted to Theo's compliance-reviewed issuer keypair, controlled via admin compliance dashboard

**SEP-24 Anchor Implementation.** Theo's architecture is designed for SEP-24 from the ground up. Tranche 3 completes the anchor implementation:

- Any SEP-24-compatible wallet can initiate HTG → USDC deposits through Theo
- Theo listed as a verified anchor on the Stellar anchor directory
- Full interoperability with the Stellar ecosystem independent of Theo's proprietary dashboard

This makes Theo a public infrastructure layer for Haiti — not just a product for Theo's direct customers. Haiti currently has no listed Stellar anchor. Theo changes that.

### Acceptance Criteria

- Minimum 5 live Mainnet orders completed for NABATCO with on-chain transaction hashes
- HTG-C live on Mainnet with TOML and compliance flags publicly verifiable
- SEP-24 anchor flow completed end-to-end with at least one external wallet
- Theo listed on the Stellar anchor directory
- Customer billing statement delivered to NABATCO treasury team
