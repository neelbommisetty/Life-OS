"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  Home,
  FolderKanban,
  CheckSquare,
  FileText,
  Inbox,
  MessageSquare,
  BarChart3,
} from "lucide-react";
import { AuthUserMenu, type SessionUser } from "./auth-user-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { brand } from "@/lib/brand";

const navItems = [
  { icon: Home, label: "Home", href: "/" },
  { icon: MessageSquare, label: brand.terms.assistant, href: "/chat" },
  { icon: FolderKanban, label: "Projects", href: "/projects" },
  { icon: CheckSquare, label: "Tasks", href: "/tasks" },
  { icon: FileText, label: brand.terms.library, href: "/notes" },
  { icon: Inbox, label: "Inbox", href: "/inbox" },
  { icon: BarChart3, label: "Analytics", href: "/analytics" },
];

type SideNavProps = {
  sessionUser: SessionUser | null;
};

export function SideNav({ sessionUser }: SideNavProps) {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-[64px] flex-col items-center bg-background border-r border-border/50 py-3 text-muted-foreground shadow-sm">
        {/* Top App Icon */}
        <div className="mb-8 flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:scale-105 transition-transform cursor-pointer">
          <LayoutGrid className="size-5" />
        </div>

        {/* Navigation Items */}
        <nav className="flex flex-1 flex-col items-center gap-4">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex aspect-square h-10 w-10 items-center justify-center rounded-xl transition-all duration-300",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 scale-100"
                        : "hover:bg-muted/80 hover:text-foreground hover:scale-105"
                    )}
                  >
                    <item.icon className="size-5" />
                    <span className="sr-only">{item.label}</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10} className="font-medium">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="mt-auto flex flex-col items-center gap-6">
          <div className="flex h-10 w-10 items-center justify-center">
            <AuthUserMenu user={sessionUser} />
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
