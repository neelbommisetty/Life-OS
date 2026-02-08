"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleUserRound, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SessionUser = {
  id: string;
  name: string | null;
  email: string | null;
};

function getInitials(name: string | null, email: string | null) {
  if (name) {
    const parts = name
      .split(" ")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (parts.length > 1) {
      return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
    }
  }

  if (email) {
    return email.slice(0, 2).toUpperCase();
  }

  return "U";
}

export function AuthUserMenu({ user }: { user: SessionUser | null }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const initials = useMemo(
    () => getInitials(user?.name ?? null, user?.email ?? null),
    [user?.name, user?.email],
  );

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      router.replace("/auth/sign-in");
      router.refresh();
      setSigningOut(false);
    }
  };

  if (!user) {
    return (
      <Button asChild variant="ghost" size="icon-sm" aria-label="Sign in">
        <Link href="/auth/sign-in">
          <CircleUserRound className="size-5" />
        </Link>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Open account menu">
          <span className="text-xs font-semibold">{initials}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{user.name ?? "User"}</span>
            <span className="text-xs text-muted-foreground">{user.email ?? ""}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account/profile">
            <UserRound className="size-4" />
            Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void handleSignOut();
          }}
          disabled={signingOut}
        >
          <LogOut className="size-4" />
          {signingOut ? "Signing out..." : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
