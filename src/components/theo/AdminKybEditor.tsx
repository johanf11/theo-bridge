import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export type EditorMode = "edit" | "create";

export type EditorCustomer = {
  id?: string;
  email?: string;
  company_name?: string | null;
  legal_name?: string | null;
  registration_number?: string | null;
  country?: string | null;
  business_type?: string | null;
  contact_name?: string | null;
  phone?: string | null;
};

type Props = {
  open: boolean;
  mode: EditorMode;
  customer?: EditorCustomer | null;
  onClose: () => void;
  onSaved: () => void;
};

const empty: EditorCustomer = {
  email: "",
  company_name: "",
  legal_name: "",
  registration_number: "",
  country: "",
  business_type: "",
  contact_name: "",
  phone: "",
};

export function AdminKybEditor({ open, mode, customer, onClose, onSaved }: Props) {
  const [form, setForm] = useState<EditorCustomer>(empty);
  const [busy, setBusy] = useState(false);
  const [feeBps, setFeeBps] = useState<string>("");
  const [corridorBps, setCorridorBps] = useState<string>("");

  useEffect(() => {
    if (open) {
      setForm(customer ?? empty);
      setFeeBps("");
      setCorridorBps("");
    }
  }, [open, customer]);

  const set = (k: keyof EditorCustomer) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const callFn = async (extra: Record<string, unknown>) => {
    setBusy(true);
    try {
      const payload =
        mode === "create"
          ? {
              action: "add_business",
              email: form.email,
              company_name: form.company_name,
              legal_name: form.legal_name || null,
              registration_number: form.registration_number || null,
              country: form.country || null,
              business_type: form.business_type || null,
              contact_name: form.contact_name || null,
              phone: form.phone || null,
              fee_bps: feeBps ? Number(feeBps) : undefined,
              corridor_bps: corridorBps ? Number(corridorBps) : undefined,
              ...extra,
            }
          : {
              action: "edit",
              customer_id: customer?.id,
              fields: {
                company_name: form.company_name,
                legal_name: form.legal_name,
                registration_number: form.registration_number,
                country: form.country,
                business_type: form.business_type,
                contact_name: form.contact_name,
                phone: form.phone,
              },
              ...extra,
            };

      const { data, error } = await supabase.functions.invoke("admin-kyb", { body: payload });
      if (error) {
        toast.error(error.message);
        return;
      }
      if ((data as { error?: string })?.error) {
        toast.error((data as { error?: string }).error!);
        return;
      }
      toast.success(mode === "create" ? "Business added" : "Saved");
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "create" ? "Add business" : `Edit ${customer?.company_name ?? "business"}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          {mode === "create" && (
            <div className="md:col-span-2">
              <Label htmlFor="email">Email *</Label>
              <Input id="email" type="email" value={form.email ?? ""} onChange={set("email")} required />
            </div>
          )}
          <div>
            <Label htmlFor="company_name">Company name *</Label>
            <Input id="company_name" value={form.company_name ?? ""} onChange={set("company_name")} required />
          </div>
          <div>
            <Label htmlFor="legal_name">Legal name</Label>
            <Input id="legal_name" value={form.legal_name ?? ""} onChange={set("legal_name")} />
          </div>
          <div>
            <Label htmlFor="contact_name">Primary contact</Label>
            <Input id="contact_name" value={form.contact_name ?? ""} onChange={set("contact_name")} />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={form.phone ?? ""} onChange={set("phone")} />
          </div>
          <div>
            <Label htmlFor="registration_number">Registration #</Label>
            <Input id="registration_number" value={form.registration_number ?? ""} onChange={set("registration_number")} />
          </div>
          <div>
            <Label htmlFor="country">Country</Label>
            <Input id="country" value={form.country ?? ""} onChange={set("country")} placeholder="Haiti" />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="business_type">Business type</Label>
            <Input id="business_type" value={form.business_type ?? ""} onChange={set("business_type")} placeholder="LLC, S.A., …" />
          </div>

          {mode === "create" && (
            <>
              <div>
                <Label htmlFor="fee_bps">Theo fee (bps, optional)</Label>
                <Input id="fee_bps" type="number" min={0} max={500} value={feeBps} onChange={(e) => setFeeBps(e.target.value)} placeholder="130" />
              </div>
              <div>
                <Label htmlFor="corridor_bps">Corridor (bps, optional)</Label>
                <Input id="corridor_bps" type="number" min={0} max={500} value={corridorBps} onChange={(e) => setCorridorBps(e.target.value)} placeholder="70" />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          {mode === "edit" ? (
            <>
              <Button variant="outline" onClick={() => callFn({})} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <Button onClick={() => callFn({ set_status: "APPROVED" })} disabled={busy}>
                Save & approve
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => callFn({ set_status: "UNDER_REVIEW" })} disabled={busy}>
                Save as pending review
              </Button>
              <Button onClick={() => callFn({ set_status: "APPROVED" })} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add & approve"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
