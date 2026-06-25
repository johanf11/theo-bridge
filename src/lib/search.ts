import {
  LayoutGrid, ArrowLeftRight, ArrowRightLeft, Wallet, SendHorizonal,
  Settings, ShieldCheck, Wrench, BookLock, Receipt, FileText, BookOpen, Activity, Building2,
  type LucideIcon,
} from "lucide-react";
import type { TKey } from "@/lib/i18n";

export const SEARCH_Q_PARAM = "q";
export const SEARCH_ID_PARAM = "id";

/** Pages where the search bar also filters the visible list inline. */
export const SEARCH_FILTER_PAGES = ["/transactions", "/payout", "/invoices"] as const;

export type SearchNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  keywords: string[];
  adminOnly?: boolean;
};

export function buildSearchNavItems(
  t: (key: TKey) => string,
  isAdmin: boolean,
): SearchNavItem[] {
  const items: SearchNavItem[] = [
    {
      to: "/dashboard",
      label: t("nav.dashboard"),
      icon: LayoutGrid,
      keywords: ["home", "dashboard", "accueil", "tableau"],
    },
    {
      to: "/transactions",
      label: t("nav.transactions"),
      icon: ArrowLeftRight,
      keywords: ["transactions", "history", "orders", "historique", "activity", "reference", "memo", "theo-cnv"],
    },
    {
      to: "/balance",
      label: t("nav.balance"),
      icon: Wallet,
      keywords: ["balance", "wallet", "account", "funds", "solde", "wallets"],
    },
    {
      to: "/payout",
      label: t("nav.payout"),
      icon: SendHorizonal,
      keywords: ["payout", "send", "payment", "transfer", "envoyer", "new payout", "send money"],
    },
    {
      to: "/pay-bill",
      label: t("nav.payBill"),
      icon: Building2,
      keywords: ["pay bill", "vendor", "supplier", "wire", "fiat", "owlting", "off ramp", "facture", "fournisseur"],
    },
    {
      to: "/invoices",
      label: t("nav.invoices"),
      icon: FileText,
      keywords: ["invoice", "invoices", "request", "bill", "facture", "create invoice"],
    },
    {
      to: "/convert",
      label: t("nav.convert"),
      icon: ArrowRightLeft,
      keywords: ["convert", "on ramp", "off ramp", "buy", "exchange", "convertir", "ramp"],
    },
    {
      to: "/compliance",
      label: t("nav.compliance"),
      icon: BookLock,
      keywords: ["compliance", "audit", "flags", "conformité", "regulatory"],
    },
    {
      to: "/billing",
      label: t("nav.billing"),
      icon: Receipt,
      keywords: ["billing", "subscription", "plan", "facturation"],
    },
    {
      to: "/settings",
      label: t("nav.settings"),
      icon: Settings,
      keywords: ["settings", "profile", "account", "paramètres", "preferences"],
    },
    {
      to: "/kyb",
      label: t("nav.kyb"),
      icon: ShieldCheck,
      keywords: ["kyb", "verification", "onboarding", "business", "vérification"],
    },
    {
      to: "/admin/kyb",
      label: t("nav.admin.kyb"),
      icon: ShieldCheck,
      keywords: ["admin kyb", "review", "approvals"],
      adminOnly: true,
    },
    {
      to: "/admin/conversions",
      label: t("nav.admin.conversions"),
      icon: ArrowLeftRight,
      keywords: ["admin conversions", "orders"],
      adminOnly: true,
    },
    {
      to: "/admin/transactions",
      label: t("nav.admin.transactions"),
      icon: Activity,
      keywords: ["admin transactions", "all transactions"],
      adminOnly: true,
    },
    {
      to: "/admin/tools",
      label: t("nav.admin.tools"),
      icon: Wrench,
      keywords: ["admin tools", "utilities"],
      adminOnly: true,
    },
    {
      to: "/admin/owlting",
      label: t("nav.admin.owlting"),
      icon: Building2,
      keywords: ["owlting", "off ramp", "vendor wires", "fiat queue"],
      adminOnly: true,
    },
    {
      to: "/admin/ledger",
      label: t("nav.admin.ledger"),
      icon: BookOpen,
      keywords: ["admin ledger", "journal"],
      adminOnly: true,
    },
  ];

  return items.filter((item) => !item.adminOnly || isAdmin);
}

/** Strip characters that break PostgREST filter syntax. */
export function sanitizeIlike(q: string): string {
  return q.replace(/[%_,()."'\\]/g, " ").replace(/\s+/g, " ").trim();
}

export function scoreNavMatch(label: string, keywords: string[], query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  const l = label.toLowerCase();
  if (l === q) return 100;
  if (l.startsWith(q)) return 80;
  if (l.includes(q)) return 60;

  for (const k of keywords) {
    const kl = k.toLowerCase();
    if (kl === q) return 70;
    if (kl.startsWith(q)) return 50;
    if (kl.includes(q)) return 40;
  }

  let idx = 0;
  for (const ch of q) {
    const found = l.indexOf(ch, idx);
    if (found === -1) return 0;
    idx = found + 1;
  }
  return q.length >= 3 ? 20 : 0;
}

export function matchNavItems(items: SearchNavItem[], query: string): SearchNavItem[] {
  const q = query.trim();
  if (!q) return [];

  return items
    .map((item) => ({ item, score: scoreNavMatch(item.label, item.keywords, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

export function parseSearchParams(search: string): { q: string; highlightId: string | null } {
  const params = new URLSearchParams(search);
  return {
    q: params.get(SEARCH_Q_PARAM) ?? "",
    highlightId: params.get(SEARCH_ID_PARAM),
  };
}

export function buildEntitySearchUrl(path: string, q: string, id: string): string {
  const params = new URLSearchParams();
  params.set(SEARCH_Q_PARAM, q);
  params.set(SEARCH_ID_PARAM, id);
  return `${path}?${params.toString()}`;
}

/** System payout memos — never surfaced in customer search. */
export const INTERNAL_PAYOUT_MEMOS = ["internal-transfer", "blend-withdraw"] as const;

/** Matches order references like THEO-CNV-GL5NAX (also used as on-chain memo). */
export function looksLikeTheoReference(q: string): boolean {
  return /^THEO-/i.test(q.trim());
}

/** Matches Stellar transaction hashes (full or partial). */
export function looksLikeStellarTxHash(q: string): boolean {
  return /^[a-f0-9]{16,64}$/i.test(q.trim());
}

/** Widen transaction history when searching by reference, hash, or deep-link id. */
export function shouldExpandTransactionDateRange(q: string, highlightId: string | null): boolean {
  const trimmed = q.trim();
  return !!highlightId || looksLikeTheoReference(trimmed) || looksLikeStellarTxHash(trimmed);
}
