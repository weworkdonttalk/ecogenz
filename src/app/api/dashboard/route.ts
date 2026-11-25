import { NextResponse, connection } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  isDeviceOnline,
  type DashboardResponse,
  type DeviceState,
  type SensorLog,
} from "@/lib/types";

export async function GET() {
  // Opt into per-request dynamic execution under Next.js Cache Components.
  await connection();

  const [stateResult, logsResult] = await Promise.all([
    supabase
      .from("device_state")
      .select("*")
      .eq("id", 1)
      .maybeSingle<DeviceState>(),
    supabase
      .from("sensor_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<SensorLog[]>(),
  ]);

  if (stateResult.error) {
    console.error(
      "[dashboard] Failed to read device_state:",
      stateResult.error.message
    );
    return NextResponse.json(
      { error: "Failed to fetch device state" },
      { status: 500 }
    );
  }

  if (logsResult.error) {
    console.error(
      "[dashboard] Failed to read sensor_logs:",
      logsResult.error.message
    );
    return NextResponse.json(
      { error: "Failed to fetch sensor logs" },
      { status: 500 }
    );
  }

  const state = stateResult.data;
  const logs = [...(logsResult.data ?? [])].reverse();

  const payload: DashboardResponse = {
    state: state
      ? {
          ...state,
          is_online: isDeviceOnline(state.updated_at),
        }
      : null,
    logs,
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
