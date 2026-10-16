import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Providers from "@/components/Providers";
import "./globals.css";

// Ported from frontend-legacy/index.html — same Inter font, same metadata.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "CampusGrade — Assignment Intelligence",
  description: "CampusGrade assignment authoring, submission, repository analysis, grading, and feedback platform.",
  openGraph: {
    title: "CampusGrade — Assignment Intelligence",
    description: "Coursework, repositories, rubrics, feedback, and results in one independent workspace.",
    type: "website",
  },
  icons: {
    icon: "/krmu-logo-short.webp",
  },
};

export const viewport = {
  themeColor: "#cc000d",
  colorScheme: "light" as const,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-slate-50 font-sans text-slate-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
