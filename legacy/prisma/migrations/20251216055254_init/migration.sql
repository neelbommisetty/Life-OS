-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('IDEA', 'IN_PROGRESS', 'MVP', 'COMPLETE', 'ARCHIVE', 'DEFER', 'NOT_INTERESTED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'IDEA',
    "priority" "Priority" DEFAULT 'MEDIUM',
    "tags" TEXT[],
    "color" TEXT,
    "icon" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusHistory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusHistory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StatusHistory" ADD CONSTRAINT "StatusHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
