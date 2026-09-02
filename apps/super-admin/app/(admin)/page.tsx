import { redirect } from "next/navigation";

// No dedicated Overview page exists for Super Admin yet -- `/gyms` is
// already the effective home (the nav's own brand link points here,
// (admin)/layout.tsx#L54). Living inside the (admin) route group means
// this page inherits that layout's auth+app_role gate before it ever
// runs, same defense-in-depth as apps/dashboard's Story 1.8 fix.
export default function AdminHome() {
  redirect("/gyms");
}
