import type { Config } from "tailwindcss";

/**
 * PRSYS design system — "Warm Slate & Tangerine"
 * (see Frontend/warm_slate_tangerine/DESIGN.md)
 *
 * Token names match the Stitch mockups 1:1 so ports stay mechanical.
 * Legacy aliases (ink, surface.*, primary.dark, danger, ...) are mapped
 * onto the new palette so older classes keep working.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* ---- Warm Slate and Tangerine ---- */
        /* primary stays an object so legacy classes keep working */
        primary: {
          DEFAULT: "#a33900",
          dark: "#7f2b00",
          light: "#cc4900",
          container: "#ffdbce",
        },
        "on-primary": "#ffffff",
        "on-primary-container": "#fffbff",
        "primary-fixed": "#ffdbce",
        "primary-fixed-dim": "#ffb599",
        "on-primary-fixed": "#370e00",
        "on-primary-fixed-variant": "#7f2b00",
        secondary: "#904d00",
        "on-secondary": "#ffffff",
        "secondary-container": "#fe932c",
        "on-secondary-container": "#663500",
        "secondary-fixed": "#ffdcc3",
        "secondary-fixed-dim": "#ffb77d",
        "on-secondary-fixed": "#2f1500",
        "on-secondary-fixed-variant": "#6e3900",
        tertiary: "#3f661e",
        "on-tertiary": "#ffffff",
        "tertiary-container": "#578034",
        "on-tertiary-container": "#f9ffec",
        "tertiary-fixed": "#c2f198",
        "tertiary-fixed-dim": "#a6d47e",
        "on-tertiary-fixed": "#0c2000",
        "on-tertiary-fixed-variant": "#2b5008",
        error: "#ba1a1a",
        "on-error": "#ffffff",
        "error-container": "#ffdad6",
        "on-error-container": "#93000a",
        "inverse-primary": "#ffb599",
        /* surface stays an object for legacy classes */
        surface: {
          DEFAULT: "#f8f9ff",
          white: "#ffffff",
          border: "#dde3ef",
          muted: "#f1f3f5",
        },
        "surface-dim": "#d5dae6",
        "surface-bright": "#f8f9ff",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#eff4ff",
        "surface-container": "#e9eefb",
        "surface-container-high": "#e3e8f5",
        "surface-container-highest": "#dde3ef",
        "on-surface": "#161c25",
        "on-surface-variant": "#5a4138",
        "inverse-surface": "#2b313a",
        "inverse-on-surface": "#ebf1fd",
        outline: "#8e7166",
        "outline-variant": "#e2bfb2",
        "surface-tint": "#a73a00",
        "surface-variant": "#dde3ef",
        background: "#f8f9ff",
        "on-background": "#161c25",

        /* ---- Legacy aliases (old code keeps working) ---- */
        ink: {
          DEFAULT: "#161c25",
          soft: "#475569",
          faint: "#94a3b8",
        },
        success: "#4f772d",
        warning: "#d97706",
        danger: "#ba1a1a",
      },
      fontFamily: {
        sans: ["Hanken Grotesk", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
        /* font-family utilities used by the mockups: font-headline-md, font-label-sm ... */
        "headline-xl": ["Hanken Grotesk", "sans-serif"],
        "headline-lg": ["Hanken Grotesk", "sans-serif"],
        "headline-md": ["Hanken Grotesk", "sans-serif"],
        "headline-sm": ["Hanken Grotesk", "sans-serif"],
        "body-lg": ["Hanken Grotesk", "sans-serif"],
        "body-md": ["Hanken Grotesk", "sans-serif"],
        "body-sm": ["Hanken Grotesk", "sans-serif"],
        "label-lg": ["JetBrains Mono", "monospace"],
        "label-md": ["JetBrains Mono", "monospace"],
        "label-sm": ["JetBrains Mono", "monospace"],
      },
      fontSize: {
        "headline-xl": ["40px", "48px"],
        "headline-lg": ["32px", "40px"],
        "headline-md": ["22px", "28px"],
        "headline-sm": ["18px", "24px"],
        "body-lg": ["16px", "24px"],
        "body-md": ["14px", "20px"],
        "body-sm": ["12px", "16px"],
        "label-lg": ["13px", "18px"],
        "label-md": ["11px", "16px"],
        "label-sm": ["10px", "14px"],
      },
      spacing: {
        "space-xs": "0.25rem",
        "space-sm": "0.5rem",
        "space-md": "1rem",
        "space-lg": "1.5rem",
        "space-xl": "2.5rem",
        gutter: "1.25rem",
        "gutter-mobile": "0.75rem",
        margin: "2rem",
        "margin-mobile": "1rem",
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
        full: "9999px",
      },
      boxShadow: {
        tier1: "0 1px 3px rgba(30, 36, 45, 0.05), 0 1px 2px rgba(30, 36, 45, 0.03)",
        tier2: "0 8px 20px -4px rgba(30, 36, 45, 0.08), 0 4px 6px -2px rgba(30, 36, 45, 0.04)",
        tier3: "0 20px 32px -8px rgba(30, 36, 45, 0.16)",
        cta: "0 2px 8px rgba(163, 57, 0, 0.2)",
      },
    },
  },
  plugins: [],
};
export default config;
