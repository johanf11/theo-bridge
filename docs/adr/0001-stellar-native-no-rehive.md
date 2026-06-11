# ADR 0001 — Build Stellar-native, not on Rehive

**Date:** 2026-04 (project start)
**Status:** Accepted

---

## Context

When designing Theo's HTG ↔ USDC corridor, the two viable implementation paths were:

**Option A — Rehive (or similar custody layer)**
Rehive is a fintech-as-a-service platform that provides hosted wallets, ledger accounting, and a multi-asset API. Several Stellar anchors have been built on it. It would have accelerated the initial wallet and ledger layer.

**Option B — Stellar-native**
Build directly on top of Stellar's Horizon API using `@stellar/stellar-sdk`, managing keypairs, trustlines, and transaction building ourselves. Use Supabase edge functions as the signing backend.

---

## Decision

Build Stellar-native (Option B).

---

## Rationale

**1. HTG-C is a first-class Stellar asset, not a ledger abstraction.**
Rehive treats blockchain as an optional settlement layer underneath its own internal ledger. HTG-C requires Stellar-native issuance semantics: Authorization Required, Revocable, and Clawback flags on the asset itself. These are control mechanisms required by Haitian financial regulators (BRH) and cannot be adequately represented in a generic hosted ledger.

**2. Settlement speed is the product.**
3–5 second Stellar finality is a core customer promise. A Rehive intermediary layer would add latency and hide the on-chain proof from the customer. Showing the Stellar tx hash immediately and linking to Stellar Explorer is part of the compliance and trust story.

**3. Fewer dependencies = faster iteration for a solo founder.**
Rehive adds a paid third-party dependency, API rate limits, and a new auth surface. With Supabase edge functions as the signing backend, the entire stack is two vendors (Supabase + Stellar). This was achievable in 1–2 weeks.

**4. Signing architecture migration is isolated.**
The current signing approach (secrets in Supabase env) is acknowledged as testnet-only. The migration to AWS KMS + CloudHSM is contained to `_shared/stellar-signer.ts` — a single file with a clear migration comment. A Rehive architecture would make this harder to own.

**5. SCF anchor requirements.**
Stellar Community Fund Build Award applications for anchor infrastructure expect direct Stellar integration. A Rehive-backed anchor would not qualify as "Stellar-native" for SEP-6/SEP-24 purposes in a future mainnet deployment.

---

## Consequences

**Accepted tradeoffs:**
- We own the keypair custody problem. Customer `stellar_secret` is stored in Postgres at rest (encrypted by Supabase). This is adequate for testnet but requires KMS before mainnet.
- We implement trustline management, balance reads, and transaction building ourselves. This is about 400 lines of code across the edge functions.
- No built-in retry queue for failed transactions. The `job_queue` table exists but is not wired to a cron executor yet.

**What this enables:**
- Full HTG-C asset compliance flag control
- Direct Horizon integration — customers see real tx hashes
- Reserve proof is verifiable on Stellar Explorer without any intermediary
- Clean migration path to MPC/HSM signing at mainnet
