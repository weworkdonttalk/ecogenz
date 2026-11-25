export interface SendTelegramResult {
  ok: boolean;
  error?: string;
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
