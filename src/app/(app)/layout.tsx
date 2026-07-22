import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull } from "@/lib/auth/session";
import { getBranding } from "@/server/branding";
import { hasAnyOrganization } from "@/server/auth/registration";
import { AppNav } from "@/components/app-nav";
import { ThemeBackgroundGrid } from "@/app/(auth)/auth-theme-context";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) {
    const orgExists = await hasAnyOrganization();
    redirect(orgExists ? "/login" : "/register");
  }
  const branding = await getBranding(session.organizationId);
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });

  return (
    <div className="relative flex h-screen overflow-hidden bg-background transition-colors duration-500">
      <ThemeBackgroundGrid />
      <div className="relative z-10 flex h-full w-full">
        <AppNav
          branding={branding}
          userName={authSession?.user.name ?? "Usuario"}
          role={session.role}
        />
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
