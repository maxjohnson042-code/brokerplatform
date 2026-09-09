import { AccreditationDetailView } from "./accreditation-detail-view";

export default async function AccreditationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccreditationDetailView id={id} />;
}
