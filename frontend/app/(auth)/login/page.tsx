"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthCard } from "@/components/layout/AuthCard";
import { BTN_PRIMARY_CLASS, FIELD_INPUT_CLASS, FIELD_LABEL_CLASS } from "@/lib/uiClasses";

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
    <AuthCard>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className={FIELD_LABEL_CLASS}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            className={FIELD_INPUT_CLASS} />
        </div>
        <div>
          <label className={FIELD_LABEL_CLASS}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            className={FIELD_INPUT_CLASS} />
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button type="submit" className={BTN_PRIMARY_CLASS}>
          Sign In
        </button>
      </form>
      <p className="mt-6 text-center text-xs text-muted">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="text-blue-400 hover:text-blue-300">Register</Link>
      </p>
    </AuthCard>
  );
}
