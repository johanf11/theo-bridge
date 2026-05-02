import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/theo/AuthLayout";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
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
      <div className="eyebrow mb-3">B2B Onboarding · KYB review applies</div>
      <h2 className="text-3xl font-extrabold text-primary tracking-tightest">Welcome back.</h2>
      <p className="text-muted-foreground text-sm mt-2">Sign in to manage your conversions.</p>

      <form onSubmit={submit} className="mt-7 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email" className="eyebrow-muted text-xs">Work email</Label>
          <Input id="email" type="email" placeholder="you@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="h-11 rounded-[10px]" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className="eyebrow-muted text-xs">Password</Label>
          <Input id="password" type="password" placeholder="••••••••••••" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required className="h-11 rounded-[10px]" />
        </div>
        <Button type="submit" disabled={busy} className="w-full h-12 rounded-[10px] text-base font-semibold">
          {busy ? "Signing in…" : (<>Sign in <ArrowRight className="h-4 w-4" /></>)}
        </Button>
        <p className="text-xs text-muted-foreground text-center pt-2">
          New to Theo?{" "}
          <Link to="/register" className="text-accent font-semibold hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
