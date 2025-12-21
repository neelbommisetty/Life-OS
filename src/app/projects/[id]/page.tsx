import { ProjectDetail } from "./project-detail";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;
  return <ProjectDetail id={id} />;
}
