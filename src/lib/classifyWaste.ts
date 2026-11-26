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
  organik_count: number;
  anorganik_count: number;
}

async function getFreeVisionModels(): Promise<string[]> {
  const fallback = [
    "google/gemma-3-27b-it:free",
    "qwen/qwen2.5-vl-72b-instruct:free",
    "meta-llama/llama-3.2-11b-vision-instruct:free",
  ];

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) return fallback;

    const json = await res.json();
    const freeVision: string[] = (json.data || [])
      .filter(
        (m: { id?: string; architecture?: { input_modalities?: string[] } }) =>
          m.id?.endsWith(":free") &&
          Array.isArray(m.architecture?.input_modalities) &&
          m.architecture.input_modalities.includes("image")
      )
      .map((m: { id: string }) => m.id);

    return freeVision.length > 0
      ? Array.from(new Set([...freeVision, ...fallback]))
      : fallback;
  } catch {
    return fallback;
  }
}

export async function classifyAndTriggerSort(
  imageBase64: string,
  mimeType: string = "image/jpeg"
): Promise<ClassificationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY belum diset di Environment Variables Vercel");
  }

  const match = imageBase64.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  const cleanMime = match ? match[1] : mimeType || "image/jpeg";
  const cleanBase64 = match ? match[2] : imageBase64;

  const prompt = `Kamu adalah AI pemilah sampah pintar EcoGenZ. Analisis gambar sampah ini dan tentukan apakah termasuk ORGANIK (sisa makanan, kulit buah, daun, tisu kotor/basah, tulang, ampas kopi) atau ANORGANIK (plastik, botol, kaleng, kertas bersih/kardus, kaca, styrofoam, logam, elektronik).
Balas HANYA dengan JSON valid tanpa teks tambahan:
{
  "category": "ORGANIK" atau "ANORGANIK",
  "item": "nama singkat benda dalam Bahasa Indonesia (maks 3 kata)",
  "confidence": angka 0-100,
  "reason": "alasan singkat 1 kalimat"
}`;

  const models = await getFreeVisionModels();
  let rawText = "";
  let lastError = "";

  for (const model of models.slice(0, 6)) {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://ecogenz.vercel.app",
          "X-Title": "EcoGenZ",
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${cleanMime};base64,${cleanBase64}`,
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    if (response.ok) {
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (content) {
        rawText = content;
        break;
      }
    }

    lastError = `[${model}] (${response.status}): ${await response.text()}`;
  }

  if (!rawText) {
    throw new Error(`OpenRouter Vision gagal: ${lastError}`);
  }

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");

  const category: "ORGANIK" | "ANORGANIK" =
    parsed.category?.toUpperCase() === "ORGANIK" ? "ORGANIK" : "ANORGANIK";
  const item = parsed.item || "Sampah Tidak Dikenal";
  const confidence = Number(parsed.confidence) || 85;
  const reason = parsed.reason || "-";

  const { data: current } = await supabase
    .from("device_state")
    .select("organik_count, anorganik_count")
    .eq("id", 1)
    .single();

  const organikCount =
    (current?.organik_count || 0) + (category === "ORGANIK" ? 1 : 0);
  const anorganikCount =
    (current?.anorganik_count || 0) + (category === "ANORGANIK" ? 1 : 0);

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

  return {
    category,
    item,
    confidence,
    reason,
    organik_count: organikCount,
    anorganik_count: anorganikCount,
  };
}
