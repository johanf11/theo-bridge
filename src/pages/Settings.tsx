import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Shield, Home, Bell, Lock, Users, ChevronDown, ChevronUp, User, Check, Loader2 } from "lucide-react";
import { WalletKeys } from "@/components/theo/WalletKeys";
import { usePermissions, type Permission } from "@/hooks/usePermissions";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────
type Customer = {
  id: string;
  company_name: string;
  kyb_status: string;
  legal_name: string | null;
  registration_number: string | null;
  country: string | null;
};

type OrgRole = {
  id: string;
  name: string;
  is_system: boolean;
  permissions: Record<Permission, boolean>;
};

type OrgMember = {
  id: string;
  email: string;
  role_id: string;
  accepted_at: string | null;
};

const ALL_PERMISSIONS: { key: Permission; label: string; description: string }[] = [
  { key: "convert",           label: "Convert",        description: "Submit HTG → USDC conversions" },
  { key: "payout_send",       label: "Send payouts",   description: "Send USDC to recipients" },
  { key: "balance_view_keys", label: "View account IDs", description: "See Stellar account addresses" },
  { key: "accounts_manage",   label: "Manage accounts", description: "Add, rename, or remove wallets" },
  { key: "view_balances",     label: "View balances",  description: "See USDC balances across accounts" },
];

// ── Small components ──────────────────────────────────────────────────────────
function Toggle({ on: defaultOn, onChange }: { on?: boolean; onChange?: (v: boolean) => void }) {
  const [on, setOn] = useState(defaultOn ?? false);
  useEffect(() => { setOn(defaultOn ?? false); }, [defaultOn]);

  return (
    <div
      onClick={() => { const next = !on; setOn(next); onChange?.(next); }}
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

// ── Role card ─────────────────────────────────────────────────────────────────
function RoleCard({
  role,
  isOwner,
  onToggle,
}: {
  role: OrgRole;
  isOwner: boolean;
  onToggle: (roleId: string, perm: Permission, value: boolean) => void;
}) {
  const isOwnerRole = role.name === "Owner";

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: "hsl(var(--theo-cream))" }}
      >
        <div>
          <span className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>{role.name}</span>
          {role.is_system && (
            <span className="rounded-full font-bold ml-2" style={{ fontSize: 10, background: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))", padding: "2px 7px" }}>
              Default
            </span>
          )}
        </div>
      </div>
      <div className="divide-y divide-border">
        {ALL_PERMISSIONS.map(({ key, label, description }) => (
          <div key={key} className="flex items-center justify-between px-4 py-2.5">
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-ink))" }}>{label}</div>
              <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{description}</div>
            </div>
            {isOwner && !isOwnerRole ? (
              <Toggle
                on={role.permissions[key]}
                onChange={(v) => onToggle(role.id, key, v)}
              />
            ) : (
              <span
                style={{
                  fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                  background: role.permissions[key] ? "#EFFBF3" : "hsl(var(--theo-light))",
                  color: role.permissions[key] ? "#1A7F37" : "hsl(var(--theo-mid))",
                }}
              >
                {role.permissions[key] ? "Allowed" : "Blocked"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Settings() {
  const { user } = useAuth();
  const { isOwner } = usePermissions();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState("");
  const [showInvite, setShowInvite] = useState(false);

  // Display name
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  // Initialise display name from user metadata once user loads
  useEffect(() => {
    if (!user) return;
    setDisplayName(user.user_metadata?.display_name || user.email?.split("@")[0] || "");
  }, [user?.id]);

  const handleSaveName = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) return;
    setSavingName(true);
    await supabase.auth.updateUser({ data: { display_name: trimmed } });
    setSavingName(false);
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  };

  useEffect(() => {
    supabase.from("customers").select("id, company_name, kyb_status").maybeSingle().then(({ data }) => {
      setCustomer(data as Customer | null);
    });
  }, []);

  useEffect(() => {
    if (!customer) return;
    loadTeam(customer.id);
  }, [customer?.id]);

  const loadTeam = async (customerId: string) => {
    setRolesLoading(true);

    const [{ data: rawRoles }, { data: rawPerms }, { data: rawMembers }] = await Promise.all([
      supabase.from("org_roles").select("id, name, is_system").eq("customer_id", customerId).order("created_at"),
      supabase.from("role_permissions").select("role_id, permission, enabled"),
      supabase.from("org_members").select("id, email, role_id, accepted_at").eq("customer_id", customerId),
    ]);

    // Build roles with permission maps
    const permMap: Record<string, Record<string, boolean>> = {};
    for (const p of rawPerms ?? []) {
      if (!permMap[p.role_id]) permMap[p.role_id] = {};
      permMap[p.role_id][p.permission] = p.enabled;
    }

    const built: OrgRole[] = (rawRoles ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      is_system: r.is_system,
      permissions: {
        convert:            permMap[r.id]?.convert ?? false,
        payout_send:        permMap[r.id]?.payout_send ?? false,
        balance_view_keys:  permMap[r.id]?.balance_view_keys ?? false,
        accounts_manage:    permMap[r.id]?.accounts_manage ?? false,
        view_balances:      permMap[r.id]?.view_balances ?? false,
      },
    }));

    setRoles(built);
    setMembers((rawMembers ?? []) as OrgMember[]);
    if (built.length > 0 && !inviteRoleId) setInviteRoleId(built[0].id);
    setRolesLoading(false);
  };

  const handleTogglePermission = async (roleId: string, perm: Permission, value: boolean) => {
    // Optimistic update
    setRoles((prev) =>
      prev.map((r) =>
        r.id === roleId ? { ...r, permissions: { ...r.permissions, [perm]: value } } : r
      )
    );

    await supabase
      .from("role_permissions")
      .update({ enabled: value })
      .eq("role_id", roleId)
      .eq("permission", perm);
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteRoleId || !customer) return;
    await supabase.from("org_members").insert({
      customer_id: customer.id,
      role_id: inviteRoleId,
      email: inviteEmail.trim().toLowerCase(),
    });
    setInviteEmail("");
    setShowInvite(false);
    loadTeam(customer.id);
  };

  const handleRemoveMember = async (memberId: string) => {
    await supabase.from("org_members").delete().eq("id", memberId);
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  };

  const handleChangeMemberRole = async (memberId: string, roleId: string) => {
    setMembers((prev) => prev.map((m) => m.id === memberId ? { ...m, role_id: roleId } : m));
    await supabase.from("org_members").update({ role_id: roleId }).eq("id", memberId);
  };

  const kybPending = customer?.kyb_status !== "APPROVED";
  const savedName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "Owner";
  const initials = savedName.slice(0, 2).toUpperCase();

  const getRoleName = (roleId: string) => roles.find((r) => r.id === roleId)?.name ?? "—";

  return (
    <AppLayout>
      <div className="mb-1">
        <div className="font-extrabold" style={{ fontSize: 22, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>Settings</div>
        <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>Manage your account, team, and compliance.</div>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      {/* KYB banner */}
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
              {kybPending ? "Complete business verification to unlock full transaction limits." : "Your business is verified and fully active."}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="rounded-full font-bold" style={{ fontSize: 11, background: kybPending ? "hsl(var(--theo-gold-soft))" : "#EFFBF3", color: kybPending ? "#7A5F00" : "#1A7F37", padding: "3px 8px" }}>
            {kybPending ? "Pending" : "Approved"}
          </span>
          {kybPending && (
            <Link to="/kyb" className="font-bold text-white" style={{ background: "hsl(var(--theo-blue))", borderRadius: 7, padding: "5px 12px", fontSize: 12, textDecoration: "none" }}>
              Start KYB
            </Link>
          )}
        </div>
      </div>

      {/* Your profile — full width above the grid */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden mb-4">
        <SectionHeader icon={User} title="Your profile" />
        <div className="p-5 flex items-center gap-6">
          {/* Avatar + email */}
          <div className="flex items-center gap-3 pr-6" style={{ borderRight: "1px solid hsl(var(--border))", flexShrink: 0 }}>
            <div className="flex items-center justify-center font-extrabold rounded-full flex-shrink-0" style={{ width: 44, height: 44, background: "hsl(var(--theo-gold))", color: "hsl(var(--theo-blue))", fontSize: 16 }}>
              {initials}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "hsl(var(--theo-ink))" }}>{savedName}</div>
              <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginTop: 2 }}>{user?.email}</div>
            </div>
          </div>

          {/* Display name input — inline */}
          <div className="flex items-end gap-3 flex-1">
            <label className="flex-1">
              <span className="block font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>
                Display name
              </span>
              <input
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setNameSaved(false); }}
                onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                maxLength={60}
                placeholder="Your name"
                className="w-full rounded-[9px] border border-border outline-none"
                style={{ fontFamily: "inherit", fontSize: 14, padding: "10px 12px", color: "hsl(var(--theo-ink))" }}
              />
            </label>
            <button
              onClick={handleSaveName}
              disabled={savingName || !displayName.trim()}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: nameSaved ? "#1A7F37" : "hsl(var(--theo-blue))",
                border: "none", color: "#fff", borderRadius: 7,
                padding: "10px 16px", fontSize: 12, fontWeight: 700,
                cursor: savingName || !displayName.trim() ? "not-allowed" : "pointer",
                fontFamily: "inherit", opacity: !displayName.trim() ? 0.5 : 1,
                transition: "background 200ms", whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              {savingName ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                : nameSaved ? <><Check size={12} /> Saved</>
                : "Save name"}
            </button>
          </div>
        </div>
      </div>

      {/* Two-column grid */}
      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* Left */}
        <div className="flex flex-col gap-4" style={{ height: "100%" }}>
          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
            <SectionHeader icon={Home} title="Business profile" />
            <div className="p-5">
              <div className="grid gap-3 mb-3.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label className="block font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>Legal company name</label>
                  <input className="w-full rounded-[9px] border border-border outline-none" style={{ fontFamily: "inherit", fontSize: 14, padding: "10px 12px", color: "hsl(var(--theo-ink))" }} defaultValue={customer?.company_name ?? ""} placeholder="Your company" />
                </div>
                <div>
                  <label className="block font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>Registration no.</label>
                  <input className="w-full rounded-[9px] border border-border outline-none" style={{ fontFamily: "inherit", fontSize: 14, padding: "10px 12px", color: "hsl(var(--theo-ink))" }} placeholder="RNFE-XXXXX" />
                </div>
              </div>
              <div className="mb-3.5">
                <label className="block font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>Country</label>
                <select className="w-full rounded-[9px] border border-border outline-none" style={{ fontFamily: "inherit", fontSize: 14, padding: "10px 12px", color: "hsl(var(--theo-ink))", appearance: "none" }}>
                  <option>Haiti</option>
                  <option>Dominican Republic</option>
                </select>
              </div>
              <button className="font-bold text-white" style={{ background: "hsl(var(--theo-blue))", borderRadius: 7, padding: "6px 12px", fontSize: 12, border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                Save changes
              </button>
            </div>
          </div>

          {/* Members card */}
          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden" style={{ flex: 1 }}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border" style={{ background: "hsl(var(--theo-blue-soft))" }}>
              <div className="flex items-center gap-2.5">
                <Users className="flex-shrink-0" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 2 }} />
                <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Team members</div>
              </div>
              {isOwner && (
                <button
                  onClick={() => setShowInvite((v) => !v)}
                  style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-blue))", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
                >
                  + Invite
                </button>
              )}
            </div>

            {showInvite && isOwner && (
              <div className="px-5 py-3 border-b border-border" style={{ background: "#fafafa" }}>
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="flex-1 border border-border rounded-lg outline-none"
                    style={{ fontFamily: "inherit", fontSize: 13, padding: "7px 10px" }}
                  />
                  <select
                    value={inviteRoleId}
                    onChange={(e) => setInviteRoleId(e.target.value)}
                    className="border border-border rounded-lg outline-none"
                    style={{ fontFamily: "inherit", fontSize: 13, padding: "7px 10px", appearance: "none" }}
                  >
                    {roles.filter((r) => r.name !== "Owner").map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleInvite}
                    disabled={!inviteEmail.trim()}
                    className="font-bold text-white"
                    style={{ background: "hsl(var(--theo-blue))", borderRadius: 7, padding: "7px 14px", fontSize: 12, border: "none", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Send
                  </button>
                </div>
              </div>
            )}

            <div className="px-5 py-1">
              {/* Always show the current user as owner */}
              <div className="flex items-center justify-between py-3 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <div className="flex items-center justify-center font-extrabold rounded-full flex-shrink-0" style={{ width: 28, height: 28, background: "hsl(var(--theo-gold))", color: "hsl(var(--theo-blue))", fontSize: 11 }}>
                    {initials}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{savedName}</div>
                    <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>Owner · {user?.email}</div>
                  </div>
                </div>
                <span className="rounded-full font-bold" style={{ fontSize: 11, background: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))", padding: "3px 8px" }}>Owner</span>
              </div>

              {/* Invited members */}
              {members
                .filter((m) => m.email !== user?.email)
                .map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-ink))" }}>{m.email}</div>
                      <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                        {m.accepted_at ? "Active" : "Invite pending"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isOwner ? (
                        <select
                          value={m.role_id}
                          onChange={(e) => handleChangeMemberRole(m.id, e.target.value)}
                          style={{ fontFamily: "inherit", fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-blue))", background: "hsl(var(--theo-blue-soft))", border: "none", borderRadius: 99, padding: "3px 8px", cursor: "pointer", appearance: "none" }}
                        >
                          {roles.filter((r) => r.name !== "Owner").map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="rounded-full font-bold" style={{ fontSize: 11, background: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))", padding: "3px 8px" }}>
                          {getRoleName(m.role_id)}
                        </span>
                      )}
                      {isOwner && (
                        <button
                          onClick={() => handleRemoveMember(m.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#B91C1C", fontSize: 12, fontFamily: "inherit", fontWeight: 600 }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Right */}
        <div className="flex flex-col gap-4" style={{ height: "100%" }}>
          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
            <SectionHeader icon={Lock} title="Security" />
            <div className="px-5 py-1">
              <SettingsRow label="Two-factor authentication" sub="TOTP via authenticator app" right={<Toggle on />} />
              <SettingsRow label="Login notifications" sub="Email on new device sign-in" right={<Toggle on />} />
            </div>
            <div className="px-5 pb-4 pt-2">
              <button className="font-bold" style={{ background: "transparent", border: "1.5px solid hsl(var(--theo-blue))", color: "hsl(var(--theo-blue))", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                Change password
              </button>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden" style={{ flex: 1 }}>
            <SectionHeader icon={Bell} title="Notifications" />
            <div className="px-5 py-1">
              <SettingsRow label="Transaction confirmations" sub="Email on every settled conversion" right={<Toggle on />} />
              <SettingsRow label="Rate alerts" sub="Notify when HTG/USDC moves ±1%" right={<Toggle />} />
              <SettingsRow label="Payout receipts" sub="Email receipt on every payout" right={<Toggle on />} />
            </div>
          </div>
        </div>
      </div>

      {/* Full-width Roles & Permissions */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden mb-4">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border" style={{ background: "hsl(var(--theo-blue-soft))" }}>
          <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Roles & permissions</div>
          {isOwner && (
            <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>Click toggles to edit · Owner role is always full access</span>
          )}
        </div>
        <div className="p-5">
          {rolesLoading ? (
            <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>Loading roles…</div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              {roles.map((role) => (
                <RoleCard
                  key={role.id}
                  role={role}
                  isOwner={isOwner}
                  onToggle={handleTogglePermission}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <AdvancedSection />
    </AppLayout>
  );
}

function AdvancedSection() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 font-bold"
        style={{ background: "transparent", border: "1px solid hsl(var(--border))", color: "hsl(var(--theo-blue))", borderRadius: 8, padding: "8px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
      >
        {open ? <ChevronUp style={{ width: 13, height: 13 }} /> : <ChevronDown style={{ width: 13, height: 13 }} />}
        Advanced
      </button>
      {open && <div className="mt-3"><WalletKeys /></div>}
    </div>
  );
}
