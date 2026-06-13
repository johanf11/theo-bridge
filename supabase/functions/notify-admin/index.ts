import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmacSignHex } from "../_shared/hmac.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sendTelegram(method: string, body: object) {
  return fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  // Authenticate every incoming request. Telegram is configured (via
  // setWebhook ?secret_token=) to send X-Telegram-Bot-Api-Secret-Token,
  // and the Postgres database webhook is configured to send the same
  // header. Anything else is an unauthenticated forgery attempt.
  const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  const incoming = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!WEBHOOK_SECRET || incoming !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();

  // Telegram sends button tap callbacks here
  if (body.callback_query) {
    const { id, data, message } = body.callback_query;

    // ── Confirm path ───────────────────────────────────────────────────────
    if (data.startsWith("confirm:")) {
      const orderId = data.replace("confirm:", "");

      // Bind this service-role call to the specific orderId via HMAC so a leaked
      // Telegram webhook secret alone can't drive simulate-spih-payment against
      // arbitrary orders. Fail closed if the HMAC secret is not configured.
      const hmacSecret = Deno.env.get("SPIH_CONFIRM_HMAC_SECRET");
      if (!hmacSecret) {
        await sendTelegram("answerCallbackQuery", {
          callback_query_id: id,
          text: "❌ Misconfigured: missing HMAC secret",
          show_alert: true,
        });
        return new Response("ok");
      }
      const signature = await hmacSignHex(hmacSecret, orderId);

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/simulate-spih-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "X-Order-Signature": signature,
        },
        body: JSON.stringify({ order_id: orderId }),
      });

      const result = await resp.json().catch(() => ({}));
      const success = resp.ok && result.error == null && result.ok !== false;

      await sendTelegram("answerCallbackQuery", {
        callback_query_id: id,
        text: success
          ? "✅ Payment confirmed — releasing USDC"
          : `❌ Failed: ${result.error ?? "unknown error"}`,
      });

      // Edit the original message to remove the buttons and show outcome
      if (message?.message_id && message?.chat?.id) {
        const statusLine = success
          ? "✅ *Confirmed* — USDC released"
          : `❌ *Error* — ${result.error ?? "unknown error"}`;
        await sendTelegram("editMessageReplyMarkup", {
          chat_id: message.chat.id,
          message_id: message.message_id,
          reply_markup: { inline_keyboard: [] },
        });
        await sendTelegram("sendMessage", {
          chat_id: message.chat.id,
          parse_mode: "Markdown",
          text: statusLine,
          reply_to_message_id: message.message_id,
        });
      }

      return new Response("ok");
    }

    // ── Reject path ────────────────────────────────────────────────────────
    if (data.startsWith("reject:")) {
      const orderId = data.replace("reject:", "");

      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

      // Only reject if still in QUOTED (idempotent — already confirmed orders can't be undone)
      const { data: updated, error: upErr } = await admin
        .from("orders")
        .update({
          status: "FAILED",
          failure_reason: "Rejected by admin — order denied before payment release",
        })
        .eq("id", orderId)
        .eq("status", "QUOTED")
        .select("reference_number")
        .maybeSingle();

      const success = !upErr && updated != null;

      await sendTelegram("answerCallbackQuery", {
        callback_query_id: id,
        text: success
          ? "🚫 Order rejected — no USDC will be released"
          : upErr
          ? `❌ DB error: ${upErr.message}`
          : "⚠️ Order is no longer in QUOTED state — cannot reject",
        show_alert: true,
      });

      // Edit the original message buttons away and post a rejection note
      if (message?.message_id && message?.chat?.id) {
        await sendTelegram("editMessageReplyMarkup", {
          chat_id: message.chat.id,
          message_id: message.message_id,
          reply_markup: { inline_keyboard: [] },
        });
        await sendTelegram("sendMessage", {
          chat_id: message.chat.id,
          parse_mode: "Markdown",
          text: success
            ? `🚫 *Rejected* — Order \`${updated?.reference_number ?? orderId}\` has been denied. No funds released.`
            : `⚠️ Could not reject — order may have already been processed.`,
          reply_to_message_id: message.message_id,
        });
      }

      return new Response("ok");
    }

    // Unknown callback — acknowledge and ignore
    await sendTelegram("answerCallbackQuery", { callback_query_id: id });
    return new Response("ok");
  }

  // Supabase database webhook sends new order inserts here
  if (body.record) {
    const order = body.record;
    if (order.status !== "QUOTED") return new Response("ignored");

    const htg = Number(order.htg_amount).toLocaleString("en-US", { maximumFractionDigits: 0 });
    const usdc = Number(order.usdc_amount).toFixed(2);

    await sendTelegram("sendMessage", {
      chat_id: TELEGRAM_CHAT_ID,
      parse_mode: "Markdown",
      text: `💳 *New Order — Awaiting Payment*\n\n` +
        `Reference: \`${order.reference_number}\`\n` +
        `HTG Deposit: *${htg} HTG*\n` +
        `USDC to Release: *$${usdc} USDC*\n\n` +
        `Tap below once you see the HTG bank deposit.`,
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Confirm Payment Received", callback_data: `confirm:${order.id}` },
          { text: "🚫 Reject Order", callback_data: `reject:${order.id}` },
        ]],
      },
    });

    return new Response("ok");
  }

  return new Response("ok");
});
