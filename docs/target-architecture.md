# Target Architecture — Fund Flow, Ledger & HTG-C Mint/Burn Model

**Status:** This document describes the **INTENDED (target / mainnet) operating model.** It is **not fully as-built.** The current **testnet** implementation mints HTG-C and USDC on demand as a stand-in for upstream funding. Every section below marks **🎯 Target** (the design) vs **🔧 As-built** (what the code does today) wherever they differ.

**Read alongside:** `docs/architecture.md` (as-built edge-function contracts), `CLAUDE.md` (conventions, Stellar constants), `REBUILD.md` (path to production), `docs/adr/0001-stellar-native-no-rehive.md`.

> **The one sentence to internalize:** **Mint/burn happens ONLY at the reserve boundary (HTG deposit in, HTG withdrawal out). USDC ↔ HTG-C *conversions* draw from buffer pools — they do NOT mint or burn.** Today's testnet code violates this by minting on conversions; that is a simulation, not the target.

---

## 1. Core principle — supply invariant

HTG-C is a **gourde-backed Stellar asset**. The invariant the whole design protects:

```
HTG-C in circulation  ==  HTG reserves held in the SPIH segregated pool
```

To keep that true, **HTG-C supply only changes at the on/off-ramp boundary**:

- **Mint HTG-C** ⟺ real HTG **deposited** into reserves (Phase 1).
- **Burn HTG-C** ⟺ real HTG **withdrawn** from reserves and paid to a bank (Phase 4).

Everything *between* those boundaries — the USDC ↔ HTG-C conversions customers do all day — is **movement of pre-existing assets between Theo-owned buffers**, never a supply change. This is the single most important thing Cursor/any session gets wrong: **conversions are buffer draws, not mint/burn.**

---

## 2. Accounts & wallets

| Account | Role | Custody |
|---|---|---|
| **HTG-C Issuer** | Mints/burns HTG-C — **only** at the reserve boundary | `STELLAR_HTGC_ISSUER_SECRET` (`HTGC_ISSUER` = `GDSRYZWT…FCQT`) |
| **SPIH segregated HTG pool** | Real HTG reserves held at the bank | Off-chain (bank), tracked in ledger as `SPIH_BANK_HTG` |
| **Distributor (hot wallet)** | USDC operational float — pays out USDC on HTG-C→USDC conversions and customer payouts; receives customer HTG-C | `STELLAR_DISTRIBUTOR_SECRET` (`DISTRIBUTOR` = `GCP6VMZS…UBS2X`) |
| **Treasury** | HTG-C buffer + USDC buffer for conversions; receives USDC on USDC→HTG-C leg 1 | `TREASURY_PUBLIC` (in `_shared/stellar-assets.ts`) |
| **Blend** | Idle USDC deployed for yield | `blend-*` functions |

> **Distributor ≠ Treasury.** This is a real split the reconciliation cards track **separately** (see the AdminLedger reconciliation per-account). Do **not** model conversions as flowing through a single "Treasury buffer" — HTG-C→USDC uses the **Distributor**, USDC→HTG-C leg 1 lands in **Treasury**. (The USDC→HTG-C → Treasury routing was a bug fixed 2026-06; before that it mis-routed to the distributor.)

---

## 3. The four phases

### Phase 1 — HTG deposit → HTG-C mint (on-ramp boundary)
**🎯 Target & 🔧 As-built (MATCH).** Customer wires HTG into the SPIH pool → issuer **mints** HTG-C 1:1 to the customer. No rate, no fee. Increases `HTGC_ISSUED` and `SPIH_BANK_HTG` together. *(`create-quote` `htgc_mint`.)*

### Phase 2 — USDC → HTG-C conversion (buffer draw)
**🎯 Target:** Customer sends USDC → leg 1 lands in **Treasury**; Theo **releases HTG-C from the Treasury buffer** to the customer. **No mint.** Revenue = spread via `fee_bps` (+ forward premium, see §6).
**🔧 As-built (DIVERGES):** `execute-swap` `usdc_to_htgc` **mints fresh HTG-C from the issuer on every conversion** — there is no HTG-C buffer or "buffer available" branch yet. *(`execute-swap`: legs are user→distributor then distributor→user; htgc shortfall minted from issuer, "testnet only, simulates upstream funding".)*

### Phase 3 — HTG-C → USDC conversion (buffer draw)
**🎯 Target:** Customer sends HTG-C to the **Distributor**; Distributor pays **USDC from its float**. **No burn, no mint.** The received HTG-C sits in the Distributor/Treasury buffer to satisfy future USDC→HTG-C conversions. Revenue = spread via `fee_bps`.
**🔧 As-built (DIVERGES):** when the Distributor's USDC float is short, `release-usdc` / `execute-swap` **mint the USDC shortfall from the issuer** ("mint exact shortfall — no buffer"). *(`release-usdc` lines ~153-161; `execute-swap` htgc_to_usdc shortfall mint.)*

### Phase 4 — HTG-C withdrawal → HTG-C burn (off-ramp boundary)
**🎯 Target & 🔧 As-built (MATCH).** Customer's HTG-C is sent to the **issuer (a burn)**; HTG is paid out from the SPIH pool to their bank. Reduces `HTGC_ISSUED` and `SPIH_BANK_HTG` together. This is the **only** place HTG-C returns to the issuer. *(`execute-withdraw`: `Operation.payment({ destination: HTGC_ISSUER, asset: htgc })`; `withdraw-htgc` records the order.)*

---

## 4. Buffer & replenishment model

**🎯 Target — NOT YET BUILT.** Theo maintains two operational buffers — an **HTG-C buffer** (Treasury) and a **USDC buffer** (Distributor float) — sized to cover normal conversion volume. When a buffer runs low, replenish in tiers, **never by minting**:

```
① Buffer available        → serve the conversion directly from the buffer
② FX Forward execution     → draw on a pre-arranged FX forward to replenish
③ MoneyGram / OTC          → execute a spot OTC/MoneyGram trade to replenish
```

**🔧 As-built:** none of these tiers exist. Replenishment is always **"mint from issuer"** (the testnet simulation). There is no buffer-threshold logic, no FX-forward path, and no MoneyGram/OTC path. There is also **no buffer-maintenance / rebalancing routine** — balances are simply whatever mint/payout operations leave behind.

---

## 5. Ledger (double-entry shadow ledger)

- Every money event posts **balanced, per-currency** journal entries (debits == credits per currency). Validated by DB triggers; written via the `post_ledger_entries` RPC; idempotent by `source_key`.
- **Supply integrity:** because mint/burn only occurs at the reserve boundary, `HTGC_ISSUED` should always equal `SPIH_BANK_HTG`. Conversions move value between `TREASURY_*`, `DISTRIBUTOR_USDC`, `CUSTOMER_USDC`, and `FEE_REVENUE_USDC` — **no change to `HTGC_ISSUED`.** If a conversion ever moves `HTGC_ISSUED`, that is the testnet mint leaking into the books (and a target-model violation).
- **God-view / completeness:** the admin Transactions log + a Horizon **chain indexer** must book **every** on-chain movement on the issuer/distributor/treasury accounts — including out-of-band/manual transfers — so nothing bypasses the ledger. (See `REBUILD.md` Phase 2/3. This is why a manual distributor send once produced a −30,000 USDC chain-vs-book drift: it wasn't booked.)
- **Distributor vs Treasury reconcile separately** against Horizon — keep them distinct accounts.

---

## 6. Revenue streams

| Stream | Mechanism | Status |
|---|---|---|
| **Customer fee (spread)** | `fee_bps` (Theo, default 130) + `corridor_bps` (default 70) = 200 bps / 2% | ✅ live |
| **Forward premium** | FX premium added to the customer rate on USD↔HTG conversions | 🎯 target — **hardcoded `FORWARD_PREMIUM = 0`** in `create-quote` today |
| **Blend yield** | APY on idle USDC float deployed to Blend | ✅ live (`blend-sweep` / `blend-positions` / `blend-withdraw`) |

Margin is currently captured via `fee_bps`, **not** rate inflation (`MARGIN = 0` in `create-quote`).

---

## 7. As-built vs target — summary

| Topic | 🎯 Target (this doc) | 🔧 As-built (testnet code) |
|---|---|---|
| USDC → HTG-C | Release HTG-C from Treasury **buffer** | **Mints** HTG-C from issuer each time |
| HTG-C → USDC | Pay USDC from Distributor **float** | **Mints** USDC shortfall from issuer when short |
| Replenishment | ① buffer ② FX forward ③ MoneyGram/OTC | Always **mint from issuer** (simulation) |
| Mint/burn scope | **Only** at deposit (mint) / withdrawal (burn) | Also mints on conversions |
| Treasury vs Distributor | Two distinct buffers, reconciled separately | Two wallets exist; conversions split across them |
| Forward premium | A real FX revenue stream | `FORWARD_PREMIUM = 0` |
| Buffer maintenance | Active sizing/rebalancing | None — residual of operations |

Phases **1 and 4 match**; Phases **2 and 3 diverge** (mint-on-demand instead of buffer draw).

---

## 8. What must change to reach the target

(Mainnet hardening — coordinate with `REBUILD.md`.)

1. **Stop minting on conversions.** Replace the issuer-mint shortfall paths in `execute-swap` (both directions) and `release-usdc` with **buffer draws**; mint/burn calls remain only in the deposit (`htgc_mint`) and withdrawal (`execute-withdraw`) paths.
2. **Implement the two buffers + threshold logic** (HTG-C in Treasury, USDC in Distributor) with low-water marks that trigger replenishment.
3. **Build the replenishment tiers:** FX-forward execution and MoneyGram/OTC integration (`REBUILD.md` Phase 7).
4. **Turn on forward premium** (`create-quote`) once FX sourcing has a real cost/premium to pass through.
5. **Keep Distributor and Treasury split** explicit in the ledger accounts and reconciliation; never collapse them into one "buffer."
6. **Chain indexer** so every on-chain movement is booked (closes the manual-transfer drift class; preserves the supply invariant audit).

Until 1–3 land, the system is a faithful **simulation** of the target: it behaves correctly for demos, but mints where the target would draw from a buffer. That is expected on testnet and must not be read as the as-built mainnet design.
