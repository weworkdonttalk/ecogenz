import { NextRequest, NextResponse } from "next/server";
import { classifyAndTriggerSort } from "@/lib/classifyWaste";
import {
  formatClassificationTelegramMessage,
  sendTelegramMessage,
} from "@/lib/telegram";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data =
    body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  const imageBase64 =
    typeof data.imageBase64 === "string" ? data.imageBase64.trim() : "";
  const mimeType =
    typeof data.mimeType === "string" && data.mimeType.trim()
      ? data.mimeType.trim()
      : "image/jpeg";

  if (!imageBase64) {
    return NextResponse.json(
      { error: "imageBase64 is required." },
      { status: 400 }
    );
  }

  try {
    const result = await classifyAndTriggerSort(imageBase64, mimeType);

    const telegramText = formatClassificationTelegramMessage(
      result,
      "Kamera Web"
    );
    await sendTelegramMessage(telegramText);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Classification failed";
    console.error("[api/classify] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
