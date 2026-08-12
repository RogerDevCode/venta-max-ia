import { redirect } from "next/navigation";
import { hasAnyOrganization } from "@/server/auth/registration";
import { Suspense } from "react";
import { LoginClientPage } from "./login-client";

export default async function LoginPage() {
  const orgExists = await hasAnyOrganization();
  if (!orgExists) {
    redirect("/register");
  }
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <LoginClientPage />
    </Suspense>
  );
}
