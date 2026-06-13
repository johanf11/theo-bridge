const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const DEFAULTS = [
  "https://app.theokingdom.com",
  "http://localhost:8080",
  "http://localhost:4173",
];

function allowlist(): string[] {
  return ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULTS;
}

export function corsHeaders(req: Request, opts?: { wildcard?: boolean }): Record<string, string> {
  if (opts?.wildcard) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
  }

  const origin = req.headers.get("Origin") ?? "";
  const allowed = allowlist();
  const echo = allowed.includes(origin) ? origin : allowed[0];

  return {
    "Access-Control-Allow-Origin": echo,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}
