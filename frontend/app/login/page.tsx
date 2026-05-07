"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
    <div className="min-h-screen flex items-center justify-center bg-navy-900">
      <div className="w-80 bg-navy-700 border border-slate-800 rounded-lg p-8">
        <div className="text-blue-400 font-bold text-lg tracking-widest mb-6 text-center">⬡ AgentFloor</div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-slate-400 text-xs uppercase tracking-wide block mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="text-slate-400 text-xs uppercase tracking-wide block mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500" />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm font-medium">
            Sign In
          </button>
        </form>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex-1 h-px bg-slate-700" />
          <span className="text-slate-600 text-xs">or</span>
          <div className="flex-1 h-px bg-slate-700" />
        </div>
        <button onClick={() => signIn("google", { callbackUrl: "/runs" })}
          className="mt-4 w-full bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-300 rounded px-4 py-2 text-sm">
          Continue with Google
        </button>
        <p className="mt-6 text-center text-xs text-slate-500">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-blue-400 hover:text-blue-300">Register</Link>
        </p>
      </div>
    </div>
  );
}
