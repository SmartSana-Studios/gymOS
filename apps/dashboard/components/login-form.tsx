"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginSchema, toPasswordCredentials } from "@gymos/types";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

// AD-01: two distinct error surfaces -- "invalid credentials" renders
// inline below the password field (AC #2's literal requirement); network/
// account-locked errors render above the submit button. GoTrue's
// `user_banned` code has a real server-side mechanism (banned_until) even
// though no admin UI currently sets it -- mapped here so the copy is wired
// correctly if that ever becomes reachable, not invented for its own sake.
function mapLoginError(
  error: unknown,
  t: TFunction,
): { passwordError: string | null; formError: string | null } {
  const code = (error as { code?: string } | null)?.code;

  if (code === "invalid_credentials") {
    return { passwordError: t("auth.errors.invalidCredentials"), formError: null };
  }
  if (code === "user_banned") {
    return { passwordError: null, formError: t("auth.errors.accountLocked") };
  }
  if (error instanceof Error && !code) {
    // No `code` means this never reached GoTrue as a structured API
    // response -- a thrown fetch-level failure (offline, DNS, CORS), not a
    // credentials rejection.
    return { passwordError: null, formError: t("auth.errors.network") };
  }
  return { passwordError: null, formError: t("common.somethingWentWrong") };
}

export function LoginForm({
  className,
  redirectTo,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & { redirectTo?: string }) {
  // Story 9.1's staff accounts (Supervisor/Manager/Receptionist/Coach) are
  // provisioned with a phone and NO email, so an email-only field left every
  // non-Owner role unable to sign in at all. See loginSchema's own note for the
  // empirical confirmation that phone sign-in works against those accounts.
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { t } = useTranslation();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setFormError(null);

    const parsed = loginSchema.safeParse({ identifier, password });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? t("common.invalidInput"));
      return;
    }

    const supabase = createClient();
    setIsLoading(true);

    try {
      // Email vs. phone discrimination lives in @gymos/types alongside the
      // schema that validated it, so the two cannot drift apart.
      const { error } = await supabase.auth.signInWithPassword(
        toPasswordCredentials(parsed.data),
      );
      if (error) {
        const mapped = mapLoginError(error, t);
        setPasswordError(mapped.passwordError);
        setFormError(mapped.formError);
        return;
      }
      // `redirectTo` comes from an untrusted query param (`?next=`). A
      // single leading "/" isn't enough -- "//evil.com" also starts with
      // "/" but browsers treat it as a protocol-relative URL, sending a
      // freshly-authenticated user off-site (Review finding: open redirect).
      const safeRedirect =
        redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
          ? redirectTo
          : "/";
      router.push(safeRedirect);
      router.refresh();
    } catch (error: unknown) {
      const mapped = mapLoginError(error, t);
      setPasswordError(mapped.passwordError);
      setFormError(mapped.formError);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t("auth.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="identifier">{t("auth.identifierLabel")}</Label>
                <Input
                  id="identifier"
                  // Deliberately `text`, not `email`: the browser's native
                  // email validation would reject a phone number before the
                  // form ever ran, which is the whole bug being fixed here.
                  type="text"
                  inputMode="email"
                  autoComplete="username"
                  placeholder={t("auth.identifierPlaceholder")}
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">{t("auth.passwordLabel")}</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    {t("auth.forgotPassword")}
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {passwordError && (
                  <p className="text-sm text-destructive">{passwordError}</p>
                )}
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? t("auth.signingIn") : t("auth.signIn")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {/* Sits outside the Card, over the auth layout's darkened background
          image -- hence the white-on-overlay colours rather than the
          `text-muted-foreground` used for links inside the card. Both stores
          expect the policy to be reachable without signing in, and this is
          the only screen a signed-out visitor ever sees. */}
      <Link
        href="/privacy"
        className="self-center text-sm text-white/70 underline-offset-4 hover:text-white hover:underline"
      >
        {t("auth.privacyPolicy")}
      </Link>
    </div>
  );
}
