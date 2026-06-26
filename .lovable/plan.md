Your local clone has a **merge conflict** in `supabase/functions/theo-api-quote/index.ts` (visible as `<<<<<<< Updated upstream` / `>>>>>>> Stashed changes` markers in the screenshots). It also has 3 uncommitted changes that overlap with what Lovable already shipped to `main`:

- `supabase/functions/_shared/odoo-settlement.ts`
- `supabase/functions/theo-api-quote/index.ts`
- `supabase/migrations/20260626131000_raise_usdc_conversion_limit.sql`

These local edits look like an **older version** of the "raise USDC conversion cap" work — they reintroduce a `$100K` cap and a `HTGC_CONVERSION_USDC_MAX` constant. Lovable's main branch has already moved past this: the cap was fully removed for the Odoo path (min $1K only, no upper bound) in the latest deploy.

## Recommended path: discard local, accept Lovable's main

Since Lovable's `main` is the source of truth and your local edits are a stale/conflicting version of the same feature, the cleanest sync is:

```bash
# 1. From your local theo-bridge repo root:
git status                          # confirm the 3 modified files
git stash -u                        # safety net — stash local edits + the conflict
git fetch origin
git reset --hard origin/main        # hard-reset working tree to Lovable's main
```

After this:
- The conflict markers disappear.
- Your working tree exactly matches what's running in Lovable / production.
- Your stashed edits remain recoverable via `git stash list` / `git stash show -p stash@{0}` if you want to diff them later, but they should not be reapplied — the cap removal is already live.

## If you want to keep some of the local edits

Tell me which behavior you want preserved (e.g. the `$100K` hard cap, or the `HTGC_CONVERSION_USDC_MAX` constant) and I'll produce a targeted resolution instead of a hard reset. Otherwise the hard reset is the right move.

## Why this happened

Both sides edited the same three files for the same feature ("raise USDC conversion limit") in parallel. Git couldn't auto-merge `theo-api-quote/index.ts`, so it inserted conflict markers. The other two files merged but still differ from `origin/main`.
