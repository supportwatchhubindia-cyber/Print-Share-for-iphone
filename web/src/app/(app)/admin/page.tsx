import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminPage } from "@/components/admin/admin-page";
import { getCurrentUser } from "@/server/auth/current";

export const metadata: Metadata = { title: "Admin" };

export default async function Page() {
  const user = await getCurrentUser();
  // The API enforces this too; hiding the page avoids revealing admin UI to regular users.
  if (!user || user.role !== "ADMIN") notFound();
  return <AdminPage currentUserId={user.id} />;
}
