import { NextResponse } from "next/server";
import { classifyAndTriggerSort } from "@/lib/classifyWaste";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawImage: string = body.image || body.imageBase64 || "";
    if (!rawImage) {
      return NextResponse.json(
        { error: "Gambar tidak ditemukan" },
        { status: 400 }
      );
    }

    const match = rawImage.match(/^data:(image\/\w+);base64,(.+)$/);
    const mimeType = match ? match[1] : body.mimeType || "image/jpeg";
    const base64Data = match ? match[2] : rawImage;

    const result = await classifyAndTriggerSort(base64Data, mimeType);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Gagal memproses klasifikasi";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
