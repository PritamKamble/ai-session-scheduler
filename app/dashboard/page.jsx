"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send, Users, Calendar, Clock, User, BookOpen, ArrowRight, CheckCircle } from "lucide-react"
import { SchedulesSidebar } from "@/components/schedules-sidebar"
import { useUser } from "@clerk/nextjs"
import toast, { Toaster } from "react-hot-toast"
import { useRouter } from "next/navigation"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

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
          // Determine role based on email
          const teacherEmails = ["7276279026.pk@gmail.com", "arjun6mahato@gmail.com",'akshayynazare@gmail.com']
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
      else if (isLoaded && !isSignedIn) {
        // Redirect to sign-in page if not signed in
        toast.error("You must be signed in to access the dashboard")
        router.push("/")
      }
    }

    syncUser()
  }, [isLoaded, isSignedIn, user])

  const formatResponse = (text) => {
    // Convert markdown bold to strong
    let formatted = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Convert bullet points to list items
    formatted = formatted.replace(/^-\s(.*$)/gm, '<li>$1</li>')
    // Convert line breaks to paragraphs
    formatted = formatted.split('\n').map(paragraph => {
      if (paragraph.startsWith('<li>')) return paragraph
      return `<p>${paragraph}</p>`
    }).join('')
    return formatted
  }

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
        matchingSessions: data.matchingSessions || [],
        allSessions: data.allSessions || [],
        extractedData: data.extractedData || null,
        sessionAction: data.sessionAction || null,
        intent: data.intent || null,
      }
      setConversation((prev) => [...prev, systemMessage])

      setUserInput("")

      // Update toast based on action
      if (data.sessionAction === 'joined_session') {
        toast.success("Successfully joined the session!", { id: loadingToast })
      } else if (data.sessionAction === 'provided_information') {
        toast.success("Here's the information you requested", { id: loadingToast })
      } else if (data.sessionAction === 'listed_all_sessions') {
        toast.success("Showing all available sessions", { id: loadingToast })
      } else {
        toast.success("Message processed successfully", { id: loadingToast })
      }

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

  const handleJoinSession = async (sessionId) => {
    try {
      const response = await fetch("/api/schedule/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: user.id,
          sessionId: sessionId,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to join session")
      }

      const data = await response.json()
      toast.success("Successfully joined the session!")
      
      // Update conversation to reflect the join
      setConversation(prev => [...prev, {
        content: `You have successfully joined the session!`,
        role: "system",
        timestamp: new Date().toISOString(),
        sessionAction: "joined_session"
      }])
    } catch (error) {
      console.error("Error joining session:", error)
      toast.error("Failed to join session")
    }
  }

  const getStatusBadge = (status) => {
    const statusConfig = {
      pending: { color: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20", text: "Pending" },
      coordinated: { color: "bg-blue-500/10 text-blue-700 border-blue-500/20", text: "Coordinated" },
      scheduled: { color: "bg-green-500/10 text-green-700 border-green-500/20", text: "Scheduled" },
      completed: { color: "bg-gray-500/10 text-gray-700 border-gray-500/20", text: "Completed" },
    }
    
    const config = statusConfig[status] || statusConfig.pending
    return (
      <Badge variant="outline" className={`${config.color} border`}>
        {config.text}
      </Badge>
    )
  }

  const renderSessionCard = (session, index, isInquiry = false) => (
    <Card key={index} className="border-l-4 border-l-primary/50 hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg">
              <span className="font-bold">• {session.topic}</span>
            </CardTitle>
            <div className="mt-2 space-y-1">
              <p className="text-sm flex items-center gap-1">
                <User className="h-4 w-4" />
                <span className="font-semibold">Teacher:</span> {session.teacherName}
              </p>
              <p className="text-sm flex items-center gap-1">
                <Users className="h-4 w-4" />
                <span className="font-semibold">Current Enrollment:</span> {session.currentStudents} students
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {getStatusBadge(session.status)}
          </div>
        </div>
      </CardHeader>
      {session.schedule && (
        <CardContent className="pt-0">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {session.schedule.day}
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {session.schedule.startTime}-{session.schedule.endTime}
            </div>
          </div>
          
          {isInquiry && role === "student" && (
            <div className="flex gap-2 mt-3">
              <Button 
                size="sm" 
                onClick={() => handleJoinSession(session.id)}
                className="flex items-center gap-2"
              >
                <CheckCircle className="h-4 w-4" />
                Join Session
              </Button>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => setUserInput(`Tell me more about ${session.topic} session`)}
              >
                Learn More
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )

  const renderSessionsList = (sessions, title, intent) => {
    if (!sessions || sessions.length === 0) return null

    const isInquiry = intent === 'inquiry' || intent === 'list_request'

    return (
      <div className="mt-4 space-y-3">
        <h3 className="font-medium text-sm text-muted-foreground flex items-center gap-2">
          <ArrowRight className="h-4 w-4" />
          {title}
        </h3>
        <div className="space-y-3">
          {sessions.map((session, index) => renderSessionCard(session, index, isInquiry))}
        </div>
      </div>
    )
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
                        : "bg-muted/50 mr-auto max-w-[90%] sm:max-w-[85%] lg:max-w-[80%]"
                    }`}
                  >
                    {msg.role === "system" ? (
                      <div 
                        className="whitespace-pre-wrap"
                        dangerouslySetInnerHTML={{ __html: formatResponse(msg.content) }}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                    
                    {/* Display action indicator */}
                    {msg.sessionAction && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {msg.sessionAction === 'joined_session' && '✅ Joined session successfully'}
                        {msg.sessionAction === 'provided_information' && 'ℹ️ Information provided'}
                        {msg.sessionAction === 'listed_all_sessions' && '📋 All sessions listed'}
                        {msg.sessionAction === 'already_enrolled' && '👤 Already enrolled in session'}
                        {msg.sessionAction === 'no_matching_sessions' && '❌ No matching sessions found'}
                      </div>
                    )}

                    {/* Render matching sessions */}
                    {msg.matchingSessions && msg.matchingSessions.length > 0 && 
                      renderSessionsList(msg.matchingSessions, "Matching Sessions", msg.intent)}

                    {/* Render all sessions for list requests */}
                    {msg.allSessions && msg.allSessions.length > 0 && 
                      renderSessionsList(msg.allSessions, "All Available Sessions", msg.intent)}

                    {/* Show extracted data for debugging (optional) */}
                    
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
                            : "E.g., 'I need help with Python', 'list all sessions', 'tell me about React session'"
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
                      : "Ask about sessions, join one, or list all available sessions"}
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