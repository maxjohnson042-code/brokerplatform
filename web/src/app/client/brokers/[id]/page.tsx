import { ClientBrokerProfileView } from "./client-broker-profile-view";

export default async function ClientBrokerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientBrokerProfileView brokerId={id} />;
}
