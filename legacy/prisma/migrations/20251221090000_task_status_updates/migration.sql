-- Map legacy WAITING status to TODO before updating enum
UPDATE "Task" SET "status" = 'TODO' WHERE "status" = 'WAITING';

-- Replace enum to remove WAITING and add ARCHIVED
ALTER TYPE "TaskStatus" RENAME TO "TaskStatus_old";
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'DONE', 'ARCHIVED');
ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus" USING "status"::text::"TaskStatus";
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'BACKLOG';
DROP TYPE "TaskStatus_old";
