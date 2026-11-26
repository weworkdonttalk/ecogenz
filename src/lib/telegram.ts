import type { WasteSortOutcome } from "@/lib/types";

export interface SendTelegramResult {
  ok: boolean;
  error?: string;
}

/**
 * Escapes HTML special characters for Telegram HTML parse_mode.
 */
export function escapeTelegramHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Formats an HTML notification summarizing Gemini Vision waste sorting output.
 */
export function formatClassificationTelegramMessage(
  result: WasteSortOutcome,
  sourceLabel: string
): string {
  const isOrganic = result.category === "ORGANIK";
  const badge = isOrganic ? "🌿 ORGANIK" : "♻️ ANORGANIK";
  const servoAngle = isOrganic ? "20° (Kiri)" : "160° (Kanan)";

  return [
    `<b>🤖 Hasil Klasifikasi EcoGenZ (${escapeTelegramHtml(sourceLabel)})</b>`,
    "",
    `• <b>Benda:</b> ${escapeTelegramHtml(result.item)}`,
    `• <b>Kategori:</b> <b>${badge}</b>`,
    `• <b>Keyakinan:</b> ${result.confidence}%`,
    `• <b>Alasan:</b> ${escapeTelegramHtml(result.reason)}`,
    `• <b>Aksi Servo:</b> Perintah <code>${result.category}</code> dikirim → gerak ke ${servoAngle}`,
    "",
    `📊 Total: 🌿 Organik <b>${result.organik_count}</b> | ♻️ Anorganik <b>${result.anorganik_count}</b>`,
  ].join("\n");
}

/**
 * Sends an HTML-formatted message to a Telegram chat via the Bot API.
 */
export async function sendTelegramMessage(
  text: string,
  chatId?: string | number
): Promise<SendTelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const targetChatId = chatId ?? process.env.TELEGRAM_CHAT_ID;

  if (!token || !targetChatId) {
    const message =
      "Missing TELEGRAM_BOT_TOKEN or target chat ID (TELEGRAM_CHAT_ID).";
    console.error(`[telegram] ${message}`);
    return { ok: false, error: message };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: targetChatId,
          text,
          parse_mode: "HTML",
        }),
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const details = await response.text();
      console.error(
        `[telegram] API responded ${response.status}: ${details}`
      );
      return { ok: false, error: `Telegram API error ${response.status}` };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[telegram] Failed to send message: ${message}`);
    return { ok: false, error: message };
  }
}
