export const metadata = { title: "Redstone Cowork" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body style={{ fontFamily: "system-ui", background: "#0a0e1a", color: "#e8ecf4", margin: 0, padding: "4rem" }}>{children}</body></html>
  );
}
