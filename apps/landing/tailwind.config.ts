import type { Config } from "tailwindcss";

// Palette adapted from the gym.smartsana.com reference: its dark navy
// surface ramp is kept verbatim, and its green/cyan accent is replaced
// throughout by the GymOS orange (#E0971F, DESIGN.md's --accent). The
// reference's blues and the GymOS brand navy (#1B2A41) are close relatives,
// so the two properties still read as one product when a gym owner moves
// from gymosapps.com to owner.gymosapps.com.
export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#05080f",
        bg2: "#070c16",
        surface: "#0a121f",
        card: "#0d1729",
        card2: "#101d33",
        ink: "#1B2A41",
        line: "rgba(148, 163, 184, 0.14)",
        "line-soft": "rgba(148, 163, 184, 0.08)",
        body: "#eef3fa",
        muted: "#9aa8bc",
        faint: "#6b7a90",
        accent: {
          DEFAULT: "#E0971F",
          soft: "#F3B847",
        },
      },
      fontFamily: {
        display: ["var(--font-sora)", "system-ui", "sans-serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        content: "76rem",
      },
      borderRadius: {
        xl2: "18px",
      },
      boxShadow: {
        card: "0 18px 50px rgba(0, 0, 0, 0.45)",
        glow: "0 0 0 1px rgba(224,151,31,.25), 0 10px 40px rgba(224,151,31,.16)",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(.22, .8, .26, .99)",
      },
      keyframes: {
        // The three motions carried over from the reference's hero.
        scan: {
          "0%, 100%": { top: "14px" },
          "50%": { top: "calc(100% - 17px)" },
        },
        floaty: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-13px)" },
        },
        pulse: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(224,151,31,.5)" },
          "50%": { boxShadow: "0 0 0 7px rgba(224,151,31,0)" },
        },
      },
      animation: {
        scan: "scan 2.6s cubic-bezier(.22,.8,.26,.99) infinite",
        floaty: "floaty 6s ease-in-out infinite",
        "pulse-dot": "pulse 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
