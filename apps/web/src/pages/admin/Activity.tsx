import { AdminLayout } from "../../components/Admin/AdminLayout";
import { AuditLogList } from "../../components/Admin/Activity/AuditLogList";

export default function Activity(): JSX.Element {
  return (
    <AdminLayout>
      <header className="mb-4">
        <h1 className="font-heading text-3xl text-gold-bright">Activity log</h1>
        <p className="mt-1 text-sm opacity-70">Every admin action, with before/after diffs.</p>
      </header>
      <AuditLogList />
    </AdminLayout>
  );
}
