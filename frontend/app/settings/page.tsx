"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiKeys, getUsers, inviteUser } from "@/lib/api";
import { TopNav } from "@/components/layout/TopNav";
import { ApiKeyRow } from "@/components/settings/ApiKeyRow";
import { TeamMemberRow } from "@/components/settings/TeamMemberRow";

export default function SettingsPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string })?.role === "admin";
  const currentUserId = (session?.user as { id?: string })?.id ?? "";
  const queryClient = useQueryClient();

  const { data: apiKeys = [] } = useQuery({
    queryKey: ["apiKeys"],
    queryFn: getApiKeys,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: getUsers,
    enabled: isAdmin,
  });

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<"idle" | "success" | "error">("idle");
  const [inviteError, setInviteError] = useState("");

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
          <h2 className="text-slate-200 text-sm font-semibold mb-3">API Keys</h2>
          <div className="bg-navy-700 border border-slate-800 rounded-lg divide-y divide-slate-800">
            {apiKeys.map((k) => (
              <ApiKeyRow
                key={k.provider}
                provider={k.provider}
                isSet={k.is_valid}
                onSaved={() => queryClient.invalidateQueries({ queryKey: ["apiKeys"] })}
              />
            ))}
            {apiKeys.length === 0 && (
              <p className="text-slate-500 text-xs px-4 py-3">No API keys configured.</p>
            )}
          </div>
        </section>

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
