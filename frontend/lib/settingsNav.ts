export type SettingsNavItem = {
  id: string;
  label: string;
  adminOnly?: boolean;
};

export const SETTINGS_SECTIONS: SettingsNavItem[] = [
  { id: "profile", label: "Profile" },
  { id: "investor-dna", label: "Investor DNA" },
  { id: "strategy", label: "Strategy" },
  { id: "llm-providers", label: "LLM Providers", adminOnly: true },
  { id: "data-providers", label: "Data Providers", adminOnly: true },
  { id: "notifications", label: "Notifications", adminOnly: true },
  { id: "team", label: "Team", adminOnly: true },
  { id: "database", label: "Database", adminOnly: true },
];

export function visibleSettingsSections(isAdmin: boolean): SettingsNavItem[] {
  return SETTINGS_SECTIONS.filter((section) => !section.adminOnly || isAdmin);
}

/** Offset for sticky top nav when scrolling to hash anchors. */
export const SETTINGS_SECTION_SCROLL_MARGIN = "scroll-mt-24";
