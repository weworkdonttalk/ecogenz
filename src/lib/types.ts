export type ControlMode = "AUTO" | "FORCE_OPEN" | "FORCE_CLOSE";
export type WasteCategory = "ORGANIK" | "ANORGANIK";
export type SortCommand = "NONE" | WasteCategory;

export const VALID_CONTROL_MODES: readonly ControlMode[] = [
  "AUTO",
  "FORCE_OPEN",
  "FORCE_CLOSE",
] as const;

export interface WasteClassificationResult {
  category: WasteCategory;
  item: string;
  confidence: number;
  reason: string;
}

export interface WasteSortOutcome extends WasteClassificationResult {
  organik_count: number;
  anorganik_count: number;
}

export interface DeviceState {
  id: number;
  temperature: number;
  humidity: number;
  gas_level: number;
  distance_cm: number;
  lid_status: string;
  control_mode: ControlMode;
  open_count: number;
  last_alert_at: string | null;
  updated_at: string;
  sort_command?: SortCommand;
  trash_detected?: boolean;
  last_item?: string | null;
  last_category?: WasteCategory | null;
  organik_count?: number;
  anorganik_count?: number;
}

export interface DashboardState extends DeviceState {
  is_online: boolean;
}

export interface SensorLog {
  id: number;
  temperature: number;
  humidity: number;
  gas_level: number;
  created_at: string;
}

export interface DashboardResponse {
  state: DashboardState | null;
  logs: SensorLog[];
}

export const ONLINE_THRESHOLD_MS = 15_000;
export const GAS_SMELLY_THRESHOLD = 250;
export const GAS_DANGER_THRESHOLD = 400;

export function isControlMode(value: unknown): value is ControlMode {
  return (
    typeof value === "string" &&
    (VALID_CONTROL_MODES as readonly string[]).includes(value)
  );
}

export function isDeviceOnline(
  updatedAt: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!updatedAt) return false;
  const updatedMs = new Date(updatedAt).getTime();
  if (Number.isNaN(updatedMs)) return false;
  return nowMs - updatedMs < ONLINE_THRESHOLD_MS;
}

export type GasCategory = "Aman" | "Bau" | "Bahaya";

export interface GasStatusInfo {
  category: GasCategory;
  accentHex: string;
  description: string;
}

export function getGasStatusInfo(gasLevel: number): GasStatusInfo {
  if (gasLevel >= GAS_DANGER_THRESHOLD) {
    return {
      category: "Bahaya",
      accentHex: "#FB8569",
      description: "Gas tinggi! Segera kosongkan & ventilasi.",
    };
  }
  if (gasLevel >= GAS_SMELLY_THRESHOLD) {
    return {
      category: "Bau",
      accentHex: "#FCD37D",
      description: "Mulai tercium bau, periksa isi tong.",
    };
  }
  return {
    category: "Aman",
    accentHex: "#BEF264",
    description: "Udara di dalam tong terpantau bersih.",
  };
}
