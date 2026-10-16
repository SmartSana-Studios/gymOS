import { CancelRecoveryForm } from "./cancel-form";

/** Story 22.8: opened from the email link. A GET never cancels (mail scanners prefetch links); the button does. */
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <CancelRecoveryForm token={typeof token === "string" ? token : ""} />;
}
