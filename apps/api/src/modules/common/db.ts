export async function getDbClient<TDb>() {
  const { prisma } = await import("@life-os/db");
  return prisma as unknown as TDb;
}
