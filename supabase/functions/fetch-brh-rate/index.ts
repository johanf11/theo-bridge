// fetch-brh-rate
// Scrapes the Bank of the Republic of Haiti "taux du jour" page and stores
// the official reference rate (TAUX DE RÉFÉRENCE) in rate_snapshots.
//
// BRH page structure (as of 2026):
//   MARCHE INFORMEL  → buy 131.0000 / sell 136.0000
//   MARCHE BANCAIRE  → buy 130.1105 / sell 131.0027
//   TAUX DE REFERENCE → 130.4663   ← we use this
//
// GET/POST — no body required.
// Returns: { rate, banking_sell, informal_sell, source, captured_at, fresh }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const BRH_URL = "https://www.brh.ht/taux-du-jour/";
const RATE_MIN = 100;
const RATE_MAX = 250;

/** Pull all HTG/USD-range decimal numbers from a text region. */
function extractNumbers(text: string): number[] {
  return [...text.matchAll(/\b(\d{2,3}[.,]\d{2,6})\b/g)]
    .map((m) => parseFloat(m[1].replace(",", ".")))
    .filter((n) => n >= RATE_MIN && n <= RATE_MAX);
}

interface BrhRates {
  reference: number | null;
  bankingSell: number | null;
  informalSell: number | null;
}

function parseRates(html: string): BrhRates {
  const lower = html.toLowerCase();
  const result: BrhRates = { reference: null, bankingSell: null, informalSell: null };

  // ── TAUX DE RÉFÉRENCE ──────────────────────────────────────────────────────
  // Look for the reference rate — it's a single number after the label.
  const refIdx = lower.search(/taux de r[eé]f[eé]rence/);
  if (refIdx !== -1) {
    const region = html.slice(refIdx, refIdx + 300);
    const nums = extractNumbers(region);
    if (nums.length > 0) result.reference = nums[0];
  }

  // ── MARCHÉ BANCAIRE ────────────────────────────────────────────────────────
  // Row has: buy (achat) then sell (vente). Sell is the second number.
  const bancIdx = lower.search(/march[eé] bancaire|marche bancaire/);
  if (bancIdx !== -1) {
    const region = html.slice(bancIdx, bancIdx + 500);
    const nums = extractNumbers(region);
    if (nums.length >= 2) result.bankingSell = nums[1]; // [0]=buy [1]=sell
    else if (nums.length === 1) result.bankingSell = nums[0];
  }

  // ── MARCHÉ INFORMEL ────────────────────────────────────────────────────────
  const infIdx = lower.search(/march[eé] informel|marche informel/);
  if (infIdx !== -1) {
    const region = html.slice(infIdx, infIdx + 500);
    const nums = extractNumbers(region);
    if (nums.length >= 2) result.informalSell = nums[1];
    else if (nums.length === 1) result.informalSell = nums[0];
  }

  // ── Fallback: any reasonable number on the page ────────────────────────────
  if (!result.reference && !result.bankingSell) {
    const all = extractNumbers(html);
    if (all.length > 0) result.reference = all[0];
  }

  return result;
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // ── AuthN: require an authenticated user to trigger a BRH refresh ───
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401, headers: { ...headers, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401, headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    // 1. Return today's cached BRH rate if already fetched
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: cached } = await admin
      .from("rate_snapshots")
      .select("spot_rate, captured_at")
      .eq("source", "brh")
      .gte("captured_at", todayStart.toISOString())
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached) {
      return new Response(
        JSON.stringify({ rate: Number(cached.spot_rate), source: "brh", captured_at: cached.captured_at, fresh: false }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    // 2. Scrape BRH
    const res = await fetch(BRH_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TheoBridge/1.0; +https://theo.ht)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) throw new Error(`BRH returned HTTP ${res.status}`);

    const html = await res.text();
    const rates = parseRates(html);

    console.log("BRH parsed rates:", JSON.stringify(rates));

    // Use reference rate as spot; fall back to banking sell
    const spot = rates.reference ?? rates.bankingSell;

    if (!spot) {
      // BRH parse failed — return latest cached rate
      const { data: fallback } = await admin
        .from("rate_snapshots")
        .select("spot_rate, captured_at, source")
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      console.warn("BRH parse failed — using cached fallback");
      return new Response(
        JSON.stringify({
          rate: Number(fallback?.spot_rate ?? 130),
          source: "cache",
          captured_at: fallback?.captured_at,
          fresh: false,
          warning: "BRH parse failed — using cached rate",
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    // 3. Store in rate_snapshots
    const { data: snap } = await admin
      .from("rate_snapshots")
      .insert({ spot_rate: spot, source: "brh" })
      .select("captured_at")
      .single();

    console.log(`BRH rate stored: ${spot} HTG/USD (banking_sell=${rates.bankingSell}, informal_sell=${rates.informalSell})`);

    return new Response(
      JSON.stringify({
        rate: spot,
        banking_sell: rates.bankingSell,
        informal_sell: rates.informalSell,
        source: "brh",
        captured_at: snap?.captured_at ?? new Date().toISOString(),
        fresh: true,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("fetch-brh-rate error:", err);
    const { data: fallback } = await admin
      .from("rate_snapshots")
      .select("spot_rate, captured_at")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        rate: Number(fallback?.spot_rate ?? 130),
        source: "cache",
        captured_at: fallback?.captured_at,
        fresh: false,
        error: (err as Error).message,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  }
});
