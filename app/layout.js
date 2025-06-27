import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import {
  ClerkProvider,
} from '@clerk/nextjs'
const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Connect, Learn, and Schedule with Ease",
  description:
    "The intelligent scheduling platform that bridges students and teachers for personalized learning experiences",
  keywords: "enterprise AI, secure AI, government AI solutions, LLM, knowledge base, AI agents, MCP server",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://your-domain.com",
    title: "Enterprise AI Platform | Secure AI Solutions",
    description:
      "Enterprise-grade AI platform with advanced security, customization, and control for businesses and government agencies.",
    siteName: "Enterprise AI Platform",
    images: [
      {
        url: "https://your-domain.com/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Enterprise AI Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Enterprise AI Platform | Secure AI Solutions",
    description: "Enterprise-grade AI platform with advanced security, customization, and control.",
    images: ["https://your-domain.com/twitter-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
    </ClerkProvider>
  );
}