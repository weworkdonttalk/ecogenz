import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  GAS_DANGER_THRESHOLD,
  type ControlMode,
  type DeviceState,
} from "@/lib/types";

const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const LOG_INTERVAL_MS = 60 * 1000;

interface SyncPayload {
  temperature: number;
  humidity: number;
  gas_level: number;
  distance_cm: number;
  lid_status: string;
  opened_now: boolean;
}

function parseSyncPayload(body: unknown): SyncPayload | null {
  if (!body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;

  const temperature = Number(data.temperature);
  const humidity = Number(data.humidity);
  const gasLevel = Number(data.gas_level);
  const distanceCm = Number(data.distance_cm);
  const lidStatus =
    typeof data.lid_status === "string" ? data.lid_status.trim() : "";
  const openedNow = Boolean(data.opened_now);

  if (
    !Number.isFinite(temperature) ||
    !Number.isFinite(humidity) ||
    !Number.isFinite(gasLevel) ||
    !Number.isFinite(distanceCm) ||
    !lidStatus
  ) {
    return null;
  }

  return {
    temperature,
    humidity,
    gas_level: gasLevel,
    distance_cm: distanceCm,
    lid_status: lidStatus,
    opened_now: openedNow,
  };
}

export async function POST(request: NextRequest) {
  const expectedApiKey = process.env.IOT_API_KEY;
  const providedApiKey = request.headers.get("x-api-key");

  if (!expectedApiKey || providedApiKey !== expectedApiKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = parseSyncPayload(rawBody);
  if (!payload) {
    return NextResponse.json(
      {
        error:
          "Invalid payload. Expected temperature, humidity, gas_level, distance_cm, lid_status, and opened_now.",
      },
      { status: 400 }
    );
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const { data: currentState, error: fetchError } = await supabase
    .from("device_state")
    .select("*")
    .eq("id", 1)
    .maybeSingle<DeviceState>();

  if (fetchError) {
    console.error("[iot/sync] Failed to read device_state:", fetchError.message);
    return NextResponse.json(
      { error: "Failed to read device state" },
      { status: 500 }
    );
  }

  const currentOpenCount = currentState?.open_count ?? 0;
  const nextOpenCount = currentOpenCount + (payload.opened_now ? 1 : 0);
  const controlMode: ControlMode = currentState?.control_mode ?? "AUTO";

  const lastAlertMs = currentState?.last_alert_at
    ? new Date(currentState.last_alert_at).getTime()
    : 0;
  const isAlertCooldownOver =
    !Number.isFinite(lastAlertMs) || nowMs - lastAlertMs > ALERT_COOLDOWN_MS;

  let nextLastAlertAt: string | null = currentState?.last_alert_at ?? null;
  if (payload.gas_level >= GAS_DANGER_THRESHOLD && isAlertCooldownOver) {
    const alertText = [
      "<b>🚨 PERINGATAN GAS ECOGENZ TRASH</b>",
      "",
      `• <b>Level Gas MQ-2:</b> ${payload.gas_level} (Bahaya)`,
      `• <b>Suhu:</b> ${payload.temperature.toFixed(1)} °C`,
      `• <b>Kelembapan:</b> ${payload.humidity.toFixed(1)} %`,
      `• <b>Status Tutup:</b> ${payload.lid_status}`,
      "",
      "Segera periksa dan kosongkan tempat sampah!",
    ].join("\n");

    const tgResult = await sendTelegramMessage(alertText);
    if (tgResult.ok) {
      nextLastAlertAt = nowIso;
    }
  }

  const updateData = {
    id: 1,
    temperature: payload.temperature,
    humidity: payload.humidity,
    gas_level: payload.gas_level,
    distance_cm: payload.distance_cm,
    lid_status: payload.lid_status,
    control_mode: controlMode,
    open_count: nextOpenCount,
    last_alert_at: nextLastAlertAt,
    updated_at: nowIso,
  };

  const { error: upsertError } = await supabase
    .from("device_state")
    .upsert(updateData, { onConflict: "id" });

  if (upsertError) {
    console.error(
      "[iot/sync] Failed to update device_state:",
      upsertError.message
    );
    return NextResponse.json(
      { error: "Failed to update device state" },
      { status: 500 }
    );
  }

  const { data: latestLog, error: logFetchError } = await supabase
    .from("sensor_logs")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();

  if (logFetchError) {
    console.error(
      "[iot/sync] Failed to query latest sensor_log:",
      logFetchError.message
    );
  } else {
    const lastLogMs = latestLog?.created_at
      ? new Date(latestLog.created_at).getTime()
      : 0;
    const shouldInsertLog =
      !latestLog ||
      !Number.isFinite(lastLogMs) ||
      nowMs - lastLogMs >= LOG_INTERVAL_MS;

    if (shouldInsertLog) {
      const { error: insertLogError } = await supabase
        .from("sensor_logs")
        .insert({
          temperature: payload.temperature,
          humidity: payload.humidity,
          gas_level: payload.gas_level,
        });

      if (insertLogError) {
        console.error(
          "[iot/sync] Failed to insert sensor_log:",
          insertLogError.message
        );
      }
    }
  }

  return NextResponse.json({ ok: true, mode: controlMode });
}
