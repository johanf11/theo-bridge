import { useEffect, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle2, XCircle, FileText, RefreshCw } from "lucide-react";

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

export default function AdminKyb() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"UNDER_REVIEW" | "ALL">("UNDER_REVIEW");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonByRow, setReasonByRow] = useState<Record<string, string>>({});

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

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

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

  return (
    <AppLayout>
      <div className="flex items-end justify-between mb-8 gap-4 flex-wrap">
        <div>
          <p className="eyebrow text-theo-cyan">Admin</p>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tightest">KYB review</h1>
        </div>
        <div className="flex gap-2">
          <Button variant={filter === "UNDER_REVIEW" ? "default" : "outline"} size="sm" onClick={() => setFilter("UNDER_REVIEW")}>Under review</Button>
          <Button variant={filter === "ALL" ? "default" : "outline"} size="sm" onClick={() => setFilter("ALL")}>All</Button>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nothing to review.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="font-display text-xl">{r.legal_name || r.company_name}</CardTitle>
                  <div className="text-sm text-muted-foreground mt-1">{r.email} · {r.contact_name ?? "—"}</div>
                </div>
                <Badge variant="outline">{r.kyb_status.replace("_", " ")}</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-4 gap-4 text-sm">
                  <Info label="Registration #" value={r.registration_number} />
                  <Info label="Country" value={r.country} />
                  <Info label="Business type" value={r.business_type} />
                  <Info label="Submitted" value={r.kyb_submitted_at ? new Date(r.kyb_submitted_at).toLocaleString() : "—"} />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => viewDoc(r.user_id)}>
                    <FileText className="h-4 w-4 mr-2" /> View document
                  </Button>
                </div>

                {r.kyb_status === "UNDER_REVIEW" && (
                  <div className="space-y-2 border-t pt-4">
                    <Textarea
                      placeholder="Rejection reason (only required when rejecting)"
                      value={reasonByRow[r.id] ?? ""}
                      onChange={(e) => setReasonByRow({ ...reasonByRow, [r.id]: e.target.value })}
                      maxLength={500}
                    />
                    <div className="flex gap-2">
                      <Button onClick={() => approve(r)} disabled={busyId === r.id}>
                        <CheckCircle2 className="h-4 w-4 mr-2" /> Approve
                      </Button>
                      <Button variant="destructive" onClick={() => reject(r)} disabled={busyId === r.id}>
                        <XCircle className="h-4 w-4 mr-2" /> Reject
                      </Button>
                    </div>
                  </div>
                )}

                {r.kyb_status === "REJECTED" && r.kyb_rejection_reason && (
                  <div className="text-sm border-t pt-4">
                    <span className="font-medium">Rejection reason: </span>
                    <span className="text-muted-foreground">{r.kyb_rejection_reason}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-medium">{value ?? "—"}</div>
    </div>
  );
}
