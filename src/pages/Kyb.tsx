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
        if (error) toast.error("Could not load your profile");
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
      toast.error("Please attach your business registration document");
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Document must be PDF, JPG, or PNG");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Document must be under 10 MB");
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
        toast.error(upErr.message || "Upload failed");
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
        toast.error(updErr.message || "Could not submit KYB");
        return;
      }

      toast.success("KYB submitted. We'll review it shortly.");
      setProfile({ ...profile, ...parsed.data, kyb_status: "UNDER_REVIEW", kyb_submitted_at: new Date().toISOString() });
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || loading) {
    return (
      <AppLayout>
        <div className="text-muted-foreground">Loading…</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8">
        <p className="eyebrow text-theo-cyan">Onboarding</p>
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tightest">Business verification</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          We need a few details about your company to comply with regulations. This usually takes one business day.
        </p>
      </div>

      <StatusCard status={status} reason={profile?.kyb_rejection_reason ?? null} submittedAt={profile?.kyb_submitted_at ?? null} />

      <div className="grid md:grid-cols-3 gap-6 mt-6">
        <form onSubmit={submit} className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" /> Company details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Legal company name" id="legal_name" value={form.legal_name} onChange={(v) => setForm({ ...form, legal_name: v })} disabled={!editable} max={160} />
                <Field label="Registration number" id="registration_number" value={form.registration_number} onChange={(v) => setForm({ ...form, registration_number: v })} disabled={!editable} max={80} />
                <Field label="Country of registration" id="country" value={form.country} onChange={(v) => setForm({ ...form, country: v })} disabled={!editable} max={80} placeholder="Haiti" />
                <Field label="Business type" id="business_type" value={form.business_type} onChange={(v) => setForm({ ...form, business_type: v })} disabled={!editable} max={80} placeholder="LLC, S.A., Sole proprietor…" />
                <div className="md:col-span-2">
                  <Field label="Primary contact (full name)" id="contact_name" value={form.contact_name} onChange={(v) => setForm({ ...form, contact_name: v })} disabled={!editable} max={120} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="doc">Business registration document</Label>
                <label
                  htmlFor="doc"
                  className={`flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm cursor-pointer transition-colors ${
                    editable ? "hover:bg-muted/40" : "opacity-60 cursor-not-allowed"
                  }`}
                >
                  <FileUp className="h-5 w-5 text-primary" />
                  <div className="flex-1">
                    <div className="font-medium">{file ? file.name : "Upload PDF, JPG, or PNG (max 10 MB)"}</div>
                    <div className="text-muted-foreground text-xs">Certificate of registration, business license, or equivalent.</div>
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
                    {busy ? "Submitting…" : "Submit for review"}
                  </Button>
                  <Button type="button" variant="outline" size="lg" onClick={() => navigate("/dashboard")}>
                    Save for later
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Your submission is locked while it's {status === "UNDER_REVIEW" ? "under review" : "approved"}.
                </p>
              )}
            </CardContent>
          </Card>
        </form>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">What we check</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <Item title="Business registration" body="We confirm your company is a legal entity in good standing." />
            <Item title="Authorized signer" body="The contact you list will be our point of contact for compliance." />
            <Item title="Business activity" body="To make sure your use case fits HTG ↔ USDC settlement." />
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function Field({
  label, id, value, onChange, disabled, max, placeholder,
}: { label: string; id: string; value: string; onChange: (v: string) => void; disabled?: boolean; max?: number; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} maxLength={max} placeholder={placeholder} required />
    </div>
  );
}

function Item({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="font-medium text-foreground">{title}</div>
      <div>{body}</div>
    </div>
  );
}

function StatusCard({ status, reason, submittedAt }: { status: KybStatus; reason: string | null; submittedAt: string | null }) {
  const map: Record<KybStatus, { icon: JSX.Element; tone: string; title: string; body: string }> = {
    PENDING: {
      icon: <ShieldCheck className="h-5 w-5" />,
      tone: "border-border bg-muted/40",
      title: "KYB not started",
      body: "Complete the form below to submit your business for review.",
    },
    UNDER_REVIEW: {
      icon: <Clock className="h-5 w-5" />,
      tone: "border-theo-cyan/40 bg-theo-cyan/5",
      title: "Under review",
      body: submittedAt
        ? `Submitted ${new Date(submittedAt).toLocaleString()}. We'll email you once it's approved.`
        : "Submitted. We'll email you once it's approved.",
    },
    APPROVED: {
      icon: <CheckCircle2 className="h-5 w-5" />,
      tone: "border-success/40 bg-success/5",
      title: "Approved",
      body: "You're cleared to convert HTG to USDC.",
    },
    REJECTED: {
      icon: <XCircle className="h-5 w-5" />,
      tone: "border-destructive/40 bg-destructive/5",
      title: "Action needed",
      body: reason ?? "Your submission needs changes. Please update the details below and resubmit.",
    },
  };
  const s = map[status];
  return (
    <Card className={`border ${s.tone}`}>
      <CardContent className="py-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="text-primary">{s.icon}</div>
          <div>
            <div className="font-semibold">{s.title}</div>
            <div className="text-sm text-muted-foreground">{s.body}</div>
          </div>
        </div>
        <Badge variant="outline">{status.replace("_", " ")}</Badge>
      </CardContent>
    </Card>
  );
}
