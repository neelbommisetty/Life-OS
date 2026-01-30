"use server";

import { prisma } from "@/lib/db";
import { authServer } from "@/lib/auth/server";
import { addDays } from "date-fns";

async function getCurrentUserId(): Promise<string> {
  const { data: session } = await authServer.getSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

export async function getRecentProjects() {
  const userId = await getCurrentUserId();
  
  return prisma.project.findMany({
    where: {
      userId,
      archivedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    take: 3,
    include: {
      _count: {
        select: { tasks: { where: { status: "TODO" } } }
      }
    }
  });
}

export async function getUpcomingTasks() {
  const userId = await getCurrentUserId();
  const now = new Date();
  const nextWeek = addDays(now, 7);

  return prisma.task.findMany({
    where: {
      userId,
      status: { not: "DONE" },
      deletedAt: null,
      OR: [
        { dueDate: { lte: nextWeek, gte: new Date(now.setHours(0, 0, 0, 0)) } },
        { dueDate: null }
      ]
    },
    orderBy: [
      { dueDate: "asc" },
      { updatedAt: "desc" }
    ],
    take: 4,
    include: {
      project: {
        select: { name: true }
      }
    }
  });
}

export async function getRecentNotes() {
  const userId = await getCurrentUserId();

  return prisma.note.findMany({
    where: {
      userId,
      deletedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    take: 3,
  });
}
