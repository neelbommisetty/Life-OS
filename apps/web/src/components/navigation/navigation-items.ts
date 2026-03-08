import {
  BarChart3,
  CheckSquare,
  FileText,
  FolderKanban,
  Home,
  Inbox,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { brand } from "@/lib/brand";

export type NavigationItem = {
  icon: LucideIcon;
  label: string;
  href: string;
};

export const navigationItems: NavigationItem[] = [
  { icon: Home, label: "Home", href: "/" },
  { icon: MessageSquare, label: brand.terms.assistant, href: "/chat" },
  { icon: FolderKanban, label: "Projects", href: "/projects" },
  { icon: CheckSquare, label: "Tasks", href: "/tasks" },
  { icon: FileText, label: brand.terms.library, href: "/notes" },
  { icon: Inbox, label: "Inbox", href: "/inbox" },
  { icon: BarChart3, label: "Analytics", href: "/analytics" },
];
