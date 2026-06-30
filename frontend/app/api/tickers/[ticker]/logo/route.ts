import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await context.params;
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const accessToken = token?.accessToken;
  if (!accessToken || typeof accessToken !== "string") {
    return new NextResponse(null, { status: 401 });
  }

  const upstream = await fetch(
    `${API}/tickers/${encodeURIComponent(ticker)}/logo`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );

  if (!upstream.ok) {
    return new NextResponse(null, { status: upstream.status });
  }

  const body = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("content-type") ?? "image/png";
  const cacheControl =
    upstream.headers.get("cache-control") ?? "public, max-age=2592000, immutable";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    },
  });
}
