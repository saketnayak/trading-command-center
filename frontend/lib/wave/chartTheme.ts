export type ChartTheme = "dark" | "light";

export interface ThemeColors {
  bg: string;
  paper: string;
  grid: string;
  axis: string;
  font: string;
  candleUp: string;
  candleDown: string;
  pivot: string;
  stop: string;
  target: string;
  invalidation: string;
  fib: string;
  projection: string;
  zoneLong: string;
  zoneShort: string;
  legendBg: string;
  legendBorder: string;
  scenario: string[];
}

export const THEMES: Record<ChartTheme, ThemeColors> = {
  dark: {
    bg: "#0f1629",
    paper: "#0f1629",
    grid: "rgba(148,163,184,0.16)",
    axis: "rgba(148,163,184,0.36)",
    font: "#cbd5e1",
    candleUp: "#4ade80",
    candleDown: "#f87171",
    pivot: "#94a3b8",
    stop: "#fb7185",
    target: "#22c55e",
    invalidation: "#fbbf24",
    fib: "rgba(147,197,253,0.75)",
    projection: "#38bdf8",
    zoneLong: "rgba(74,222,128,0.14)",
    zoneShort: "rgba(248,113,113,0.14)",
    legendBg: "rgba(15,22,41,0.92)",
    legendBorder: "rgba(148,163,184,0.28)",
    scenario: ["#93c5fd", "#fbbf24", "#c084fc", "#4ade80", "#f87171"],
  },
  light: {
    bg: "#ffffff",
    paper: "#ffffff",
    grid: "rgba(100,116,139,0.18)",
    axis: "rgba(71,85,105,0.36)",
    font: "#0f172a",
    candleUp: "#15803d",
    candleDown: "#b91c1c",
    pivot: "#475569",
    stop: "#b91c1c",
    target: "#15803d",
    invalidation: "#b45309",
    fib: "rgba(29,78,216,0.7)",
    projection: "#0284c7",
    zoneLong: "rgba(21,128,61,0.10)",
    zoneShort: "rgba(185,28,28,0.10)",
    legendBg: "rgba(255,255,255,0.94)",
    legendBorder: "rgba(71,85,105,0.22)",
    scenario: ["#1d4ed8", "#b45309", "#7e22ce", "#15803d", "#b91c1c"],
  },
};
