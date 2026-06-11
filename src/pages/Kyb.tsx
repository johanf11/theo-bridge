import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldCheck, FileUp, Clock, CheckCircle2, XCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

type KybStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";

type CustomerProfile = {
  id: string;
  company_name: string;
  legal_name: string | null;
  registration_number: string | null;
  country: string | null;
  business_type: string | null;
  contact_name: string | null;
  kyb_status: KybStatus;
  kyb_rejection_reason: string | null;
  kyb_submitted_at: string | null;
};

const schema = z.object({
  legal_name: z.string().trim().min(2, "Legal name required").max(160),
  registration_number: z.string().trim().min(2, "Registration number required").max(80),
  country: z.string().trim().min(2, "Country required").max(80),
  business_type: z.string().trim().min(2, "Business type required").max(80),
  contact_name: z.string().trim().min(2, "Contact name required").max(120),
});

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export default function Kyb() {
  const t = useT();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    legal_name: "",
    registration_number: "",
    country: "",
    business_type: "",
    contact_name: "",
  });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("customers")
      .select("id, company_name, legal_name, registration_number, country, business_type, contact_name, kyb_status, kyb_rejection_reason, kyb_submitted_at")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) toast.error(t("common.error"));
        const p = data as CustomerProfile | null;
        setProfile(p);
        if (p) {
          setForm({
            legal_name: p.legal_name ?? p.company_name ?? "",
            registration_number: p.registration_number ?? "",
            country: p.country ?? "",
            business_type: p.business_type ?? "",
            contact_name: p.contact_name ?? "",
          });
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user]);

  const status = profile?.kyb_status ?? "PENDING";
  const editable = status === "PENDING" || status === "REJECTED";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;

    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (!file) {
      toast.error(t("kyb.doc.label"));
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error(t("kyb.doc.upload"));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t("kyb.doc.upload"));
      return;
    }

    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const path = `${user.id}/registration-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("kyb-documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        toast.error(upErr.message || t("common.error"));
        return;
      }

      const { error: updErr } = await supabase
        .from("customers")
        .update({
          legal_name: parsed.data.legal_name,
          registration_number: parsed.data.registration_number,
          country: parsed.data.country,
          business_type: parsed.data.business_type,
          contact_name: parsed.data.contact_name,
          kyb_status: "UNDER_REVIEW",
          kyb_submitted_at: new Date().toISOString(),
        })
        .eq("id", profile.id);

      if (updErr) {
        toast.error(updErr.message || t("common.error"));
        return;
      }

      toast.success(t("kyb.submitted"));
      setProfile({ ...profile, ...parsed.data, kyb_status: "UNDER_REVIEW", kyb_submitted_at: new Date().toISOString() });
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || loading) {
    return (
      <AppLayout>
        <div className="text-muted-foreground">{t("common.loading")}</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8">
        <p className="eyebrow">{t("kyb.onboarding")}</p>
        <h1 className="mt-2 text-3xl md:text-4xl font-extrabold tracking-tightest">{t("kyb.pageTitle")}</h1>
        <hr className="gold-rule mt-3" />
        <p className="text-muted-foreground mt-4 max-w-2xl">
          {t("kyb.pageBody")}
        </p>
      </div>

      <StatusCard status={status} reason={profile?.kyb_rejection_reason ?? null} submittedAt={profile?.kyb_submitted_at ?? null} />

      <div className="grid lg:grid-cols-[1fr,260px] gap-6 mt-6 items-start">
        <form onSubmit={submit}>
          <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-xs">
            <div className="bg-muted px-6 py-4 flex items-center gap-2 text-primary font-semibold">
              <ShieldCheck className="h-4 w-4" /> {t("kyb.companyDetails")}
            </div>
            <div className="p-6 space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <Field label={t("kyb.field.legalName")} id="legal_name" value={form.legal_name} onChange={(v) => setForm({ ...form, legal_name: v })} disabled={!editable} max={160} />
                <Field label={t("kyb.field.registrationNumber")} id="registration_number" value={form.registration_number} onChange={(v) => setForm({ ...form, registration_number: v })} disabled={!editable} max={80} />
                <Field label={t("kyb.field.countryRegistration")} id="country" value={form.country} onChange={(v) => setForm({ ...form, country: v })} disabled={!editable} max={80} placeholder="Haiti" />
                <Field label={t("kyb.field.businessType")} id="business_type" value={form.business_type} onChange={(v) => setForm({ ...form, business_type: v })} disabled={!editable} max={80} placeholder="LLC, S.A., Sole proprietor…" />
                <div className="md:col-span-2">
                  <Field label={t("kyb.field.primaryContact")} id="contact_name" value={form.contact_name} onChange={(v) => setForm({ ...form, contact_name: v })} disabled={!editable} max={120} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="doc">{t("kyb.doc.label")}</Label>
                <label
                  htmlFor="doc"
                  className={`flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm cursor-pointer transition-colors ${
                    editable ? "hover:bg-muted/40" : "opacity-60 cursor-not-allowed"
                  }`}
                >
                  <FileUp className="h-5 w-5 text-primary" />
                  <div className="flex-1">
                    <div className="font-medium">{file ? file.name : t("kyb.doc.upload")}</div>
                    <div className="text-muted-foreground text-xs">{t("kyb.doc.help")}</div>
                  </div>
                  <input
                    id="doc"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    className="sr-only"
                    disabled={!editable}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

              {editable ? (
                <div className="flex gap-3">
                  <Button type="submit" size="lg" disabled={busy}>
                    {busy ? t("kyb.submit.busy") : t("kyb.submit")}
                  </Button>
                  <Button type="button" variant="outline" size="lg" onClick={() => navigate("/dashboard")}>
                    {t("kyb.saveLater")}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("kyb.locked.message")} {status === "UNDER_REVIEW" ? t("kyb.locked.review") : t("kyb.locked.approved")}.
                </p>
              )}
            </div>
          </div>
        </form>

        <aside className="bg-card rounded-2xl border border-border p-6 shadow-xs space-y-5">
          <p className="eyebrow eyebrow-muted">{t("kyb.check.title")}</p>
          <div className="space-y-4 text-sm">
            <Item title={t("kyb.check.registration.title")} body={t("kyb.check.registration.body")} />
            <Item title={t("kyb.check.signer.title")} body={t("kyb.check.signer.body")} />
            <Item title={t("kyb.check.activity.title")} body={t("kyb.check.activity.body")} />
          </div>
          <div className="pt-4 border-t border-border text-sm">
            <div className="text-muted-foreground">{t("kyb.questions")}</div>
            <a href="mailto:kyb@theo.finance" className="text-accent font-semibold hover:underline">kyb@theo.finance</a>
          </div>
        </aside>
      </div>
    </AppLayout>
  );
}

function Field({
  label, id, value, onChange, disabled, max, placeholder,
}: { label: string; id: string; value: string; onChange: (v: string) => void; disabled?: boolean; max?: number; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="eyebrow eyebrow-muted">{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} maxLength={max} placeholder={placeholder} required className="h-11 rounded-xl" />
    </div>
  );
}

function Item({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="font-semibold text-primary">{title}</div>
      <div className="text-muted-foreground mt-1 leading-snug">{body}</div>
    </div>
  );
}

function StatusCard({ status, reason, submittedAt }: { status: KybStatus; reason: string | null; submittedAt: string | null }) {
  const map: Record<KybStatus, { icon: JSX.Element; title: string; body: string; pill: string; pillClass: string }> = {
    PENDING: {
      icon: <ShieldCheck className="h-5 w-5" />,
      title: "KYB not started",
      body: "Complete the form below to submit your business for review.",
      pill: "Pending",
      pillClass: "bg-secondary/30 text-primary border-secondary",
    },
    UNDER_REVIEW: {
      icon: <Clock className="h-5 w-5" />,
      title: "Under review",
      body: submittedAt
        ? `Submitted ${new Date(submittedAt).toLocaleString()}. We'll email you once it's approved.`
        : "Submitted. We'll email you once it's approved.",
      pill: "Under review",
      pillClass: "bg-accent/15 text-accent border-accent/40",
    },
    APPROVED: {
      icon: <CheckCircle2 className="h-5 w-5" />,
      title: "Approved",
      body: "You're cleared to convert HTG to USDC.",
      pill: "Approved",
      pillClass: "bg-success/15 text-success border-success/40",
    },
    REJECTED: {
      icon: <XCircle className="h-5 w-5" />,
      title: "Action needed",
      body: reason ?? "Your submission needs changes. Please update the details below and resubmit.",
      pill: "Action needed",
      pillClass: "bg-destructive/15 text-destructive border-destructive/40",
    },
  };
  const s = map[status];
  return (
    <div className="bg-card rounded-2xl border border-border shadow-xs p-5 flex items-start justify-between gap-4">
      <div className="flex items-start gap-4">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-primary">
          {s.icon}
        </span>
        <div>
          <div className="font-bold text-primary">{s.title}</div>
          <div className="text-sm text-muted-foreground mt-0.5">{s.body}</div>
        </div>
      </div>
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border ${s.pillClass}`}>
        {s.pill}
      </span>
    </div>
  );
}
