import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        gold: {
          primary: "#B5A66B",
          accent: "#DAAF35",
          bright: "#E8B833",
        },
        workshop: {
          DEFAULT: "#1A1A1A",
          dark: "#0F0F0F",
        },
        surface: {
          light: "#FAF7F0",
          dark: "#2A2018",
        },
        status: {
          available: "#4A7C59",
          out: "#C97D3F",
          overdue: "#B85042",
        },
        tier: {
          howdy: "#E5D5A0",
          friend: "#B5A66B",
          family: "#DAAF35",
        },
      },
      fontFamily: {
        heading: ['"Permanent Marker"', "cursive"],
        body: ['"Inter Variable"', "Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', "monospace"],
      },
      backgroundImage: {
        "wood-grain-light": "url('/src/assets/wood-grain.svg')",
        "wood-grain-dark": "url('/src/assets/wood-grain-dark.svg')",
        "pegboard-dots": "url('/src/assets/pegboard-dots.svg')",
      },
    },
  },
  plugins: [],
};

export default config;
