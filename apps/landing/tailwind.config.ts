import type { Config } from "tailwindcss";

// The landing page is a static marketing site, not an app shell: it has no
// theme toggle and no shadcn components, so it does not carry the
// dashboard's CSS-variable token layer. The three brand colours are declared
// directly here instead, with the same values DESIGN.md gives the dashboard
// (background #FAFAF7, primary #1B2A41, accent #E0971F) so the three
// properties read as one product when a gym owner moves from
// gymosapps.com to app.gymosapps.com.
export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#1B2A41",
          soft: "#2C3E5C",
          deep: "#131F31",
        },
        accent: {
          DEFAULT: "#E0971F",
          soft: "#F3B847",
        },
        sand: "#FAFAF7",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        content: "72rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
