import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: "#0a0b0d",
          900: "#111317",
          850: "#16191e",
          800: "#1c2026",
          700: "#272c34",
          600: "#353b45",
          500: "#4a515d",
          400: "#6b7380",
          300: "#9aa1ad",
          200: "#c6cbd3",
          100: "#e6e8ec",
        },
        fault: { DEFAULT: "#ff8a1f", dim: "#ff8a1f26" },
        recover: { DEFAULT: "#35d07f", dim: "#35d07f22" },
        danger: { DEFAULT: "#ff4d5e", dim: "#ff4d5e22" },
        unknown: { DEFAULT: "#e7c14b", dim: "#e7c14b22" },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      keyframes: {
        rise: { "0%": { opacity: "0", transform: "translateY(4px)" }, "100%": { opacity: "1", transform: "none" } },
      },
      animation: { rise: "rise 260ms ease-out both" },
    },
  },
  plugins: [],
} satisfies Config;
