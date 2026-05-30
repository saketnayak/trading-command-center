"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/layout/Logo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.error) setError("Invalid email or password");
    else router.push("/runs");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-page">
      <div className="w-full max-w-sm mx-4 bg-surface border border-border rounded-lg p-8">
        <div className="flex justify-center mb-6">
          <Logo height={44} />
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-muted text-xs uppercase tracking-wide block mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full bg-input border border-input-border rounded-sm px-3 py-2 text-sm text-fg focus:outline-hidden focus:border-blue-500" />
          </div>
          <div>
            <label className="text-muted text-xs uppercase tracking-wide block mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full bg-input border border-input-border rounded-sm px-3 py-2 text-sm text-fg focus:outline-hidden focus:border-blue-500" />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-fg rounded-sm px-4 py-2 text-sm font-medium">
            Sign In
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-muted">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-blue-400 hover:text-blue-300">Register</Link>
        </p>
      </div>
    </div>
  );
}
