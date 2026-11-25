import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  getGasStatusInfo,
  isDeviceOnline,
  type ControlMode,
  type DeviceState,
} from "@/lib/types";

interface TelegramUpdate {
  message?: {
    chat?: {
      id: number | string;
    };
    text?: string;
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

  const reply = [
    "<b>🗑️ Status EcoGenZ Smart Trash</b>",
    "",
    `• <b>Koneksi:</b> ${online ? "🟢 Online" : "⚫ Offline"}`,
    `• <b>Mode Kontrol:</b> <code>${state.control_mode}</code>`,
    `• <b>Status Tutup:</b> ${state.lid_status}`,
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
  const text = update.message?.text;

  if (!chatId || !text) {
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
        "<b>🤖 EcoGenZ Smart Trash Bot</b>",
        "",
        "Perintah yang tersedia:",
        "• /status — Cek kondisi terkini tong sampah",
        "• /buka — Buka tutup tong secara paksa",
        "• /tutup — Tutup tong secara paksa",
        "• /auto — Kembali ke mode sensor otomatis",
      ].join("\n"),
      chatId
    );
  }

  return NextResponse.json({ ok: true });
}
