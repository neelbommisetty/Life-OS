import { authServer } from "@/lib/auth/server";
import { RecentProjects } from "@/components/home/recent-projects";
import { UpcomingTasks } from "@/components/home/upcoming-tasks";
import { RecentNotes } from "@/components/home/recent-notes";

export default async function Page() {
  const { data: session } = await authServer.getSession();
  if (!session?.user?.id) return null; // Should ideally redirect
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

  return (
    <div className="h-full w-full bg-background p-8 overflow-auto">
      <div className="max-w-5xl mx-auto space-y-8">
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

        <RecentProjects />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <UpcomingTasks />
          <RecentNotes />
        </div>
      </div>
    </div>
  );
}
