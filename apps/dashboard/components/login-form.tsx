"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginSchema } from "@gymos/types";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const NETWORK_ERROR_MESSAGE = "Couldn't connect. Check your internet connection.";
const INVALID_CREDENTIALS_MESSAGE = "Email or password is incorrect.";
const ACCOUNT_LOCKED_MESSAGE =
  "Your account has been locked. Contact your gym administrator.";
const GENERIC_ERROR_MESSAGE = "Something went wrong on our end.";

// AD-01: two distinct error surfaces -- "invalid credentials" renders
// inline below the password field (AC #2's literal requirement); network/
// account-locked errors render above the submit button. GoTrue's
// `user_banned` code has a real server-side mechanism (banned_until) even
// though no admin UI currently sets it -- mapped here so the copy is wired
// correctly if that ever becomes reachable, not invented for its own sake.
function mapLoginError(error: unknown): { passwordError: string | null; formError: string | null } {
  const code = (error as { code?: string } | null)?.code;

  if (code === "invalid_credentials") {
    return { passwordError: INVALID_CREDENTIALS_MESSAGE, formError: null };
  }
  if (code === "user_banned") {
    return { passwordError: null, formError: ACCOUNT_LOCKED_MESSAGE };
  }
  if (error instanceof Error && !code) {
    // No `code` means this never reached GoTrue as a structured API
    // response -- a thrown fetch-level failure (offline, DNS, CORS), not a
    // credentials rejection.
    return { passwordError: null, formError: NETWORK_ERROR_MESSAGE };
  }
  return { passwordError: null, formError: GENERIC_ERROR_MESSAGE };
}

export function LoginForm({
  className,
  redirectTo,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & { redirectTo?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setFormError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    const supabase = createClient();
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword(parsed.data);
      if (error) {
        const mapped = mapLoginError(error);
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
      const mapped = mapLoginError(error);
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
          <CardTitle className="text-2xl">Sign in to GymOS</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Email address *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password *</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    Forgot password?
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
                    aria-label={showPassword ? "Hide password" : "Show password"}
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
                {isLoading ? "Signing in…" : "Sign in"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
