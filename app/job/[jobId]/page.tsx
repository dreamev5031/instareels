import HomeScreen from "@/ui/HomeScreen";

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <HomeScreen initialJobId={jobId} />;
}
