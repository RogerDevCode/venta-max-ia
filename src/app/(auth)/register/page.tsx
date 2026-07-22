import { redirect } from "next/navigation";
import { isPublicSignupAllowed } from "@/server/auth/registration";
import { RegisterClientPage } from "./register-client";

export default async function RegisterPage() {
  const allowed = await isPublicSignupAllowed();
  if (!allowed) {
    redirect("/login");
  }
  return <RegisterClientPage />;
}
