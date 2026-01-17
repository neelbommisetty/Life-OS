import { ProjectDetail } from "../project-detail";

type Props = {
  params: Promise<{ id: string; tab: string }>;
};

export default async function ProjectDetailTabPage({ params }: Props) {
  const { id } = await params;
  return <ProjectDetail id={id} />;
}
