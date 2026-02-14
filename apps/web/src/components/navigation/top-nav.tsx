"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ModeToggle } from "@/components/mode-toggle";
import { brand } from "@/lib/brand";

export function TopNav() {
  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b bg-background/95 backdrop-blur-md px-6">
      <div className="flex flex-1 items-center gap-6">
        <div className="flex items-center gap-2.5 min-w-fit">
          <span className="text-lg font-bold tracking-tight text-foreground">
            Life-OS
          </span>
        </div>

        <div className="hidden md:flex relative w-full max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={`Search tasks, projects, or ${brand.terms.library.toLowerCase()}...`}
            className="h-9 w-full rounded-full bg-muted/50 border-none pl-9 transition-all focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-primary/20"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 ml-4">
        <ModeToggle />
      </div>
    </header>
  );
}
