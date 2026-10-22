import { AdminDashboard } from "@/ui/admin/dashboard";

// No metadata on admin pages: Next resolves it even when the layout answers not-found, and a
// non-staff visitor must see an ordinary not-found page. The title is set in the browser (AdminNav).
export default function AdminDashboardPage() {
  return <AdminDashboard />;
}
