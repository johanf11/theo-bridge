import { useLanguage, type Lang } from "@/contexts/LanguageContext";

/**
 * Pill-shaped EN/FR language toggle.
 * Gold pill behind the active option, navy text for both.
 */
export function LanguageToggle() {
  const { lang, setLang } = useLanguage();

  return (
    <div
      role="group"
      aria-label="Language"
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: "hsl(var(--theo-blue-soft))",
        borderRadius: 10,
        padding: 3,
        gap: 2,
      }}
    >
      <Pill code="en" active={lang === "en"} onClick={() => setLang("en")} />
      <Pill code="fr" active={lang === "fr"} onClick={() => setLang("fr")} />
    </div>
  );
}

function Pill({ code, active, onClick }: { code: Lang; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        minWidth: 32,
        height: 22,
        padding: "0 10px",
        borderRadius: 7,
        border: "none",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.3,
        background: active ? "hsl(var(--theo-gold))" : "transparent",
        color: "hsl(var(--theo-blue))",
        transition: "background 120ms",
      }}
    >
      {code.toUpperCase()}
    </button>
  );
}
