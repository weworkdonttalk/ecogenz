import { NextRequest, NextResponse } from "next/server";
import { classifyAndTriggerSort } from "@/lib/classifyWaste";
import { supabase } from "@/lib/supabase";
import {
  escapeTelegramHtml,
  formatClassificationTelegramMessage,
  sendTelegramMessage,
} from "@/lib/telegram";
import {
  getGasStatusInfo,
  isDeviceOnline,
  type ControlMode,
  type DeviceState,
} from "@/lib/types";

interface TelegramPhotoSize {
  file_id: string;
  width?: number;
  height?: number;
  file_size?: number;
}

interface TelegramUpdate {
  message?: {
    chat?: {
      id: number | string;
    };
    text?: string;
    photo?: TelegramPhotoSize[];
  };
}

interface TelegramGetFileResponse {
  ok: boolean;
  result?: {
    file_path?: string;
  };
}

const MODE_COMMANDS: Record<
  string,
  { mode: ControlMode; label: string; emoji: string }
> = {
  "/buka": {
    mode: "FORCE_OPEN",
    label: "Buka Paksa (FORCE_OPEN)",
    emoji: "🟢",
  },
  "/tutup": {
    mode: "FORCE_CLOSE",
    label: "Tutup Paksa (FORCE_CLOSE)",
    emoji: "🔴",
  },
  "/auto": {
    mode: "AUTO",
    label: "Otomatis (AUTO)",
    emoji: "🤖",
  },
};

function inferImageMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function pickLargestPhoto(photos: TelegramPhotoSize[]): TelegramPhotoSize {
  return photos.reduce((largest, current) => {
    const largestScore =
      largest.file_size ?? (largest.width ?? 0) * (largest.height ?? 0);
    const currentScore =
      current.file_size ?? (current.width ?? 0) * (current.height ?? 0);
    return currentScore >= largestScore ? current : largest;
  }, photos[0]);
}

async function handlePhotoMessage(
  photos: TelegramPhotoSize[],
  chatId: number | string
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[telegram/webhook] Missing TELEGRAM_BOT_TOKEN");
    return;
  }

  try {
    const largestPhoto = pickLargestPhoto(photos);
    const fileInfoRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(
        largestPhoto.file_id
      )}`,
      { cache: "no-store" }
    );

    if (!fileInfoRes.ok) {
      throw new Error(`getFile failed with status ${fileInfoRes.status}`);
    }

    const fileInfo = (await fileInfoRes.json()) as TelegramGetFileResponse;
    const filePath = fileInfo.result?.file_path;
    if (!fileInfo.ok || !filePath) {
      throw new Error("Telegram getFile did not return a file_path");
    }

    const downloadRes = await fetch(
      `https://api.telegram.org/file/bot${token}/${filePath}`,
      { cache: "no-store" }
    );

    if (!downloadRes.ok) {
      throw new Error(`File download failed with status ${downloadRes.status}`);
    }

    const arrayBuffer = await downloadRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = inferImageMimeType(filePath);

    const outcome = await classifyAndTriggerSort(base64, mimeType);
    const reply = formatClassificationTelegramMessage(outcome, "Foto Telegram");
    await sendTelegramMessage(reply, chatId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[telegram/webhook] Photo classification error:", message);
    await sendTelegramMessage(
      "❌ Gagal memproses foto sampah dengan Gemini Vision. Coba kirim ulang foto yang lebih jelas.",
      chatId
    );
  }
}

async function handleStatusCommand(chatId: number | string) {
  const { data: state, error } = await supabase
    .from("device_state")
    .select("*")
    .eq("id", 1)
    .maybeSingle<DeviceState>();

  if (error || !state) {
    await sendTelegramMessage(
      "⚠️ Data perangkat EcoGenZ Smart Trash belum tersedia.",
      chatId
    );
    return;
  }

  const online = isDeviceOnline(state.updated_at);
  const gasInfo = getGasStatusInfo(state.gas_level);
  const trayStatus = state.trash_detected
    ? "📦 Sampah Terdeteksi — Siap Difoto"
    : "✨ Nampan Kosong";
  const lastItemText = state.last_item
    ? `${escapeTelegramHtml(state.last_item)} (${state.last_category ?? "-"})`
    : "-";

  const reply = [
    "<b>🗑️ Status EcoGenZ Smart Trash</b>",
    "",
    `• <b>Koneksi:</b> ${online ? "🟢 Online" : "⚫ Offline"}`,
    `• <b>Status Nampan:</b> ${trayStatus}`,
    `• <b>Item Terakhir:</b> ${lastItemText}`,
    `• <b>Counter Pemilahan:</b> 🌿 Organik <b>${state.organik_count ?? 0}</b> | ♻️ Anorganik <b>${state.anorganik_count ?? 0}</b>`,
    `• <b>Mode Kontrol:</b> <code>${state.control_mode}</code>`,
    `• <b>Status Tutup:</b> ${escapeTelegramHtml(state.lid_status)}`,
    `• <b>Gas MQ-2:</b> ${state.gas_level} (${gasInfo.category})`,
    `• <b>Suhu:</b> ${Number(state.temperature).toFixed(1)} °C`,
    `• <b>Kelembapan:</b> ${Number(state.humidity).toFixed(1)} %`,
    `• <b>Jarak Sensor:</b> ${Number(state.distance_cm).toFixed(1)} cm`,
    `• <b>Total Dibuka:</b> ${state.open_count}x`,
  ].join("\n");

  await sendTelegramMessage(reply, chatId);
}

async function handleModeCommand(
  command: string,
  chatId: number | string
): Promise<boolean> {
  const config = MODE_COMMANDS[command];
  if (!config) return false;

  const { error } = await supabase
    .from("device_state")
    .update({ control_mode: config.mode })
    .eq("id", 1);

  if (error) {
    console.error("[telegram/webhook] Failed updating mode:", error.message);
    await sendTelegramMessage(
      "❌ Gagal mengubah mode kontrol. Coba lagi sebentar.",
      chatId
    );
    return true;
  }

  await sendTelegramMessage(
    `${config.emoji} Mode kontrol diubah ke <b>${config.label}</b>.`,
    chatId
  );
  return true;
}

export async function POST(request: NextRequest) {
  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const chatId = update.message?.chat?.id;
  if (!chatId) {
    return NextResponse.json({ ok: true });
  }

  const photos = update.message?.photo;
  if (Array.isArray(photos) && photos.length > 0) {
    await handlePhotoMessage(photos, chatId);
    return NextResponse.json({ ok: true });
  }

  const text = update.message?.text;
  if (!text) {
    return NextResponse.json({ ok: true });
  }

  const command = text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();

  if (command === "/status") {
    await handleStatusCommand(chatId);
  } else if (await handleModeCommand(command, chatId)) {
    // Handled mode command
  } else if (command === "/start" || command === "/help") {
    await sendTelegramMessage(
      [
        "<b>🤖 EcoGenZ Smart Waste Sorter Bot</b>",
        "",
        "Perintah yang tersedia:",
        "• Kirim <b>Foto Sampah</b> — Deteksi Gemini AI & pilah servo otomatis",
        "• /status — Cek kondisi terkini tong, nampan & counter",
        "• /buka — Buka tutup tong secara paksa",
        "• /tutup — Tutup tong secara paksa",
        "• /auto — Kembali ke mode sensor otomatis",
      ].join("\n"),
      chatId
    );
  }

  return NextResponse.json({ ok: true });
}
