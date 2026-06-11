import { createContext, useContext, useEffect, useState } from "react";

export type Lang = "en" | "fr";

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const STORAGE_KEY = "theo.lang";

function readInitial(): Lang {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  const lang: Lang = (saved === "en" || saved === "fr")
    ? saved
    : (navigator.language?.toLowerCase() ?? "").startsWith("fr") ? "fr" : "en";
  // Set synchronously so currentLocale() returns the right value on first render,
  // before the LanguageProvider's useEffect fires.
  document.documentElement.lang = lang;
  return lang;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitial);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (l: Lang) => {
    // Update document.lang BEFORE the state update so that currentLocale() in
    // non-hook format functions (fmtUSDC, fmtHTG, etc.) reads the new locale
    // during the same render cycle that useLocale() will produce.
    document.documentElement.lang = l;
    window.localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
