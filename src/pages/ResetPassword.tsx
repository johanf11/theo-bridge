import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/theo/AuthLayout";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

export default function ResetPassword() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedCode = code.trim();

    if (!normalizedEmail) {
      toast.error(t("auth.toast.enterEmail"));
      return;
    }
    if (normalizedCode.length !== 8) {
      toast.error(t("auth.toast.enterCode"));
      return;
    }
    if (password.length < 12) {
      toast.error(t("auth.toast.passwordLength"));
      return;
    }
    if (password !== confirm) {
      toast.error(t("auth.toast.passwordMismatch"));
      return;
    }

    setBusy(true);

    // 1. Verify the temporary code — this creates a recovery session.
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: normalizedCode,
      type: "recovery",
    });
    if (verifyErr) {
      setBusy(false);
      toast.error(verifyErr.message || t("auth.toast.invalidCode"));
      return;
    }

    // 2. Set the new password on the now-authenticated session.
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setBusy(false);
      toast.error(updateErr.message);
      return;
    }

    setBusy(false);
    toast.success(t("auth.toast.passwordUpdated"));
    navigate("/dashboard");
  };

  return (
    <AuthLayout>
      <div className="eyebrow mb-3">{t("auth.recovery.eyebrow")}</div>
      <h2 className="text-3xl font-extrabold text-primary tracking-tightest">
        {t("auth.reset.title")}
      </h2>
      <p className="text-muted-foreground text-sm mt-2">
        {t("auth.reset.subtitle")}
      </p>

      <form onSubmit={submit} className="mt-7 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email" className="eyebrow-muted text-xs">
            {t("auth.field.workEmail")}
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-11 rounded-[10px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="code" className="eyebrow-muted text-xs">
            {t("auth.field.tempCode")}
          </Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="12345678"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            required
            className="h-11 rounded-[10px] tracking-[0.3em] font-semibold"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="eyebrow-muted text-xs">
            {t("auth.field.newPassword")}
          </Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            maxLength={128}
            className="h-11 rounded-[10px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm" className="eyebrow-muted text-xs">
            {t("auth.field.confirmPassword")}
          </Label>
          <Input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={12}
            maxLength={128}
            className="h-11 rounded-[10px]"
          />
        </div>

        <Button
          type="submit"
          disabled={busy}
          className="w-full h-12 rounded-[10px] text-base font-semibold mt-2"
        >
          {busy ? t("auth.reset.submitting") : (<>{t("auth.reset.submit")} <ArrowRight className="h-4 w-4" /></>)}
        </Button>

        <Link
          to="/forgot-password"
          className="inline-block text-xs font-semibold text-accent hover:underline"
        >
          {t("auth.reset.requestNew")}
        </Link>
      </form>
    </AuthLayout>
  );
}
