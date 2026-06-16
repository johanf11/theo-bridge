import { useEffect, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle2, XCircle, FileText, RefreshCw, Loader2, Pencil, Undo2, Plus } from "lucide-react";
import { AdminKybEditor, type EditorCustomer } from "@/components/theo/AdminKybEditor";

type KybStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";

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
  phone: string | null;
  kyb_status: KybStatus;
  kyb_submitted_at: string | null;
  kyb_rejection_reason: string | null;
  kyb_review_notes: string | null;
  kyb_requested_changes: string[] | null;
};

const STATUS_STYLE: Record<KybStatus, { bg: string; color: string; label: string }> = {
  PENDING:           { bg: "#F3F4F6", color: "#6B7280", label: "Awaiting submission" },
  UNDER_REVIEW:      { bg: "#FFF8E0", color: "#7A5F00", label: "Under review" },
  APPROVED:          { bg: "#EFFBF3", color: "#1A7F37", label: "Approved" },
  REJECTED:          { bg: "#FDE8E8", color: "#B91C1C", label: "Rejected" },
  CHANGES_REQUESTED: { bg: "#FEF3E2", color: "#9A3412", label: "Changes requested" },
};

type Filter = "UNDER_REVIEW" | "AWAITING" | "ALL";
type Expanded = { id: string; mode: "reject" | "send_back" } | null;

const emptyCounts = { awaiting: 0, underReview: 0, approved: 0, rejected: 0, changesRequested: 0 };

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
  const [filter, setFilter] = useState<Filter>("UNDER_REVIEW");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonByRow, setReasonByRow] = useState<Record<string, string>>({});
  const [changesByRow, setChangesByRow] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Expanded>(null);
  const [counts, setCounts] = useState(emptyCounts);
  const [editor, setEditor] = useState<{ mode: "edit" | "create"; customer: EditorCustomer | null } | null>(null);

  const loadCounts = async () => {
    const headCount = (status: KybStatus) =>
      supabase.from("customers").select("*", { count: "exact", head: true }).eq("kyb_status", status);
    const [awaiting, underReview, approved, rejected, changesRequested] = await Promise.all([
      headCount("PENDING"),
      headCount("UNDER_REVIEW"),
      headCount("APPROVED"),
      headCount("REJECTED"),
      headCount("CHANGES_REQUESTED"),
    ]);
    setCounts({
      awaiting: awaiting.count ?? 0,
      underReview: underReview.count ?? 0,
      approved: approved.count ?? 0,
      rejected: rejected.count ?? 0,
      changesRequested: changesRequested.count ?? 0,
    });
  };

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from("customers")
      .select("id, user_id, company_name, legal_name, registration_number, country, business_type, contact_name, email, phone, kyb_status, kyb_submitted_at, kyb_rejection_reason, kyb_review_notes, kyb_requested_changes")
      .order("kyb_submitted_at", { ascending: false, nullsFirst: false });
    if (filter === "UNDER_REVIEW") query = query.in("kyb_status", ["UNDER_REVIEW", "CHANGES_REQUESTED"]);
    else if (filter === "AWAITING") query = query.eq("kyb_status", "PENDING");
    const { data, error } = await query;
    if (error) toast.error(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
    loadCounts();
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  const callAdmin = async (body: Record<string, unknown>, successMsg: string, rowId: string) => {
    setBusyId(rowId);
    try {
      const { data, error } = await supabase.functions.invoke("admin-kyb", { body });
      if (error) { toast.error(error.message); return false; }
      if ((data as { error?: string })?.error) { toast.error((data as { error?: string }).error!); return false; }
      toast.success(successMsg);
      return true;
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (row: Row) => {
    const ok = await callAdmin({ action: "approve", customer_id: row.id }, `${row.company_name} approved`, row.id);
    if (ok) load();
  };

  const reject = async (row: Row) => {
    const reason = (reasonByRow[row.id] ?? "").trim();
    if (reason.length < 5) { toast.error("Please provide a rejection reason (5+ chars)"); return; }
    const ok = await callAdmin({ action: "reject", customer_id: row.id, reason }, `${row.company_name} rejected`, row.id);
    if (ok) { setExpanded(null); load(); }
  };

  const sendBack = async (row: Row) => {
    const notes = (reasonByRow[row.id] ?? "").trim();
    if (notes.length < 5) { toast.error("Please add reviewer notes (5+ chars)"); return; }
    const changes = (changesByRow[row.id] ?? "")
      .split("\n").map((s) => s.trim()).filter(Boolean);
    const ok = await callAdmin(
      { action: "send_back", customer_id: row.id, notes, requested_changes: changes },
      `${row.company_name} sent back to customer`,
      row.id,
    );
    if (ok) { setExpanded(null); load(); }
  };

  const viewDoc = async (userId: string) => {
    const { data, error } = await supabase.storage.from("kyb-documents").list(userId, { limit: 20, sortBy: { column: "created_at", order: "desc" } });
    if (error || !data?.length) { toast.error("No documents found"); return; }
    const latest = data[0];
    const { data: signed, error: sErr } = await supabase.storage.from("kyb-documents").createSignedUrl(`${userId}/${latest.name}`, 60 * 5);
    if (sErr || !signed?.signedUrl) { toast.error("Could not load document"); return; }
    window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 16px", fontSize: 12, fontWeight: 700,
    border: "none", background: "none", cursor: "pointer", fontFamily: "inherit",
    color: active ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
    borderBottom: active ? "2px solid hsl(var(--theo-blue))" : "2px solid transparent",
    marginBottom: -1, transition: "all 120ms",
  });

  const btn = (bg: string, border: string, color: string): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 4,
    background: bg, border: `1.5px solid ${border}`, color,
    borderRadius: 6, padding: "5px 9px",
    fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
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
            Approve, reject, send back, or onboard businesses on their behalf.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditor({ mode: "create", customer: null })}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "hsl(var(--theo-blue))", border: "none",
              color: "#fff", borderRadius: 7, padding: "7px 13px",
              fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <Plus size={13} /> Add business
          </button>
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
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      {/* Stats */}
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {[
          { label: "Awaiting submission", value: counts.awaiting, sub: "registered, not submitted", bg: "#F3F4F6", color: "#6B7280" },
          { label: "Under review", value: counts.underReview + counts.changesRequested, sub: counts.changesRequested > 0 ? `${counts.changesRequested} changes requested` : "awaiting decision", bg: "#FFF8E0", color: "#7A5F00" },
          { label: "Approved", value: counts.approved, sub: "businesses onboarded", bg: "#EFFBF3", color: "#1A7F37" },
          { label: "Rejected", value: counts.rejected, sub: "applications declined", bg: "#FDE8E8", color: "#B91C1C" },
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
            {(counts.underReview + counts.changesRequested) > 0 && (
              <span style={{ marginLeft: 5, background: "#F59E0B", color: "#fff", borderRadius: 99, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>
                {counts.underReview + counts.changesRequested}
              </span>
            )}
          </button>
          <button style={tabStyle(filter === "AWAITING")} onClick={() => setFilter("AWAITING")}>
            Awaiting submission
            {counts.awaiting > 0 && (
              <span style={{ marginLeft: 5, background: "#9CA3AF", color: "#fff", borderRadius: 99, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>
                {counts.awaiting}
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
                {["Business", "Contact", "Registration", "Country", "Submitted", "Status", "Document", "Actions"].map((h) => (
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
                const isOpen = expanded?.id === r.id;
                const actionable = r.kyb_status === "UNDER_REVIEW" || r.kyb_status === "CHANGES_REQUESTED";

                return (
                  <>
                    <tr
                      key={r.id}
                      className="border-b border-border hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-ink))" }}>
                          {r.legal_name || r.company_name}
                        </div>
                        <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{r.email}</div>
                      </td>
                      <td className="px-4 py-3" style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>{r.contact_name ?? "—"}</td>
                      <td className="px-4 py-3" style={{ fontFamily: "monospace", fontSize: 12, color: "hsl(var(--theo-ink))" }}>{r.registration_number ?? "—"}</td>
                      <td className="px-4 py-3" style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>{r.country ?? "—"}</td>
                      <td className="px-4 py-3" style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>{r.kyb_submitted_at ? timeAgo(r.kyb_submitted_at) : "—"}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full font-bold" style={{ background: sc.bg, color: sc.color, fontSize: 11, padding: "3px 8px" }}>
                          {sc.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button onClick={() => viewDoc(r.user_id)} style={btn("transparent", "hsl(var(--border))", "hsl(var(--theo-mid))")}>
                            <FileText size={11} /> Doc
                          </button>
                          {actionable && (
                            <>
                              <button onClick={() => approve(r)} disabled={isBusy} style={btn("#EFFBF3", "#86EFAC", "#1A7F37")}>
                                {isBusy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Approve
                              </button>
                              <button
                                onClick={() => setExpanded(isOpen && expanded?.mode === "send_back" ? null : { id: r.id, mode: "send_back" })}
                                style={btn("#FEF3E2", "#FDBA74", "#9A3412")}
                              >
                                <Undo2 size={11} /> Send back
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => setEditor({ mode: "edit", customer: r })}
                            style={btn("hsl(var(--theo-blue-soft))", "hsl(var(--theo-blue))", "hsl(var(--theo-blue))")}
                          >
                            <Pencil size={11} /> Edit
                          </button>
                          {actionable && (
                            <button
                              onClick={() => setExpanded(isOpen && expanded?.mode === "reject" ? null : { id: r.id, mode: "reject" })}
                              style={btn("#FDE8E8", "#FCA5A5", "#B91C1C")}
                            >
                              <XCircle size={11} /> Reject
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isOpen && expanded?.mode === "reject" && (
                      <tr key={`${r.id}-reject`} className="border-b border-border">
                        <td colSpan={7} className="px-4 pb-4 pt-2" style={{ background: "#FFF8F8" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#B91C1C", marginBottom: 6 }}>Rejection reason</div>
                          <div className="flex gap-2">
                            <textarea
                              placeholder="Explain why this application is being rejected (required)…"
                              value={reasonByRow[r.id] ?? ""}
                              onChange={(e) => setReasonByRow({ ...reasonByRow, [r.id]: e.target.value })}
                              maxLength={500}
                              rows={2}
                              style={{ flex: 1, fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #FCA5A5", outline: "none", resize: "vertical", color: "hsl(var(--theo-ink))" }}
                            />
                            <button onClick={() => reject(r)} disabled={isBusy} style={{ background: "#B91C1C", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: isBusy ? "wait" : "pointer", fontFamily: "inherit", alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5 }}>
                              {isBusy ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Confirm rejection
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}

                    {isOpen && expanded?.mode === "send_back" && (
                      <tr key={`${r.id}-back`} className="border-b border-border">
                        <td colSpan={7} className="px-4 pb-4 pt-2" style={{ background: "#FFFAF3" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#9A3412", marginBottom: 6 }}>
                            Reviewer notes (visible to customer)
                          </div>
                          <textarea
                            placeholder="Explain what needs to be changed or added…"
                            value={reasonByRow[r.id] ?? ""}
                            onChange={(e) => setReasonByRow({ ...reasonByRow, [r.id]: e.target.value })}
                            maxLength={1000}
                            rows={2}
                            style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #FDBA74", outline: "none", resize: "vertical", color: "hsl(var(--theo-ink))", marginBottom: 8 }}
                          />
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#9A3412", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            Specific items (one per line, optional)
                          </div>
                          <textarea
                            placeholder={"Upload a clearer registration certificate\nProvide proof of address\nCorrect legal name spelling"}
                            value={changesByRow[r.id] ?? ""}
                            onChange={(e) => setChangesByRow({ ...changesByRow, [r.id]: e.target.value })}
                            rows={3}
                            style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #FDBA74", outline: "none", resize: "vertical", color: "hsl(var(--theo-ink))", marginBottom: 8 }}
                          />
                          <button onClick={() => sendBack(r)} disabled={isBusy} style={{ background: "#9A3412", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: isBusy ? "wait" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
                            {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Send back to customer
                          </button>
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

      {editor && (
        <AdminKybEditor
          open
          mode={editor.mode}
          customer={editor.customer}
          onClose={() => setEditor(null)}
          onSaved={load}
        />
      )}
    </AppLayout>
  );
}
