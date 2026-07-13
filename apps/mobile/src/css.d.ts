// Expo SDK 57 supports native CSS/CSS Modules for web builds via Metro, but
// ships no ambient TS declarations for them -- without this, `tsc --noEmit`
// fails on animated-icon.web.tsx's and theme.ts's CSS imports.
declare module "*.module.css" {
  const classes: { readonly [className: string]: string };
  export default classes;
}

declare module "*.css";
