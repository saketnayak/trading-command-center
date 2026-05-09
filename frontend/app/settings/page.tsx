"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiKeys, getUsers, inviteUser, updateProfile, getSmtpStatus, getMe } from "@/lib/api";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { TopNav } from "@/components/layout/TopNav";
import { ApiKeyRow } from "@/components/settings/ApiKeyRow";
import { ServerUrlRow } from "@/components/settings/ServerUrlRow";
import { TeamMemberRow } from "@/components/settings/TeamMemberRow";

const CLOUD_PROVIDERS: { provider: string; label: string; placeholder: string; docsUrl: string }[] = [
  { provider: "openai",    label: "OpenAI",    placeholder: "sk-…",     docsUrl: "https://platform.openai.com/api-keys" },
  { provider: "anthropic", label: "Anthropic", placeholder: "sk-ant-…", docsUrl: "https://console.anthropic.com/settings/keys" },
  { provider: "google",    label: "Google",    placeholder: "AIza…",    docsUrl: "https://aistudio.google.com/app/apikey" },
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
        <h2 className="text-slate-100 text-base font-semibold">{title}</h2>
        {description && <p className="text-slate-500 text-xs mt-0.5">{description}</p>}
      </div>
      <div className="bg-navy-700 border border-slate-800 rounded-lg overflow-hidden">
        {children}
      </div>
    </section>
  );
}

function Divider() {
  return <div className="border-t border-slate-800" />;
}

function SubGroupLabel({ label }: { label: string }) {
  return (
    <div className="px-4 py-2 bg-slate-800/40 border-b border-slate-800">
      <span className="text-slate-400 text-xs font-medium uppercase tracking-wide">{label}</span>
    </div>
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

  return (
    <>
      <TopNav />
      <main className="p-6 max-w-3xl mx-auto flex flex-col gap-8">

        {/* Profile */}
        <SectionCard title="My Profile" description="Your display name and login credentials.">
          <div className="px-4 py-4 flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <label className="text-slate-400 text-xs w-32 shrink-0">Display Name</label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => { setProfileName(e.target.value); setProfileStatus("idle"); }}
                className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 w-64 focus:outline-none focus:border-blue-500"
              />
            </div>
            <Divider />
            <div className="flex flex-col gap-2">
              <span className="text-slate-400 text-xs">Change Password</span>
              <div className="flex items-center gap-3">
                <label className="text-slate-500 text-xs w-32 shrink-0">Current</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => { setCurrentPassword(e.target.value); setProfileStatus("idle"); }}
                  placeholder="Current password"
                  className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 w-64 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-slate-500 text-xs w-32 shrink-0">New</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setProfileStatus("idle"); }}
                  placeholder="New password"
                  className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 w-64 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <Divider />
            <div className="flex items-center gap-4">
              <label className="text-slate-400 text-xs w-32 shrink-0">Display Currency</label>
              <select
                value={preferredCurrency}
                onChange={(e) => { setPreferredCurrency(e.target.value); setProfileStatus("idle"); }}
                className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 w-32 focus:outline-none focus:border-blue-500"
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
                className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-1.5 text-xs disabled:opacity-50"
              >
                {profileMutation.isPending ? "Saving…" : "Save Changes"}
              </button>
              {profileStatus === "success" && <span className="text-green-400 text-xs">Saved.</span>}
              {profileStatus === "error" && <span className="text-red-400 text-xs">{profileError}</span>}
            </div>
          </div>
        </SectionCard>

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
              description="Live portfolio prices + outcome tracking (+7/14/30/90d)"
              placeholder="Your Finnhub API key"
              docsUrl="https://finnhub.io/dashboard"
              isSet={apiKeys.find((k) => k.provider === "finnhub")?.is_valid ?? false}
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
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-xs w-32 shrink-0">Status</span>
                {smtpLoading ? (
                  <span className="text-slate-500 text-xs">Checking…</span>
                ) : smtpError ? (
                  <span className="text-slate-500 text-xs">Unavailable — restart the backend to load status</span>
                ) : smtpStatus?.configured ? (
                  <span className="text-green-400 text-xs">Configured ✓</span>
                ) : (
                  <span className="text-amber-400 text-xs">Not configured — emails are disabled</span>
                )}
              </div>
              {!smtpLoading && !smtpError && smtpStatus?.configured && smtpStatus.from_address && (
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 text-xs w-32 shrink-0">Sending from</span>
                  <span className="text-slate-300 text-xs font-mono">{smtpStatus.from_address}</span>
                </div>
              )}
              {!smtpLoading && !smtpError && smtpStatus && !smtpStatus.configured && (
                <>
                  <Divider />
                  <div className="text-slate-400 text-xs">
                    Set the following environment variables to enable email notifications:
                  </div>
                  <pre className="bg-slate-800 rounded p-3 text-xs text-slate-300 font-mono leading-relaxed overflow-x-auto">
{`SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@yourdomain.com`}
                  </pre>
                  <p className="text-slate-500 text-xs">
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
            <div className="divide-y divide-slate-800">
              {users.map((u) => (
                <TeamMemberRow
                  key={u.id}
                  user={u}
                  currentUserId={currentUserId}
                  onChanged={() => queryClient.invalidateQueries({ queryKey: ["users"] })}
                />
              ))}
              {users.length === 0 && (
                <p className="text-slate-500 text-xs px-4 py-3">No team members found.</p>
              )}
            </div>
            <div className="border-t border-slate-800 px-4 py-3 flex items-center gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => { setInviteEmail(e.target.value); setInviteStatus("idle"); }}
                placeholder="member@example.com"
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 w-64 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => { setInviteStatus("idle"); setInviteUrl(null); inviteMutation.mutate(); }}
                disabled={inviteMutation.isPending || !inviteEmail}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1 text-xs disabled:opacity-50"
              >
                {inviteMutation.isPending ? "Sending…" : "Invite Member"}
              </button>
              {inviteStatus === "success" && !inviteUrl && <span className="text-green-400 text-xs">Invite sent.</span>}
              {inviteStatus === "error" && <span className="text-red-400 text-xs">{inviteError}</span>}
            </div>
            {inviteUrl && (
              <div className="border-t border-slate-800 px-4 py-3 flex flex-col gap-1">
                <span className="text-slate-400 text-xs">SMTP not configured — share this invite link directly:</span>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={inviteUrl}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 font-mono flex-1 focus:outline-none"
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(inviteUrl)}
                    className="bg-slate-700 hover:bg-slate-600 text-slate-300 rounded px-3 py-1 text-xs shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </SectionCard>
        )}

      </main>
    </>
  );
}
