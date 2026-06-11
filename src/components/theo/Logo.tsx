import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export function Logo({ className, variant = "dark" }: { className?: string; variant?: "dark" | "light" }) {
  return (
    <Link
      to="/"
      aria-label="Theo — home"
      className={cn("inline-flex items-center no-underline", className)}
      style={{ gap: 10 }}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center bg-secondary text-secondary-foreground flex-shrink-0"
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          fontWeight: 800,
          fontSize: 22,
          letterSpacing: "-1px",
          lineHeight: 1,
        }}
      >
        T
      </span>
      <span
        className={cn("wordmark", variant === "light" ? "text-white" : "text-primary")}
        style={{ fontWeight: 800, fontSize: 22, letterSpacing: "-0.5px", lineHeight: 1 }}
      >
        Theo
      </span>
    </Link>
  );
}
