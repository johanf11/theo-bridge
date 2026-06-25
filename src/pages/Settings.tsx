import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Shield, Home, Bell, Lock, Users, ChevronDown, ChevronUp, User, Check, Loader2, AtSign, Copy, Trash2, Plus, X } from "lucide-react";
import { WalletKeys } from "@/components/theo/WalletKeys";
import { ApiKeysSection } from "@/components/theo/ApiKeysSection";
import { usePermissions, type Permission } from "@/hooks/usePermissions";
import { toast } from "sonner";
import { useT, type TKey } from "@/lib/i18n";

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

type FederationAddress = {
  id: string;
  alias: string;
  stellar_address: string;
  memo_type: string | null;
  memo: string | null;
};

type Wallet = {
  id: string;
  label: string;
  stellar_address: string;
};

const FEDERATION_DOMAIN = "theokingdom.com";

const ALL_PERMISSIONS: { key: Permission; labelKey: TKey; descKey: TKey }[] = [
  { key: "convert",           labelKey: "settings.perm.convert.label",        descKey: "settings.perm.convert.desc" },
  { key: "payout_send",       labelKey: "settings.perm.payout.label",         descKey: "settings.perm.payout.desc" },
  { key: "balance_view_keys", labelKey: "settings.perm.viewKeys.label",       descKey: "settings.perm.viewKeys.desc" },
  { key: "accounts_manage",   labelKey: "settings.perm.manageAccounts.label", descKey: "settings.perm.manageAccounts.desc" },
  { key: "view_balances",     labelKey: "settings.perm.viewBalances.label",   descKey: "settings.perm.viewBalances.desc" },
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
  const t = useT();
  const isOwnerRole = role.name === "Owner";

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: "hsl(var(--theo-cream))" }}
      >
        <div>
          <span className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>{
            role.name === "Owner" ? t("settings.role.owner")
            : role.name === "Treasury Analyst" ? t("settings.role.treasuryAnalyst")
            : role.name === "Viewer" ? t("settings.role.viewer")
            : role.name
          }</span>
          {role.is_system && (
            <span className="rounded-full font-bold ml-2" style={{ fontSize: 10, background: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))", padding: "2px 7px" }}>
              {t("settings.roles.default")}
            </span>
          )}
        </div>
      </div>
      <div className="divide-y divide-border">
        {ALL_PERMISSIONS.map(({ key, labelKey, descKey }) => (
          <div key={key} className="flex items-center justify-between px-4 py-2.5">
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-ink))" }}>{t(labelKey)}</div>
              <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{t(descKey)}</div>
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
                {role.permissions[key] ? t("settings.roles.allowed") : t("settings.roles.blocked")}
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
  const t = useT();
  const { user } = useAuth();
  const { isOwner } = usePermissions();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState("");
  const [showInvite, setShowInvite] = useState(false);

  // Federation addresses
  const [fedAddresses, setFedAddresses]   = useState<FederationAddress[]>([]);
  const [wallets, setWallets]             = useState<Wallet[]>([]);
  const [showAddFed, setShowAddFed]       = useState(false);
  const [fedAlias, setFedAlias]           = useState("");
  const [fedWallet, setFedWallet]         = useState("");
  const [savingFed, setSavingFed]         = useState(false);
  const [copiedFedId, setCopiedFedId]     = useState<string | null>(null);

  // Display name
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  // Business profile form state
  const [companyName, setCompanyName] = useState("");
  const [registrationNo, setRegistrationNo] = useState("");
  const [country, setCountry] = useState("Haiti");
  const [savingBiz, setSavingBiz] = useState(false);

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

  const handleSaveBusiness = async () => {
    if (!customer) return;
    const trimmed = companyName.trim();
    if (!trimmed) { toast.error(t("settings.error.companyRequired")); return; }
    setSavingBiz(true);
    const { error } = await supabase
      .from("customers")
      .update({
        company_name: trimmed,
        legal_name: trimmed,
        registration_number: registrationNo.trim() || null,
        country: country || null,
      })
      .eq("id", customer.id);
    setSavingBiz(false);
    if (error) { toast.error(error.message); return; }
    setCustomer({ ...customer, company_name: trimmed, legal_name: trimmed, registration_number: registrationNo.trim() || null, country });
    toast.success(t("settings.saved.business"));
  };

  useEffect(() => {
    if (!user) return;
    // Resolve effective customer — org member takes priority over own row
    (async () => {
      const { data: mem } = await supabase.from("org_members").select("customer_id").eq("user_id", user.id).not("accepted_at", "is", null).maybeSingle();
      const customerId = mem?.customer_id ?? null;
      const { data } = customerId
        ? await supabase.from("customers").select("id, company_name, kyb_status, legal_name, registration_number, country").eq("id", customerId).maybeSingle()
        : await supabase.from("customers").select("id, company_name, kyb_status, legal_name, registration_number, country").eq("user_id", user.id).maybeSingle();
      const c = data as Customer | null;
      setCustomer(c);
      if (c) {
        setCompanyName(c.legal_name ?? c.company_name ?? "");
        setRegistrationNo(c.registration_number ?? "");
        setCountry(c.country ?? "Haiti");
        setFedAlias("");
        loadFederation(c.id);
        loadWallets(c.id);
      }
    })();
  }, [user?.id]);

  const loadFederation = async (customerId: string) => {
    const { data } = await (supabase as any)
      .from("federation_addresses")
      .select("id, alias, stellar_address, memo_type, memo")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: true });
    setFedAddresses((data ?? []) as FederationAddress[]);
  };

  const loadWallets = async (customerId: string) => {
    const { data } = await supabase
      .from("wallets")
      .select("id, label, stellar_address")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: true });
    const list = (data ?? []) as Wallet[];
    setWallets(list);
    if (list.length > 0) setFedWallet(list[0].stellar_address);
  };

  const handleAddFederation = async () => {
    if (!customer || !fedAlias.trim() || !fedWallet) return;
    const alias = fedAlias.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (!alias) { toast.error("Invalid alias — use letters, numbers, dots, hyphens only"); return; }
    setSavingFed(true);
    const { error } = await (supabase as any)
      .from("federation_addresses")
      .insert({ customer_id: customer.id, alias, stellar_address: fedWallet });
    setSavingFed(false);
    if (error) {
      if (error.code === "23505") toast.error(`"${alias}" is already taken — choose another alias`);
      else toast.error(error.message);
      return;
    }
    toast.success(`${alias}*${FEDERATION_DOMAIN} created`);
    setFedAlias("");
    loadFederation(customer.id);

    // Set home_domain on the Stellar account so stellar.expert resolves the alias
    supabase.functions.invoke("set-wallet-home-domain", {
      body: { stellar_address: fedWallet },
    }).then(({ error: domainErr }) => {
      if (domainErr) console.warn("home_domain set skipped:", domainErr.message);
    });
  };

  const handleDeleteFederation = async (id: string, alias: string) => {
    const { error } = await (supabase as any)
      .from("federation_addresses")
      .delete()
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${alias}*${FEDERATION_DOMAIN} removed`);
    setFedAddresses((prev) => prev.filter((f) => f.id !== id));
  };

  const copyFedAddress = async (id: string, alias: string) => {
    await navigator.clipboard.writeText(`${alias}*${FEDERATION_DOMAIN}`).catch(() => {});
    setCopiedFedId(id);
    setTimeout(() => setCopiedFedId(null), 2000);
  };

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
    const { error, data } = await supabase.functions.invoke("invite-member", {
      body: { email: inviteEmail.trim().toLowerCase(), roleId: inviteRoleId },
    });
    if (error) { toast.error(error.message); return; }
    const result = data as { ok?: boolean; alreadyRegistered?: boolean } | null;
    if (result?.alreadyRegistered) {
      toast.success(`${inviteEmail.trim()} already has an account — they'll see your org on next login.`);
    } else {
      toast.success(`Invite sent to ${inviteEmail.trim()}`);
    }
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
        <div className="font-extrabold" style={{ fontSize: 22, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>{t("settings.title")}</div>
        <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>{t("settings.subtitle")}</div>
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
              {t("settings.kyb.title")} — {kybPending ? t("settings.kyb.notStarted") : t("settings.kyb.approved")}
            </div>
            <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
              {kybPending ? t("settings.kyb.subPending") : t("settings.kyb.subApproved")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="rounded-full font-bold" style={{ fontSize: 11, background: kybPending ? "hsl(var(--theo-gold-soft))" : "#EFFBF3", color: kybPending ? "#7A5F00" : "#1A7F37", padding: "3px 8px" }}>
            {kybPending ? t("settings.kyb.pending") : t("settings.kyb.approved")}
          </span>
          {kybPending && (
            <Link to="/kyb" className="font-bold text-white" style={{ background: "hsl(var(--theo-blue))", borderRadius: 7, padding: "5px 12px", fontSize: 12, textDecoration: "none" }}>
              {t("settings.kyb.startBtn")}
            </Link>
          )}
        </div>
      </div>

      {/* Your profile — full width above the grid */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden mb-4">
        <SectionHeader icon={User} title={t("settings.profile.title")} />
        <div className="p-5 flex items-center gap-6">
          <div className="flex items-center gap-3 pr-6" style={{ borderRight: "1px solid hsl(var(--border))", flexShrink: 0 }}>
            <div className="flex items-center justify-center font-extrabold rounded-full flex-shrink-0" style={{ width: 44, height: 44, background: "hsl(var(--theo-gold))", color: "hsl(var(--theo-blue))", fontSize: 16 }}>
              {initials}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "hsl(var(--theo-ink))" }}>{savedName}</div>
              <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginTop: 2 }}>{user?.email}</div>
            </div>
          </div>
          <div className="flex items-end gap-3 flex-1">
            <label className="flex-1">
              <span className="block font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>
                {t("settings.profile.displayName")}
              </span>
              <input
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setNameSaved(false); }}
                onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                maxLength={60}
                placeholder={t("settings.profile.placeholder")}
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
              {savingName ? <><Loader2 size={12} className="animate-spin" /> {t("settings.profile.save")}…</>
                : nameSaved ? <><Check size={12} /> {t("settings.profile.saved")}</>
                : t("settings.profile.save")}
            </button>
          </div>
        </div>
      </div>

      {/* Two-column grid: cards pair row-by-row on desktop, stack on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4" style={{ alignItems: "start" }}>
        {/* Business profile card */}
          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
            <SectionHeader icon={Home} title={t("settings.biz.title")} />
            <div className="p-5">
              <div className="grid gap-3 mb-3.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label className="block font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>{t("settings.biz.legalName")}</label>
                  <input
                    className="w-full rounded-[9px] border border-border outline-none"
                    style={{ fontFamily: "inherit", fontSize: 14, padding: "10px 12px", color: "hsl(var(--theo-ink))" }}
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Your company"
                  />
                </div>
                <div>
                  <label className="block font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>{t("settings.biz.regNo")}</label>
                  <input
                    className="w-full rounded-[9px] border border-border outline-none"
                    style={{ fontFamily: "inherit", fontSize: 14, padding: "10px 12px", color: "hsl(var(--theo-ink))" }}
                    value={registrationNo}
                    onChange={(e) => setRegistrationNo(e.target.value)}
                    placeholder="RNFE-XXXXX"
                  />
                </div>
              </div>
              <div className="mb-3.5">
                <label className="block font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>{t("settings.biz.country")}</label>
                <select
                  className="w-full rounded-[9px] border border-border outline-none"
                  style={{ fontFamily: "inherit", fontSize: 14, padding: "10px 12px", color: "hsl(var(--theo-ink))", appearance: "none" }}
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  <option>Haiti</option>
                  <option>Dominican Republic</option>
                </select>
              </div>
              <button
                onClick={handleSaveBusiness}
                disabled={savingBiz}
                className="font-bold text-white inline-flex items-center gap-1.5"
                style={{ background: "hsl(var(--theo-blue))", borderRadius: 7, padding: "6px 12px", fontSize: 12, border: "none", cursor: savingBiz ? "wait" : "pointer", fontFamily: "inherit", opacity: savingBiz ? 0.7 : 1 }}
              >
                {savingBiz && <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} />}
                {t("settings.biz.save")}
              </button>
            </div>
          </div>

          {/* Security card */}
          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
            <SectionHeader icon={Lock} title={t("settings.security.title")} />
            <div className="px-5 py-1">
              <SettingsRow label={t("settings.security.2fa")} sub={t("settings.security.2faSub")} right={<Toggle on />} />
              <SettingsRow label={t("settings.security.loginNotif")} sub={t("settings.security.loginNotifSub")} right={<Toggle on />} />
            </div>
            <div className="px-5 pb-4 pt-2">
              <button className="font-bold" style={{ background: "transparent", border: "1.5px solid hsl(var(--theo-blue))", color: "hsl(var(--theo-blue))", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                {t("settings.security.changePassword")}
              </button>
            </div>
          </div>

          {/* Members card */}
          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border" style={{ background: "hsl(var(--theo-blue-soft))" }}>
              <div className="flex items-center gap-2.5">
                <Users className="flex-shrink-0" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 2 }} />
                <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>{t("settings.team.title")}</div>
              </div>
              {isOwner && (
                <button
                  onClick={() => setShowInvite((v) => !v)}
                  style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-blue))", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
                >
                  {t("settings.team.invite")}
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
                    {t("settings.team.send")}
                  </button>
                </div>
              </div>
            )}

            <div className="px-5 py-1">
              {/* Current user row */}
              <div className="flex items-center justify-between py-3 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <div className="flex items-center justify-center font-extrabold rounded-full flex-shrink-0" style={{ width: 28, height: 28, background: "hsl(var(--theo-gold))", color: "hsl(var(--theo-blue))", fontSize: 11 }}>
                    {initials}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{savedName}</div>
                    <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{isOwner ? t("settings.team.owner") : t("settings.team.member")} · {user?.email}</div>
                  </div>
                </div>
                <span className="rounded-full font-bold" style={{ fontSize: 11, background: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))", padding: "3px 8px" }}>{isOwner ? t("settings.team.owner") : t("settings.team.member")}</span>
              </div>

              {/* Invited members */}
              {members
                .filter((m) => m.email !== user?.email)
                .map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-ink))" }}>{m.email}</div>
                      <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                        {m.accepted_at ? t("settings.team.active") : t("settings.team.pending")}
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
                          {t("settings.team.remove")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Notifications card */}
          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
            <SectionHeader icon={Bell} title={t("settings.notif.title")} />
            <div className="px-5 py-1">
              <SettingsRow label={t("settings.notif.txConfirm")} sub={t("settings.notif.txSub")} right={<Toggle on />} />
              <SettingsRow label={t("settings.notif.rateAlert")} sub={t("settings.notif.rateSub")} right={<Toggle />} />
            </div>
          </div>
      </div>

      {/* Full-width Federation Addresses */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden mb-4">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border" style={{ background: "hsl(var(--theo-blue-soft))" }}>
          <div className="flex items-center gap-2.5">
            <AtSign className="flex-shrink-0" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", strokeWidth: 2 }} />
            <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>{t("settings.fed.title")}</div>
            <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))", fontWeight: 500 }}>{t("settings.fed.sub")}</span>
          </div>
          <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{fedAddresses.length !== 1 ? t("settings.fed.countPlural").replace("{n}", String(fedAddresses.length)) : t("settings.fed.count").replace("{n}", "1")}</span>
        </div>

        {/* List + inline add form */}
        <div className="px-5 py-1">
          {fedAddresses.length === 0 && !showAddFed && (
            <div style={{ padding: "14px 0 10px", fontSize: 13, color: "hsl(var(--theo-mid))" }}>
              {t("settings.fed.empty")} <strong>yourname*{FEDERATION_DOMAIN}</strong>.
            </div>
          )}

          {fedAddresses.map((f, i) => {
            const wallet = wallets.find((w) => w.stellar_address === f.stellar_address);
            return (
              <div
                key={f.id}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid hsl(var(--theo-light))", gap: 12 }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "hsl(var(--theo-blue))", fontFamily: "monospace" }}>
                    {f.alias}<span style={{ color: "hsl(var(--theo-mid))" }}>*{FEDERATION_DOMAIN}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
                    {wallet ? `${wallet.label} · ` : ""}{f.stellar_address.slice(0, 8)}…{f.stellar_address.slice(-6)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => copyFedAddress(f.id, f.alias)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 7, border: "1px solid hsl(var(--theo-light))", background: "#fff", color: "hsl(var(--theo-blue))", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {copiedFedId === f.id ? <Check size={11} /> : <Copy size={11} />}
                    {copiedFedId === f.id ? t("settings.fed.copied") : t("settings.fed.copy")}
                  </button>
                  {isOwner && (
                    <button
                      onClick={() => handleDeleteFederation(f.id, f.alias)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 7, border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      <Trash2 size={11} /> {t("settings.fed.remove")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Inline add form */}
          {showAddFed && isOwner && (
            <div style={{ paddingTop: 12, paddingBottom: 4 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", border: "1.5px solid hsl(var(--theo-light))", borderRadius: 9, overflow: "hidden", flex: "0 0 auto" }}>
                  <input
                    value={fedAlias}
                    onChange={(e) => setFedAlias(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))}
                    placeholder="company"
                    maxLength={32}
                    autoFocus
                    style={{ fontFamily: "inherit", fontSize: 14, padding: "8px 10px", border: "none", outline: "none", width: 120 }}
                  />
                  <span style={{ padding: "8px 10px 8px 0", fontSize: 14, color: "hsl(var(--theo-mid))", fontWeight: 600, whiteSpace: "nowrap", background: "#fff" }}>
                    *{FEDERATION_DOMAIN}
                  </span>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <select
                    value={fedWallet}
                    onChange={(e) => setFedWallet(e.target.value)}
                    style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "9px 12px", borderRadius: 9, border: "1.5px solid hsl(var(--theo-light))", appearance: "none", outline: "none" }}
                  >
                    {wallets.length === 0
                      ? <option value="">No wallets yet</option>
                      : wallets.map((w) => (
                          <option key={w.id} value={w.stellar_address}>
                            {w.label} · {w.stellar_address.slice(0, 6)}…{w.stellar_address.slice(-4)}
                          </option>
                        ))
                    }
                  </select>
                </div>
                <button
                  onClick={handleAddFederation}
                  disabled={savingFed || !fedAlias.trim() || wallets.length === 0}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "9px 16px", borderRadius: 9, border: "none", background: "hsl(var(--theo-blue))", color: "#fff", cursor: savingFed ? "wait" : "pointer", opacity: (!fedAlias.trim() || wallets.length === 0) ? 0.5 : 1 }}
                >
                  {savingFed ? <Loader2 size={12} className="animate-spin" /> : null}
                  {t("settings.fed.save")}
                </button>
                <button
                  onClick={() => { setShowAddFed(false); setFedAlias(""); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--theo-mid))", display: "flex", alignItems: "center" }}
                >
                  <X size={14} />
                </button>
              </div>
              {fedAlias && (
                <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 7 }}>
                  {t("settings.fed.aliasHint")} <strong>{fedAlias}*{FEDERATION_DOMAIN}</strong> {t("settings.fed.aliasHint2")}
                </div>
              )}
            </div>
          )}

          {/* Always-visible add button */}
          {isOwner && !showAddFed && (
            <button
              onClick={() => setShowAddFed(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 10, marginBottom: 6, fontSize: 12, fontWeight: 600, color: "hsl(var(--theo-blue))", background: "hsl(var(--theo-blue-soft))", border: "none", borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}
            >
              <Plus size={12} /> {t("settings.fed.add")}
            </button>
          )}
        </div>
      </div>

      {/* Full-width Roles & Permissions — owner only */}
      {isOwner && (
        <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden mb-4">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border" style={{ background: "hsl(var(--theo-blue-soft))" }}>
            <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>{t("settings.roles.title")}</div>
            <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{t("settings.roles.hint")}</span>
          </div>
          <div className="p-5">
            {rolesLoading ? (
              <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>{t("settings.roles.loading")}</div>
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
      )}

      {/* API keys for Odoo and other integrations */}
      <ApiKeysSection customerId={customer?.id ?? null} isOwner={isOwner} />

      {/* Account credentials — owner only (contains secret keys) */}
      {isOwner && <AdvancedSection />}
    </AppLayout>
  );
}

function AdvancedSection() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 font-bold"
        style={{ background: "transparent", border: "1px solid hsl(var(--border))", color: "hsl(var(--theo-blue))", borderRadius: 8, padding: "8px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
      >
        {open ? <ChevronUp style={{ width: 13, height: 13 }} /> : <ChevronDown style={{ width: 13, height: 13 }} />}
        {t("settings.advanced")}
      </button>
      {open && <div className="mt-3"><WalletKeys /></div>}
    </div>
  );
}
