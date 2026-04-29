import { cn } from "@/lib/utils";

export function Logo({ className, variant = "dark" }: { className?: string; variant?: "dark" | "light" }) {
  return (
    <div className={cn("flex items-center gap-2 font-display font-bold text-xl", className)}>
      <span
        aria-hidden
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-gold text-theo-blue-deep font-bold"
      >
        T
      </span>
      <span className={variant === "light" ? "text-white" : "text-theo-blue-deep"}>
        Theo
      </span>
    </div>
  );
}
