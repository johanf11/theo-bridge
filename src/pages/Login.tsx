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

export default function Login() {
  const t = useT();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword(form);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    navigate("/dashboard");
  };

  return (
    <AuthLayout>
      <div className="eyebrow mb-3">{t("login.eyebrow")}</div>
      <h2 className="text-3xl font-extrabold text-primary tracking-tightest">{t("login.title")}</h2>
      <p className="text-muted-foreground text-sm mt-2">{t("login.subtitle")}</p>

      <form onSubmit={submit} className="mt-7 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email" className="eyebrow-muted text-xs">{t("login.email")}</Label>
          <Input
            id="email"
            type="email"
            placeholder={t("register.email")}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            className="h-11 rounded-[10px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="eyebrow-muted text-xs">{t("login.password")}</Label>
          <Input
            id="password"
            type="password"
            placeholder={t("login.password")}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            className="h-11 rounded-[10px]"
          />
          <Link
            to="/forgot-password"
            className="inline-block text-xs font-semibold text-accent hover:underline pt-1"
          >
            {t("login.forgot")}
          </Link>
        </div>

        <Button
          type="submit"
          disabled={busy}
          className="w-full h-12 rounded-[10px] text-base font-semibold mt-2"
        >
          {busy ? t("login.submitting") : (<>{t("login.submit")} <ArrowRight className="h-4 w-4" /></>)}
        </Button>

        <p className="text-xs text-muted-foreground text-center pt-1">
          {t("login.security")}
        </p>
      </form>
    </AuthLayout>
  );
}
