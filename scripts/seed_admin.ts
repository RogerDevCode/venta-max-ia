import { runInternalSignup, getAuth } from "../src/lib/auth";

async function main() {
  const auth = getAuth();
  await runInternalSignup(async () => {
    try {
      const res = await auth.api.signUpEmail({
        body: {
          email: "roger.gallegos.cl@gmail.com",
          password: "StaxPlataforma2026!",
          name: "Administrador STAX",
        },
      });
      console.log("Administrador STAX creado exitosamente en VentaMax IA:", res.user.email);
    } catch (err: any) {
      if (err?.message?.includes("already exists") || err?.code === "USER_ALREADY_EXISTS") {
        console.log("El usuario roger.gallegos.cl@gmail.com ya existe en VentaMax IA.");
      } else {
        throw err;
      }
    }
  });
}

main().catch((err) => {
  console.error("Error al crear administrador en VentaMax IA:", err);
  process.exit(1);
});
