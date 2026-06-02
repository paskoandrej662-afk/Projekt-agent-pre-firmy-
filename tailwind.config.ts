import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand palette — warm amber accent over neutral slate, professional & calm.
        brand: {
          50: "#fff8ed",
          100: "#ffefce",
          200: "#ffdb9c",
          300: "#ffc05f",
          400: "#ff9f30",
          500: "#f97e07",
          600: "#dd5f02",
          700: "#b74506",
          800: "#94360c",
          900: "#792e0d",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
