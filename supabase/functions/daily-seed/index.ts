/**
 * daily-seed — Inserts realistic completed transactions for CIG each day.
 * Triggered by pg_cron via CRON_SECRET header.
 *
 * Each run inserts:
 *   2–3 usdc_conversion orders  (HTG deposits → USDC)
 *   1   htgc_usdc_swap order    (HTG-C → USDC exchange)
 *   1   payout                  (USDC sent to a saved recipient)
 *
 * Amounts vary daily using a date-based seed so the chart looks organic.
 * All records are written as COMPLETED — no Stellar txs are executed.
 * This keeps the dashboard and ledger realistic for demos without
 * requiring live on-chain activity every day.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Lightweight seeded PRNG (mulberry32) — deterministic per date so
// re-running on the same day produces identical records (idempotent via reference_number).
function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function dateSeed(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function refId(prefix: string, rng: () => number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(rng() * chars.length)];
  return `${prefix}-${s}`;
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...headers, "Content-Type": "application/json" } });

  // Auth: cron secret OR admin JWT
  const cronHeader = req.headers.get("x-cron-secret");
  const isCron = cronHeader && cronHeader === Deno.env.get("CRON_SECRET");

  if (!isCron) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: role } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Admin access required" }, 403);
  }

  const url  = Deno.env.get("SUPABASE_URL")!;
  const svc  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, svc);

  // Allow overriding the date via body for backfilling past days
  let targetDate = new Date();
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.date) targetDate = new Date(body.date);
  } catch { /* no body */ }

  const rng = seededRng(dateSeed(targetDate));
  const dateStr = targetDate.toISOString().slice(0, 10);

  // ── Resolve CIG customer + wallets ───────────────────────────────────────
  const { data: customer } = await admin
    .from("customers")
    .select("id, fee_bps, corridor_bps")
    .eq("company_name", "Caribbean Import Group S.A.")
    .maybeSingle();
  if (!customer) return json({ error: "CIG customer not found" }, 404);

  const { data: wallets } = await admin
    .from("wallets")
    .select("id, stellar_address, label")
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: true });
  if (!wallets?.length) return json({ error: "No wallets found for CIG" }, 404);

  const { data: recipients } = await admin
    .from("saved_recipients")
    .select("id, name, stellar_address")
    .eq("customer_id", customer.id);

  const feeBps = (customer.fee_bps ?? 130) + (customer.corridor_bps ?? 70); // 200 = 2%
  const RATE = 130 + rng() * 2 - 1; // 129–131 HTG/USDC daily variation

  const inserted: string[] = [];
  const skipped: string[] = [];

  // Helper: insert order if reference doesn't already exist
  async function insertOrder(row: Record<string, unknown>) {
    const { data: existing } = await admin
      .from("orders")
      .select("id")
      .eq("reference_number", row.reference_number)
      .maybeSingle();
    if (existing) { skipped.push(row.reference_number as string); return; }
    const { error } = await admin.from("orders").insert(row);
    if (error) throw new Error(`order insert failed: ${error.message}`);
    inserted.push(row.reference_number as string);
  }

  async function insertPayout(row: Record<string, unknown>) {
    const { data: existing } = await admin
      .from("payouts")
      .select("id")
      .eq("memo", row.memo)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (existing) { skipped.push(`payout:${row.memo}`); return; }
    const { error } = await admin.from("payouts").insert(row);
    if (error) throw new Error(`payout insert failed: ${error.message}`);
    inserted.push(`payout:${row.memo}`);
  }

  // ── 1. usdc_conversion orders (2–3 per day) ──────────────────────────────
  const convCount = rng() > 0.4 ? 3 : 2;
  const convAmounts = [5000, 10000, 20000, 25000, 50000];
  for (let i = 0; i < convCount; i++) {
    const usdcGross = pick(convAmounts, rng) * (0.9 + rng() * 0.2);
    const feeUsdc   = usdcGross * (feeBps / 10000);
    const usdcNet   = usdcGross - feeUsdc;
    const htgAmount = Math.round(usdcGross * RATE);
    const wallet    = pick(wallets, rng);
    const ref       = refId("THEO-CNV", rng);
    // Spread timestamps across the day
    const hour = 8 + Math.floor(rng() * 12);
    const min  = Math.floor(rng() * 60);
    const ts   = `${dateStr}T${String(hour).padStart(2,"0")}:${String(min).padStart(2,"0")}:00Z`;

    await insertOrder({
      customer_id:    customer.id,
      wallet_id:      wallet.id,
      order_kind:     "usdc_conversion",
      status:         "COMPLETED",
      usdc_amount:    Math.round(usdcNet   * 1e7) / 1e7,
      htg_amount:     htgAmount,
      usdc_gross:     Math.round(usdcGross * 1e7) / 1e7,
      fee_usdc:       Math.round(feeUsdc   * 1e7) / 1e7,
      fee_bps:        feeBps,
      rate:           Math.round(RATE * 1e4) / 1e4,
      reference_number: ref,
      stellar_tx_hash:  null,
      completed_at:   ts,
      created_at:     ts,
    });
  }

  // ── 2. htgc_usdc_swap order (1 per day) ──────────────────────────────────
  {
    const usdcGross = pick([10000, 15000, 20000], rng) * (0.9 + rng() * 0.2);
    const feeUsdc   = usdcGross * (feeBps / 10000);
    const usdcNet   = usdcGross - feeUsdc;
    const htgAmount = Math.round(usdcGross * RATE);
    const wallet    = pick(wallets, rng);
    const ref       = refId("SWP", rng);
    const hour = 14 + Math.floor(rng() * 5);
    const min  = Math.floor(rng() * 60);
    const ts   = `${dateStr}T${String(hour).padStart(2,"0")}:${String(min).padStart(2,"0")}:00Z`;

    await insertOrder({
      customer_id:    customer.id,
      wallet_id:      wallet.id,
      order_kind:     "htgc_usdc_swap",
      status:         "COMPLETED",
      swap_direction: "htgc_to_usdc",
      usdc_amount:    Math.round(usdcNet   * 1e7) / 1e7,
      htg_amount:     htgAmount,
      usdc_gross:     Math.round(usdcGross * 1e7) / 1e7,
      fee_usdc:       Math.round(feeUsdc   * 1e7) / 1e7,
      fee_bps:        feeBps,
      rate:           Math.round(RATE * 1e4) / 1e4,
      reference_number: ref,
      stellar_tx_hash:  null,
      destination_stellar_address: wallet.stellar_address,
      completed_at:   ts,
      created_at:     ts,
    });
  }

  // ── 3. Payout (1 per day, only if recipients exist) ──────────────────────
  if (recipients?.length) {
    const recipient = pick(recipients, rng);
    const amount    = pick([5000, 10000, 15000], rng) * (0.9 + rng() * 0.2);
    const wallet    = pick(wallets, rng);
    const memos     = ["Supplier Payment", "April Payment", "Invoice Settlement", "Monthly Transfer", "Trade Finance"];
    const memo      = `${pick(memos, rng)} — ${dateStr}`;
    const hour = 16 + Math.floor(rng() * 3);
    const ts   = `${dateStr}T${String(hour).padStart(2,"0")}:00:00Z`;

    await insertPayout({
      customer_id:       customer.id,
      source_wallet_id:  wallet.id,
      recipient_name:    recipient.name,
      recipient_address: recipient.stellar_address,
      amount_usdc:       Math.round(amount * 1e7) / 1e7,
      status:            "COMPLETED",
      memo,
      stellar_tx_hash:   null,
      created_at:        ts,
    });
  }

  return json({
    ok: true,
    date: dateStr,
    inserted: inserted.length,
    skipped: skipped.length,
    records: { inserted, skipped },
  });
});
