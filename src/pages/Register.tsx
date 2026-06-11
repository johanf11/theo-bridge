import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/theo/AuthLayout";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

const schema = z.object({
  companyName: z.string().trim().min(2, "Company name required").max(120),
  firstName: z.string().trim().min(1, "First name required").max(60),
  lastName: z.string().trim().min(1, "Last name required").max(60),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(6).max(40),
  password: z.string().min(12, "At least 12 characters").max(128),
});

function passwordScore(val: string): number {
  let score = 0;
  if (val.length >= 8) score++;
  if (val.length >= 12) score++;
  if (/[A-Z]/.test(val) && /[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;
  return score;
}

function StrengthBar({ score }: { score: number }) {
  const cls = (i: number) => {
    if (i >= score) return "bg-border";
    if (score <= 1) return "bg-destructive";
    if (score <= 2) return "bg-secondary";
    return "bg-accent";
  };
  return (
    <div className="flex gap-1 mt-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${cls(i)}`}
        />
      ))}
    </div>
  );
}

export default function Register() {
  const t = useT();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    companyName: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
  });

  const score = passwordScore(form.password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/kyb`,
        data: {
          company_name: form.companyName,
          first_name: form.firstName,
          last_name: form.lastName,
          phone: form.phone,
        },
      },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("register.check.email"));
    navigate("/kyb");
  };

  return (
    <AuthLayout>
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-7">
        <div className="w-2 h-2 rounded-full bg-accent" />
        <div className="w-2 h-2 rounded-full bg-primary" />
        <div className="w-2 h-2 rounded-full bg-border" />
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground ml-1">
          {t("register.eyebrow")}
        </span>
      </div>

      <div className="eyebrow mb-2">{t("register.onboarding")}</div>
      <h2 className="text-[28px] font-extrabold text-primary tracking-tight leading-[1.1] mb-1">
        {t("register.title")}
      </h2>
      <p className="text-muted-foreground text-sm mb-8">{t("register.subtitle")}</p>

      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-[7px]">
          <Label htmlFor="company" className="eyebrow-muted text-[11px]">{t("register.company")}</Label>
          <Input id="company" placeholder="e.g. Marché Soleil S.A." value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} required maxLength={120} className="h-11 rounded-[10px]" />
        </div>

        <div className="grid grid-cols-2 gap-[14px]">
          <div className="space-y-[7px]">
            <Label htmlFor="first" className="eyebrow-muted text-[11px]">{t("register.firstName")}</Label>
            <Input id="first" placeholder="Jean" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required maxLength={60} className="h-11 rounded-[10px]" />
          </div>
          <div className="space-y-[7px]">
            <Label htmlFor="last" className="eyebrow-muted text-[11px]">{t("register.lastName")}</Label>
            <Input id="last" placeholder="Baptiste" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required maxLength={60} className="h-11 rounded-[10px]" />
          </div>
        </div>

        <div className="space-y-[7px]">
          <Label htmlFor="email" className="eyebrow-muted text-[11px]">{t("register.email")}</Label>
          <Input id="email" type="email" placeholder="you@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required maxLength={255} className="h-11 rounded-[10px]" />
        </div>

        <div className="space-y-[7px]">
          <Label htmlFor="phone" className="eyebrow-muted text-[11px]">{t("register.phone")}</Label>
          <Input id="phone" placeholder="+509 ou +1 (809)…" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required maxLength={40} className="h-11 rounded-[10px]" />
        </div>

        <div className="space-y-[7px]">
          <Label htmlFor="password" className="eyebrow-muted text-[11px]">{t("register.password")}</Label>
          <Input
            id="password"
            type="password"
            placeholder={t("register.passwordHint")}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={12}
            maxLength={128}
            className="h-11 rounded-[10px]"
          />
          {form.password.length > 0 && <StrengthBar score={score} />}
        </div>

        <hr className="border-border my-6" />

        <Button type="submit" disabled={busy} className="w-full h-12 rounded-[10px] text-[15px] font-bold">
          {busy ? t("register.submitting") : (<>{t("register.submit")} <ArrowRight className="h-4 w-4" /></>)}
        </Button>

        <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
          {t("register.terms").split("Terms of Service").map((part, i) =>
            i === 0 ? part : (
              <>
                <Link key={i} to="/terms" className="text-primary font-bold hover:underline underline-offset-[2px]">
                  {t("landing.footer.terms")}
                </Link>
                {part.split("Privacy Policy").map((p2, j) =>
                  j === 0 ? p2 : (
                    <>
                      <Link key={j} to="/privacy" className="text-primary font-bold hover:underline underline-offset-[2px]">
                        {t("register.privacy")}
                      </Link>
                      {p2}
                    </>
                  )
                )}
              </>
            )
          )}
        </p>
      </form>
    </AuthLayout>
  );
}
