"use client"
import Navbar from '@/components/navbar'
import React, { useState, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Send, Menu } from "lucide-react"
import Sidebar from '@/components/sidebar'
import { useUser } from '@clerk/nextjs'
import { useToast } from '@/components/ui/toast'

const Page = () => {
    const [message, setMessage] = useState("")
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [userInput, setUserInput] = useState("")
    const { isLoaded, isSignedIn, user } = useUser()
    const [role, setRole] = useState("student")
    const [conversation, setConversation] = useState([])
    const [isProcessing, setIsProcessing] = useState(false)
    const { toast } = useToast()

    // Enhanced sync function with role detection
    useEffect(() => {
        const syncUser = async () => {
            if (isLoaded && isSignedIn && user) {
                try {
                    // Determine role based on email (you can modify this logic)
                    const userRole = user.primaryEmailAddress?.emailAddress === 'akshaynazare3@gmail.com' 
                        ? 'teacher' 
                        : 'student'
                    
                    setRole(userRole)

                    const response = await fetch('/api/sync-user', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            clerkId: user.id,
                            userName: user.username || user.primaryEmailAddress?.emailAddress.split('@')[0],
                            email: user.primaryEmailAddress?.emailAddress,
                            firstName: user.firstName,
                            lastName: user.lastName,
                            profileImage: user.imageUrl,
                            role: userRole,
                            metadata: {
                                bio: user.publicMetadata?.bio || '',
                                expertise: user.publicMetadata?.expertise || [],
                                availability: user.publicMetadata?.availability || []
                            }
                        })
                    })

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`)
                    }

                    const data = await response.json()
                    console.log('User synced:', data)
                    
                    // Load initial sessions based on role
                    loadInitialSessions(userRole)
                    
                } catch (error) {
                    console.error('Sync failed:', error)
                    toast({
                        title: "Sync Error",
                        description: "Failed to sync user data",
                        variant: "destructive"
                    })
                }
            }
        }

        syncUser()
    }, [isLoaded, isSignedIn, user])

    const loadInitialSessions = async (userRole) => {
        try {
            const response = await fetch(`/api/sessions?role=${userRole}&userId=${user.id}`)
            if (response.ok) {
                const sessions = await response.json()
                // Update your sessions state here
            }
        } catch (error) {
            console.error('Failed to load sessions:', error)
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!userInput.trim() || isProcessing) return

        setIsProcessing(true)
        try {
            // Add user message to conversation
            const userMessage = {
                content: userInput,
                role: 'user',
                timestamp: new Date().toISOString()
            }
            setConversation(prev => [...prev, userMessage])

            // Send message to your API route
            const response = await fetch('/api/schedule/process', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    userId: user.id,
                    message: userInput.trim(),
                    role: role
                }),
            })

            if (!response.ok) {
                throw new Error('Failed to process message')
            }

            const data = await response.json()
            
            // Add system response to conversation
            const systemMessage = {
                content: data.response,
                role: 'system',
                timestamp: new Date().toISOString(),
                sessions: data.matchingSessions || [],
                extractedData: data.extractedData || null
            }
            setConversation(prev => [...prev, systemMessage])

            setUserInput("")
            
            // Show success feedback
            toast({
                title: "Message processed",
                description: "We've found matching sessions for you",
            })

        } catch (error) {
            console.error('Error:', error)
            toast({
                title: "Processing Error",
                description: "Failed to process your message",
                variant: "destructive"
            })
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

    return (
        <>
            <Navbar/>
            <div className="min-h-screen bg-background">
                {/* Mobile header with menu */}
                <div className="lg:hidden sticky top-0 z-40 bg-background/95 backdrop-blur border-b">
                    <div className="flex items-center justify-between p-4">
                        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                            <SheetTrigger asChild>
                                <Button variant="outline" size="icon" className="h-9 w-9">
                                    <Menu className="h-4 w-4" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="left" className="p-0 w-72 sm:w-80">
                                <Sidebar role={role} />
                            </SheetContent>
                        </Sheet>
                        <h1 className="text-lg font-bold">
                            {role === 'teacher' ? 'Teacher Dashboard' : 'Student Dashboard'}
                        </h1>
                        <div className="w-9" /> {/* Spacer for centering */}
                    </div>
                </div>

                <div className="lg:flex lg:h-screen">
                    {/* Desktop sidebar */}
                    <div className="hidden lg:block w-64 xl:w-80 flex-shrink-0">
                        <Sidebar role={role} />
                    </div>

                    {/* Main content */}
                    <div className="flex-1 flex flex-col lg:overflow-hidden">
                        <div className="flex-1 p-4 sm:p-6 lg:p-8 lg:overflow-auto">
                            <div className="max-w-4xl mx-auto h-full flex flex-col">
                                {/* Welcome section */}
                                <div className="mb-6 sm:mb-8">
                                    {isSignedIn ? (
                                        <div className="text-center">
                                            <h1 className='text-xl sm:text-3xl lg:text-3xl font-medium tracking-tighter mb-2'>
                                                {role === 'teacher' ? 'Teach Mode' : 'Learn Mode'}
                                            </h1>
                                            <p className="text-muted-foreground">
                                                {role === 'teacher' 
                                                    ? 'Set your availability and expertise' 
                                                    : 'Find sessions that match your schedule'}
                                            </p>
                                        </div>
                                    ) : (
                                        <p>Not signed in</p>
                                    )}
                                </div>

                                {/* Conversation area */}
                                <div className="flex-1 mb-6 space-y-4 overflow-y-auto">
                                    {conversation.map((msg, index) => (
                                        <div key={index} className={`p-4 rounded-lg ${
                                            msg.role === 'user' 
                                                ? 'bg-primary/10 ml-auto max-w-[80%]'
                                                : 'bg-muted/50 mr-auto max-w-[80%]'
                                        }`}>
                                            <p>{msg.content}</p>
                                            {msg.sessions && msg.sessions.length > 0 && (
                                                <div className="mt-2">
                                                    {/* Render session suggestions */}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Input area */}
                                <div className="space-y-3 sm:space-y-4">
                                    <div className="relative w-full max-w-2xl mx-auto">
                                        <div className="relative group">
                                            <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/30 to-primary/30 rounded-xl blur opacity-75 group-hover:opacity-100 transition duration-1000"></div>
                                            <form onSubmit={handleSubmit} className="relative">
                                                <Input
                                                    className="pr-20 py-6 text-base rounded-xl backdrop-blur-md border-2 focus-visible:ring-0 focus-visible:ring-offset-0 
                                                    dark:bg-background/20 dark:border-white/5 dark:text-white
                                                    bg-white/80 border-primary/10 text-gray-800 shadow-[0_4px_20px_rgba(36,101,237,0.2)]"
                                                    placeholder={
                                                        role === 'teacher' 
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
                                                    {isProcessing ? (
                                                        <div className="animate-spin">↻</div>
                                                    ) : (
                                                        <Send className="h-5 w-5" />
                                                    )}
                                                </Button>
                                            </form>
                                        </div>
                                        <p className="text-xs text-muted-foreground text-center mt-2">
                                            {role === 'teacher' 
                                                ? 'Describe your expertise and availability' 
                                                : 'Describe what you want to learn and when'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

export default Page