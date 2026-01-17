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
import { Bot, CheckSquare, FileText, FolderKanban } from "lucide-react";
import Link from "next/link";

export default function Page() {
  const features = [
    {
      title: "AI Chat",
      description: "Chat with AI models for brainstorming and knowledge.",
      icon: Bot,
      href: "/ai-chat",
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
  ];

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-5xl mx-auto space-y-12">
        <header className="text-center space-y-4">
          <h1 className="text-4xl font-bold tracking-tight">Welcome to Life-OS</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Your personal productivity platform to organize work, ideas, and tasks.
          </p>
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
