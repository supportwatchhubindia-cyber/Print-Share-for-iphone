import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AppShell } from "@/components/app-shell/app-shell";
import { getCurrentUser } from "@/server/auth/current";
import { toUserDTO } from "@/server/dto";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    const path = (await headers()).get("x-ps-path") ?? "/dashboard";
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  return <AppShell user={toUserDTO(user)}>{children}</AppShell>;
}
