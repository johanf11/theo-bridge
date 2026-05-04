import { useEffect, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle2, XCircle, FileText, RefreshCw, Loader2 } from "lucide-react";

type KybStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";

type Row = {
  id: string;
  user_id: string;
  company_name: string;
  legal_name: string | null;
  registration_number: string | null;
  country: string | null;
  business_type: string | null;
  contact_name: string | null;
  email: string;
  kyb_status: KybStatus;
  kyb_submitted_at: string | null;
  kyb_rejection_reason: string | null;
};

const STATUS_STYLE: Record<KybStatus, { bg: string; color: string; label: string }> = {
  PENDING:      { bg: "#F3F4F6", color: "#6B7280", label: "Pending" },
  UNDER_REVIEW: { bg: "#FFF8E0", color: "#7A5F00", label: "Under review" },
  APPROVED:     { bg: "#EFFBF3", color: "#1A7F37", label: "Approved" },
  REJECTED:     { bg: "#FDE8E8", color: "#B91C1C", label: "Rejected" },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdminKyb() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"UNDER_REVIEW" | "ALL">("UNDER_REVIEW");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonByRow, setReasonByRow] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from("customers")
      .select("id, user_id, company_name, legal_name, registration_number, country, business_type, contact_name, email, kyb_status, kyb_submitted_at, kyb_rejection_reason")
      .order("kyb_submitted_at", { ascending: false, nullsFirst: false });
    if (filter === "UNDER_REVIEW") query = query.eq("kyb_status", "UNDER_REVIEW");
    const { data, error } = await query;
    if (error) toast.error(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filter]);

  const approve = async (row: Row) => {
    setBusyId(row.id);
    const { error } = await supabase
      .from("customers")
      .update({ kyb_status: "APPROVED", kyb_rejection_reason: null })
      .eq("id", row.id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${row.company_name} approved`);
    load();
  };

  const reject = async (row: Row) => {
    const reason = (reasonByRow[row.id] ?? "").trim();
    if (reason.length < 5) { toast.error("Please provide a rejection reason (5+ chars)"); return; }
    setBusyId(row.id);
    const { error } = await supabase
      .from("customers")
      .update({ kyb_status: "REJECTED", kyb_rejection_reason: reason })
      .eq("id", row.id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${row.company_name} rejected`);
    load();
  };

  const viewDoc = async (userId: string) => {
    const { data, error } = await supabase.storage.from("kyb-documents").list(userId, { limit: 20, sortBy: { column: "created_at", order: "desc" } });
    if (error || !data?.length) { toast.error("No documents found"); return; }
    const latest = data[0];
    const { data: signed, error: sErr } = await supabase.storage
      .from("kyb-documents")
      .createSignedUrl(`${userId}/${latest.name}`, 60 * 5);
    if (sErr || !signed?.signedUrl) { toast.error("Could not load document"); return; }
    window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
  };

  // Stats
  const underReviewCount = rows.filter((r) => r.kyb_status === "UNDER_REVIEW").length;
  const approvedCount = rows.filter((r) => r.kyb_status === "APPROVED").length;
  const rejectedCount = rows.filter((r) => r.kyb_status === "REJECTED").length;

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 16px", fontSize: 12, fontWeight: 700,
    border: "none", background: "none", cursor: "pointer", fontFamily: "inherit",
    color: active ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
    borderBottom: active ? "2px solid hsl(var(--theo-blue))" : "2px solid transparent",
    marginBottom: -1, transition: "all 120ms",
  });

  return (
    <AppLayout>
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "hsl(var(--theo-cyan))" }}>
            Admin
          </div>
          <div className="font-extrabold" style={{ fontSize: 22, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
            KYB Review
          </div>
          <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
            Approve or reject business verification applications.
          </div>
        </div>
        <button
          onClick={load}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "transparent", border: "1.5px solid hsl(var(--border))",
            color: "hsl(var(--theo-mid))", borderRadius: 7, padding: "6px 12px",
            fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          Refresh
        </button>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      {/* Stats */}
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {[
          { label: "Under review", value: underReviewCount, sub: "awaiting decision", bg: "#FFF8E0", color: "#7A5F00" },
          { label: "Approved", value: approvedCount, sub: "businesses onboarded", bg: "#EFFBF3", color: "#1A7F37" },
          { label: "Rejected", value: rejectedCount, sub: "applications declined", bg: "#FDE8E8", color: "#B91C1C" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl p-4" style={{ background: s.bg, border: "1px solid rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: s.color, marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
              {s.value}
            </div>
            <div style={{ fontSize: 11, color: s.color, opacity: 0.7, marginTop: 3 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs + table */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        <div className="flex border-b border-border px-4">
          <button style={tabStyle(filter === "UNDER_REVIEW")} onClick={() => setFilter("UNDER_REVIEW")}>
            Under review
            {underReviewCount > 0 && (
              <span style={{ marginLeft: 5, background: "#F59E0B", color: "#fff", borderRadius: 99, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>
                {underReviewCount}
              </span>
            )}
          </button>
          <button style={tabStyle(filter === "ALL")} onClick={() => setFilter("ALL")}>All applications</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> Loading applications…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center" style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>
            Nothing to review.
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "hsl(var(--theo-cream))" }}>
                {["Business", "Contact", "Registration", "Country", "Submitted", "Status", "Actions"].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 border-b border-border"
                    style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sc = STATUS_STYLE[r.kyb_status];
                const isBusy = busyId === r.id;
                const isExpanded = expandedId === r.id;

                return (
                  <>
                    <tr
                      key={r.id}
                      className="border-b border-border hover:bg-muted/30 transition-colors"
                      style={{ cursor: "pointer" }}
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    >
                      {/* Business */}
                      <td className="px-4 py-3">
                        <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-ink))" }}>
                          {r.legal_name || r.company_name}
                        </div>
                        <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{r.email}</div>
                      </td>

                      {/* Contact */}
                      <td className="px-4 py-3" style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                        {r.contact_name ?? "—"}
                      </td>

                      {/* Registration */}
                      <td className="px-4 py-3" style={{ fontFamily: "monospace", fontSize: 12, color: "hsl(var(--theo-ink))" }}>
                        {r.registration_number ?? "—"}
                      </td>

                      {/* Country */}
                      <td className="px-4 py-3" style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                        {r.country ?? "—"}
                      </td>

                      {/* Submitted */}
                      <td className="px-4 py-3" style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                        {r.kyb_submitted_at ? timeAgo(r.kyb_submitted_at) : "—"}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span className="rounded-full font-bold" style={{ background: sc.bg, color: sc.color, fontSize: 11, padding: "3px 8px" }}>
                          {sc.label}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => viewDoc(r.user_id)}
                            style={{
                              display: "flex", alignItems: "center", gap: 4,
                              background: "transparent", border: "1.5px solid hsl(var(--border))",
                              color: "hsl(var(--theo-mid))", borderRadius: 6, padding: "5px 9px",
                              fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                            }}
                          >
                            <FileText size={11} /> Doc
                          </button>
                          {r.kyb_status === "UNDER_REVIEW" && (
                            <>
                              <button
                                onClick={() => approve(r)}
                                disabled={isBusy}
                                style={{
                                  display: "flex", alignItems: "center", gap: 4,
                                  background: "#EFFBF3", border: "1.5px solid #86EFAC",
                                  color: "#1A7F37", borderRadius: 6, padding: "5px 9px",
                                  fontSize: 11, fontWeight: 700, cursor: isBusy ? "wait" : "pointer", fontFamily: "inherit",
                                }}
                              >
                                {isBusy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                                Approve
                              </button>
                              <button
                                onClick={() => setExpandedId(isExpanded ? null : r.id)}
                                style={{
                                  display: "flex", alignItems: "center", gap: 4,
                                  background: "#FDE8E8", border: "1.5px solid #FCA5A5",
                                  color: "#B91C1C", borderRadius: 6, padding: "5px 9px",
                                  fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                                }}
                              >
                                <XCircle size={11} /> Reject
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded reject panel */}
                    {isExpanded && r.kyb_status === "UNDER_REVIEW" && (
                      <tr key={`${r.id}-expand`} className="border-b border-border">
                        <td colSpan={7} className="px-4 pb-4 pt-2" style={{ background: "#FFF8F8" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#B91C1C", marginBottom: 6 }}>
                            Rejection reason
                          </div>
                          <div className="flex gap-2">
                            <textarea
                              placeholder="Explain why this application is being rejected (required)…"
                              value={reasonByRow[r.id] ?? ""}
                              onChange={(e) => setReasonByRow({ ...reasonByRow, [r.id]: e.target.value })}
                              maxLength={500}
                              rows={2}
                              style={{
                                flex: 1, fontFamily: "inherit", fontSize: 13,
                                padding: "8px 10px", borderRadius: 8,
                                border: "1.5px solid #FCA5A5", outline: "none",
                                resize: "vertical", color: "hsl(var(--theo-ink))",
                              }}
                            />
                            <button
                              onClick={() => reject(r)}
                              disabled={isBusy}
                              style={{
                                background: "#B91C1C", color: "#fff", border: "none",
                                borderRadius: 8, padding: "8px 14px", fontSize: 12,
                                fontWeight: 700, cursor: isBusy ? "wait" : "pointer",
                                fontFamily: "inherit", alignSelf: "flex-start",
                                display: "flex", alignItems: "center", gap: 5,
                              }}
                            >
                              {isBusy ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                              Confirm rejection
                            </button>
                          </div>
                          {r.kyb_rejection_reason && (
                            <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 6 }}>
                              Previous reason: {r.kyb_rejection_reason}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  );
}
