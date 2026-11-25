import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isControlMode } from "@/lib/types";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).mode
      : undefined;

  if (!isControlMode(mode)) {
    return NextResponse.json(
      {
        error:
          "Invalid mode. Allowed values: 'AUTO', 'FORCE_OPEN', 'FORCE_CLOSE'.",
      },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("device_state")
    .update({ control_mode: mode })
    .eq("id", 1);

  if (error) {
    console.error("[control] Failed to update control_mode:", error.message);
    return NextResponse.json(
      { error: "Failed to update control mode" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, mode });
}
