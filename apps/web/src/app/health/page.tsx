import { HomePage, type SearchParams } from "@/components/home-page";
export const dynamic = "force-dynamic";
export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <HomePage page="health" searchParams={searchParams} />;
}
