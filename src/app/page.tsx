import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Bot, CheckSquare, DollarSign, FileText, FolderKanban } from "lucide-react";
import Link from "next/link";

import { authServer } from "@/lib/auth/server";

export default async function Page() {
  const { data: session } = await authServer.getSession();
  const fullUserName = session?.user?.name || "there";
  const firstName = fullUserName.split(" ")[0];

  const now = new Date();
  const hour = now.getHours();
  let greeting = "Good Evening";
  if (hour >= 5 && hour < 12) greeting = "Good Morning";
  else if (hour >= 12 && hour < 17) greeting = "Good Afternoon";

  const dateString = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const features = [
    {
      title: "AI Chat",
      description: "Chat with AI models for brainstorming and knowledge.",
      icon: Bot,
      href: "/chat",
      color: "text-purple-500",
    },
    {
      title: "Projects",
      description: "Manage your active work and plan upcoming initiatives.",
      icon: FolderKanban,
      href: "/projects",
      color: "text-blue-500",
    },
    {
      title: "Tasks",
      description: "Track what needs to be done to stay organized.",
      icon: CheckSquare,
      href: "/tasks",
      color: "text-green-500",
    },
    {
      title: "Notes",
      description: "Capture thoughts, ideas, and information.",
      icon: FileText,
      href: "/notes",
      color: "text-orange-500",
    },
    {
      title: "Pricing",
      description: "View AI model pricing and cost information.",
      icon: DollarSign,
      href: "/pricing",
      color: "text-emerald-500",
    },
  ];

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-5xl mx-auto space-y-12">
        <header className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">
              {greeting}, {firstName}
            </h1>
            <p className="text-lg text-muted-foreground">
              Building what matters, one step at a time.
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-secondary/50 border border-border w-fit h-fit mt-2">
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              {dateString}
            </span>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feature) => (
            <Card key={feature.title} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className={cn("p-3 rounded-lg bg-secondary", feature.color)}>
                    <feature.icon className="w-8 h-8" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl">{feature.title}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  {feature.description}
                </CardDescription>
              </CardContent>
              <CardFooter>
                <Button asChild className="w-full">
                  <Link href={feature.href}>Go to {feature.title}</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
