"use client";
import { useState, Suspense } from "react";
import { Logo } from "@/components/layout/Logo";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function RegisterForm() {
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const inviteToken = params.get("token");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, invite_token: inviteToken }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setError(body.detail ?? "Registration failed.");
      return;
    }
    await signIn("credentials", { email, password, callbackUrl: "/runs" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-page">
      <div className="w-full max-w-sm mx-4 bg-surface border border-border rounded-lg p-8">
        <div className="flex justify-center mb-4">
          <Logo height={44} />
        </div>
        <p className="text-muted text-xs text-center mb-6">Create your account</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {([["Name", "text", name, setName], ["Email", "email", email, setEmail], ["Password", "password", password, setPassword]] as [string, string, string, (v: string) => void][]).map(([label, type, value, setter]) => (
            <div key={label}>
              <label className="text-muted text-xs uppercase tracking-wide block mb-1">{label}</label>
              <input type={type} value={value} onChange={e => setter(e.target.value)} required
                className="w-full bg-input border border-input-border rounded-sm px-3 py-2 text-sm text-fg focus:outline-hidden focus:border-blue-500" />
            </div>
          ))}
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-fg rounded-sm px-4 py-2 text-sm font-medium">Create Account</button>
        </form>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return <Suspense><RegisterForm /></Suspense>;
}
