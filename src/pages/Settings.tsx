import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Shield, Home, Bell, Lock, Users } from "lucide-react";
import { WalletKeys } from "@/components/theo/WalletKeys";

type Customer = { id: string; company_name: string; kyb_status: string };

function Toggle({ on: defaultOn }: { on?: boolean }) {
  const [on, setOn] = useState(defaultOn ?? false);
  return (
    <div
      onClick={() => setOn(!on)}
      className="cursor-pointer flex-shrink-0 relative"
      style={{
        width: 36, height: 20, borderRadius: 10,
        background: on ? "hsl(var(--theo-blue))" : "hsl(var(--theo-light))",
        transition: "background 200ms",
      }}
    >
      <div
        style={{
          position: "absolute", width: 14, height: 14, borderRadius: "50%",
          background: "white", top: 3, left: 3,
          transform: on ? "translateX(16px)" : "translateX(0)",
          transition: "transform 200ms",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; title: string }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border" style={{ background: "hsl(var(--theo-blue-soft))" }}>
      <Icon className="flex-shrink-0" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 2 }} />
      <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>{title}</div>
    </div>
  );
}

function SettingsRow({ label, sub, right }: { label: string; sub?: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const [customer, setCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    supabase.from("customers").select("id, company_name, kyb_status").maybeSingle().then(({ data }) => {
      setCustomer(data as Customer | null);
    });
  }, []);

  const kybPending = customer?.kyb_status !== "APPROVED";
  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "TB";

  return (
    <AppLayout>
      <div className="mb-1">
        <div className="font-extrabold" style={{ fontSize: 22, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>Settings</div>
        <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>Manage your account, team, and compliance.</div>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      {/* KYB status banner */}
      <div
        className="flex items-center justify-between mb-5 rounded-xl"
        style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-blue-chip))", padding: "14px 18px" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center rounded-lg" style={{ width: 34, height: 34, background: "hsl(var(--theo-blue))" }}>
            <Shield className="h-3.5 w-3.5 text-white" style={{ strokeWidth: 2 }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>
              KYB Verification — {kybPending ? "Not started" : "Approved"}
            </div>
            <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
              {kybPending
                ? "Complete business verification to unlock full transaction limits."
                : "Your business is verified and fully active."}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="rounded-full font-bold" style={{ fontSize: 11, background: kybPending ? "hsl(var(--theo-gold-soft))" : "#EFFBF3", color: kybPending ? "#7A5F00" : "#1A7F37", padding: "3px 8px" }}>
            {kybPending ? "Pending" : "Approved"}
          </span>
          {kybPending && (
            <Link
              to="/kyb"
              className="font-bold text-white"
              style={{ background: "hsl(var(--theo-blue))", borderRadius: 7, padding: "5px 12px", fontSize: 12, textDecoration: "none" }}
            >
              Start KYB
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>
        {/* Left column */}
        <div className="flex flex-col gap-4">
          {/* Business profile */}
          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
            <SectionHeader icon={Home} title="Business profile" />
            <div className="p-5">
              <div className="grid gap-3 mb-3.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label className="block font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>
                    Legal company name
                  </label>
                  <input
                    className="w-full rounded-[9px] border border-border outline-none"
                    style={{ fontFamily: "inherit", fontSize: 14, padding: "10px 12px", color: "hsl(var(--theo-ink))" }}
                    defaultValue={customer?.company_name ?? ""}
                    placeholder="Your company"
                  />
                </div>
                <div>
                  <label className="block font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>
                    Registration no.
                  </label>
                  <input
                    className="w-full rounded-[9px] border border-border outline-none"
                    style={{ fontFamily: "inherit", fontSize: 14, padding: "10px 12px", color: "hsl(var(--theo-ink))" }}
                    placeholder="RNFE-XXXXX"
                  />
                </div>
              </div>
              <div className="mb-3.5">
                <label className="block font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>Country</label>
                <select className="w-full rounded-[9px] border border-border outline-none" style={{ fontFamily: "inherit", fontSize: 14, padding: "10px 12px", color: "hsl(var(--theo-ink))", appearance: "none" }}>
                  <option>Haiti</option>
                  <option>Dominican Republic</option>
                </select>
              </div>
              <button
                className="font-bold text-white"
                style={{ background: "hsl(var(--theo-blue))", borderRadius: 7, padding: "6px 12px", fontSize: 12, border: "none", cursor: "pointer", fontFamily: "inherit" }}
              >
                Save changes
              </button>
            </div>
          </div>

          {/* Notifications */}
          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
            <SectionHeader icon={Bell} title="Notifications" />
            <div className="px-5 py-1">
              <SettingsRow label="Transaction confirmations" sub="Email on every settled conversion" right={<Toggle on />} />
              <SettingsRow label="Rate alerts" sub="Notify when HTG/USDC moves ±1%" right={<Toggle />} />
              <SettingsRow label="Payout receipts" sub="Email receipt on every payout" right={<Toggle on />} />
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          {/* Security */}
          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
            <SectionHeader icon={Lock} title="Security" />
            <div className="px-5 py-1">
              <SettingsRow label="Two-factor authentication" sub="TOTP via authenticator app" right={<Toggle on />} />
              <SettingsRow label="Login notifications" sub="Email on new device sign-in" right={<Toggle on />} />
            </div>
            <div className="px-5 pb-4 pt-2">
              <button
                className="font-bold"
                style={{ background: "transparent", border: "1.5px solid hsl(var(--theo-blue))", color: "hsl(var(--theo-blue))", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
              >
                Change password
              </button>
            </div>
          </div>

          {/* Team */}
          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
            <SectionHeader icon={Users} title="Team members" />
            <div className="px-5 py-1">
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex items-center justify-center font-extrabold rounded-full flex-shrink-0"
                    style={{ width: 28, height: 28, background: "hsl(var(--theo-gold))", color: "hsl(var(--theo-blue))", fontSize: 11 }}
                  >
                    {initials}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>
                      {user?.email?.split("@")[0] ?? "Owner"}
                    </div>
                    <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                      Owner · {user?.email}
                    </div>
                  </div>
                </div>
                <span className="rounded-full font-bold" style={{ fontSize: 11, background: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))", padding: "3px 8px" }}>
                  Owner
                </span>
              </div>
            </div>
            <div className="px-5 pb-4">
              <button
                className="flex items-center gap-1.5 font-bold"
                style={{ background: "transparent", border: "1.5px solid hsl(var(--theo-blue))", color: "hsl(var(--theo-blue))", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
              >
                + Invite team member
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <WalletKeys />
      </div>
    </AppLayout>
  );
}
