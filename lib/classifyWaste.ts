import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface ClassificationResult {
  category: "ORGANIK" | "ANORGANIK";
  item: string;
  confidence: number;
  reason: string;
}

async function getCandidateModels(apiKey: string): Promise<string[]> {
  const defaults = ["gemini-3.8-flash", "gemini-flash-latest"];

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (!res.ok) return defaults;

    const json = await res.json();
    const activeFlash: string[] = (json.models || [])
      .filter(
        (m: { name?: string; supportedGenerationMethods?: string[] }) =>
          m.name?.includes("flash") &&
          !m.name?.includes("embedding") &&
          !m.name?.includes("tts") &&
          !m.name?.includes("audio") &&
          !m.name?.includes("image") &&
          m.supportedGenerationMethods?.includes("generateContent")
      )
      .map((m: { name: string }) => m.name.replace(/^models\//, ""));

    return Array.from(
      new Set(["gemini-3.8-flash", ...activeFlash.reverse(), ...defaults])
    );
  } catch {
    return defaults;
  }
}

export async function classifyAndTriggerSort(
  imageBase64: string,
  mimeType: string = "image/jpeg"
): Promise<ClassificationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY belum diset");

  const prompt = `Kamu adalah AI pemilah sampah pintar EcoGenZ. Analisis gambar sampah ini dan tentukan apakah termasuk ORGANIK (sisa makanan, kulit buah, daun, tisu kotor/basah, tulang, ampas kopi) atau ANORGANIK (plastik, botol, kaleng, kertas bersih/kardus, kaca, styrofoam, logam, elektronik).
Jawab HANYA dalam format JSON valid dengan skema:
{
  "category": "ORGANIK" atau "ANORGANIK",
  "item": "nama singkat benda dalam Bahasa Indonesia (maks 3 kata)",
  "confidence": angka 0-100,
  "reason": "alasan singkat 1 kalimat"
}`;

  const models = await getCandidateModels(apiKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = null;
  let lastError = "";

  for (const model of models) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        }),
      }
    );

    if (response.ok) {
      data = await response.json();
      break;
    }

    lastError = `[${model}] ${await response.text()}`;
    if (response.status !== 404 && response.status !== 400) {
      throw new Error(`Gemini API Error: ${lastError}`);
    }
  }

  if (!data) {
    throw new Error(`Semua model Gemini gagal: ${lastError}`);
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const cleanedText = rawText.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleanedText);

  const category: "ORGANIK" | "ANORGANIK" =
    parsed.category?.toUpperCase() === "ORGANIK" ? "ORGANIK" : "ANORGANIK";
  const item = parsed.item || "Sampah Tidak Dikenal";
  const confidence = Number(parsed.confidence) || 85;
  const reason = parsed.reason || "-";

  // Ambil counter saat ini dari Supabase
  const { data: current } = await supabase
    .from("device_state")
    .select("organik_count, anorganik_count")
    .eq("id", 1)
    .single();

  const organikCount =
    (current?.organik_count || 0) + (category === "ORGANIK" ? 1 : 0);
  const anorganikCount =
    (current?.anorganik_count || 0) + (category === "ANORGANIK" ? 1 : 0);

  // Kirim perintah gerak servo ke Supabase
  await supabase
    .from("device_state")
    .update({
      sort_command: category,
      last_item: item,
      last_category: category,
      organik_count: organikCount,
      anorganik_count: anorganikCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  return { category, item, confidence, reason };
}
