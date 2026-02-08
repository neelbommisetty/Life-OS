"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  toastApiError,
  toastApiResponseError,
} from "@/lib/api/error-toast";
import { cn } from "@/lib/utils";

type SessionUser = {
  id: string;
  name: string | null;
  email: string | null;
};

type AccountPath = "profile" | "security";

type AccountClientProps = {
  path: AccountPath;
  user: SessionUser;
};

export function AccountClient({ path, user }: AccountClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onUpdateProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/auth/update-user", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const message = await toastApiResponseError(
          response,
          "Failed to update profile",
        );
        setError(message);
        return;
      }

      setSuccess("Profile updated");
      router.refresh();
    } catch (error) {
      setError(toastApiError(error, "Failed to update profile"));
    } finally {
      setLoading(false);
    }
  };

  const onChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      if (!response.ok) {
        const message = await toastApiResponseError(
          response,
          "Failed to change password",
        );
        setError(message);
        return;
      }

      setSuccess("Password updated");
      (event.currentTarget as HTMLFormElement).reset();
    } catch (error) {
      setError(toastApiError(error, "Failed to change password"));
    } finally {
      setLoading(false);
    }
  };

  const onSignOut = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const message = await toastApiResponseError(response, "Failed to sign out");
        setError(message);
        return;
      }

      router.replace("/auth/sign-in");
      router.refresh();
    } catch (error) {
      setError(toastApiError(error, "Failed to sign out"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="container mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile and security settings.
        </p>
      </header>

      <div className="flex gap-2">
        <Button
          asChild
          variant={path === "profile" ? "default" : "outline"}
          size="sm"
        >
          <Link href="/account/profile">Profile</Link>
        </Button>
        <Button
          asChild
          variant={path === "security" ? "default" : "outline"}
          size="sm"
        >
          <Link href="/account/security">Security</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{path === "profile" ? "Profile" : "Security"}</CardTitle>
          <CardDescription>
            {path === "profile"
              ? "Update your account name."
              : "Change your password and sign out on this device."}
          </CardDescription>
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

          {path === "profile" ? (
            <form className="space-y-4" onSubmit={onUpdateProfile}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={user.email ?? ""} disabled readOnly />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" defaultValue={user.name ?? ""} required />
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <Loader2 className={cn("size-4 animate-spin")} />
                ) : (
                  "Save changes"
                )}
              </Button>
            </form>
          ) : (
            <div className="space-y-6">
              <form className="space-y-4" onSubmit={onChangePassword}>
                <div className="space-y-2">
                  <Label htmlFor="currentPassword">Current password</Label>
                  <Input
                    id="currentPassword"
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </div>
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
                  <Label htmlFor="confirmPassword">Confirm new password</Label>
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <Button type="submit" disabled={loading}>
                  {loading ? (
                    <Loader2 className={cn("size-4 animate-spin")} />
                  ) : (
                    "Change password"
                  )}
                </Button>
              </form>

              <div className="border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void onSignOut();
                  }}
                  disabled={loading}
                >
                  Sign out
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
