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

export async function classifyAndTriggerSort(
  imageBase64: string,
  mimeType: string = "image/jpeg"
): Promise<ClassificationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("token ku habis kontol");

  const prompt = `Kamu adalah AI pemilah sampah pintar EcoGenZ. Analisis gambar sampah ini dan tentukan apakah termasuk ORGANIK (sisa makanan, kulit buah, daun, tisu kotor/basah, tulang, ampas kopi) atau ANORGANIK (plastik, botol, kaleng, kertas bersih/kardus, kaca, styrofoam, logam, elektronik).
Jawab HANYA dalam format JSON valid dengan skema:
{
  "category": "ORGANIK" atau "ANORGANIK",
  "item": "nama singkat benda dalam Bahasa Indonesia (maks 3 kata)",
  "confidence": angka 0-100,
  "reason": "alasan singkat 1 kalimat"
}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Error: ${errText}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const parsed = JSON.parse(rawText);

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
