"use client"

import { useUser } from "@clerk/nextjs"
import CssGridBackground from "@/components/css-grid-background"
import FeaturesSection from "@/components/features-section"
import FramerSpotlight from "@/components/framer-spotlight"
import Navbar from "@/components/navbar"
import StructuredData from "@/components/structured-data"
import TypingPromptInput from "@/components/typing-prompt-input"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { SignInButton, SignUpButton } from "@clerk/nextjs"

export default function Home() {
  const { isSignedIn, isLoaded } = useUser()
  const router = useRouter()

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      router.push("/dashboard")
    }
  }, [isSignedIn, isLoaded, router])

  // Show loading state with theme-compatible styling
  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <StructuredData />
      <div className="flex min-h-screen flex-col bg-background">
        <Navbar />

        {!isSignedIn ? (
          // Show hero section with sign in/up buttons (modal only)
          <section id="hero" className="relative min-h-screen flex items-center justify-center overflow-hidden">
            <CssGridBackground />
            <FramerSpotlight />
            <div className="container px-4 md:px-6 py-16 md:py-20">
              <div className="flex flex-col items-center text-center max-w-3xl mx-auto">
                <div className="inline-block rounded-lg bg-muted px-3 py-1 text-sm mb-6 text-muted-foreground">
                  Techonsy Agent
                </div>
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tighter mb-6 text-foreground">
                  Connect, Learn, and Schedule with Ease
                </h1>
                <p className="text-xl text-muted-foreground md:text-2xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed max-w-2xl mb-12">
                  The intelligent scheduling platform that bridges students and teachers for personalized learning
                  experiences
                </p>

                <div className="flex gap-4">
                  <SignInButton mode="modal">
                    <Button className="px-8 py-4 text-lg tracking-tighter">Sign In</Button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <Button className="px-8 py-4 text-lg bg-transparent tracking-tighter" variant="outline">
                      Sign Up
                    </Button>
                  </SignUpButton>
                </div>
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
                <div className="inline-block rounded-lg bg-muted px-3 py-1 text-sm mb-6 text-muted-foreground">
                  Techonsy Agent
                </div>
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tighter mb-6 text-foreground">
                  Connect, Learn, and Schedule with Ease
                </h1>
                <p className="text-xl text-muted-foreground md:text-2xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed max-w-2xl mb-12">
                  The intelligent scheduling platform that bridges students and teachers for personalized learning
                  experiences
                </p>

                <TypingPromptInput />

                <Button className="mt-4">Test - (not working)</Button>
              </div>
            </div>
          </section>
        )}

        {/* Features Section - only show when signed in */}
        {isSignedIn && <FeaturesSection />}
      </div>
    </>
  )
}
