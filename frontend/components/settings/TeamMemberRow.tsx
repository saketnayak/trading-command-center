"use client";
import { useMutation } from "@tanstack/react-query";
import { updateUserRole, deleteUser } from "@/lib/api";
import type { User } from "@/lib/types";

interface TeamMemberRowProps {
  user: User;
  currentUserId: string;
  onChanged: () => void;
}

export function TeamMemberRow({ user, currentUserId, onChanged }: TeamMemberRowProps) {
  const isSelf = user.id === currentUserId;

  const roleMutation = useMutation({
    mutationFn: () => updateUserRole(user.id, user.role === "admin" ? "member" : "admin"),
    onSuccess: onChanged,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteUser(user.id),
    onSuccess: onChanged,
  });

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-slate-200 text-sm truncate">{user.name}</p>
        <p className="text-slate-500 text-xs truncate">{user.email}</p>
      </div>
      <span
        className={`text-xs px-2 py-0.5 rounded ${
          user.role === "admin" ? "bg-blue-900 text-blue-300" : "bg-slate-700 text-slate-300"
        }`}
      >
        {user.role}
      </span>
      {!isSelf && (
        <>
          <button
            onClick={() => roleMutation.mutate()}
            disabled={roleMutation.isPending}
            className="text-slate-400 hover:text-slate-300 text-xs disabled:opacity-50"
          >
            {user.role === "admin" ? "Make Member" : "Make Admin"}
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
          >
            Remove
          </button>
        </>
      )}
    </div>
  );
}
