import { ProjectWorkspace } from "@/app/features/projects/project-workspace";
export const metadata = { title: "项目总览 — SthStart" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectWorkspace projectId={id} />;
}
