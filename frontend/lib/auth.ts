import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const API = process.env.INTERNAL_API_URL ?? "http://localhost:8000";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 24 * 60 * 60 }, // 24h — matches backend JWT TTL
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: { email: { type: "email" }, password: { type: "password" } },
      async authorize(credentials) {
        if (!credentials) return null;
        const r = await fetch(`${API}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: credentials.email, password: credentials.password }),
        });
        if (!r.ok) return null;
        const { access_token } = await r.json();
        const me = await fetch(`${API}/auth/me`, {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const user = await me.json();
        return { ...user, accessToken: access_token };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = (user as { accessToken?: string }).accessToken;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      (session as { accessToken?: string }).accessToken = token.accessToken as string;
      if (session.user) (session.user as { role?: string }).role = token.role as string;
      return session;
    },
  },
  pages: { signIn: "/login" },
};
