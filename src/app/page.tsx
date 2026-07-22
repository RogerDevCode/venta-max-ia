import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { hasAnyOrganization } from "@/server/auth/registration";

export default async function Home() {
  const session = await getSessionOrNull();
  if (session) {
    redirect("/inbox");
  }
  const orgExists = await hasAnyOrganization();
  redirect(orgExists ? "/login" : "/register");
}
