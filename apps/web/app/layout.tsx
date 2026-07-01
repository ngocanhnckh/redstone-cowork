import "./globals.css";

export const metadata = {
  title: "Redstone Cowork",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Cowork", statusBarStyle: "black-translucent" as const },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};
export const viewport = { themeColor: "#15110D" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* drifting atmosphere behind everything */}
        <div className="atmosphere" aria-hidden>
          <div className="blob blob--a" />
          <div className="blob blob--b" />
          <div className="blob blob--c" />
        </div>
        <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>{children}</div>
      </body>
    </html>
  );
}
