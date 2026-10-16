import { LoginForm } from "@/components/login-form";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const { expired } = await searchParams;
  // Story 22.7: the (admin) layout sends an idle, over-age or locked session here with ?expired=1.
  return <LoginForm expired={expired === "1"} />;
}
