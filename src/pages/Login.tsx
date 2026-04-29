import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/theo/Logo";
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
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="hidden md:flex bg-gradient-hero text-white p-12 flex-col justify-between">
        <Logo variant="light" />
        <div>
          <h2 className="font-display text-4xl font-bold leading-tight">Welcome back.</h2>
          <p className="mt-4 text-white/80 max-w-md">Manage your conversions and track settlement in real time.</p>
        </div>
        <div className="text-sm text-white/60">Secure · B2B only</div>
      </div>
      <div className="flex items-center justify-center p-6 md:p-10">
        <form onSubmit={submit} className="w-full max-w-md space-y-5">
          <div className="md:hidden mb-4"><Logo /></div>
          <div>
            <h1 className="font-display text-3xl font-bold">Sign in</h1>
            <p className="text-muted-foreground text-sm mt-1">Use your business email</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </div>
          <Button type="submit" disabled={busy} className="w-full" size="lg">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-sm text-muted-foreground text-center">
            New to Theo? <Link to="/register" className="text-theo-blue font-medium hover:underline">Create an account</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
