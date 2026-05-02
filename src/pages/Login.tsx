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
      <div className="eyebrow mb-3">Welcome back</div>
      <h2 className="text-3xl font-extrabold text-primary tracking-tightest">Sign in</h2>
      <p className="text-muted-foreground text-sm mt-2">Access your Theo business dashboard.</p>

      <form onSubmit={submit} className="mt-7 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email" className="eyebrow-muted text-xs">Work email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@company.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            className="h-11 rounded-[10px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="eyebrow-muted text-xs">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="Your password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            className="h-11 rounded-[10px]"
          />
          <Link
            to="/forgot-password"
            className="inline-block text-xs font-semibold text-accent hover:underline pt-1"
          >
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          disabled={busy}
          className="w-full h-12 rounded-[10px] text-base font-semibold mt-2"
        >
          {busy ? "Signing in…" : (<>Sign in <ArrowRight className="h-4 w-4" /></>)}
        </Button>

        <p className="text-xs text-muted-foreground text-center pt-1">
          Protected by 2FA and end-to-end encryption.
        </p>
      </form>
    </AuthLayout>
  );
}
