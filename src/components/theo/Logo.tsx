import { cn } from "@/lib/utils";

export function Logo({ className, variant = "dark" }: { className?: string; variant?: "dark" | "light" }) {
  return (
    <div className={cn("flex items-center gap-2 font-display font-bold text-xl", className)}>
      <span
        aria-hidden
        className="inline-flex h-8 w-8 items-center justify-center bg-secondary text-secondary-foreground font-extrabold"
        style={{ borderRadius: "22%" }}
      >
        T
      </span>
      <span className={cn("wordmark", variant === "light" && "!text-white")}>
        Theo
      </span>
    </div>
  );
}
