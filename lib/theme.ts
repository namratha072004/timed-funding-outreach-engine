export const PALETTES = ["aurora", "green", "slate", "indigo", "terra", "plum"] as const;
export const DEFAULT_PALETTE = "aurora";
export const paletteFrom = (v: string | undefined): string => (v && (PALETTES as readonly string[]).includes(v) ? v : DEFAULT_PALETTE);
export const themeFrom = (v: string | undefined): "dark" | "light" | undefined => (v === "dark" || v === "light" ? v : undefined);
