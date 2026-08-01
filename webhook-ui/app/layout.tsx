import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { Geist, JetBrains_Mono, IBM_Plex_Sans } from "next/font/google";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";

const ibmPlexSansHeading = IBM_Plex_Sans({subsets:['latin'],variable:'--font-heading'});

const jetbrainsMono = JetBrains_Mono({subsets:['latin'],variable:'--font-mono'});

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata = {
  title: "Dalux webhook registration",
  description: "Register change and freshness monitors for Dalux Build files.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn( geist.variable, "font-mono", jetbrainsMono.variable, ibmPlexSansHeading.variable)}>
      <body>
        <ClerkProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
