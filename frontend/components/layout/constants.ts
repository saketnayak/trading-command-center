/** Mobile drawer offset — matches TopNav rendered height. */
export const TOP_NAV_OFFSET_PX = 49;

/** Full-height chart pages subtract this from the viewport. */
export const TOP_NAV_HEIGHT_REM = "3.5rem";

/** Sticky in-page panels (settings sidebar, run summary) sit below TopNav + page top padding. */
export const STICKY_PANEL_TOP_CLASS = "top-[calc(3.5rem+1.5rem)]";

/** Cap sticky panel height so long nav lists scroll inside the panel. */
export const STICKY_PANEL_MAX_HEIGHT_CLASS = "max-h-[calc(100vh-5rem)]";

/**
 * Responsive horizontal gutters — shared by TopNav, PageShell, and custom full-bleed pages.
 * Uses full viewport width; padding tightens on phones and relaxes from tablet up.
 */
export const APP_PAGE_PADDING_X_CLASS = "px-4 sm:px-6";

/** Full-width app column (no max-width cap). */
export const APP_CONTENT_CONTAINER_CLASS = "w-full min-w-0";
