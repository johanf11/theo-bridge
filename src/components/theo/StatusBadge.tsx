import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

const styles: Record<string, string> = {
  CREATED:   "bg-muted text-muted-foreground",
  QUOTED:    "bg-theo-cyan/15 text-theo-cyan border-theo-cyan/30",
  FUNDED:    "bg-warning/15 text-warning border-warning/30",
  RELEASING: "bg-theo-blue/15 text-theo-blue border-theo-blue/30",
  COMPLETED: "bg-success/15 text-success border-success/30",
  EARNING:   "bg-success/15 text-success border-success/30",
  EARNED:    "bg-success/15 text-success border-success/30",
  ACCRUING:  "bg-theo-cyan/15 text-theo-cyan border-theo-cyan/30",
  FAILED:    "bg-destructive/15 text-destructive border-destructive/30",
  EXPIRED:   "bg-destructive/10 text-destructive border-destructive/20",
  REFUNDED:  "bg-muted text-muted-foreground",
};

const labelKeys: Record<string, string> = {
  CREATED: "common.status.created",
  QUOTED: "common.status.awaitingPayment",
  FUNDED: "common.status.paymentReceived",
  RELEASING: "common.status.releasing",
  COMPLETED: "common.status.complete",
  EARNING: "common.status.earning",
  EARNED: "common.status.earned",
  ACCRUING: "common.status.accruing",
  FAILED: "common.status.failed",
  EXPIRED: "common.status.expired",
  REFUNDED: "common.status.refunded",
};

export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  const key = labelKeys[status];
  return (
    <Badge variant="outline" className={cn("border", styles[status] ?? "")}>
      {key ? t(key as Parameters<typeof t>[0]) : status}
    </Badge>
  );
}
