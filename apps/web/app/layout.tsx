export const metadata = {
  title: "Redstone Cowork",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Cowork", statusBarStyle: "black-translucent" as const },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};
export const viewport = { themeColor: "#0a0e1a" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body style={{ fontFamily: "system-ui", background: "#0a0e1a", color: "#e8ecf4", margin: 0, padding: "4rem" }}>{children}</body></html>
  );
}
