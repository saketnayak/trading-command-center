"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiKeys, getUsers, inviteUser, updateProfile } from "@/lib/api";
import { TopNav } from "@/components/layout/TopNav";
import { ApiKeyRow } from "@/components/settings/ApiKeyRow";
import { ServerUrlRow } from "@/components/settings/ServerUrlRow";
import { TeamMemberRow } from "@/components/settings/TeamMemberRow";

const LOCAL_PROVIDERS = ["ollama", "vllm"];
const LOCAL_LABELS: Record<string, string> = { ollama: "Ollama Server", vllm: "vLLM Server" };
const CLOUD_PROVIDERS = ["openai", "anthropic", "google"];

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

  const [profileName, setProfileName] = useState((session?.user as { name?: string })?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [profileStatus, setProfileStatus] = useState<"idle" | "success" | "error">("idle");
  const [profileError, setProfileError] = useState("");

  const profileMutation = useMutation({
    mutationFn: () => updateProfile({
      ...(profileName.trim() ? { name: profileName.trim() } : {}),
      ...(currentPassword && newPassword ? { current_password: currentPassword, new_password: newPassword } : {}),
    }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setProfileStatus("success");
    },
    onError: (err: Error) => {
      setProfileStatus("error");
      setProfileError(err.message);
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () => inviteUser(inviteEmail),
    onSuccess: () => {
      setInviteEmail("");
      setInviteStatus("success");
    },
    onError: (err: Error) => {
      setInviteStatus("error");
      setInviteError(err.message);
    },
  });

  return (
    <>
      <TopNav />
      <main className="p-6 max-w-3xl mx-auto flex flex-col gap-8">
        <section>
          <h2 className="text-slate-200 text-sm font-semibold mb-3">My Profile</h2>
          <div className="bg-navy-700 border border-slate-800 rounded-lg p-4 flex flex-col gap-3">
            <div>
              <label className="block text-slate-400 text-xs mb-1">Display Name</label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => { setProfileName(e.target.value); setProfileStatus("idle"); }}
                className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 w-72 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1">Change Password</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => { setCurrentPassword(e.target.value); setProfileStatus("idle"); }}
                  placeholder="Current password"
                  className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 w-44 focus:outline-none focus:border-blue-500"
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setProfileStatus("idle"); }}
                  placeholder="New password"
                  className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 w-44 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => profileMutation.mutate()}
                disabled={profileMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1 text-xs disabled:opacity-50"
              >
                {profileMutation.isPending ? "Saving…" : "Save Changes"}
              </button>
              {profileStatus === "success" && <span className="text-green-400 text-xs">Saved.</span>}
              {profileStatus === "error" && <span className="text-red-400 text-xs">{profileError}</span>}
            </div>
          </div>
        </section>

        {isAdmin && (
        <section>
          <h2 className="text-slate-200 text-sm font-semibold mb-3">API Keys</h2>
          <div className="bg-navy-700 border border-slate-800 rounded-lg divide-y divide-slate-800">
            {CLOUD_PROVIDERS.map((provider) => {
              const existing = apiKeys.find((k) => k.provider === provider);
              return (
                <ApiKeyRow
                  key={provider}
                  provider={provider}
                  isSet={existing?.is_valid ?? false}
                  onSaved={refetchKeys}
                />
              );
            })}
          </div>
        </section>
        )}

        {isAdmin && (
        <section>
          <h2 className="text-slate-200 text-sm font-semibold mb-3">Local Inference Servers</h2>
          <div className="bg-navy-700 border border-slate-800 rounded-lg divide-y divide-slate-800">
            {LOCAL_PROVIDERS.map((provider) => (
              <ServerUrlRow
                key={provider}
                provider={provider as "ollama" | "vllm"}
                label={LOCAL_LABELS[provider]}
                isValid={localKey(provider)?.is_valid ?? false}
                onSaved={refetchKeys}
              />
            ))}
          </div>
        </section>
        )}

        {isAdmin && (
          <section>
            <h2 className="text-slate-200 text-sm font-semibold mb-3">Team</h2>
            <div className="bg-navy-700 border border-slate-800 rounded-lg divide-y divide-slate-800 mb-4">
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
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => {
                  setInviteEmail(e.target.value);
                  setInviteStatus("idle");
                }}
                placeholder="member@example.com"
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 w-64 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => inviteMutation.mutate()}
                disabled={inviteMutation.isPending || !inviteEmail}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1 text-xs disabled:opacity-50"
              >
                {inviteMutation.isPending ? "Sending…" : "Invite Member"}
              </button>
              {inviteStatus === "success" && (
                <span className="text-green-400 text-xs">Invite sent.</span>
              )}
              {inviteStatus === "error" && (
                <span className="text-red-400 text-xs">{inviteError}</span>
              )}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
