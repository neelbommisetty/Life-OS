-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('TEXT', 'LINK', 'FILE');

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "ArtifactType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "url" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "fileType" TEXT,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Artifact_projectId_createdAt_idx" ON "Artifact"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
