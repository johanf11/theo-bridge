import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/theo/AuthLayout";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

export default function ForgotPassword() {
  const t = useT();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    setBusy(true);
    // No redirectTo — we want a code-based recovery, not a magic link.
    const { error } = await supabase.auth.resetPasswordForEmail(normalized);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("auth.toast.codeSent"));
    navigate(`/reset-password?email=${encodeURIComponent(normalized)}`);
  };

  return (
    <AuthLayout>
      <div className="eyebrow mb-3">{t("auth.recovery.eyebrow")}</div>
      <h2 className="text-3xl font-extrabold text-primary tracking-tightest">
        {t("auth.forgot.title")}
      </h2>
      <p className="text-muted-foreground text-sm mt-2">
        {t("auth.forgot.subtitle")}
      </p>

      <form onSubmit={submit} className="mt-7 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email" className="eyebrow-muted text-xs">
            {t("auth.field.workEmail")}
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-11 rounded-[10px]"
          />
        </div>

        <Button
          type="submit"
          disabled={busy}
          className="w-full h-12 rounded-[10px] text-base font-semibold mt-2"
        >
          {busy ? t("auth.forgot.submitting") : (<>{t("auth.forgot.submit")} <ArrowRight className="h-4 w-4" /></>)}
        </Button>

        <Link
          to="/login"
          className="inline-block text-xs font-semibold text-accent hover:underline"
        >
          {t("auth.forgot.backToSignIn")}
        </Link>
      </form>
    </AuthLayout>
  );
}
