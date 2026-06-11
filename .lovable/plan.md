## Password Reset for johanfrancois@me.com

The Login page already links to `/forgot-password`, but the route and page don't exist. The `/reset-password` page is also missing — it's where Supabase redirects users after clicking the recovery link. I need to build both pages, wire routes, and then send the reset email.

### Plan

1. **Build `/forgot-password` page** (`src/pages/ForgotPassword.tsx`)
   - Email input form using `AuthLayout` (matches Login/Register styling)
   - Calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' })`
   - Shows success message after submission

2. **Build `/reset-password` page** (`src/pages/ResetPassword.tsx`)
   - On mount, checks URL hash for `type=recovery` token
   - If valid recovery session: show new password + confirm password form
   - Calls `supabase.auth.updateUser({ password })` to set the new password
   - On success, redirect to `/dashboard`
   - If no recovery token: show error + link back to login

3. **Wire routes** (`src/App.tsx`)
   - Add `/forgot-password` route (public)
   - Add `/reset-password` route (public — must be accessible without auth)

4. **Add translations** (`src/lib/i18n.ts`)
   - Add EN/FR keys for forgot-password and reset-password UI copy

5. **Send the reset email**
   - Use Supabase admin API to send password reset to `johanfrancois@me.com`
   - Or trigger via a direct `resetPasswordForEmail` call from the agent side

### Technical Details
- Both pages reuse existing `AuthLayout` component for consistent styling
- Follow the same form patterns as Login.tsx (state hooks, loading states, toast errors)
- No new dependencies needed
- The reset-password page must be a public route — users arrive there from their email while logged out