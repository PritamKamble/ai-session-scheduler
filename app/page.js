import CssGridBackground from "@/components/css-grid-background";
import FeaturesSection from "@/components/features-section";
import FramerSpotlight from "@/components/framer-spotlight";
import Navbar from "@/components/navbar";
import StructuredData from "@/components/structured-data";
import TypingPromptInput from "@/components/typing-prompt-input";
import { Button } from "@/components/ui/button";
import { Zap } from "lucide-react";

export default function Home() {
  return (
    <>
      <StructuredData />
      <div className="flex min-h-screen flex-col">
        <Navbar />

        {/* Hero Section */}
        <section id="hero" className="relative min-h-screen flex items-center justify-center overflow-hidden">
          <CssGridBackground />
          <FramerSpotlight />
          <div className="container px-4 md:px-6 py-16 md:py-20">
            <div className="flex flex-col items-center text-center max-w-3xl mx-auto">
              <div className="inline-block rounded-lg bg-muted px-3 py-1 text-sm mb-6">Enterprise AI Solution</div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tighter mb-6">
                Secure AI Conversations for Enterprise & Government
              </h1>
              <p className="text-xl text-muted-foreground md:text-2xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed max-w-2xl mb-12">
                Unlock the power of AI with enterprise-grade security, customizable agents, and comprehensive knowledge
                management.
              </p>

              <TypingPromptInput />

              <div className="flex flex-wrap justify-center gap-3 mt-16">
                <Button className="flex items-center gap-3 px-5 py-6 h-[60px] bg-[#1a1d21] hover:bg-[#2a2d31] text-white rounded-xl border-0 dark:bg-primary dark:hover:bg-primary/90 dark:shadow-[0_0_15px_rgba(36,101,237,0.5)] relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/30 to-primary/0 dark:opacity-30 opacity-0 group-hover:opacity-100 transition-opacity duration-500 transform translate-x-[-100%] group-hover:translate-x-[100%]"></div>
                  <Zap className="h-5 w-5 text-white relative z-10" />
                  <div className="flex flex-col items-start relative z-10">
                    <span className="text-[15px] font-medium">Request Demo</span>
                    <span className="text-xs text-gray-400 dark:text-gray-300 -mt-0.5">v1.0.0</span>
                  </div>
                </Button>
                <Button className="px-5 py-6 h-[60px] rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-[15px] font-medium text-foreground">
                  Learn More
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <FeaturesSection />
        </div>
        </>
  )
}