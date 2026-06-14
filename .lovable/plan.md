## Why no code arrived

The recovery hook fired successfully at 00:13 UTC for `johanfrancois@me.com` (auth log confirms `user_recovery_requested` → 200). So the email *was* sent — it just doesn't contain what the reset page needs.

Root cause: there are no custom auth email templates in this repo (`supabase/functions/_shared/email-templates/` and `supabase/functions/auth-email-hook/` don't exist). Supabase is therefore sending its **default recovery email**, which contains a magic-link only — no 6-digit `{{ .Token }}`.

But `ForgotPassword.tsx` calls `resetPasswordForEmail` with no `redirectTo` (comment: "we want a code-based recovery, not a magic link") and `ResetPassword.tsx` calls `supabase.auth.verifyOtp({ type: "recovery", token: <6 digits> })`. That flow requires the email to print the OTP token. The default template doesn't, so the user gets a link they can't paste into the 6-digit input — effectively "no code".

The email domain `notify.app.theokingdom.com` is verified, so we can scaffold managed Lovable auth templates and the recovery template will include the 6-digit code.

## Plan

1. **Scaffold managed auth email templates** via `email_domain--scaffold_auth_email_templates`. This creates:
   - `supabase/functions/_shared/email-templates/{signup,magic-link,recovery,invite,email-change,reauthentication}.tsx`
   - `supabase/functions/auth-email-hook/{index.ts,deno.json}`

2. **Brand the templates with Theo tokens** (read `src/index.css` for the actual HSL values; don't guess):
   - Primary button: `--theo-blue` (#33359A) bg, white text, 10px radius
   - Heading color: `--theo-ink`
   - Body text: `--theo-mid`
   - Font stack: Inter (Plain isn't email-safe), with system-ui fallback
   - Apply to all six templates, not just recovery
   - Recovery email **must** prominently display `{{ .Token }}` as a large, monospaced 6-digit block, with copy below: "Enter this code at app.theokingdom.com to set a new password. Code expires in 1 hour."
   - Email tone: match the app's professional B2B Haitian-market voice; keep both EN copy (FR localization can be a follow-up)
   - Add a small Theo "T" mark at top if a suitable logo asset exists in `public/` (skip if not — don't ask)

3. **Deploy** `auth-email-hook` via `supabase--deploy_edge_functions`.

4. **Tell the user** to re-tap "Request a new code" on `/forgot-password` — the new template will include the 6-digit code. No changes to `ForgotPassword.tsx` or `ResetPassword.tsx` are needed; the OTP flow they implement is correct, it was just starved of a token in the email.

## Out of scope

- French translations of the email templates (can follow as a separate request)
- Touching the existing reset/forgot pages — they're correct
- DNS / domain setup — already verified
- `SPIH_CONFIRM_HMAC_SECRET` and the recently deployed edge functions — unrelated

## Technical notes

- Managed templates use `LOVABLE_API_KEY` (auto-provisioned). Do not add `RESEND_API_KEY` or `SEND_EMAIL_HOOK_SECRET`.
- `auth-email-hook` is a system-contract name — do not rename.
- Email body background stays `#ffffff` per Lovable guidance, even though the app uses cream.
- Templates import React via `npm:react@18.3.1` and components via `@react-email/components@0.0.22` — pinned versions per the email guide.
