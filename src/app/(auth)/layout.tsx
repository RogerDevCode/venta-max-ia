import { DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";
import { AuthClientWrapper } from "./auth-client-wrapper";

export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  return (
    <AuthClientWrapper branding={branding}>
      {children}
    </AuthClientWrapper>
  );
}
