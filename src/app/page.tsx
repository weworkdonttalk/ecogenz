"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GAS_DANGER_THRESHOLD,
  GAS_SMELLY_THRESHOLD,
  getGasStatusInfo,
  type ControlMode,
  type DashboardResponse,
  type DashboardState,
  type GasCategory,
  type SensorLog,
} from "@/lib/types";

const POLL_INTERVAL_MS = 3000;

const MODE_OPTIONS: readonly {
  mode: ControlMode;
  label: string;
  activeBg: string;
}[] = [
  { mode: "AUTO", label: "Auto", activeBg: "bg-[#A78BFA]" },
  { mode: "FORCE_OPEN", label: "Buka Paksa", activeBg: "bg-[#BEF264]" },
  { mode: "FORCE_CLOSE", label: "Tutup Paksa", activeBg: "bg-[#FB8569]" },
];

function isLidOpen(lidStatus: string | undefined): boolean {
  if (!lidStatus) return false;
  const normalized = lidStatus.toUpperCase();
  return normalized.includes("OPEN") || normalized.includes("BUKA");
}

function formatTimeShort(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLidLabel(lidStatus: string | undefined): string {
  if (!lidStatus) return "Belum ada data";
  const upper = lidStatus.toUpperCase();
  if (upper.includes("OPEN") || upper.includes("BUKA")) return "Terbuka";
  if (upper.includes("CLOSE") || upper.includes("TUTUP")) return "Tertutup";
  return lidStatus;
}

function TrashMascotSvg({
  category,
  lidOpen,
}: {
  category: GasCategory;
  lidOpen: boolean;
}) {
  const bodyColor =
    category === "Bahaya"
      ? "#FB8569"
      : category === "Bau"
        ? "#FCD37D"
        : "#BEF264";

  return (
    <svg
      viewBox="0 0 220 220"
      className="h-40 w-40 drop-shadow-[3px_3px_0px_#000]"
      role="img"
      aria-label={`Ilustrasi tong sampah EcoGenZ kondisi ${category}`}
    >
      {/* Fume lines for Bau & Bahaya, sparkles for Aman */}
      {category === "Aman" && (
        <g stroke="#000" strokeWidth="3" strokeLinecap="round" fill="#FCD37D">
          <path d="M36 58 L42 46 L48 58 L60 64 L48 70 L42 82 L36 70 L24 64 Z" />
          <circle cx="182" cy="54" r="6" fill="#F9A8D4" />
        </g>
      )}

      {category === "Bau" && (
        <g
          fill="none"
          stroke="#000"
          strokeWidth="3.5"
          strokeLinecap="round"
        >
          <path d="M74 44 C66 32, 82 22, 74 10" />
          <path d="M110 38 C102 26, 118 16, 110 4" />
          <path d="M146 44 C138 32, 154 22, 146 10" />
        </g>
      )}

      {category === "Bahaya" && (
        <g>
          <g
            fill="none"
            stroke="#000"
            strokeWidth="4"
            strokeLinecap="round"
          >
            <path d="M68 44 C56 30, 82 20, 68 8" />
            <path d="M110 38 C98 24, 124 14, 110 2" />
            <path d="M152 44 C140 30, 166 20, 152 8" />
          </g>
          <circle
            cx="186"
            cy="48"
            r="16"
            fill="#FCD37D"
            stroke="#000"
            strokeWidth="3.5"
          />
          <path d="M186 39 V50" stroke="#000" strokeWidth="4" strokeLinecap="round" />
          <circle cx="186" cy="56" r="2.2" fill="#000" />
        </g>
      )}

      {/* Bin Lid (tilts open when lidOpen is true) */}
      <g
        transform={lidOpen ? "rotate(-16 44 76) translate(0 -12)" : "rotate(0)"}
        className="transition-transform duration-300 ease-out"
      >
        <rect
          x="86"
          y="42"
          width="48"
          height="18"
          rx="9"
          fill="#F9A8D4"
          stroke="#000"
          strokeWidth="4"
        />
        <rect
          x="36"
          y="58"
          width="148"
          height="24"
          rx="12"
          fill="#A78BFA"
          stroke="#000"
          strokeWidth="4"
        />
      </g>

      {/* Bin Body */}
      <rect
        x="48"
        y="90"
        width="124"
        height="112"
        rx="26"
        fill={bodyColor}
        stroke="#000"
        strokeWidth="4"
      />

      {/* Side ridges */}
      <line
        x1="68"
        y1="176"
        x2="68"
        y2="188"
        stroke="#000"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <line
        x1="152"
        y1="176"
        x2="152"
        y2="188"
        stroke="#000"
        strokeWidth="4"
        strokeLinecap="round"
      />

      {/* Facial expressions based on gas level */}
      {category === "Aman" && (
        <g>
          {/* Happy curved eyes */}
          <path
            d="M78 132 C82 122, 94 122, 98 132"
            fill="none"
            stroke="#000"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <path
            d="M122 132 C126 122, 138 122, 142 132"
            fill="none"
            stroke="#000"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          {/* Rosy cheeks */}
          <circle cx="72" cy="144" r="8" fill="#F9A8D4" opacity="0.9" />
          <circle cx="148" cy="144" r="8" fill="#F9A8D4" opacity="0.9" />
          {/* Big happy smile */}
          <path
            d="M90 148 C98 166, 122 166, 130 148 Z"
            fill="#FFFDF7"
            stroke="#000"
            strokeWidth="4"
            strokeLinejoin="round"
          />
        </g>
      )}

      {category === "Bau" && (
        <g>
          {/* Squinting eyes */}
          <path
            d="M76 126 L94 133 L76 140"
            fill="none"
            stroke="#000"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M144 126 L126 133 L144 140"
            fill="none"
            stroke="#000"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Sweat drop */}
          <path
            d="M156 106 C156 106, 164 118, 158 124 C153 128, 147 122, 156 106 Z"
            fill="#A78BFA"
            stroke="#000"
            strokeWidth="2.5"
          />
          {/* Wavy disgusted mouth */}
          <path
            d="M86 156 Q98 148, 110 156 T134 156"
            fill="none"
            stroke="#000"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
        </g>
      )}

      {category === "Bahaya" && (
        <g>
          {/* X eyes */}
          <path
            d="M78 122 L96 140 M96 122 L78 140"
            stroke="#000"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <path
            d="M124 122 L142 140 M142 122 L124 140"
            stroke="#000"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          {/* Panic open zig-zag mouth */}
          <rect
            x="84"
            y="150"
            width="52"
            height="22"
            rx="11"
            fill="#FFFDF7"
            stroke="#000"
            strokeWidth="4"
          />
          <path
            d="M92 161 L101 155 L110 165 L119 155 L128 161"
            fill="none"
            stroke="#000"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
    </svg>
  );
}

async function requestDashboard(
  signal?: AbortSignal
): Promise<DashboardResponse> {
  const response = await fetch("/api/dashboard", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as DashboardResponse;
}

export default function HomePage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<ControlMode | null>(null);
  const [selectedLogIndex, setSelectedLogIndex] = useState<number | null>(null);

  const fetchDashboard = useCallback(async (signal?: AbortSignal) => {
    try {
      const json = await requestDashboard(signal);
      setData(json);
      setErrorMsg(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setErrorMsg("Gagal memuat data perangkat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;

    const loadInitialAndPoll = () => {
      requestDashboard(controller.signal)
        .then((json) => {
          if (!isMounted) return;
          setData(json);
          setErrorMsg(null);
        })
        .catch((error: unknown) => {
          if (
            !isMounted ||
            (error instanceof DOMException && error.name === "AbortError")
          ) {
            return;
          }
          setErrorMsg("Gagal memuat data perangkat.");
        })
        .finally(() => {
          if (isMounted) {
            setLoading(false);
          }
        });
    };

    loadInitialAndPoll();
    const intervalId = setInterval(loadInitialAndPoll, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      controller.abort();
      clearInterval(intervalId);
    };
  }, []);

  const handleModeChange = async (mode: ControlMode) => {
    setPendingMode(mode);
    setData((prev) =>
      prev?.state
        ? {
            ...prev,
            state: {
              ...prev.state,
              control_mode: mode,
            },
          }
        : prev
    );

    try {
      const response = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await fetchDashboard();
    } catch {
      setErrorMsg("Gagal mengirim perintah kontrol.");
      await fetchDashboard();
    } finally {
      setPendingMode(null);
    }
  };

  const state: DashboardState | null = data?.state ?? null;
  const logs: SensorLog[] = useMemo(() => data?.logs ?? [], [data?.logs]);

  const gasLevel = state?.gas_level ?? 0;
  const gasInfo = getGasStatusInfo(gasLevel);
  const lidOpen = isLidOpen(state?.lid_status);
  const activeMode = pendingMode ?? state?.control_mode ?? "AUTO";
  const isOnline = state?.is_online ?? false;

  const maxGasInLogs = useMemo(() => {
    const highest = logs.reduce(
      (max, item) => Math.max(max, item.gas_level),
      GAS_DANGER_THRESHOLD
    );
    return Math.max(highest, 500);
  }, [logs]);

  const inspectedLog =
    selectedLogIndex !== null && logs[selectedLogIndex]
      ? logs[selectedLogIndex]
      : logs.length > 0
        ? logs[logs.length - 1]
        : null;

  return (
    <div className="min-h-screen bg-[#FFFDF7] px-4 py-5 pb-10">
      <main className="mx-auto flex w-full max-w-md flex-col gap-4">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 rounded-[28px] border-2 border-black bg-[#FCD37D] px-5 py-4 shadow-[4px_4px_0px_#000]">
          <div className="flex flex-col">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-black/75">
              Smart IoT Bin
            </span>
            <h1 className="text-2xl font-black tracking-tight text-black">
              EcoGenZ Trash
            </h1>
          </div>

          <div
            className={`flex items-center gap-2 rounded-full border-2 border-black px-3.5 py-1.5 text-xs font-extrabold shadow-[2px_2px_0px_#000] ${
              isOnline ? "bg-[#BEF264]" : "bg-[#FB8569]"
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full border border-black ${
                isOnline ? "animate-pulse bg-black" : "bg-white"
              }`}
            />
            <span>{isOnline ? "Online" : "Offline"}</span>
          </div>
        </header>

        {errorMsg && (
          <div className="rounded-[20px] border-2 border-black bg-[#FB8569] px-4 py-2.5 text-xs font-bold shadow-[3px_3px_0px_#000]">
            ⚠️ {errorMsg}
          </div>
        )}

        {/* Control Mode Pill Tabs */}
        <section aria-label="Kontrol Mode Tutup">
          <div className="grid grid-cols-3 gap-1.5 rounded-[28px] border-2 border-black bg-white p-1.5 shadow-[4px_4px_0px_#000]">
            {MODE_OPTIONS.map((option) => {
              const isActive = activeMode === option.mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  disabled={pendingMode !== null}
                  onClick={() => handleModeChange(option.mode)}
                  className={`cursor-pointer rounded-full px-2 py-2.5 text-xs font-black transition-all active:translate-x-[1px] active:translate-y-[1px] ${
                    isActive
                      ? `${option.activeBg} border-2 border-black shadow-[2px_2px_0px_#000]`
                      : "border-2 border-transparent text-black/70 hover:bg-black/5"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Cartoon Mascot & Quick Lid + Counter Card */}
        <section className="grid grid-cols-1 gap-4 rounded-[28px] border-2 border-black bg-[#F9A8D4] p-5 shadow-[4px_4px_0px_#000]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <span className="w-fit rounded-full border-2 border-black bg-white px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide shadow-[2px_2px_0px_#000]">
                {loading ? "Memuat..." : `Sync ${formatTimeShort(state?.updated_at)}`}
              </span>

              <div className="mt-1">
                <p className="text-xs font-bold uppercase tracking-wide text-black/75">
                  Status Tutup
                </p>
                <p className="text-2xl font-black leading-tight">
                  {formatLidLabel(state?.lid_status)}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <div className="rounded-2xl border-2 border-black bg-[#FFFDF7] px-3 py-1.5 shadow-[2px_2px_0px_#000]">
                  <p className="text-[10px] font-bold uppercase text-black/65">
                    Dibuka
                  </p>
                  <p className="font-mono text-base font-black">
                    {state?.open_count ?? 0}x
                  </p>
                </div>
                <div className="rounded-2xl border-2 border-black bg-[#FFFDF7] px-3 py-1.5 shadow-[2px_2px_0px_#000]">
                  <p className="text-[10px] font-bold uppercase text-black/65">
                    Jarak
                  </p>
                  <p className="font-mono text-base font-black">
                    {state ? `${Number(state.distance_cm).toFixed(0)} cm` : "--"}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-center rounded-[24px] border-2 border-black bg-[#FFFDF7] p-2 shadow-[3px_3px_0px_#000]">
              <TrashMascotSvg category={gasInfo.category} lidOpen={lidOpen} />
            </div>
          </div>
        </section>

        {/* Gas MQ-2 Status Card */}
        <section
          className="rounded-[28px] border-2 border-black p-5 shadow-[4px_4px_0px_#000] transition-colors"
          style={{ backgroundColor: gasInfo.accentHex }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-black/75">
                Sensor Gas MQ-2
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-black tracking-tight">
                  {gasInfo.category}
                </span>
                <span className="font-mono text-base font-extrabold text-black/80">
                  ({state ? state.gas_level : "--"} ADC)
                </span>
              </div>
              <p className="mt-1 text-xs font-bold text-black/80">
                {gasInfo.description}
              </p>
            </div>

            <span className="rounded-2xl border-2 border-black bg-white px-3 py-1.5 font-mono text-sm font-black shadow-[2px_2px_0px_#000]">
              {gasLevel >= GAS_DANGER_THRESHOLD
                ? "🚨 ≥400"
                : gasLevel >= GAS_SMELLY_THRESHOLD
                  ? "💨 ≥250"
                  : "✨ <250"}
            </span>
          </div>

          {/* Capsule Progress Meter */}
          <div className="mt-4 h-5 w-full overflow-hidden rounded-full border-2 border-black bg-white p-0.5">
            <div
              className="h-full rounded-full border border-black bg-black transition-all duration-300"
              style={{
                width: `${Math.min(100, Math.max(6, (gasLevel / 600) * 100))}%`,
              }}
            />
          </div>
        </section>

        {/* 2 Mini Cards: Suhu & Kelembapan */}
        <section className="grid grid-cols-2 gap-4">
          <div className="flex flex-col justify-between rounded-[28px] border-2 border-black bg-[#FCD37D] p-4 shadow-[4px_4px_0px_#000]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wide text-black/80">
                Suhu
              </span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-black bg-white text-sm font-black">
                🌡️
              </span>
            </div>
            <p className="mt-3 font-mono text-3xl font-black tracking-tight">
              {state ? `${Number(state.temperature).toFixed(1)}` : "--"}
              <span className="ml-1 text-lg font-extrabold">°C</span>
            </p>
          </div>

          <div className="flex flex-col justify-between rounded-[28px] border-2 border-black bg-[#A78BFA] p-4 shadow-[4px_4px_0px_#000]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wide text-black/90">
                Kelembapan
              </span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-black bg-white text-sm font-black">
                💧
              </span>
            </div>
            <p className="mt-3 font-mono text-3xl font-black tracking-tight">
              {state ? `${Number(state.humidity).toFixed(1)}` : "--"}
              <span className="ml-1 text-lg font-extrabold">%</span>
            </p>
          </div>
        </section>

        {/* Capsule Bar Chart Card: Gas History */}
        <section className="rounded-[28px] border-2 border-black bg-white p-5 shadow-[4px_4px_0px_#000]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-black/65">
                Histori Gas MQ-2
              </p>
              <h2 className="text-lg font-black">20 Catatan Terakhir</h2>
            </div>

            {inspectedLog && (
              <div className="rounded-2xl border-2 border-black bg-[#BEF264] px-3 py-1 text-right shadow-[2px_2px_0px_#000]">
                <p className="font-mono text-xs font-black">
                  {inspectedLog.gas_level} ADC
                </p>
                <p className="text-[10px] font-bold text-black/75">
                  {formatTimeShort(inspectedLog.created_at)}
                </p>
              </div>
            )}
          </div>

          {logs.length === 0 ? (
            <div className="mt-4 flex h-36 items-center justify-center rounded-2xl border-2 border-dashed border-black/40 bg-[#FFFDF7] text-xs font-bold text-black/60">
              {loading
                ? "Mengambil riwayat sensor..."
                : "Belum ada log histori sensor."}
            </div>
          ) : (
            <div className="mt-5">
              <div className="flex h-36 items-end justify-between gap-1.5">
                {logs.map((log, index) => {
                  const pct = Math.max(
                    14,
                    Math.min(100, Math.round((log.gas_level / maxGasInLogs) * 100))
                  );
                  const barInfo = getGasStatusInfo(log.gas_level);
                  const isSelected =
                    selectedLogIndex === index ||
                    (selectedLogIndex === null && index === logs.length - 1);

                  return (
                    <button
                      key={log.id}
                      type="button"
                      onClick={() => setSelectedLogIndex(index)}
                      aria-label={`Gas ${log.gas_level} pada ${formatTimeShort(log.created_at)}`}
                      className="group flex h-full flex-1 cursor-pointer flex-col items-center justify-end"
                    >
                      <div className="flex h-full w-full max-w-[16px] items-end rounded-full bg-black/5 p-[1px]">
                        <div
                          className={`w-full rounded-full border-2 border-black transition-all duration-300 ${
                            isSelected ? "scale-x-110 shadow-[2px_2px_0px_#000]" : "opacity-90 group-hover:opacity-100"
                          }`}
                          style={{
                            height: `${pct}%`,
                            backgroundColor: barInfo.accentHex,
                          }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex items-center justify-between text-[11px] font-bold text-black/65">
                <span>{formatTimeShort(logs[0]?.created_at)}</span>
                <span>Tap kapsul untuk detail</span>
                <span>{formatTimeShort(logs[logs.length - 1]?.created_at)}</span>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
