"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getApiKeys,
  getUsers,
  inviteUser,
  updateProfile,
  getSmtpStatus,
  getMe,
  downloadDbBackup,
  restoreDbBackup,
  getInvestorProfile,
  getAppSettings,
  updateAppSettings,
} from "@/lib/api";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { ApiKeyRow } from "@/components/settings/ApiKeyRow";
import { InfoPopover } from "@/components/settings/InfoPopover";
import { ServerUrlRow } from "@/components/settings/ServerUrlRow";
import { TeamMemberRow } from "@/components/settings/TeamMemberRow";
import {
  APP_SETTINGS_DEFAULTS,
  APP_SETTINGS_RANGES,
  validateAppSettings,
  type KalmanProcessingMode,
  type AppSettings,
} from "@/lib/appSettings";
import { PageShell } from "@/components/layout/PageShell";

const CLOUD_PROVIDERS: { provider: string; label: string; placeholder: string; docsUrl: string }[] = [
  { provider: "openai",    label: "OpenAI",    placeholder: "sk-…",     docsUrl: "https://platform.openai.com/api-keys" },
  { provider: "anthropic", label: "Anthropic", placeholder: "sk-ant-…", docsUrl: "https://console.anthropic.com/settings/keys" },
  { provider: "google",    label: "Google",    placeholder: "AIza…",    docsUrl: "https://aistudio.google.com/app/apikey" },
  { provider: "ionos",      label: "IONOS",      placeholder: "ion_…",    docsUrl: "https://docs.ionos.com/cloud/ai/ai-model-hub" },
  { provider: "groq",      label: "Groq",      placeholder: "gsk_…",    docsUrl: "https://console.groq.com/keys" },
];

const LOCAL_PROVIDERS: { provider: "ollama" | "vllm"; label: string }[] = [
  { provider: "ollama", label: "Ollama" },
  { provider: "vllm",   label: "vLLM" },
];

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-fg text-base font-semibold">{title}</h2>
        {description && <p className="text-muted text-xs mt-0.5">{description}</p>}
      </div>
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        {children}
      </div>
    </section>
  );
}

function Divider() {
  return <div className="border-t border-border" />;
}

function SubGroupLabel({ label }: { label: string }) {
  return (
    <div className="px-4 py-2 bg-input/40 border-b border-border">
      <span className="text-muted text-xs font-medium uppercase tracking-wide">{label}</span>
    </div>
  );
}

const KALMAN_TOOLTIPS = {
  observationCovariance:
    "Controls sensitivity to market noise. Higher values treat daily price fluctuations as random noise, resulting in a smoother, lag-prone trend line. Lower values track raw prices tightly, increasing responsiveness but adding market noise.",
  transitionCovariance:
    "Controls how fast the underlying trend can change. Higher values assume the market regime or trend shifts rapidly, allowing the filter to catch trend reversals quickly. Lower values assume a stable structural trend, producing a rigid baseline.",
  mode:
    "'Live Tracking' utilizes only data up to day T to eliminate look-ahead bias, making it mandatory for backtesting and trading signals. 'Historical View' uses the entire dataset to build a perfectly smoothed history, ideal for retroactive macro research but unusable for live execution.",
};

interface AppSettingsDraft {
  observationCovariance: string;
  transitionCovariance: string;
  mode: KalmanProcessingMode;
  enableKalmanFilter: boolean;
  enableElliottWave: boolean;
  enableMarkovRegime: boolean;
}

function toDraft(settings: AppSettings): AppSettingsDraft {
  return {
    observationCovariance: String(settings.observationCovariance),
    transitionCovariance: String(settings.transitionCovariance),
    mode: settings.mode,
    enableKalmanFilter: settings.enableKalmanFilter,
    enableElliottWave: settings.enableElliottWave,
    enableMarkovRegime: settings.enableMarkovRegime,
  };
}

function ModuleToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex items-center justify-between gap-4 rounded-md border border-input-border bg-input/40 px-3 py-2 ${disabled ? "opacity-60" : ""}`}>
      <span className="text-xs text-fg-secondary">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-blue-600"
      />
    </label>
  );
}

function StrategySettingsPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { data: persistedSettings = APP_SETTINGS_DEFAULTS, isLoading } = useQuery({
    queryKey: ["app-settings"],
    queryFn: getAppSettings,
    retry: false,
  });
  const [draft, setDraft] = useState<AppSettingsDraft | null>(null);
  const [openInfo, setOpenInfo] = useState<keyof typeof KALMAN_TOOLTIPS | null>(null);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const values = draft ?? toDraft(persistedSettings);

  function currentSettings(): AppSettings {
    return {
      observationCovariance: Number(values.observationCovariance),
      transitionCovariance: Number(values.transitionCovariance),
      mode: values.mode,
      enableKalmanFilter: values.enableKalmanFilter,
      enableElliottWave: values.enableElliottWave,
      enableMarkovRegime: values.enableMarkovRegime,
    };
  }

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      setDraft(toDraft(settings));
      setStatus("success");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      queryClient.invalidateQueries({ queryKey: ["ticker-kalman"] });
      queryClient.invalidateQueries({ queryKey: ["ticker-regime"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-regime"] });
      queryClient.invalidateQueries({ queryKey: ["ticker-wave"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-wave"] });
      queryClient.invalidateQueries({ queryKey: ["wave-analyze"] });
    },
    onError: (err: Error) => {
      setStatus("error");
      setError(err.message);
    },
  });

  function handleSave() {
    const settings = currentSettings();
    const validationError = validateAppSettings(settings);
    if (validationError) {
      setStatus("error");
      setError(validationError);
      return;
    }

    mutation.mutate(settings);
  }

  function resetDefaults() {
    setDraft(toDraft(APP_SETTINGS_DEFAULTS));
    if (isAdmin) mutation.mutate(APP_SETTINGS_DEFAULTS);
  }

  const inputClass = "bg-input border border-input-border rounded-sm px-3 py-1.5 text-sm text-fg w-full sm:max-w-xs focus:outline-hidden focus:border-blue-500";
  const disabled = !isAdmin || isLoading || mutation.isPending;

  return (
    <SectionCard
      title="Strategy Configuration"
      description="Controls analytical module visibility and Kalman trend/noise defaults."
    >
      <div className="px-4 py-4 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
          <InfoPopover
            label="Observation Covariance (R)"
            tooltip={KALMAN_TOOLTIPS.observationCovariance}
            open={openInfo === "observationCovariance"}
            onToggle={() => setOpenInfo(openInfo === "observationCovariance" ? null : "observationCovariance")}
          />
          <div className="flex-1">
            <input
              type="number"
              min={APP_SETTINGS_RANGES.observationCovariance.min}
              max={APP_SETTINGS_RANGES.observationCovariance.max}
              step="0.0001"
              value={values.observationCovariance}
              onChange={(e) => {
                setDraft({ ...values, observationCovariance: e.target.value });
                setStatus("idle");
              }}
              disabled={disabled}
              className={inputClass}
            />
            <p className="mt-1 text-[10px] text-muted">Range: 0.0001 to 10.0. Default: 0.1.</p>
          </div>
        </div>

        <Divider />

        <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
          <InfoPopover
            label="Transition Covariance (Q)"
            tooltip={KALMAN_TOOLTIPS.transitionCovariance}
            open={openInfo === "transitionCovariance"}
            onToggle={() => setOpenInfo(openInfo === "transitionCovariance" ? null : "transitionCovariance")}
          />
          <div className="flex-1">
            <input
              type="number"
              min={APP_SETTINGS_RANGES.transitionCovariance.min}
              max={APP_SETTINGS_RANGES.transitionCovariance.max}
              step="0.0001"
              value={values.transitionCovariance}
              onChange={(e) => {
                setDraft({ ...values, transitionCovariance: e.target.value });
                setStatus("idle");
              }}
              disabled={disabled}
              className={inputClass}
            />
            <p className="mt-1 text-[10px] text-muted">Range: 0.0001 to 1.0. Default: 0.01.</p>
          </div>
        </div>

        <Divider />

        <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
          <InfoPopover
            label="Processing Mode"
            tooltip={KALMAN_TOOLTIPS.mode}
            open={openInfo === "mode"}
            onToggle={() => setOpenInfo(openInfo === "mode" ? null : "mode")}
          />
          <select
            value={values.mode}
            onChange={(e) => {
              setDraft({ ...values, mode: e.target.value as KalmanProcessingMode });
              setStatus("idle");
            }}
            disabled={disabled}
            className="bg-input border border-input-border rounded-sm px-3 py-1.5 text-sm text-fg w-full sm:max-w-xs focus:outline-hidden focus:border-blue-500"
          >
            <option value="causal">Live Tracking (Causal)</option>
            <option value="historical">Historical View (Smoothed)</option>
          </select>
        </div>

        <Divider />

        <div className="space-y-2">
          <div>
            <p className="text-muted text-xs font-medium uppercase tracking-wide">Strategy Modules</p>
            <p className="text-[10px] text-muted mt-0.5">
              Disable a module to hide its charts, badges, and confirmation cards across the app.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <ModuleToggle
              label="Enable Kalman Filter Module"
              checked={values.enableKalmanFilter}
              disabled={disabled}
              onChange={(checked) => {
                setDraft({ ...values, enableKalmanFilter: checked });
                setStatus("idle");
              }}
            />
            <ModuleToggle
              label="Enable Elliott Wave Module"
              checked={values.enableElliottWave}
              disabled={disabled}
              onChange={(checked) => {
                setDraft({ ...values, enableElliottWave: checked });
                setStatus("idle");
              }}
            />
            <ModuleToggle
              label="Enable Markov Regime Module"
              checked={values.enableMarkovRegime}
              disabled={disabled}
              onChange={(checked) => {
                setDraft({ ...values, enableMarkovRegime: checked });
                setStatus("idle");
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={disabled}
            className="bg-blue-600 hover:bg-blue-700 text-fg rounded-sm px-4 py-1.5 text-xs disabled:opacity-50"
          >
            {mutation.isPending ? "Saving..." : "Save Strategy Settings"}
          </button>
          <button
            onClick={resetDefaults}
            disabled={!isAdmin || mutation.isPending}
            className="text-xs text-muted hover:text-fg-secondary disabled:opacity-50"
          >
            Reset defaults
          </button>
          {!isAdmin && <span className="text-muted text-xs">Admin access required to modify.</span>}
          {isLoading && <span className="text-muted text-xs">Loading settings...</span>}
          {status === "success" && <span className="text-green-400 text-xs">Saved.</span>}
          {status === "error" && <span className="text-red-400 text-xs">{error}</span>}
        </div>
      </div>
    </SectionCard>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string })?.role === "admin";
  const currentUserId = (session?.user as { id?: string })?.id ?? "";
  const queryClient = useQueryClient();

  const { data: apiKeys = [] } = useQuery({
    queryKey: ["apiKeys"],
    queryFn: getApiKeys,
    enabled: isAdmin,
  });

  const { data: smtpStatus, isPending: smtpLoading, isError: smtpError } = useQuery({
    queryKey: ["smtpStatus"],
    queryFn: getSmtpStatus,
    enabled: isAdmin,
    retry: false,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: getUsers,
    enabled: isAdmin,
  });

  const localKey = (provider: string) => apiKeys.find((k) => k.provider === provider);
  const refetchKeys = () => queryClient.invalidateQueries({ queryKey: ["apiKeys"] });

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<"idle" | "success" | "error">("idle");
  const [inviteError, setInviteError] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });

  const { data: investorProfile, isLoading: profileLoading } = useQuery({
    queryKey: ["investorProfile"],
    queryFn: getInvestorProfile,
  });

  const HORIZON_LABELS: Record<string, string> = {
    lt_1y: "< 1 year", "1_3y": "1–3 years", "3_7y": "3–7 years",
    "7_15y": "7–15 years", gt_15y: "15+ years",
  };
  const RISK_LABELS: Record<number, string> = {
    1: "Very conservative", 2: "Conservative", 3: "Moderate", 4: "Aggressive", 5: "Very aggressive",
  };
  const STYLE_LABELS: Record<string, string> = {
    passive: "Passive", active: "Active", hybrid: "Hybrid",
  };

  const [profileName, setProfileName] = useState((session?.user as { name?: string })?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [preferredCurrency, setPreferredCurrency] = useState("USD");
  const [profileStatus, setProfileStatus] = useState<"idle" | "success" | "error">("idle");
  const [profileError, setProfileError] = useState("");

  // Sync preferred_currency from server once loaded
  useEffect(() => {
    if (me?.preferred_currency) setPreferredCurrency(me.preferred_currency);
  }, [me?.preferred_currency]);

  const profileMutation = useMutation({
    mutationFn: () => updateProfile({
      ...(profileName.trim() ? { name: profileName.trim() } : {}),
      ...(currentPassword && newPassword ? { current_password: currentPassword, new_password: newPassword } : {}),
      preferred_currency: preferredCurrency,
    }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setProfileStatus("success");
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-current"] });
    },
    onError: (err: Error) => {
      setProfileStatus("error");
      setProfileError(err.message);
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () => inviteUser(inviteEmail),
    onSuccess: (data) => {
      setInviteEmail("");
      setInviteStatus("success");
      setInviteUrl(data.invite_url);
    },
    onError: (err: Error) => {
      setInviteStatus("error");
      setInviteError(err.message);
      setInviteUrl(null);
    },
  });

  // Database backup / restore
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [restoreElapsed, setRestoreElapsed] = useState(0);

  const restoreMutation = useMutation({
    mutationFn: () => restoreDbBackup(restoreFile!),
    onSuccess: () => {
      setRestoreModalOpen(false);
      setRestoreFile(null);
      setRestoreConfirmText("");
    },
  });

  // Tick elapsed seconds while restore is in progress
  useEffect(() => {
    if (!restoreMutation.isPending) { setRestoreElapsed(0); return; }
    setRestoreElapsed(0);
    const id = setInterval(() => setRestoreElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [restoreMutation.isPending]);

  async function handleDownloadBackup() {
    setBackupLoading(true);
    setBackupError("");
    try {
      const blob = await downloadDbBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `agentfloor-backup-${new Date().toISOString().slice(0, 10)}.dump`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setBackupError((err as Error).message);
    } finally {
      setBackupLoading(false);
    }
  }

  return (
    <>
    <PageShell width="settings" gap="8">

        {/* Profile */}
        <SectionCard title="My Profile" description="Your display name and login credentials.">
          <div className="px-4 py-4 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-muted text-xs sm:w-32 shrink-0">Display Name</label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => { setProfileName(e.target.value); setProfileStatus("idle"); }}
                className="bg-input border border-input-border rounded-sm px-3 py-1.5 text-sm text-fg w-full sm:max-w-xs focus:outline-hidden focus:border-blue-500"
              />
            </div>
            <Divider />
            <div className="flex flex-col gap-2">
              <span className="text-muted text-xs">Change Password</span>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <label className="text-muted text-xs sm:w-32 shrink-0">Current</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => { setCurrentPassword(e.target.value); setProfileStatus("idle"); }}
                  placeholder="Current password"
                  className="bg-input border border-input-border rounded-sm px-3 py-1.5 text-sm text-fg w-full sm:max-w-xs focus:outline-hidden focus:border-blue-500"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <label className="text-muted text-xs sm:w-32 shrink-0">New</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setProfileStatus("idle"); }}
                  placeholder="New password"
                  className="bg-input border border-input-border rounded-sm px-3 py-1.5 text-sm text-fg w-full sm:max-w-xs focus:outline-hidden focus:border-blue-500"
                />
              </div>
            </div>
            <Divider />
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-muted text-xs sm:w-32 shrink-0">Display Currency</label>
              <select
                value={preferredCurrency}
                onChange={(e) => { setPreferredCurrency(e.target.value); setProfileStatus("idle"); }}
                className="bg-input border border-input-border rounded-sm px-3 py-1.5 text-sm text-fg w-32 focus:outline-hidden focus:border-blue-500"
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => profileMutation.mutate()}
                disabled={profileMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-fg rounded-sm px-4 py-1.5 text-xs disabled:opacity-50"
              >
                {profileMutation.isPending ? "Saving…" : "Save Changes"}
              </button>
              {profileStatus === "success" && <span className="text-green-400 text-xs">Saved.</span>}
              {profileStatus === "error" && <span className="text-red-400 text-xs">{profileError}</span>}
            </div>
          </div>
        </SectionCard>

        {/* Investor DNA */}
        <SectionCard title="Investor DNA" description="Personalize AI insights with your investment context.">
          <div className="px-4 py-4">
            {profileLoading ? (
              <div className="h-8 bg-input rounded-sm animate-pulse w-48" />
            ) : investorProfile ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-6 text-sm">
                  {investorProfile.time_horizon && (
                    <div>
                      <span className="text-muted text-xs">Horizon</span>
                      <p className="text-fg">{HORIZON_LABELS[investorProfile.time_horizon] ?? investorProfile.time_horizon}</p>
                    </div>
                  )}
                  {investorProfile.risk_willingness && (
                    <div>
                      <span className="text-muted text-xs">Risk</span>
                      <p className="text-fg">{RISK_LABELS[investorProfile.risk_willingness] ?? investorProfile.risk_willingness}</p>
                    </div>
                  )}
                  {investorProfile.investment_style && (
                    <div>
                      <span className="text-muted text-xs">Style</span>
                      <p className="text-fg">{STYLE_LABELS[investorProfile.investment_style] ?? investorProfile.investment_style}</p>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <span className="text-xs text-green-400 font-medium">● DNA active</span>
                  <a href="/settings/investor-profile" className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/30 rounded-sm px-2 py-1">Edit</a>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-muted text-sm">Personalize your AI insights by sharing your investment context.</p>
                <a href="/settings/investor-profile" className="text-xs text-purple-400 hover:text-purple-300 border border-purple-500/30 rounded-sm px-3 py-1.5">Set up →</a>
              </div>
            )}
          </div>
        </SectionCard>

        <StrategySettingsPanel isAdmin={isAdmin} />

        {/* LLM Providers */}
        {isAdmin && (
          <SectionCard title="LLM Providers" description="API keys and server URLs used when running analyses.">
            <SubGroupLabel label="Cloud APIs" />
            {CLOUD_PROVIDERS.map(({ provider, label, placeholder, docsUrl }, i) => (
              <div key={provider}>
                {i > 0 && <Divider />}
                <ApiKeyRow
                  provider={provider}
                  label={label}
                  placeholder={placeholder}
                  docsUrl={docsUrl}
                  isSet={apiKeys.find((k) => k.provider === provider)?.is_valid ?? false}
                  onSaved={refetchKeys}
                />
              </div>
            ))}
            <SubGroupLabel label="Local Servers" />
            {LOCAL_PROVIDERS.map(({ provider, label }, i) => (
              <div key={provider}>
                {i > 0 && <Divider />}
                <ServerUrlRow
                  provider={provider}
                  label={label}
                  isValid={localKey(provider)?.is_valid ?? false}
                  onSaved={refetchKeys}
                />
              </div>
            ))}
          </SectionCard>
        )}

        {/* Data Providers */}
        {isAdmin && (
          <SectionCard
            title="Data Providers"
            description="Third-party data sources used for portfolio prices and outcome tracking."
          >
            <ApiKeyRow
              provider="finnhub"
              label="Finnhub"
              description="Live portfolio prices, fundamentals, news, and outcome tracking"
              placeholder="Your Finnhub API key"
              docsUrl="https://finnhub.io/dashboard"
              isSet={apiKeys.find((k) => k.provider === "finnhub")?.is_valid ?? false}
              capabilities={apiKeys.find((k) => k.provider === "finnhub")?.capabilities}
              capabilityWarning={apiKeys.find((k) => k.provider === "finnhub")?.last_error_message ?? null}
              onSaved={refetchKeys}
            />
          </SectionCard>
        )}

        {/* Email Notifications */}
        {isAdmin && (
          <SectionCard
            title="Email Notifications"
            description="Notifies users when their analysis runs complete."
          >
            <div className="px-4 py-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="text-muted text-xs sm:w-32 shrink-0">Status</span>
                {smtpLoading ? (
                  <span className="text-muted text-xs">Checking…</span>
                ) : smtpError ? (
                  <span className="text-muted text-xs">Unavailable — restart the backend to load status</span>
                ) : smtpStatus?.configured ? (
                  <span className="text-green-400 text-xs">Configured ✓</span>
                ) : (
                  <span className="text-amber-400 text-xs">Not configured — emails are disabled</span>
                )}
              </div>
              {!smtpLoading && !smtpError && smtpStatus?.configured && smtpStatus.from_address && (
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <span className="text-muted text-xs sm:w-32 shrink-0">Sending from</span>
                  <span className="text-fg-secondary text-xs font-mono">{smtpStatus.from_address}</span>
                </div>
              )}
              {!smtpLoading && !smtpError && smtpStatus && !smtpStatus.configured && (
                <>
                  <Divider />
                  <div className="text-muted text-xs">
                    Set the following environment variables to enable email notifications:
                  </div>
                  <pre className="bg-input rounded-sm p-3 text-xs text-fg-secondary font-mono leading-relaxed overflow-x-auto">
{`SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@yourdomain.com`}
                  </pre>
                  <p className="text-muted text-xs">
                    For Gmail, use an{" "}
                    <a
                      href="https://myaccount.google.com/apppasswords"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      App Password
                    </a>{" "}
                    instead of your account password. Restart the backend after updating.
                  </p>
                </>
              )}
            </div>
          </SectionCard>
        )}

        {/* Team */}
        {isAdmin && (
          <SectionCard title="Team" description="Manage members and send invitations.">
            <div className="divide-y divide-border">
              {users.map((u) => (
                <TeamMemberRow
                  key={u.id}
                  user={u}
                  currentUserId={currentUserId}
                  onChanged={() => queryClient.invalidateQueries({ queryKey: ["users"] })}
                />
              ))}
              {users.length === 0 && (
                <p className="text-muted text-xs px-4 py-3">No team members found.</p>
              )}
            </div>
            <div className="border-t border-border px-4 py-3 flex items-center gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => { setInviteEmail(e.target.value); setInviteStatus("idle"); }}
                placeholder="member@example.com"
                className="bg-input border border-input-border rounded-sm px-2 py-1 text-xs text-fg w-full sm:max-w-xs focus:outline-hidden focus:border-blue-500"
              />
              <button
                onClick={() => { setInviteStatus("idle"); setInviteUrl(null); inviteMutation.mutate(); }}
                disabled={inviteMutation.isPending || !inviteEmail}
                className="bg-blue-600 hover:bg-blue-700 text-fg rounded-sm px-3 py-1 text-xs disabled:opacity-50"
              >
                {inviteMutation.isPending ? "Sending…" : "Invite Member"}
              </button>
              {inviteStatus === "success" && !inviteUrl && <span className="text-green-400 text-xs">Invite sent.</span>}
              {inviteStatus === "error" && <span className="text-red-400 text-xs">{inviteError}</span>}
            </div>
            {inviteUrl && (
              <div className="border-t border-border px-4 py-3 flex flex-col gap-1">
                <span className="text-muted text-xs">SMTP not configured — share this invite link directly:</span>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={inviteUrl}
                    className="bg-input border border-input-border rounded-sm px-2 py-1 text-xs text-fg-secondary font-mono flex-1 focus:outline-hidden"
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(inviteUrl)}
                    className="bg-muted-surface hover:bg-muted-surface text-fg-secondary rounded-sm px-3 py-1 text-xs shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* Database */}
        {isAdmin && (
          <SectionCard
            title="Database"
            description="Download a full backup or restore from a previously downloaded backup file."
          >
            <div className="px-4 py-4 flex flex-col gap-5">
              {/* Backup */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex-1">
                  <p className="text-fg-secondary text-xs font-medium mb-0.5">Download Backup</p>
                  <p className="text-muted text-xs">
                    Exports a compressed pg_dump file (.dump) of the full database.
                  </p>
                </div>
                <button
                  onClick={handleDownloadBackup}
                  disabled={backupLoading}
                  className="shrink-0 bg-muted-surface hover:bg-muted-surface text-fg rounded-sm px-4 py-1.5 text-xs disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                >
                  {backupLoading ? (
                    <>
                      <span className="inline-block w-3 h-3 border border-muted border-t-transparent rounded-full animate-spin" />
                      Exporting…
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                        <path d="M8.75 2.75a.75.75 0 0 0-1.5 0v5.69L5.03 6.22a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 8.44V2.75Z" />
                        <path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z" />
                      </svg>
                      Download Backup
                    </>
                  )}
                </button>
              </div>
              {backupError && <p className="text-red-400 text-xs -mt-3">{backupError}</p>}

              <Divider />

              {/* Restore */}
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <p className="text-fg-secondary text-xs font-medium mb-0.5">Restore from Backup</p>
                  <p className="text-muted text-xs">
                    Select a .dump file exported from this app. This will replace all current data.
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <label className="cursor-pointer bg-input border border-input-border rounded-sm px-3 py-1.5 text-xs text-fg-secondary hover:border-border-strong transition-colors">
                    {restoreFile ? restoreFile.name : "Choose file…"}
                    <input
                      type="file"
                      accept=".dump"
                      className="hidden"
                      onChange={(e) => { setRestoreFile(e.target.files?.[0] ?? null); }}
                    />
                  </label>
                  <button
                    onClick={() => setRestoreModalOpen(true)}
                    disabled={!restoreFile}
                    className="bg-red-700 hover:bg-red-600 text-fg rounded-sm px-3 py-1.5 text-xs disabled:opacity-40 transition-colors"
                  >
                    Restore…
                  </button>
                </div>
              </div>
            </div>
          </SectionCard>
        )}

      </PageShell>

      {/* Restore confirmation modal */}
      {restoreModalOpen && restoreFile && (() => {
        // Estimate restore time: ~5 MB/s effective rate for pg_restore
        const estimatedSecs = Math.max(10, Math.round(restoreFile.size / (5 * 1024 * 1024)));
        // Fake progress: grows fast then slows, caps at 95% until done
        const progress = restoreMutation.isSuccess
          ? 100
          : restoreMutation.isPending
            ? Math.min(95, Math.round(100 * (1 - Math.exp(-restoreElapsed / (estimatedSecs * 0.7)))))
            : 0;
        const remaining = Math.max(0, estimatedSecs - restoreElapsed);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
            <div className="bg-elevated border border-input-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-red-400 shrink-0">
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                </svg>
                <h2 className="text-base font-semibold text-fg">Restore Database</h2>
              </div>

              {restoreMutation.isPending ? (
                /* ── In-progress view ── */
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-fg-secondary">
                    <span className="inline-block w-4 h-4 border-2 border-muted border-t-white rounded-full animate-spin shrink-0" />
                    Restoring database…
                  </div>
                  {/* Progress bar */}
                  <div className="w-full bg-muted-surface rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full bg-red-500 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted">
                    <span>{restoreElapsed}s elapsed</span>
                    <span>
                      {remaining > 0
                        ? `~${remaining}s remaining`
                        : "finishing up…"}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {restoreElapsed < 3
                      ? "Uploading backup file…"
                      : restoreElapsed < 8
                        ? "Dropping existing tables…"
                        : "Importing data…"}
                  </p>
                </div>
              ) : (
                /* ── Confirmation view ── */
                <>
                  <p className="text-sm text-fg-secondary">
                    This will <span className="text-red-400 font-medium">replace all current data</span> with the contents of:
                  </p>
                  <p className="text-xs text-muted font-mono bg-input rounded-sm px-3 py-2">{restoreFile.name}</p>
                  <p className="text-xs text-muted">
                    All runs, portfolios, watchlists, API keys, and user data will be overwritten. This cannot be undone.
                  </p>
                  <div className="space-y-1">
                    <label className="text-xs text-muted">Type <span className="font-mono text-fg">RESTORE</span> to confirm</label>
                    <input
                      type="text"
                      value={restoreConfirmText}
                      onChange={(e) => setRestoreConfirmText(e.target.value)}
                      placeholder="RESTORE"
                      className="w-full bg-input border border-input-border rounded-sm px-3 py-1.5 text-sm text-fg focus:outline-hidden focus:border-red-500 font-mono"
                    />
                  </div>
                  <p className="text-xs text-muted">
                    Est. restore time: ~{estimatedSecs}s
                    {restoreFile.size > 0 && ` (${(restoreFile.size / (1024 * 1024)).toFixed(1)} MB)`}
                  </p>
                </>
              )}

              {restoreMutation.isError && (
                <p className="text-xs text-red-400">{(restoreMutation.error as Error).message}</p>
              )}
              {restoreMutation.isSuccess && (
                <p className="text-xs text-green-400">Restore completed successfully.</p>
              )}

              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => { setRestoreModalOpen(false); setRestoreConfirmText(""); restoreMutation.reset(); }}
                  disabled={restoreMutation.isPending}
                  className="px-3 py-1.5 text-sm text-muted hover:text-fg disabled:opacity-30"
                >
                  Cancel
                </button>
                {!restoreMutation.isPending && (
                  <button
                    onClick={() => restoreMutation.mutate()}
                    disabled={restoreConfirmText !== "RESTORE"}
                    className="px-4 py-1.5 text-sm bg-red-700 hover:bg-red-600 text-fg rounded-sm disabled:opacity-40 transition-colors"
                  >
                    Restore Database
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
