import { publicProcedure, router } from "../trpc";
import { createLogger } from "@/lib/logger";

const logger = createLogger("trpc:dashboard");

export const dashboardRouter = router({
  getSummary: publicProcedure.query(async ({ ctx }) => {
    const start = Date.now();
    logger.debug("Getting dashboard summary");

    try {
      // Parallel queries for efficiency
      const [projects, recentTasks] = await Promise.all([
        ctx.prisma.project.findMany({
          orderBy: { updatedAt: "desc" },
          take: 10,
        }),
        ctx.prisma.task.findMany({
          where: {
            status: { in: ["TODO", "IN_PROGRESS"] }
          },
          orderBy: { updatedAt: "desc" },
          take: 5,
          include: {
            project: {
              select: {
                id: true,
                name: true,
                icon: true,
                color: true
              }
            }
          },
        }),
      ]);

      const stats = {
        total: projects.length,
        byStatus: {
          IDEA: projects.filter((p) => p.status === "IDEA").length,
          IN_PROGRESS: projects.filter((p) => p.status === "IN_PROGRESS").length,
          COMPLETE: projects.filter((p) => p.status === "COMPLETE").length,
        },
      };

      const lastEdited = projects[0] ?? null;

      // Filter tasks due within the next 7 days
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const upcomingTasks = recentTasks.filter((t) =>
        t.dueDate && new Date(t.dueDate) <= nextWeek
      );

      logger.info("Dashboard summary retrieved successfully", {
        durationMs: Date.now() - start,
        projectCount: projects.length,
        upcomingTasksCount: upcomingTasks.length,
      });

      return {
        stats,
        lastEdited,
        recentProjects: projects.slice(0, 6),
        upcomingTasks,
      };
    } catch (error) {
      logger.error("Failed to get dashboard summary", {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      throw error;
    }
  }),
});
