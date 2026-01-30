import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FolderKanban, Clock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { getRecentProjects } from "@/lib/home/actions";

export async function RecentProjects() {
  const projects = await getRecentProjects();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">Recent Projects</h2>
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-primary">
          <Link href="/projects">View All</Link>
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {projects.map((project) => (
          <Link href={`/projects/${project.id}`} key={project.id}>
            <Card className="h-full hover:bg-secondary/5 transition-colors cursor-pointer group relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary/50 opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start mb-1">
                  <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                    PROJECT
                  </Badge>
                  <div className="p-2 bg-secondary rounded-full">
                    <FolderKanban className="w-4 h-4 text-primary" />
                  </div>
                </div>
                <CardTitle className="text-lg leading-tight group-hover:text-primary transition-colors">
                  {project.name}
                </CardTitle>
                {project.description && (
                  <CardDescription className="line-clamp-2 text-xs mt-1">
                    {project.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  {project._count.tasks > 0 ? `${project._count.tasks} pending tasks` : 'No pending tasks'}
                </div>
              </CardContent>
              <CardFooter className="pt-0 text-xs text-muted-foreground flex items-center gap-2">
                <Clock className="w-3 h-3" />
                {formatDistanceToNow(project.updatedAt, { addSuffix: true })}
              </CardFooter>
            </Card>
          </Link>
        ))}
        <Link href="/projects">
          <Card className="h-full border-dashed flex flex-col items-center justify-center p-6 hover:bg-secondary/5 transition-colors cursor-pointer text-muted-foreground hover:text-primary min-h-[180px]">
            <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center mb-3">
              <Plus className="h-5 w-5" />
            </div>
            <span className="font-medium">Create Project</span>
          </Card>
        </Link>
      </div>
    </div>
  );
}
