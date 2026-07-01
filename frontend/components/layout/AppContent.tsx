import type { ReactNode } from "react";
import { APP_CONTENT_CONTAINER_CLASS } from "./constants";

type AppContentProps = {
  children: ReactNode;
};

/** Full-width main column for authenticated routes. */
export function AppContent({ children }: AppContentProps) {
  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-x-clip ${APP_CONTENT_CONTAINER_CLASS}`}>
      {children}
    </div>
  );
}
