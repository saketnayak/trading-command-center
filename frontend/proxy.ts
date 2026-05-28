import type { NextFetchEvent } from "next/server";
import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";

export function proxy(request: NextRequestWithAuth, event: NextFetchEvent) {
  return withAuth(request, event);
}

export const config = {
  matcher: ["/((?!login|register|api/auth|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
