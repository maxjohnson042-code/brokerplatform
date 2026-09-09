import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BusinessForm } from "./business-form";
import { BusinessList } from "./business-list";

export default function BusinessPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Your business</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        BUS-001/003, ONB-014. Look your business up by ABN and confirm what we find, or enter its details
        manually.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Business details</CardTitle>
          <CardDescription>One authoritative record per entity, shared by every broker affiliated with it (BUS-006).</CardDescription>
        </CardHeader>
        <CardContent>
          <BusinessForm />
        </CardContent>
      </Card>

      <BusinessList />
    </div>
  );
}
