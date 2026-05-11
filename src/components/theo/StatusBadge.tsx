import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

const labels: Record<string, string> = {
  CREATED: "Created", QUOTED: "Awaiting payment", FUNDED: "Payment received",
  RELEASING: "Releasing USDC", COMPLETED: "Complete",
  EARNING: "Earning", EARNED: "Earned", ACCRUING: "Accruing",
  FAILED: "Failed", EXPIRED: "Expired", REFUNDED: "Refunded",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("border", styles[status] ?? "")}>
      {labels[status] ?? status}
    </Badge>
  );
}
