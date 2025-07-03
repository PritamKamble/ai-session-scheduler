"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send } from "lucide-react"
import { SchedulesSidebar } from "@/components/schedules-sidebar"
import { useUser } from "@clerk/nextjs"
import toast, { Toaster } from "react-hot-toast"
import { useRouter } from "next/navigation"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb"

// Local storage keys
const CONVERSATION_KEY = "app_conversation"
const CONVERSATION_TIMESTAMP_KEY = "app_conversation_timestamp"

// Conversation expiration time (3 days in milliseconds)
const CONVERSATION_EXPIRATION = 3 * 24 * 60 * 60 * 1000

const DashboardPage = () => {
  const [userInput, setUserInput] = useState("")
  const { isLoaded, isSignedIn, user } = useUser()
  const [role, setRole] = useState("student")
  const [conversation, setConversation] = useState([])
  const [isProcessing, setIsProcessing] = useState(false)
  const router = useRouter()

  // Load conversation from local storage on component mount
  useEffect(() => {
    const loadConversation = () => {
      try {
        const savedTimestamp = localStorage.getItem(CONVERSATION_TIMESTAMP_KEY)
        const currentTime = new Date().getTime()

        // Check if conversation is expired
        if (savedTimestamp && currentTime - Number.parseInt(savedTimestamp) > CONVERSATION_EXPIRATION) {
          localStorage.removeItem(CONVERSATION_KEY)
          localStorage.removeItem(CONVERSATION_TIMESTAMP_KEY)
          return
        }

        const savedConversation = localStorage.getItem(CONVERSATION_KEY)
        if (savedConversation) {
          setConversation(JSON.parse(savedConversation))
        }
      } catch (error) {
        console.error("Failed to load conversation:", error)
      }
    }

    loadConversation()
  }, [])

  // Save conversation to local storage whenever it changes
  useEffect(() => {
    const saveConversation = () => {
      try {
        if (conversation.length > 0) {
          localStorage.setItem(CONVERSATION_KEY, JSON.stringify(conversation))
          localStorage.setItem(CONVERSATION_TIMESTAMP_KEY, new Date().getTime().toString())
        }
      } catch (error) {
        console.error("Failed to save conversation:", error)
      }
    }

    saveConversation()
  }, [conversation])

  // Enhanced sync function with role detection
  useEffect(() => {
    const syncUser = async () => {
      if (isLoaded && isSignedIn && user) {
        try {
          // Determine role based on email (you can modify this logic)
          const teacherEmails = ["7276279026.pk@gmail.com", "arjun6mahato@gmail.com"]
          const userRole = teacherEmails.includes(user.primaryEmailAddress?.emailAddress) ? "teacher" : "student"

          setRole(userRole)

          const response = await fetch("/api/sync-user", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              clerkId: user.id,
              userName: user.username || user.primaryEmailAddress?.emailAddress.split("@")[0],
              email: user.primaryEmailAddress?.emailAddress,
              firstName: user.firstName,
              lastName: user.lastName,
              profileImage: user.imageUrl,
              role: userRole,
              metadata: {
                bio: user.publicMetadata?.bio || "",
                expertise: user.publicMetadata?.expertise || [],
                availability: user.publicMetadata?.availability || [],
              },
            }),
          })

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }

          const data = await response.json()
          console.log("User synced:", data)

          toast.success("Profile synced successfully!")
        } catch (error) {
          console.error("Sync failed:", error)
          toast.error("Failed to sync user data")
        }
      }
    }

    syncUser()
  }, [isLoaded, isSignedIn, user])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!userInput.trim() || isProcessing) return

    setIsProcessing(true)
    try {
      // Add user message to conversation
      const userMessage = {
        content: userInput,
        role: "user",
        timestamp: new Date().toISOString(),
      }
      setConversation((prev) => [...prev, userMessage])

      // Show loading toast
      const loadingToast = toast.loading("Processing your message...")

      // Send message to your API route
      const response = await fetch("/api/schedule/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: user.id,
          message: userInput.trim(),
          role: role,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to process message")
      }

      const data = await response.json()

      // Add system response to conversation
      const systemMessage = {
        content: data.response,
        role: "system",
        timestamp: new Date().toISOString(),
        sessions: data.matchingSessions || [],
        extractedData: data.extractedData || null,
      }
      setConversation((prev) => [...prev, systemMessage])

      setUserInput("")

      // Update toast to success
      toast.success("Found matching sessions for you!", {
        id: loadingToast,
      })

      // Scroll to bottom of conversation
      setTimeout(() => {
        const conversationContainer = document.querySelector(".conversation-container")
        if (conversationContainer) {
          conversationContainer.scrollTop = conversationContainer.scrollHeight
        }
      }, 100)
    } catch (error) {
      console.error("Error:", error)
      toast.error("Failed to process your message")
    } finally {
      setIsProcessing(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const clearConversation = () => {
    setConversation([])
    localStorage.removeItem(CONVERSATION_KEY)
    localStorage.removeItem(CONVERSATION_TIMESTAMP_KEY)
    toast.success("Conversation cleared")
  }

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "hsl(var(--background))",
            color: "hsl(var(--foreground))",
            border: "1px solid hsl(var(--border))",
          },
        }}
      />
      <SidebarProvider>
        <SchedulesSidebar />
        <SidebarInset>
          {/* Header */}
          <header className="sticky top-0 flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage className="mx-20">
                    {role === "teacher" ? "Teacher Dashboard" : "Student Dashboard"}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </header>

          {/* Main content */}
          <div className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8">
            <div className="w-full max-w-4xl mx-auto h-full flex flex-col">
              {/* Welcome section */}
              <div className="mb-6 sm:mb-8">
                {isSignedIn ? (
                  <div className="text-center">
                    <h1 className="text-xl sm:text-3xl lg:text-3xl font-medium tracking-tighter mb-2">
                      {role === "teacher" ? "Teach Mode" : "Learn Mode"}
                    </h1>
                    <p className="text-muted-foreground">
                      {role === "teacher"
                        ? "Set your availability and expertise"
                        : "Find sessions that match your schedule"}
                    </p>
                  </div>
                ) : (
                  <p>Not signed in</p>
                )}
              </div>

              {/* Conversation area */}
              <div className="conversation-container flex-1 mb-6 space-y-4 overflow-y-auto min-h-[400px] max-h-[60vh]">
                {conversation.map((msg, index) => (
                  <div
                    key={index}
                    className={`p-4 rounded-lg ${
                      msg.role === "user"
                        ? "bg-primary/10 ml-auto max-w-[80%] sm:max-w-[70%] lg:max-w-[60%]"
                        : "bg-muted/50 mr-auto max-w-[80%] sm:max-w-[70%] lg:max-w-[60%]"
                    }`}
                  >
                    <p>{msg.content}</p>
                    {msg.sessions && msg.sessions.length > 0 && (
                      <div className="mt-2">
                        <div className="grid gap-2">
                          {msg.sessions.map((session, i) => (
                            <div key={i} className="p-3 border rounded-lg bg-background">
                              <h3 className="font-medium">{session.topic}</h3>
                              <p className="text-sm text-muted-foreground">
                                {session.teacherName} • {session.currentStudents} students
                              </p>
                              <p className="text-sm mt-1">
                                {session.schedule.day}, {session.schedule.date} • {session.schedule.startTime}-
                                {session.schedule.endTime}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Input area */}
              <div className="space-y-3 sm:space-y-4">
                {conversation.length > 0 && (
                  <div className="flex justify-center">
                    <Button variant="ghost" size="sm" onClick={clearConversation} className="text-muted-foreground">
                      Clear Conversation
                    </Button>
                  </div>
                )}
                <div className="relative w-full max-w-3xl mx-auto">
                  <div className="relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/30 to-primary/30 rounded-xl blur opacity-75 group-hover:opacity-100 transition duration-1000"></div>
                    <form onSubmit={handleSubmit} className="relative">
                      <Input
                        className="pr-20 py-6 text-base rounded-xl backdrop-blur-md border-2 focus-visible:ring-0 focus-visible:ring-offset-0 
                                                dark:bg-background/20 dark:border-white/5 dark:text-white
                                                bg-white/80 border-primary/10 text-gray-800 shadow-[0_4px_20px_rgba(36,101,237,0.2)]"
                        placeholder={
                          role === "teacher"
                            ? "E.g., 'I can teach React on Mondays 2-4pm'"
                            : "E.g., 'I need help with Python next week'"
                        }
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        onKeyDown={handleKeyPress}
                        disabled={isProcessing}
                      />
                      <Button
                        type="submit"
                        size="icon"
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 h-10 w-10 
                                                bg-primary/90 hover:bg-primary backdrop-blur-md shadow-md"
                        aria-label="Send message"
                        disabled={!userInput.trim() || isProcessing}
                      >
                        {isProcessing ? <div className="animate-spin">↻</div> : <Send className="h-5 w-5" />}
                      </Button>
                    </form>
                  </div>
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    {role === "teacher"
                      ? "Describe your expertise and availability"
                      : "Describe what you want to learn and when"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </>
  )
}

export default DashboardPage
