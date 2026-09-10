import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // PRSYS design system (Material-ish, neutral-first)
        primary: {
          DEFAULT: "#2563eb",
          dark: "#004ac6",
          light: "#3b82f6",
          container: "#dbe4ff",
        },
        surface: {
          DEFAULT: "#f8f9fb",
          white: "#ffffff",
          border: "#e2e8f0",
          muted: "#f1f5f9",
        },
        ink: {
          DEFAULT: "#1e293b",
          soft: "#475569",
          faint: "#94a3b8",
        },
        success: "#16a34a",
        warning: "#d97706",
        danger: "#dc2626",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "0.5rem",
      },
    },
  },
  plugins: [],
};
export default config;
