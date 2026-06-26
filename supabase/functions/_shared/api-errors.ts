// Shared {error, code} envelope for public Theo API responses.
// Keep `error` human-readable (rendered verbatim in the Odoo wizard);
// `code` is the machine-readable enum the plugin branches on.

import { corsHeaders } from "./cors.ts";

export type ApiErrorCode =
  | "invalid_request"
  | "invalid_settlement"
  | "unauthorized"
  | "kyb_required"
  | "forbidden"
  | "not_found"
  | "quote_already_used"
  | "quote_expired"
  | "internal_error"
  | "on_chain_failed"
  | "destination_not_configured"
  | "rate_unavailable";

export function apiErrorResponse(
  req: Request,
  message: string,
  code: ApiErrorCode | string,
  status: number,
): Response {
  const headers = corsHeaders(req, { wildcard: true });
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** Map an auth helper result (with `.status`) to a sensible code. */
export function authErrorCode(status: number, error: string): ApiErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) {
    if (/kyb/i.test(error)) return "kyb_required";
    return "forbidden";
  }
  return "internal_error";
}
