"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function UpdatePasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // Story 1.11 AC #5: flip must_change_password so the (dashboard)
      // layout gate (session.ts/getDashboardShellContext) stops redirecting
      // here on subsequent logins. A failure here is logged but must not
      // block the primary success path -- matches this codebase's
      // established "non-critical follow-up write failing open" pattern
      // (e.g. smsSent/audit-log-failure not blocking gym creation).
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        // Same silent-redirect-loop risk as a failed clearFlagError below --
        // if getUser() returns no user right after a successful updateUser(),
        // must_change_password never flips and the (dashboard) layout gate
        // bounces the user straight back here with no explanation.
        console.error(
          "[update-password-form] no user returned after password update",
        );
        setError(t("common.somethingWentWrong"));
        return;
      }

      const { error: clearFlagError } = await supabase
        .from("users")
        .update({ must_change_password: false })
        .eq("id", userData.user.id);
      if (clearFlagError) {
        // Unlike the smsSent/audit-log-failure precedent this comment
        // block originally cited, this failure is NOT safe to ignore:
        // must_change_password never actually flips, so the (dashboard)
        // layout gate would immediately bounce the user right back to
        // this same screen on the very next load with no visible
        // explanation (code review finding). Surface an error and stop
        // instead of navigating to a route that will just redirect back.
        console.error(
          "[update-password-form] failed to clear must_change_password",
          clearFlagError,
        );
        setError(t("common.somethingWentWrong"));
        return;
      }

      // "/" is AD-02 Overview (Story 1.8) -- apps/dashboard has no "/protected"
      // route, so the starter kit's original target 404ed here for every
      // owner who actually completed a password reset (invite link or
      // forgot-password). See docs/manual-walkthrough-findings-2026-07-13.md.
      router.push("/");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : t("common.somethingWentWrong"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t("auth.resetPasswordTitle")}</CardTitle>
          <CardDescription>{t("auth.resetPasswordBody2")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleForgotPassword}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="password">{t("auth.newPassword")}</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={t("auth.newPassword")}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? t("auth.savingPassword") : t("auth.saveNewPassword")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
