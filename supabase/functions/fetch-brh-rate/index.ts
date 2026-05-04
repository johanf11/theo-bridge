// fetch-brh-rate
// Scrapes the Bank of the Republic of Haiti daily rate page and stores
// the USD/HTG mid-market rate in rate_snapshots.
//
// GET/POST — no body required.
// Returns: { rate, source, captured_at, fresh }
//   fresh=true  → just scraped from BRH
//   fresh=false → returned from today's cached snapshot

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const BRH_URL = "https://www.brh.ht/taux-du-jour/";
const RATE_MIN = 80;   // sanity bounds for HTG/USD
const RATE_MAX = 300;

/** Extract the USD mid-market rate from BRH's HTML. */
function parseRate(html: string): number | null {
  // BRH renders a WordPress table. Each row looks roughly like:
  // <tr> ... Dollar américain ... 134.50 ... 135.50 ... </tr>
  // We normalise the HTML and scan for the USD row, then grab
  // the last numeric value in that row (typically the sell/mid rate).

  const lower = html.toLowerCase();

  // Find the block that contains "dollar" and "usd"
  const dollarIdx = lower.indexOf("dollar am");
  if (dollarIdx === -1) {
    // Fallback: try generic "usd" marker
    const usdIdx = lower.indexOf(">usd<");
    if (usdIdx === -1) return null;
    return extractRatesFromRegion(html, usdIdx);
  }

  return extractRatesFromRegion(html, dollarIdx);
}

function extractRatesFromRegion(html: string, startIdx: number): number | null {
  // Take the next 600 chars and pull all decimal numbers
  const region = html.slice(startIdx, startIdx + 600);
  const matches = [...region.matchAll(/\b(\d{2,3}[.,]\d{2,4})\b/g)];

  const candidates = matches
    .map((m) => parseFloat(m[1].replace(",", ".")))
    .filter((n) => n >= RATE_MIN && n <= RATE_MAX);

  if (candidates.length === 0) return null;

  // BRH tables: achat (buy), vente (sell), moyen (mid) — we take the last
  // candidate which is typically the mid or sell rate.
  return candidates[candidates.length - 1];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // 1. Check if we already have a BRH rate captured today (avoid hammering BRH)
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
        JSON.stringify({
          rate: Number(cached.spot_rate),
          source: "brh",
          captured_at: cached.captured_at,
          fresh: false,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Scrape BRH
    const res = await fetch(BRH_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TheoBridge/1.0; +https://theo.ht)",
        "Accept": "text/html",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`BRH returned HTTP ${res.status}`);
    }

    const html = await res.text();
    const rate = parseRate(html);

    if (!rate) {
      // BRH unavailable — fall back to latest snapshot from any source
      const { data: fallback } = await admin
        .from("rate_snapshots")
        .select("spot_rate, captured_at, source")
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      console.warn("BRH parse failed — returning latest cached rate");
      return new Response(
        JSON.stringify({
          rate: Number(fallback?.spot_rate ?? 130),
          source: fallback?.source ?? "cache",
          captured_at: fallback?.captured_at ?? new Date().toISOString(),
          fresh: false,
          warning: "BRH parse failed, using cached rate",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3. Store in rate_snapshots
    const { data: snap } = await admin
      .from("rate_snapshots")
      .insert({ spot_rate: rate, source: "brh" })
      .select("captured_at")
      .single();

    console.log(`BRH rate fetched: ${rate} HTG/USD`);

    return new Response(
      JSON.stringify({
        rate,
        source: "brh",
        captured_at: snap?.captured_at ?? new Date().toISOString(),
        fresh: true,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("fetch-brh-rate error:", err);
    // Last-resort fallback — return latest stored rate
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
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
