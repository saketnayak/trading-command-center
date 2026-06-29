"use client";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { AuthCard } from "@/components/layout/AuthCard";
import { BTN_PRIMARY_CLASS, FIELD_INPUT_CLASS, FIELD_LABEL_CLASS } from "@/lib/uiClasses";

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
    <AuthCard
      subtitle={<p className="text-muted text-xs text-center mb-6">Create your account</p>}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {([["Name", "text", name, setName], ["Email", "email", email, setEmail], ["Password", "password", password, setPassword]] as [string, string, string, (v: string) => void][]).map(([label, type, value, setter]) => (
          <div key={label}>
            <label className={FIELD_LABEL_CLASS}>{label}</label>
            <input type={type} value={value} onChange={e => setter(e.target.value)} required
              className={FIELD_INPUT_CLASS} />
          </div>
        ))}
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button type="submit" className={BTN_PRIMARY_CLASS}>Create Account</button>
      </form>
    </AuthCard>
  );
}

export default function RegisterPage() {
  return <Suspense><RegisterForm /></Suspense>;
}
