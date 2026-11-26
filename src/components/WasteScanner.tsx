"use client";

import Image from "next/image";
import { useRef, useState, type ChangeEvent } from "react";
import type {
  SortCommand,
  WasteCategory,
  WasteSortOutcome,
} from "@/lib/types";

const MAX_IMAGE_DIMENSION = 800;
const JPEG_QUALITY = 0.8;

interface WasteScannerProps {
  trashDetected: boolean;
  lastItem: string | null;
  lastCategory: WasteCategory | null;
  organikCount: number;
  anorganikCount: number;
  sortCommand: SortCommand;
  onClassified?: () => void;
}

interface CompressedImage {
  dataUrl: string;
  base64: string;
  mimeType: string;
}

function compressImageWithCanvas(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new window.Image();

    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          if (width >= height) {
            height = Math.round((height * MAX_IMAGE_DIMENSION) / width);
            width = MAX_IMAGE_DIMENSION;
          } else {
            width = Math.round((width * MAX_IMAGE_DIMENSION) / height);
            height = MAX_IMAGE_DIMENSION;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas 2D context tidak tersedia."));
          return;
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        const commaIndex = dataUrl.indexOf(",");
        const base64 = commaIndex !== -1 ? dataUrl.slice(commaIndex + 1) : "";

        if (!base64) {
          reject(new Error("Gagal mengonversi gambar ke JPEG."));
          return;
        }

        resolve({
          dataUrl,
          base64,
          mimeType: "image/jpeg",
        });
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Gagal membaca file gambar."));
    };

    img.src = objectUrl;
  });
}

export default function WasteScanner({
  trashDetected,
  lastItem,
  lastCategory,
  organikCount,
  anorganikCount,
  sortCommand,
  onClassified,
}: WasteScannerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [result, setResult] = useState<WasteSortOutcome | null>(null);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setScanError(null);
    setIsAnalyzing(true);

    try {
      const compressed = await compressImageWithCanvas(file);
      setPreviewUrl(compressed.dataUrl);

      const response = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: compressed.base64,
          mimeType: compressed.mimeType,
        }),
      });

      const payload = (await response.json()) as WasteSortOutcome & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      setResult(payload);
      onClassified?.();
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "Gagal mengklasifikasi foto sampah.";
      setScanError(msg);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const displayOrganik = result?.organik_count ?? organikCount;
  const displayAnorganik = result?.anorganik_count ?? anorganikCount;

  return (
    <section
      aria-label="Scanner Pemilah Sampah Gemini Vision"
      className="flex flex-col gap-4 rounded-[28px] border-2 border-black bg-[#FFFDF7] p-5 shadow-[4px_4px_0px_#000]"
    >
      {/* Header & Tray Status */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-black/65">
            Gemini Vision AI
          </p>
          <h2 className="text-lg font-black">Pemilah Sampah Pintar</h2>
        </div>

        <span
          className={`flex items-center gap-1.5 rounded-full border-2 border-black px-3 py-1 text-[11px] font-black shadow-[2px_2px_0px_#000] ${
            trashDetected ? "bg-[#BEF264]" : "bg-white"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full border border-black ${
              trashDetected ? "animate-pulse bg-black" : "bg-black/25"
            }`}
          />
          {trashDetected
            ? "Sampah Terdeteksi — Siap Difoto"
            : "Nampan Kosong"}
        </span>
      </div>

      {/* Camera Trigger */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      <button
        type="button"
        disabled={isAnalyzing}
        onClick={() => inputRef.current?.click()}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[22px] border-2 border-black bg-[#FCD37D] px-4 py-3.5 text-sm font-black shadow-[4px_4px_0px_#000] transition-all hover:bg-[#fbd06c] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0px_#000] disabled:cursor-not-allowed disabled:opacity-65"
      >
        <span>{isAnalyzing ? "⏳ Menganalisis dengan Gemini AI..." : "📸 Foto & Pilah Sampah"}</span>
      </button>

      {sortCommand !== "NONE" && (
        <div className="rounded-2xl border-2 border-black bg-[#A78BFA] px-3.5 py-2 text-xs font-black shadow-[2px_2px_0px_#000]">
          ⚙️ Perintah servo aktif: <code>{sortCommand}</code> (menunggu Wemos membuang sampah)
        </div>
      )}

      {scanError && (
        <div className="rounded-2xl border-2 border-black bg-[#FB8569] px-3.5 py-2.5 text-xs font-bold shadow-[2px_2px_0px_#000]">
          ⚠️ {scanError}
        </div>
      )}

      {/* Photo Preview */}
      {previewUrl && (
        <div className="overflow-hidden rounded-[22px] border-2 border-black bg-white shadow-[3px_3px_0px_#000]">
          <Image
            src={previewUrl}
            alt="Preview foto sampah di nampan"
            width={800}
            height={600}
            unoptimized
            className="h-48 w-full object-cover"
          />
        </div>
      )}

      {/* AI Classification Result Card */}
      {result ? (
        <div
          className={`rounded-[22px] border-2 border-black p-4 shadow-[3px_3px_0px_#000] ${
            result.category === "ORGANIK" ? "bg-[#BEF264]" : "bg-[#A78BFA]"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-black/75">
                Hasil Deteksi AI
              </span>
              <h3 className="text-xl font-black leading-tight">{result.item}</h3>
            </div>
            <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-black shadow-[2px_2px_0px_#000]">
              {result.category} • {result.confidence}%
            </span>
          </div>
          <p className="mt-2 text-xs font-bold leading-relaxed text-black/85">
            {result.reason}
          </p>
        </div>
      ) : lastItem ? (
        <div className="flex items-center justify-between gap-2 rounded-[20px] border-2 border-black bg-[#F9A8D4]/50 px-4 py-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-black/65">
              Item Terakhir Dipilah
            </p>
            <p className="text-sm font-black">{lastItem}</p>
          </div>
          {lastCategory && (
            <span
              className={`rounded-full border-2 border-black px-3 py-1 text-[11px] font-black ${
                lastCategory === "ORGANIK" ? "bg-[#BEF264]" : "bg-[#A78BFA]"
              }`}
            >
              {lastCategory}
            </span>
          )}
        </div>
      ) : null}

      {/* Organik vs Anorganik Counters */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center justify-between rounded-[20px] border-2 border-black bg-[#BEF264] px-4 py-3 shadow-[3px_3px_0px_#000]">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-black/75">
              Organik
            </p>
            <p className="font-mono text-2xl font-black">{displayOrganik}</p>
          </div>
          <span className="text-xl" aria-hidden="true">
            🌿
          </span>
        </div>

        <div className="flex items-center justify-between rounded-[20px] border-2 border-black bg-[#A78BFA] px-4 py-3 shadow-[3px_3px_0px_#000]">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-black/80">
              Anorganik
            </p>
            <p className="font-mono text-2xl font-black">{displayAnorganik}</p>
          </div>
          <span className="text-xl" aria-hidden="true">
            ♻️
          </span>
        </div>
      </div>
    </section>
  );
}
