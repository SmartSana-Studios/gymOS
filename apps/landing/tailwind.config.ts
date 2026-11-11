import type { Config } from "tailwindcss";

// Light ground for a gym owner on a phone in daylight, navy ink, one orange.
// The orange is `#E0971F` (DESIGN.md's --accent, shared with the dashboard and
// the member app). It is a FILL colour: on white it is only 2.44:1, so any
// orange that has to be read as text uses `accent-ink` (#9A5200, 5.86:1 on
// white) and any text sitting on an orange fill is navy (7.09:1).
export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        bg: "#F6F8FB",
        surface: "#FFFFFF",
        line: "#E1E7EF",
        // Interactive borders (ghost button, pills): 3.3:1 on white, WCAG 1.4.11.
        "line-strong": "#7F8FA6",
        // Text on light
        ink: "#0F1B2D",
        body: "#3A485C",
        muted: "#59687C",
        // Dark bands (the closing call to action, the footer, the phone frame)
        navy: "#1B2A41",
        "navy-deep": "#0F1B2D",
        "navy-line": "rgba(197, 208, 224, 0.16)",
        "on-navy": "#FFFFFF",
        "on-navy-muted": "#A9B7CB",
        // Brand orange
        accent: {
          DEFAULT: "#E0971F",
          hover: "#EBA73A",
          ink: "#9A5200",
          // Large display text only (headline fragments, step numerals): 3.99:1 on the page ground.
          display: "#BA6500",
          tint: "#FDF1DC",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        content: "76rem",
      },
      boxShadow: {
        // One soft offset shadow; never stacked on a border of the same card.
        card: "0 1px 2px rgba(15, 27, 45, 0.06), 0 16px 32px -16px rgba(15, 27, 45, 0.22)",
        panel: "0 2px 4px rgba(15, 27, 45, 0.06), 0 32px 56px -24px rgba(15, 27, 45, 0.32)",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(.22, .8, .26, .99)",
      },
      keyframes: {
        // The hero scanner: the scan line sweeps the code continuously, the
        // "Live" dot breathes, and the two check-ins settle in once on load.
        // All of it only runs under `motion-safe`, so reduced motion shows
        // the finished, still state.
        scan: {
          "0%, 100%": { top: "14px" },
          "50%": { top: "calc(100% - 17px)" },
        },
        live: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
        settle: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        scan: "scan 2.6s cubic-bezier(.22,.8,.26,.99) infinite",
        live: "live 2s ease-in-out infinite",
        "settle-a": "settle 0.5s cubic-bezier(.22,.8,.26,.99) 1.3s backwards",
        "settle-b": "settle 0.5s cubic-bezier(.22,.8,.26,.99) 1.5s backwards",
      },
    },
  },
  plugins: [],
} satisfies Config;
