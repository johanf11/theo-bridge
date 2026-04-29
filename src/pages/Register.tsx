import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/theo/Logo";
import { toast } from "sonner";

const schema = z.object({
  companyName: z.string().trim().min(2, "Company name required").max(120),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(6).max(40),
  password: z.string().min(8, "At least 8 characters").max(128),
});

export default function Register() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ companyName: "", email: "", phone: "", password: "" });

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
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { company_name: form.companyName, phone: form.phone },
      },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Account created. KYB review will follow.");
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="hidden md:flex bg-gradient-hero text-white p-12 flex-col justify-between">
        <Logo variant="light" />
        <div>
          <h2 className="font-display text-4xl font-bold leading-tight">Open your business account.</h2>
          <p className="mt-4 text-white/80 max-w-md">Start moving from HTG to USDC with locked rates and transparent fees. KYB review usually completes within one business day.</p>
        </div>
        <div className="text-sm text-white/60">B2B only · KYB required · $1,000 – $50,000 per transaction</div>
      </div>
      <div className="flex items-center justify-center p-6 md:p-10">
        <form onSubmit={submit} className="w-full max-w-md space-y-5">
          <div className="md:hidden mb-4"><Logo /></div>
          <div>
            <h1 className="font-display text-3xl font-bold">Create your account</h1>
            <p className="text-muted-foreground text-sm mt-1">B2B onboarding · KYB review applies</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="company">Company name</Label>
            <Input id="company" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} required maxLength={120} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
            <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required maxLength={255} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required maxLength={40} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} maxLength={128} />
          </div>
          <Button type="submit" disabled={busy} className="w-full" size="lg">
            {busy ? "Creating…" : "Create account"}
          </Button>
          <p className="text-sm text-muted-foreground text-center">
            Already have an account? <Link to="/login" className="text-theo-blue font-medium hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
