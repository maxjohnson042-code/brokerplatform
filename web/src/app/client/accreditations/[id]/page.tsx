import { ClientAccreditationDetailView } from "./client-accreditation-detail-view";

export default async function ClientAccreditationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientAccreditationDetailView id={id} />;
}
