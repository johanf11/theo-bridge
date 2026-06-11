# Theo Bridge

Haiti's first Stellar anchor — a compliant B2B foreign-exchange platform for Haitian importers and corporate treasuries.

Businesses deposit Haitian Gourdes (HTG) via the SPIH interbank network and receive USDC in a Stellar wallet, settled in seconds at the official BRH reference rate.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript (hosted on Lovable) |
| Backend | Supabase (Postgres + Auth + Edge Functions) |
| Settlement | Stellar testnet via `@stellar/stellar-sdk@12.3.0` |
| PDF | jsPDF (client-side receipts and fee statements) |

## Quick start

```bash
bun install
bun run dev        # http://localhost:8080
npx tsc --noEmit   # type check
bun run lint
bun run test
```

## Key docs

| File | Purpose |
|---|---|
| `CLAUDE.md` | Conventions, commands, Stellar constants, decision rules — **read first** |
| `docs/architecture.md` | Full system architecture, data model, edge function contracts |
| `docs/design.md` | Design system — colors, typography, component patterns |
| `REBUILD.md` | Roadmap: port off Lovable, harden to mainnet (Phases 0–9) |
| `docs/target-architecture.md` | Intended fund flow and mint/burn model for mainnet |
| `docs/adr/0001-stellar-native-no-rehive.md` | Why Stellar-native, not Rehive |
| `docs/stellar-queries.md` | Horizon curl commands and debugging runbook |

## Supabase project

Project ref: `nlbnmsiqfywskuxhqjon`  
Dashboard: https://supabase.com/dashboard/project/nlbnmsiqfywskuxhqjon

Do not edit `src/integrations/supabase/client.ts` or `types.ts` — both are auto-generated.
