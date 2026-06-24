import type { ReactNode } from "react";
import { APP_CONTENT_CONTAINER_CLASS } from "./constants";

type AppContentProps = {
  children: ReactNode;
};

/** Stable-width main column for authenticated routes. */
export function AppContent({ children }: AppContentProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col w-full overflow-x-hidden">
      <div className={`flex min-h-0 flex-1 flex-col ${APP_CONTENT_CONTAINER_CLASS}`}>
        {children}
      </div>
    </div>
  );
}
