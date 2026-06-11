import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Returns the locale for UI TEXT and dates (labels, months, weekdays).
 * Numbers always use "en-US" — see NUMBER_LOCALE below.
 */
export function useLocale() {
  const { lang } = useLanguage();
  return lang === "fr" ? "fr-FR" : "en-US";
}

export function currentLocale() {
  if (typeof document === "undefined") return "en-US";
  return document.documentElement.lang === "fr" ? "fr-FR" : "en-US";
}

/**
 * Number locale is always "en-US" regardless of UI language.
 * Financial amounts on this platform are USD-denominated; users expect
 * comma as thousands separator and period as decimal (e.g. $509,854.00).
 * Translating the UI to French changes labels, not number format.
 */
export const NUMBER_LOCALE = "en-US";

// normalizeThousands is no longer needed since we pin to en-US, but kept
// for any legacy call sites that may still reference it.
export function normalizeThousands(s: string): string {
  return s;
}

/**
 * Capitalize the first letter of every word in a locale date string.
 * Turns "27 mai 2026" => "27 Mai 2026" for French.
 */
export function capitalizeDate(s: string): string {
  return s.replace(/\b([a-zA-ZÀ-ÿ])/g, (c) => c.toUpperCase());
}

/**
 * Hook: returns a number formatter pinned to en-US (comma thousands, period decimal).
 * Always produces consistent results regardless of UI language.
 */
export function useFormatN() {
  return (n: number, opts?: Intl.NumberFormatOptions) =>
    n.toLocaleString(NUMBER_LOCALE, opts);
}

/** Hook: returns a date formatter that uses the current UI locale and capitalizes month names */
export function useFormatDate() {
  const locale = useLocale();
  return (date: Date, opts: Intl.DateTimeFormatOptions) =>
    capitalizeDate(date.toLocaleDateString(locale, opts));
}
