import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BULCREATIVE — מכונת וריאציות קריאייטיב",
  description:
    "מעלים קריאייטיב אחד — מקבלים עשרות וריאציות: אותו טקסט, אותו פונט, זווית שיווקית חדשה.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
