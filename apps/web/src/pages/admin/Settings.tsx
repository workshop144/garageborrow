import { AdminLayout } from "../../components/Admin/AdminLayout";
import { SettingsForm } from "../../components/Admin/Settings/SettingsForm";

export default function Settings(): JSX.Element {
  return (
    <AdminLayout>
      <header className="mb-4">
        <h1 className="font-heading text-3xl text-gold-bright">Settings</h1>
      </header>
      <SettingsForm />
    </AdminLayout>
  );
}
