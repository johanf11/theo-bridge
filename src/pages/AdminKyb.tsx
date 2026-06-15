import { useEffect, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, FileText, RefreshCw, Loader2,
  CornerUpLeft, Pencil, Plus, Building2, Upload, X,
} from "lucide-react";

type KybStatus = "PENDING" | "UNDER_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED";

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
  kyb_review_notes: string | null;
};

const STATUS_STYLE: Record<KybStatus, { bg: string; color: string; label: string }> = {
  PENDING:           { bg: "#F3F4F6", color: "#6B7280", label: "Awaiting submission" },
  UNDER_REVIEW:      { bg: "#FFF8E0", color: "#7A5F00", label: "Under review" },
  CHANGES_REQUESTED: { bg: "#FEF3E2", color: "#B45309", label: "Changes requested" },
  APPROVED:          { bg: "#EFFBF3", color: "#1A7F37", label: "Approved" },
  REJECTED:          { bg: "#FDE8E8", color: "#B91C1C", label: "Rejected" },
};

type Filter = "UNDER_REVIEW" | "AWAITING" | "CHANGES_REQUESTED" | "ALL";

const emptyCounts = { awaiting: 0, underReview: 0, changesRequested: 0, approved: 0, rejected: 0 };

type EditDraft = {
  legal_name: string;
  registration_number: string;
  country: string;
  business_type: string;
  contact_name: string;
};

type Panel = "reject" | "send_back" | "edit";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_BYTES = 10 * 1024 * 1024;

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function callAdminKyb(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; data?: any }> {
  const { data, error } = await supabase.functions.invoke("admin-kyb", { body });
  if (error) {
    let msg = error.message;
    try {
      const j = await (error as any).context?.json?.();
      if (j?.error) msg = j.error;
    } catch { /* keep generic message */ }
    return { ok: false, error: msg };
  }
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, data };
}

async function uploadDoc(userId: string, file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const path = `${userId}/registration-${Date.now()}.${ext}`;
  return supabase.storage.from("kyb-documents").upload(path, file, { contentType: file.type, upsert: false });
}

function validFile(file: File | null): string | null {
  if (!file) return null;
  if (!ALLOWED_TYPES.includes(file.type)) return "Document must be PDF, JPG, or PNG";
  if (file.size > MAX_BYTES) return "Document must be 10 MB or smaller";
  return null;
}

export default function AdminKyb() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<Filter>("UNDER_REVIEW");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [counts, setCounts] = useState(emptyCounts);

  // Per-row panel + drafts
  const [panelByRow, setPanelByRow] = useState<Record<string, Panel | undefined>>({});
  const [reasonByRow, setReasonByRow] = useState<Record<string, string>>({});
  const [notesByRow, setNotesByRow] = useState<Record<string, string>>({});
  const [editByRow, setEditByRow] = useState<Record<string, EditDraft>>({});
  const [editFileByRow, setEditFileByRow] = useState<Record<string, File | null>>({});

  // Create-business modal
  const [showCreate, setShowCreate] = useState(false);

  const loadCounts = async () => {
    const headCount = (status: KybStatus) =>
      supabase.from("customers").select("*", { count: "exact", head: true }).eq("kyb_status", status);
    const [awaiting, underReview, changesRequested, approved, rejected] = await Promise.all([
      headCount("PENDING"),
      headCount("UNDER_REVIEW"),
      headCount("CHANGES_REQUESTED"),
      headCount("APPROVED"),
      headCount("REJECTED"),
    ]);
    setCounts({
      awaiting: awaiting.count ?? 0,
      underReview: underReview.count ?? 0,
      changesRequested: changesRequested.count ?? 0,
      approved: approved.count ?? 0,
      rejected: rejected.count ?? 0,
    });
  };

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from("customers")
      .select("id, user_id, company_name, legal_name, registration_number, country, business_type, contact_name, email, kyb_status, kyb_submitted_at, kyb_rejection_reason, kyb_review_notes")
      .order("kyb_submitted_at", { ascending: false, nullsFirst: false });
    if (filter === "UNDER_REVIEW") query = query.eq("kyb_status", "UNDER_REVIEW");
    else if (filter === "AWAITING") query = query.eq("kyb_status", "PENDING");
    else if (filter === "CHANGES_REQUESTED") query = query.eq("kyb_status", "CHANGES_REQUESTED");
    const { data, error } = await query;
    if (error) toast.error(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
    loadCounts();
  };

  useEffect(() => { load(); }, [filter]);

  const closePanel = (id: string) =>
    setPanelByRow((p) => ({ ...p, [id]: undefined }));

  const openPanel = (row: Row, panel: Panel) => {
    setPanelByRow((p) => ({ ...p, [row.id]: p[row.id] === panel ? undefined : panel }));
    if (panel === "edit" && !editByRow[row.id]) {
      setEditByRow((e) => ({
        ...e,
        [row.id]: {
          legal_name: row.legal_name ?? row.company_name ?? "",
          registration_number: row.registration_number ?? "",
          country: row.country ?? "",
          business_type: row.business_type ?? "",
          contact_name: row.contact_name ?? "",
        },
      }));
    }
  };

  const approve = async (row: Row) => {
    setBusyId(row.id);
    const res = await callAdminKyb({ action: "approve", customerId: row.id });
    setBusyId(null);
    if (!res.ok) { toast.error(res.error ?? "Could not approve"); return; }
    toast.success(`${row.company_name} approved`);
    load();
  };

  const reject = async (row: Row) => {
    const reason = (reasonByRow[row.id] ?? "").trim();
    if (reason.length < 5) { toast.error("Please provide a rejection reason (5+ chars)"); return; }
    setBusyId(row.id);
    const res = await callAdminKyb({ action: "reject", customerId: row.id, reason });
    setBusyId(null);
    if (!res.ok) { toast.error(res.error ?? "Could not reject"); return; }
    toast.success(`${row.company_name} rejected`);
    closePanel(row.id);
    load();
  };

  const sendBack = async (row: Row) => {
    const notes = (notesByRow[row.id] ?? "").trim();
    if (notes.length < 5) { toast.error("Please describe the changes needed (5+ chars)"); return; }
    setBusyId(row.id);
    const res = await callAdminKyb({ action: "send_back", customerId: row.id, notes });
    setBusyId(null);
    if (!res.ok) { toast.error(res.error ?? "Could not send back"); return; }
    toast.success(`Sent back to ${row.company_name} with notes`);
    closePanel(row.id);
    load();
  };

  const saveEdit = async (row: Row) => {
    const draft = editByRow[row.id];
    if (!draft) return;
    const file = editFileByRow[row.id] ?? null;
    const fileErr = validFile(file);
    if (fileErr) { toast.error(fileErr); return; }

    setBusyId(row.id);
    if (file) {
      const { error: upErr } = await uploadDoc(row.user_id, file);
      if (upErr) { setBusyId(null); toast.error(upErr.message); return; }
    }
    const res = await callAdminKyb({
      action: "edit",
      customerId: row.id,
      fields: {
        legalName: draft.legal_name,
        registrationNumber: draft.registration_number,
        country: draft.country,
        businessType: draft.business_type,
        contactName: draft.contact_name,
      },
    });
    setBusyId(null);
    if (!res.ok) { toast.error(res.error ?? "Could not save"); return; }
    toast.success(`${row.company_name} updated`);
    setEditFileByRow((e) => ({ ...e, [row.id]: null }));
    closePanel(row.id);
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

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 16px", fontSize: 12, fontWeight: 700,
    border: "none", background: "none", cursor: "pointer", fontFamily: "inherit",
    color: active ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
    borderBottom: active ? "2px solid hsl(var(--theo-blue))" : "2px solid transparent",
    marginBottom: -1, transition: "all 120ms",
  });

  const actionBtn = (bg: string, border: string, color: string): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 4,
    background: bg, border: `1.5px solid ${border}`, color,
    borderRadius: 6, padding: "5px 9px", fontSize: 11, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit",
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
            Review, send back, or onboard business verification applications.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(true)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "hsl(var(--theo-blue))", border: "1.5px solid hsl(var(--theo-blue))",
              color: "#fff", borderRadius: 7, padding: "6px 12px",
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
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        {[
          { label: "Awaiting submission", value: counts.awaiting, sub: "registered, not submitted", bg: "#F3F4F6", color: "#6B7280" },
          { label: "Under review", value: counts.underReview, sub: "awaiting decision", bg: "#FFF8E0", color: "#7A5F00" },
          { label: "Changes requested", value: counts.changesRequested, sub: "sent back to customer", bg: "#FEF3E2", color: "#B45309" },
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
            {counts.underReview > 0 && (
              <span style={{ marginLeft: 5, background: "#F59E0B", color: "#fff", borderRadius: 99, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>
                {counts.underReview}
              </span>
            )}
          </button>
          <button style={tabStyle(filter === "CHANGES_REQUESTED")} onClick={() => setFilter("CHANGES_REQUESTED")}>
            Changes requested
            {counts.changesRequested > 0 && (
              <span style={{ marginLeft: 5, background: "#B45309", color: "#fff", borderRadius: 99, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>
                {counts.changesRequested}
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
            Nothing here.
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
                const panel = panelByRow[r.id];
                const draft = editByRow[r.id];
                const editFile = editFileByRow[r.id] ?? null;
                const canApprove = r.kyb_status === "UNDER_REVIEW" || r.kyb_status === "CHANGES_REQUESTED";
                const canReview = r.kyb_status === "UNDER_REVIEW";

                return (
                  <>
                    <tr key={r.id} className="border-b border-border">
                      <td className="px-4 py-3">
                        <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-ink))" }}>
                          {r.legal_name || r.company_name}
                        </div>
                        <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{r.email}</div>
                      </td>
                      <td className="px-4 py-3" style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                        {r.contact_name ?? "—"}
                      </td>
                      <td className="px-4 py-3" style={{ fontFamily: "monospace", fontSize: 12, color: "hsl(var(--theo-ink))" }}>
                        {r.registration_number ?? "—"}
                      </td>
                      <td className="px-4 py-3" style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                        {r.country ?? "—"}
                      </td>
                      <td className="px-4 py-3" style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                        {r.kyb_submitted_at ? timeAgo(r.kyb_submitted_at) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full font-bold" style={{ background: sc.bg, color: sc.color, fontSize: 11, padding: "3px 8px" }}>
                          {sc.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button onClick={() => viewDoc(r.user_id)} style={actionBtn("transparent", "hsl(var(--border))", "hsl(var(--theo-mid))")}>
                            <FileText size={11} /> Doc
                          </button>
                          {canApprove && (
                            <button onClick={() => approve(r)} disabled={isBusy} style={{ ...actionBtn("#EFFBF3", "#86EFAC", "#1A7F37"), cursor: isBusy ? "wait" : "pointer" }}>
                              {isBusy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Approve
                            </button>
                          )}
                          {canReview && (
                            <button onClick={() => openPanel(r, "send_back")} style={actionBtn("#FEF3E2", "#FDBA74", "#B45309")}>
                              <CornerUpLeft size={11} /> Send back
                            </button>
                          )}
                          {canReview && (
                            <button onClick={() => openPanel(r, "reject")} style={actionBtn("#FDE8E8", "#FCA5A5", "#B91C1C")}>
                              <XCircle size={11} /> Reject
                            </button>
                          )}
                          <button onClick={() => openPanel(r, "edit")} style={actionBtn("#EEF0FB", "#C7CBF0", "hsl(var(--theo-blue))")}>
                            <Pencil size={11} /> Edit
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Send back panel */}
                    {panel === "send_back" && (
                      <tr key={`${r.id}-sb`} className="border-b border-border">
                        <td colSpan={7} className="px-4 pb-4 pt-2" style={{ background: "#FFFBF3" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#B45309", marginBottom: 6 }}>
                            Send back with comments
                          </div>
                          <div className="flex gap-2">
                            <textarea
                              placeholder="Describe the suggested inclusions or edits the customer needs to make…"
                              value={notesByRow[r.id] ?? ""}
                              onChange={(e) => setNotesByRow({ ...notesByRow, [r.id]: e.target.value })}
                              maxLength={1000} rows={2}
                              style={{ flex: 1, fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #FDBA74", outline: "none", resize: "vertical", color: "hsl(var(--theo-ink))" }}
                            />
                            <button onClick={() => sendBack(r)} disabled={isBusy}
                              style={{ background: "#B45309", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: isBusy ? "wait" : "pointer", fontFamily: "inherit", alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5 }}>
                              {isBusy ? <Loader2 size={12} className="animate-spin" /> : <CornerUpLeft size={12} />} Send back
                            </button>
                          </div>
                          {r.kyb_review_notes && (
                            <div style={{ fontSize: 11, color: "#B45309", marginTop: 6 }}>Previous notes: {r.kyb_review_notes}</div>
                          )}
                        </td>
                      </tr>
                    )}

                    {/* Reject panel */}
                    {panel === "reject" && (
                      <tr key={`${r.id}-rj`} className="border-b border-border">
                        <td colSpan={7} className="px-4 pb-4 pt-2" style={{ background: "#FFF8F8" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#B91C1C", marginBottom: 6 }}>Rejection reason</div>
                          <div className="flex gap-2">
                            <textarea
                              placeholder="Explain why this application is being rejected (required)…"
                              value={reasonByRow[r.id] ?? ""}
                              onChange={(e) => setReasonByRow({ ...reasonByRow, [r.id]: e.target.value })}
                              maxLength={1000} rows={2}
                              style={{ flex: 1, fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #FCA5A5", outline: "none", resize: "vertical", color: "hsl(var(--theo-ink))" }}
                            />
                            <button onClick={() => reject(r)} disabled={isBusy}
                              style={{ background: "#B91C1C", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: isBusy ? "wait" : "pointer", fontFamily: "inherit", alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5 }}>
                              {isBusy ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Confirm rejection
                            </button>
                          </div>
                          {r.kyb_rejection_reason && (
                            <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 6 }}>Previous reason: {r.kyb_rejection_reason}</div>
                          )}
                        </td>
                      </tr>
                    )}

                    {/* Edit (white-glove) panel */}
                    {panel === "edit" && draft && (
                      <tr key={`${r.id}-ed`} className="border-b border-border">
                        <td colSpan={7} className="px-4 pb-4 pt-2" style={{ background: "#F7F8FE" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-blue))", marginBottom: 8 }}>
                            Edit on behalf of customer
                          </div>
                          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                            <EditField label="Legal company name" value={draft.legal_name} onChange={(v) => setEditByRow((e) => ({ ...e, [r.id]: { ...draft, legal_name: v } }))} />
                            <EditField label="Registration number" value={draft.registration_number} onChange={(v) => setEditByRow((e) => ({ ...e, [r.id]: { ...draft, registration_number: v } }))} />
                            <EditField label="Country of registration" value={draft.country} onChange={(v) => setEditByRow((e) => ({ ...e, [r.id]: { ...draft, country: v } }))} />
                            <EditField label="Business type" value={draft.business_type} onChange={(v) => setEditByRow((e) => ({ ...e, [r.id]: { ...draft, business_type: v } }))} />
                            <EditField label="Primary contact" value={draft.contact_name} onChange={(v) => setEditByRow((e) => ({ ...e, [r.id]: { ...draft, contact_name: v } }))} />
                            <div>
                              <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "hsl(var(--theo-mid))" }}>
                                Replace document (optional)
                              </label>
                              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, border: "1.5px dashed hsl(var(--border))", borderRadius: 8, padding: "8px 10px", fontSize: 12, cursor: "pointer", color: "hsl(var(--theo-mid))" }}>
                                <Upload size={13} /> {editFile ? editFile.name : "Upload PDF, JPG, or PNG"}
                                <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="sr-only"
                                  onChange={(e) => setEditFileByRow((m) => ({ ...m, [r.id]: e.target.files?.[0] ?? null }))} />
                              </label>
                            </div>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button onClick={() => saveEdit(r)} disabled={isBusy}
                              style={{ background: "hsl(var(--theo-blue))", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: isBusy ? "wait" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
                              {isBusy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Save changes
                            </button>
                            <button onClick={() => closePanel(r.id)}
                              style={{ background: "transparent", color: "hsl(var(--theo-mid))", border: "1.5px solid hsl(var(--border))", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                              Cancel
                            </button>
                          </div>
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

      {showCreate && <CreateBusinessModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
    </AppLayout>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "hsl(var(--theo-mid))" }}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", marginTop: 4, fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1.5px solid hsl(var(--border))", outline: "none", color: "hsl(var(--theo-ink))" }} />
    </div>
  );
}

function CreateBusinessModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    email: "", companyName: "", legalName: "", registrationNumber: "",
    country: "", businessType: "", contactName: "", phone: "",
  });

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.email.includes("@")) { toast.error("A valid email is required"); return; }
    if (form.companyName.trim().length < 2) { toast.error("Company name is required"); return; }
    const fileErr = validFile(file);
    if (fileErr) { toast.error(fileErr); return; }

    setBusy(true);
    const res = await callAdminKyb({
      action: "create_business",
      email: form.email,
      companyName: form.companyName,
      submit: true,
      fields: {
        legalName: form.legalName,
        registrationNumber: form.registrationNumber,
        country: form.country,
        businessType: form.businessType,
        contactName: form.contactName,
        phone: form.phone,
      },
    });
    if (!res.ok) { setBusy(false); toast.error(res.error ?? "Could not create business"); return; }

    if (file && res.data?.userId) {
      const { error: upErr } = await uploadDoc(res.data.userId, file);
      if (upErr) { setBusy(false); toast.error(`Business created, but document upload failed: ${upErr.message}`); onCreated(); return; }
    }
    setBusy(false);
    toast.success(`${form.companyName} added and queued for review`);
    onCreated();
  };

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(26,26,46,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div className="flex items-center justify-between" style={{ padding: "16px 20px", borderBottom: "1px solid hsl(var(--border))" }}>
          <div className="flex items-center gap-2" style={{ fontSize: 15, fontWeight: 800, color: "hsl(var(--theo-blue))" }}>
            <Building2 size={16} /> Add a business
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--theo-mid))" }}><X size={18} /></button>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginBottom: 16 }}>
            Creates the account, emails the customer an invite to set their password, and files the KYB details you have on hand. The application is queued for review.
          </p>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            <EditField label="Customer email *" value={form.email} onChange={set("email")} />
            <EditField label="Company name *" value={form.companyName} onChange={set("companyName")} />
            <EditField label="Legal company name" value={form.legalName} onChange={set("legalName")} />
            <EditField label="Registration number" value={form.registrationNumber} onChange={set("registrationNumber")} />
            <EditField label="Country of registration" value={form.country} onChange={set("country")} />
            <EditField label="Business type" value={form.businessType} onChange={set("businessType")} />
            <EditField label="Primary contact" value={form.contactName} onChange={set("contactName")} />
            <EditField label="Phone" value={form.phone} onChange={set("phone")} />
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "hsl(var(--theo-mid))" }}>
              Registration document (optional)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, border: "1.5px dashed hsl(var(--border))", borderRadius: 8, padding: "8px 10px", fontSize: 12, cursor: "pointer", color: "hsl(var(--theo-mid))" }}>
              <Upload size={13} /> {file ? file.name : "Upload PDF, JPG, or PNG (max 10 MB)"}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2" style={{ padding: "16px 20px", borderTop: "1px solid hsl(var(--border))" }}>
          <button onClick={onClose} style={{ background: "transparent", color: "hsl(var(--theo-mid))", border: "1.5px solid hsl(var(--border))", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy}
            style={{ background: "hsl(var(--theo-blue))", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add business
          </button>
        </div>
      </div>
    </div>
  );
}
