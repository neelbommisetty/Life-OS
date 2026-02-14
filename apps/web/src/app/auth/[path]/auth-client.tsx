"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  toastApiError,
  toastApiResponseError,
} from "@/lib/api/error-toast";
import { couldnt } from "@/lib/brand";

type AuthViewPath =
  | "sign-in"
  | "sign-up"
  | "forget-password"
  | "reset-password";

type AuthClientProps = {
  path: AuthViewPath;
};

export function AuthClient({ path }: AuthClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const callbackURL = useMemo(
    () => searchParams.get("callbackURL") ?? "/",
    [searchParams],
  );

  const resetToken = useMemo(
    () => searchParams.get("token"),
    [searchParams],
  );

  const submitSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          callbackURL,
        }),
      });

      if (!response.ok) {
        const message = await toastApiResponseError(response, couldnt("sign in"));
        setError(message);
        return;
      }

      router.replace(callbackURL);
      router.refresh();
    } catch (error) {
      setError(toastApiError(error, couldnt("sign in")));
    } finally {
      setLoading(false);
    }
  };

  const submitSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          name,
          email,
          password,
          callbackURL,
        }),
      });

      if (!response.ok) {
        const message = await toastApiResponseError(response, couldnt("create your account"));
        setError(message);
        return;
      }

      router.replace(callbackURL);
      router.refresh();
    } catch (error) {
      setError(toastApiError(error, couldnt("create your account")));
    } finally {
      setLoading(false);
    }
  };

  const submitForgotPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const origin = window.location.origin;
      const response = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          email,
          redirectTo: `${origin}/auth/reset-password`,
        }),
      });

      if (!response.ok) {
        const message = await toastApiResponseError(
          response,
          couldnt("send the reset link"),
        );
        setError(message);
        return;
      }

      setSuccess(
        "If that email exists, a password reset link has been sent.",
      );
    } catch (error) {
      setError(toastApiError(error, couldnt("send the reset link")));
    } finally {
      setLoading(false);
    }
  };

  const submitResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (!resetToken) {
      setError("Missing reset token. Open the reset link again.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          newPassword,
          token: resetToken,
        }),
      });

      if (!response.ok) {
        const message = await toastApiResponseError(
          response,
          couldnt("reset your password"),
        );
        setError(message);
        return;
      }

      router.replace("/auth/sign-in");
      router.refresh();
    } catch (error) {
      setError(toastApiError(error, couldnt("reset your password")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          {path === "sign-in" && "Sign in"}
          {path === "sign-up" && "Create account"}
          {path === "forget-password" && "Recover password"}
          {path === "reset-password" && "Set new password"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
            {success}
          </p>
        ) : null}

        {path === "sign-in" ? (
          <form className="space-y-4" onSubmit={submitSignIn}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Sign in"}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <Link href="/auth/sign-up" className="text-primary hover:underline">
                Create account
              </Link>
              <Link href="/auth/forget-password" className="text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
          </form>
        ) : null}

        {path === "sign-up" ? (
          <form className="space-y-4" onSubmit={submitSignUp}>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" autoComplete="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Create account"}
            </Button>
            <p className="text-sm">
              Already have an account?{" "}
              <Link href="/auth/sign-in" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        ) : null}

        {path === "forget-password" ? (
          <form className="space-y-4" onSubmit={submitForgotPassword}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Send reset link"}
            </Button>
            <p className="text-sm">
              Back to{" "}
              <Link href="/auth/sign-in" className="text-primary hover:underline">
                sign in
              </Link>
            </p>
          </form>
        ) : null}

        {path === "reset-password" ? (
          <form className="space-y-4" onSubmit={submitResetPassword}>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Update password"}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
