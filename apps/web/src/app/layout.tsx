import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { SideNav } from "@/components/navigation/side-nav";
import { TopNav } from "@/components/navigation/top-nav";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { UnhandledErrorToaster } from "@/components/providers/unhandled-error-toaster";
import { getApiSessionUser } from "@/lib/api/session";
import { brand } from "@/lib/brand";
import "@fontsource/fira-code";
import "./globals.css";

export const dynamic = "force-dynamic";

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
  title: {
    default: "Life-OS",
    template: "%s | Life-OS",
  },
  description: brand.oneSentenceDescription,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const sessionUser = await getApiSessionUser();

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
          <div className="flex min-h-screen bg-background">
            <SideNav sessionUser={sessionUser} />
            <div className="flex flex-1 flex-col pl-[64px]">
              <TopNav />
              <main className="h-[calc(100dvh-4rem)] overflow-hidden">
                {children}
              </main>
            </div>
          </div>
          <UnhandledErrorToaster />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
