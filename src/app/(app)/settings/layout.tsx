import { SettingsNav } from "@/components/settings/settings-nav";
import { ThemeToggleButton } from "@/app/(auth)/auth-theme-context";

export default function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-full flex-col backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-border/80 px-6 py-4 bg-surface/60 transition-colors duration-500">
        <h2 className="font-semibold text-foreground">Configuración</h2>
        <ThemeToggleButton className="shadow-sm" />
      </header>
      <div className="flex min-h-0 flex-1">
        <SettingsNav />
        <div className="min-w-0 flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
