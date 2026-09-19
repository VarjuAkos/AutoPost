import { Studio } from '@/components/Studio';

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <Studio projectId={projectId} />;
}
