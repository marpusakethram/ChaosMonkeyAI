import type { Config } from "tailwindcss";

// Tokens follow Meta's light commerce system: white canvas, pill controls, hairline-only depth.
// Semantic trio: inject (we did this on purpose), fail (it broke), pass (it held / recovered).
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#ffffff",
        cloud: "#f1f4f7",
        ink: {
          deep: "#0a1317",
          DEFAULT: "#1c1e21",
          charcoal: "#444950",
          steel: "#5d6c7b",
          stone: "#8595a4",
        },
        line: { DEFAULT: "#ced0d4", soft: "#dee3e9" },
        cobalt: { DEFAULT: "#0064e0", deep: "#0457cb", tint: "#e8f1fd" },
        inject: { DEFAULT: "#a121ce", tint: "#f7ecfb" },
        fail: { DEFAULT: "#e41e3f", text: "#c4122f", tint: "#fdecef" },
        pass: { DEFAULT: "#1f7a35", tint: "#e8f5eb" },
        attention: { DEFAULT: "#f2a918", tint: "#fef6e4" },
      },
      fontFamily: {
        sans: ['"Figtree Variable"', "Montserrat", "Helvetica", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        caption: ["12px", { lineHeight: "16px" }],
        "body-sm": ["14px", { lineHeight: "20px", letterSpacing: "-0.14px" }],
        body: ["16px", { lineHeight: "24px", letterSpacing: "-0.16px" }],
        subtitle: ["18px", { lineHeight: "26px" }],
        "heading-sm": ["24px", { lineHeight: "30px" }],
        "heading-md": ["28px", { lineHeight: "34px" }],
        "heading-lg": ["36px", { lineHeight: "46px" }],
        display: ["48px", { lineHeight: "56px" }],
      },
      borderRadius: { xl: "16px", "2xl": "24px", "3xl": "32px" },
      maxWidth: { page: "1280px" },
    },
  },
  plugins: [],
} satisfies Config;
