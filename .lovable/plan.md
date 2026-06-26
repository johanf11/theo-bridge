## Use user-provided address as the Owlting omnibus collector

Skip wallet generation entirely. Seed `app_settings.owlting_omnibus_address` directly with the provided Stellar address so `pay-vendor-owlting` resolves it on the first call. No UI needed.

### Address
`GDLAQLNZNXLDJ2J2LDG3J5EAYAKAHAUSDFTKURMNED2J7LXJ7UET65RQ`

### Steps
1. **Migration** — upsert into `public.app_settings`:
   ```sql
   INSERT INTO public.app_settings (key, value)
   VALUES (
     'owlting_omnibus_address',
     jsonb_build_object(
       'address', 'GDLAQLNZNXLDJ2J2LDG3J5EAYAKAHAUSDFTKURMNED2J7LXJ7UET65RQ',
       'source', 'externally_managed',
       'created_at', now()
     )
   )
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
   ```
   No `secret` field — this wallet is not Theo-managed.

2. **AdminOwlting.tsx** — remove the "Create omnibus wallet" CTA (and the `setup-owlting-omnibus` invocation). Replace the empty state with a read-only display of the configured address. Page becomes purely the wire queue + "Mark wired" action.

3. **Cleanup** — delete `supabase/functions/setup-owlting-omnibus/` (no longer used; testnet wallet generation isn't appropriate for an externally-managed address).

### Caveat
The provided address must already have a USDC trustline open (and authorized by the USDC issuer) on testnet for `pay-vendor-owlting` payments to succeed. If it doesn't, the first payment will fail with `op_no_trust`. I'll note this in the AdminOwlting empty state but won't try to open the trustline — that's the address owner's responsibility.
