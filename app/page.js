"use client"
import { SignIn, useAuth } from '@clerk/nextjs';
import CssGridBackground from "@/components/css-grid-background";
import FeaturesSection from "@/components/features-section";
import FramerSpotlight from "@/components/framer-spotlight";
import Navbar from "@/components/navbar";
import StructuredData from "@/components/structured-data";
import TypingPromptInput from "@/components/typing-prompt-input";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { isSignedIn, isLoaded } = useAuth();

  // Show loading state
  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <StructuredData />
      <div className="flex min-h-screen flex-col">
        <Navbar />
        
        {!isSignedIn ? (
          // Show Sign-In instead of hero section
          <section id="auth" className="relative min-h-screen flex items-center justify-center overflow-hidden">
            <CssGridBackground />
            <FramerSpotlight />
            <div className="container px-4 md:px-6 py-16 md:py-20">
              <div className="flex flex-col items-center text-center max-w-md mx-auto">
                <div className="inline-block rounded-lg bg-muted px-3 py-1 text-sm mb-6">
                  Linkcode Agent
                </div>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tighter mb-6">
                  Welcome Back
                </h1>
                <p className="text-muted-foreground mb-8">
                  Sign in to access your personalized learning experience
                </p>
                
                {/* Clerk Sign-In Component */}
                <SignIn 
                  appearance={{
                    elements: {
                      rootBox: "mx-auto",
                      card: "shadow-lg"
                    }
                  }}
                  forceRedirectUrl='/dashboard'
                />
              </div>
            </div>
          </section>
        ) : (
          // Show normal hero section when signed in
          <section id="hero" className="relative min-h-screen flex items-center justify-center overflow-hidden">
            <CssGridBackground />
            <FramerSpotlight />
            <div className="container px-4 md:px-6 py-16 md:py-20">
              <div className="flex flex-col items-center text-center max-w-3xl mx-auto">
                <div className="inline-block rounded-lg bg-muted px-3 py-1 text-sm mb-6">
                  Linkcode Agent
                </div>
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tighter mb-6">
                  Connect, Learn, and Schedule with Ease
                </h1>
                <p className="text-xl text-muted-foreground md:text-2xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed max-w-2xl mb-12">
                  The intelligent scheduling platform that bridges students and teachers for personalized learning experiences
                </p>
                
                <TypingPromptInput />
                
                
              </div>
            </div>
          </section>
        )}

        {/* Features Section - only show when signed in */}
        {isSignedIn && <FeaturesSection />}
      </div>
    </>
  );
}