"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AuthUserMenu, type SessionUser } from "./auth-user-menu";
import { navigationItems } from "./navigation-items";
import { cn } from "@/lib/utils";

export function TopNav({ sessionUser }: { sessionUser: SessionUser | null }) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b bg-background/95 px-4 backdrop-blur-md md:px-6">
        <div className="flex flex-1 items-center gap-4 md:gap-6">
          <div className="md:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Open navigation menu"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="size-4" />
            </Button>
          </div>

          <div className="flex min-w-fit items-center gap-2.5">
            <span className="text-lg font-bold tracking-tight text-foreground">
              Life-OS
            </span>
          </div>

          <div className="relative hidden w-full max-w-xl md:flex">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search tasks, projects, or notes"
              placeholder="Search tasks, projects, or notes..."
              className="h-9 w-full rounded-full border-none bg-muted/50 pl-9 transition-all focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-primary/20"
            />
          </div>
        </div>

        <div className="ml-4 flex items-center gap-4">
          <ModeToggle />
        </div>
      </header>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetHeader className="border-b border-border/60">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>
              Move between assistant work, notes, tasks, and projects.
            </SheetDescription>
          </SheetHeader>

          <div className="flex h-full flex-col px-4 py-4">
            <nav className="flex flex-1 flex-col gap-2">
              {navigationItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/" && pathname?.startsWith(item.href));

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileNavOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-muted",
                    )}
                  >
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-border/60 pt-4">
              <AuthUserMenu user={sessionUser} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
