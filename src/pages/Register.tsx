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

const schema = z.object({
  companyName: z.string().trim().min(2, "Company name required").max(120),
  firstName: z.string().trim().min(1, "First name required").max(60),
  lastName: z.string().trim().min(1, "Last name required").max(60),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(6).max(40),
  password: z.string().min(12, "At least 12 characters").max(128),
});

export default function Register() {
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
    toast.success("Account created. Let's verify your business.");
    navigate("/kyb");
  };

  return (
    <AuthLayout>
      <div className="eyebrow mb-3">B2B Onboarding · KYB review applies</div>
      <h2 className="text-3xl font-extrabold text-primary tracking-tightest">Create your account</h2>
      <p className="text-muted-foreground text-sm mt-2">For Haitian businesses exchanging HTG to USDC.</p>

      <form onSubmit={submit} className="mt-7 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="company" className="eyebrow-muted text-xs">Company name</Label>
          <Input id="company" placeholder="e.g. Marché Soleil S.A." value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} required maxLength={120} className="h-11 rounded-[10px]" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="first" className="eyebrow-muted text-xs">First name</Label>
            <Input id="first" placeholder="Jean" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required maxLength={60} className="h-11 rounded-[10px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last" className="eyebrow-muted text-xs">Last name</Label>
            <Input id="last" placeholder="Baptiste" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required maxLength={60} className="h-11 rounded-[10px]" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="eyebrow-muted text-xs">Work email</Label>
          <Input id="email" type="email" placeholder="you@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required maxLength={255} className="h-11 rounded-[10px]" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone" className="eyebrow-muted text-xs">Phone</Label>
          <Input id="phone" placeholder="+509 or +1 (809)…" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required maxLength={40} className="h-11 rounded-[10px]" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="eyebrow-muted text-xs">Password</Label>
          <Input id="password" type="password" placeholder="Min. 12 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={12} maxLength={128} className="h-11 rounded-[10px]" />
        </div>

        <Button type="submit" disabled={busy} className="w-full h-12 rounded-[10px] text-base font-semibold">
          {busy ? "Creating…" : (<>Create account <ArrowRight className="h-4 w-4" /></>)}
        </Button>

        <p className="text-xs text-muted-foreground text-center leading-relaxed pt-2">
          By creating an account you agree to our{" "}
          <Link to="/terms" className="text-accent font-medium hover:underline">Terms of Use</Link>
          {" "}and{" "}
          <Link to="/privacy" className="text-accent font-medium hover:underline">Privacy Policy</Link>
          . KYB review takes 1–2 business days.
        </p>
      </form>
    </AuthLayout>
  );
}
