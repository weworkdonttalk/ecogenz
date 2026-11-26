import { supabase } from "@/lib/supabase";
import type {
  DeviceState,
  WasteCategory,
  WasteClassificationResult,
  WasteSortOutcome,
} from "@/lib/types";

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

const CLASSIFICATION_PROMPT = [
  "Kamu adalah sistem AI pemilah sampah EcoGenZ Smart Waste Sorter.",
  "Analisis foto sampah pada nampan dan klasifikasikan secara ketat ke salah satu dari dua kategori saja:",
  '- "ORGANIK": sisa makanan, kulit buah, sayuran, daun, ampas kopi/teh, bahan hayati yang mudah terurai.',
  '- "ANORGANIK": plastik, botol, kaleng, kertas/kardus kemasan, kaca, styrofoam, logam, elektronik, atau benda non-organik lainnya.',
  "",
  "Balas HANYA dalam JSON valid sesuai skema:",
  '- "category": wajib tepat "ORGANIK" atau "ANORGANIK"',
  '- "item": nama benda dalam Bahasa Indonesia, maksimal 3 kata',
  '- "confidence": angka bulat 0 sampai 100',
  '- "reason": penjelasan singkat tepat 1 kalimat dalam Bahasa Indonesia',
].join("\n");

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
}

function stripDataUrlPrefix(base64OrDataUrl: string): string {
  const commaIdx = base64OrDataUrl.indexOf(",");
  if (base64OrDataUrl.startsWith("data:") && commaIdx !== -1) {
    return base64OrDataUrl.slice(commaIdx + 1).trim();
  }
  return base64OrDataUrl.trim();
}

function normalizeClassification(raw: unknown): WasteClassificationResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("Gemini returned non-object JSON");
  }

  const obj = raw as Record<string, unknown>;
  const rawCategory =
    typeof obj.category === "string" ? obj.category.trim().toUpperCase() : "";

  let category: WasteCategory;
  if (rawCategory === "ORGANIK") {
    category = "ORGANIK";
  } else if (rawCategory === "ANORGANIK") {
    category = "ANORGANIK";
  } else {
    throw new Error(`Invalid waste category from Gemini: "${rawCategory}"`);
  }

  const rawItem =
    typeof obj.item === "string" ? obj.item.trim() : "Sampah Tidak Dikenal";
  const words = rawItem.split(/\s+/).filter(Boolean).slice(0, 3);
  const item = words.length > 0 ? words.join(" ") : "Sampah";

  const parsedConfidence = Number(obj.confidence);
  const confidence = Number.isFinite(parsedConfidence)
    ? Math.max(0, Math.min(100, Math.round(parsedConfidence)))
    : 80;

  const reason =
    typeof obj.reason === "string" && obj.reason.trim().length > 0
      ? obj.reason.trim()
      : `Benda diklasifikasikan sebagai sampah ${category.toLowerCase()}.`;

  return {
    category,
    item,
    confidence,
    reason,
  };
}

/**
 * Classifies a waste photo using Gemini 2.5 Flash Vision and triggers servo sorting
 * by updating row id = 1 in Supabase `device_state`.
 */
export async function classifyAndTriggerSort(
  imageBase64: string,
  mimeType: string
): Promise<WasteSortOutcome> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY environment variable.");
  }

  const cleanBase64 = stripDataUrlPrefix(imageBase64);
  if (!cleanBase64) {
    throw new Error("Empty imageBase64 payload.");
  }

  const normalizedMimeType =
    typeof mimeType === "string" && mimeType.startsWith("image/")
      ? mimeType
      : "image/jpeg";

  const geminiResponse = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: CLASSIFICATION_PROMPT },
            {
              inline_data: {
                mime_type: normalizedMimeType,
                data: cleanBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            category: {
              type: "STRING",
              enum: ["ORGANIK", "ANORGANIK"],
            },
            item: { type: "STRING" },
            confidence: { type: "INTEGER" },
            reason: { type: "STRING" },
          },
          required: ["category", "item", "confidence", "reason"],
        },
        temperature: 0.2,
      },
    }),
    cache: "no-store",
  });

  if (!geminiResponse.ok) {
    const errorText = await geminiResponse.text();
    throw new Error(
      `Gemini API error (${geminiResponse.status}): ${errorText}`
    );
  }

  const geminiData = (await geminiResponse.json()) as GeminiResponse;
  const parts = geminiData.candidates?.[0]?.content?.parts ?? [];
  const rawText =
    parts.find((part) => !part.thought && typeof part.text === "string")
      ?.text ?? parts[0]?.text;

  if (!rawText) {
    throw new Error("Gemini API returned empty candidate text.");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new Error(`Failed to parse Gemini JSON response: ${rawText}`);
  }

  const classification = normalizeClassification(parsedJson);

  const { data: currentState, error: fetchError } = await supabase
    .from("device_state")
    .select("organik_count, anorganik_count")
    .eq("id", 1)
    .maybeSingle<Pick<DeviceState, "organik_count" | "anorganik_count">>();

  if (fetchError) {
    throw new Error(
      `Failed to fetch device_state counters: ${fetchError.message}`
    );
  }

  const nextOrganikCount =
    (currentState?.organik_count ?? 0) +
    (classification.category === "ORGANIK" ? 1 : 0);
  const nextAnorganikCount =
    (currentState?.anorganik_count ?? 0) +
    (classification.category === "ANORGANIK" ? 1 : 0);

  const { error: updateError } = await supabase
    .from("device_state")
    .update({
      sort_command: classification.category,
      last_item: classification.item,
      last_category: classification.category,
      organik_count: nextOrganikCount,
      anorganik_count: nextAnorganikCount,
    })
    .eq("id", 1);

  if (updateError) {
    throw new Error(
      `Failed to update device_state for sort trigger: ${updateError.message}`
    );
  }

  return {
    ...classification,
    organik_count: nextOrganikCount,
    anorganik_count: nextAnorganikCount,
  };
}
