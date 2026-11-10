import { redirect } from "next/navigation";

// Story 24.11: held names became the first tab of Pages (EXPERIENCE.md SA-16, `/pages?tab=names`). The old address keeps working.
export default function PageNamesPage(): never {
  redirect("/pages?tab=names");
}
