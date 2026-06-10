export type KalmanProcessingMode = "causal" | "historical";

export interface KalmanSettings {
  observationCovariance: number;
  transitionCovariance: number;
  mode: KalmanProcessingMode;
}

export const KALMAN_SETTINGS_DEFAULTS: KalmanSettings = {
  observationCovariance: 0.1,
  transitionCovariance: 0.01,
  mode: "causal",
};

export const KALMAN_SETTINGS_RANGES = {
  observationCovariance: { min: 0.0001, max: 10.0 },
  transitionCovariance: { min: 0.0001, max: 1.0 },
} as const;

export function validateKalmanSettings(settings: KalmanSettings): string | null {
  const { observationCovariance, transitionCovariance, mode } = settings;
  if (!Number.isFinite(observationCovariance)) return "Observation covariance must be a valid number.";
  if (!Number.isFinite(transitionCovariance)) return "Transition covariance must be a valid number.";
  if (
    observationCovariance < KALMAN_SETTINGS_RANGES.observationCovariance.min ||
    observationCovariance > KALMAN_SETTINGS_RANGES.observationCovariance.max
  ) {
    return "Observation covariance must be between 0.0001 and 10.0.";
  }
  if (
    transitionCovariance < KALMAN_SETTINGS_RANGES.transitionCovariance.min ||
    transitionCovariance > KALMAN_SETTINGS_RANGES.transitionCovariance.max
  ) {
    return "Transition covariance must be between 0.0001 and 1.0.";
  }
  if (mode !== "causal" && mode !== "historical") return "Processing mode is invalid.";
  return null;
}
