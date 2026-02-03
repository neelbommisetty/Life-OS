import { authClient } from "@/lib/auth/client";
import { NeonAuthUIProvider } from "@neondatabase/auth/react";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { SideNav } from "@/components/navigation/side-nav";
import { TopNav } from "@/components/navigation/top-nav";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "@fontsource/fira-code";
import "./globals.css";
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Life-OS",
  description:
    "Your personal productivity platform to organize work, ideas, and tasks.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable}`} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NeonAuthUIProvider
            authClient={authClient}
            redirectTo="/"
            emailOTP={false}
          >
            <div className="flex min-h-screen bg-background">
              <SideNav />
              <div className="flex flex-1 flex-col pl-[64px]">
                <TopNav />
                <main className="h-[calc(100dvh-4rem)] overflow-hidden">
                  {children}
                </main>
              </div>
            </div>
            <Toaster />
          </NeonAuthUIProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
