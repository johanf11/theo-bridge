// Parse and validate Odoo settlement payloads for theo-api-quote.

export type SettlementRail = "wire" | "local" | "usdc" | "ach";

export type BeneficiaryMetadata = {
  name: string;
  bank_name?: string | null;
  account_number?: string | null;
  swift?: string | null;
  country?: string | null;
  wallet_address?: string | null;
  currency?: string | null;
};

export type SettlementPayload = {
  rail: SettlementRail;
  currency?: string | null;
  beneficiary: BeneficiaryMetadata;
  external_ref?: string | null;
};

export function owltningOfframpAddress(): string | null {
  const addr = (Deno.env.get("OWLTING_OFFRAMP_STELLAR_ADDRESS") ?? "").trim();
  if (addr.startsWith("G") && addr.length >= 50) return addr;
  return null;
}

const OWLTING_PLATFORM_FEE_BPS = 50;
const OWLTING_PLATFORM_FEE_MIN_USD = 50;

/** Platform fee for USDC → fiat off-ramp: max($50, 50 bps of bill amount). */
export function calcOwltingPlatformFeeUsd(billAmountUsd: number, rail: SettlementRail): number {
  if (rail === "usdc") return 0;
  const amount = Number(billAmountUsd) || 0;
  const bpsFee = Math.round(amount * OWLTING_PLATFORM_FEE_BPS / 10_000 * 100) / 100;
  return Math.round(Math.max(OWLTING_PLATFORM_FEE_MIN_USD, bpsFee) * 100) / 100;
}

export function parseSettlementBody(body: Record<string, unknown>): { settlement?: SettlementPayload; error?: string } {
  const settlementRaw = body.settlement as Record<string, unknown> | undefined;
  const supplierRaw = body.supplier as Record<string, unknown> | undefined;

  if (settlementRaw) {
    return parseSettlementObject(settlementRaw, body);
  }

  // Legacy: direct-to-supplier Stellar (deprecated — kept for backward compatibility).
  if (supplierRaw?.stellar_address) {
    const dest = String(supplierRaw.stellar_address).trim();
    if (!dest.startsWith("G") || dest.length < 50) {
      return { error: "supplier.stellar_address (G…) invalid" };
    }
    return {
      settlement: {
        rail: "usdc",
        currency: "USD",
        beneficiary: {
          name: String(supplierRaw.name ?? ""),
          wallet_address: dest,
        },
        external_ref: supplierRaw.external_ref ? String(supplierRaw.external_ref) : null,
      },
    };
  }

  return { error: "settlement object required (rail + beneficiary)" };
}

function parseSettlementObject(
  settlementRaw: Record<string, unknown>,
  body: Record<string, unknown>,
): { settlement?: SettlementPayload; error?: string } {
  const rail = String(settlementRaw.rail ?? "").trim() as SettlementRail;
  const beneficiaryRaw = settlementRaw.beneficiary as Record<string, unknown> | undefined;
  const name = String(beneficiaryRaw?.name ?? "").trim();
  const externalRef =
    (settlementRaw.external_ref ? String(settlementRaw.external_ref) : null) ??
    (body.invoice_ref ? String(body.invoice_ref) : null) ??
    (body.external_invoice_ref ? String(body.external_invoice_ref) : null);

  if (!name) return { error: "settlement.beneficiary.name required" };

  const beneficiary: BeneficiaryMetadata = {
    name,
    bank_name: beneficiaryRaw?.bank_name ? String(beneficiaryRaw.bank_name).trim() : null,
    account_number: beneficiaryRaw?.account_number ? String(beneficiaryRaw.account_number).trim() : null,
    swift: beneficiaryRaw?.swift ? String(beneficiaryRaw.swift).trim() : null,
    country: beneficiaryRaw?.country ? String(beneficiaryRaw.country).trim() : null,
    wallet_address: beneficiaryRaw?.wallet_address ? String(beneficiaryRaw.wallet_address).trim() : null,
    currency: (settlementRaw.currency ?? beneficiaryRaw?.currency)
      ? String(settlementRaw.currency ?? beneficiaryRaw?.currency).trim()
      : null,
  };

  if (rail === "wire") {
    if (!beneficiary.bank_name || !beneficiary.account_number || !beneficiary.swift) {
      return { error: "wire rail requires bank_name, account_number, and swift" };
    }
  } else if (rail === "local") {
    if (!beneficiary.bank_name || !beneficiary.account_number || !beneficiary.currency) {
      return { error: "local rail requires bank_name, account_number, and currency" };
    }
  } else if (rail === "usdc") {
    const wallet = beneficiary.wallet_address ?? "";
    if (!wallet.startsWith("G") || wallet.length < 50) {
      return { error: "usdc rail requires beneficiary.wallet_address (G…)" };
    }
  } else if (rail === "ach") {
    if (!beneficiary.bank_name || !beneficiary.account_number) {
      return { error: "ach rail requires bank_name and account_number" };
    }
  } else {
    return { error: "settlement.rail must be wire, local, usdc, or ach" };
  }

  return {
    settlement: {
      rail,
      currency: beneficiary.currency,
      beneficiary,
      external_ref: externalRef,
    },
  };
}
