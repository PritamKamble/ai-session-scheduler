"use client"

import { useState, useEffect } from "react"
import {
  Calendar,
  Clock,
  Users,
  Plus,
  MoreHorizontal,
  Eye,
  Edit,
  Trash2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LinkIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from "@clerk/nextjs"
import { Skeleton } from "@/components/ui/skeleton"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar"
import Link from "next/link"

export function SchedulesSidebar({ side = "left", ...props }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all")
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedDate, setSelectedDate] = useState("")
  const [includeAvailability, setIncludeAvailability] = useState(false)
  const [useVectorSearch, setUseVectorSearch] = useState(false)
  const [expandedSessions, setExpandedSessions] = useState(new Set())
  const [currentPage, setCurrentPage] = useState(1)
  const [limit] = useState(10)
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    scheduled: 0,
    completed: 0,
    cancelled: 0,
    upcoming: 0,
    today: 0,
    currentPage: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
    vectorSearchUsed: false,
    averageScore: null,
  })

  const router = useRouter()
  const { isLoaded, user } = useUser()

  useEffect(() => {
    if (isLoaded && user) {
      fetchSessions()
    }
  }, [filter, selectedDate, includeAvailability, useVectorSearch, currentPage, isLoaded, user])

  const fetchSessions = async () => {
    try {
      setLoading(true)

      if (!user) return

      const params = new URLSearchParams()

      params.append("userId", user.id)
      const teacherEmails = ["7276279026.pk@gmail.com", "arjun6mahato@gmail.com", "akshayynazare@gmail.com","patiljayesh95666@gmail.com"]

      if (teacherEmails.includes(user.primaryEmailAddress?.emailAddress)) {
        params.append("userRole", "teacher")
      } else {
        params.append("userRole", "student")
      }
      params.append("page", currentPage.toString())
      params.append("limit", limit.toString())

      if (filter !== "all") params.append("status", filter)
      if (selectedDate) {
        const date = new Date(selectedDate)
        if (!isNaN(date.getTime())) {
          const formattedDate = date.toISOString().split("T")[0]
          params.append("date", formattedDate)
        }
      }
      if (searchTerm.trim()) params.append("topic", searchTerm.trim())
      if (includeAvailability) params.append("includeAvailability", "true")

      if (user.publicMetadata?.role === "student" && useVectorSearch) {
        params.append("useVectorSearch", "true")
        params.append("minScore", "0.7")
      }

      const response = await fetch(`/api/sessions?${params.toString()}`)

      if (!response.ok) {
        const errorData = await response.json()

        switch (response.status) {
          case 403:
            toast.error("Access denied - insufficient permissions")
            break
          case 404:
            toast.error("User or resource not found")
            break
          case 400:
            toast.error("Invalid request parameters")
            break
          default:
            toast.error(errorData.error || "Failed to fetch sessions")
        }

        throw new Error(errorData.error || "Failed to fetch sessions")
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || "Failed to fetch sessions")
      }

      // Add hardcoded meeting link to each session
      const sessionsWithMeetingLink = data.data.map((session) => ({
        ...session,
        meetingLink: "https://meet.google.com/qyt-dpvs-sds",
      }))

      setSessions(sessionsWithMeetingLink || [])

      setStats({
        total: data.aggregation?.total || 0,
        pending: data.aggregation?.byStatus?.pending || 0,
        scheduled: data.aggregation?.byStatus?.scheduled || 0,
        completed: data.aggregation?.byStatus?.completed || 0,
        cancelled: data.aggregation?.byStatus?.cancelled || 0,
        upcoming: data.aggregation?.upcomingSessions || 0,
        today: data.aggregation?.todaySessions || 0,
        currentPage: data.aggregation?.currentPage || 1,
        totalPages: data.aggregation?.totalPages || 1,
        hasNextPage: data.aggregation?.hasNextPage || false,
        hasPrevPage: data.aggregation?.hasPrevPage || false,
        vectorSearchUsed: data.aggregation?.vectorSearchUsed || false,
        averageScore: data.aggregation?.averageScore || null,
      })

      if (data.aggregation?.vectorSearchUsed) {
        toast.success(`Found ${data.data.length} sessions using AI recommendations`)
      }
    } catch (error) {
      console.error("Error fetching sessions:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateSession = () => {
    router.push("/sessions/create")
  }

  const handleViewDetails = (sessionId) => {
    router.push(`/session/${sessionId}`)
  }

  const handleEditSession = async (sessionId) => {
    const session = sessions.find((s) => s._id === sessionId)
    if (!session) return

    const isOwner =
      (session.teacherId._id && session.teacherId._id.toString() === user.id) ||
      (session.teacherId.clerkId && session.teacherId.clerkId === user.id)

    if (!isOwner) {
      toast.error("You can only edit your own sessions")
      return
    }

    router.push(`/sessions/${sessionId}/edit`)
  }

  const handleDeleteSession = async (sessionId) => {
    try {
      const session = sessions.find((s) => s._id === sessionId)
      if (!session) return

      const isOwner =
        (session.teacherId._id && session.teacherId._id.toString() === user.id) ||
        (session.teacherId.clerkId && session.teacherId.clerkId === user.id)

      if (!isOwner) {
        toast.error("You can only delete your own sessions")
        return
      }

      const response = await fetch(`/api/sessions?sessionId=${sessionId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to delete session")
      }

      toast.success("Session deleted successfully")
      fetchSessions()
    } catch (error) {
      console.error("Error deleting session:", error)
      toast.error(error.message || "Failed to delete session")
    }
  }

  const toggleSessionExpansion = (sessionId) => {
    const newExpanded = new Set(expandedSessions)
    if (newExpanded.has(sessionId)) {
      newExpanded.delete(sessionId)
    } else {
      newExpanded.add(sessionId)
    }
    setExpandedSessions(newExpanded)
  }

  const getStatusColor = (status) => {
    switch (status) {
      case "pending":
        return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
      case "scheduled":
        return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800"
      case "completed":
        return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
      case "cancelled":
        return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800"
      default:
        return "bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-950 dark:text-gray-300 dark:border-gray-800"
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return "No date set"
    return new Date(dateString).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
  }

  const formatTimeSlot = (session) => {
    if (!session.schedule) return "No time set"
    return `${session.schedule.startTime || ""} - ${session.schedule.endTime || ""}`
  }

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= stats.totalPages) {
      setCurrentPage(newPage)
    }
  }

  const renderEnrolledStudents = (session) => {
    const students = session.studentIds || []

    if (students.length === 0) {
      return <div className="text-sm text-muted-foreground italic">No students enrolled yet</div>
    }

    return (
      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground mb-2">Enrolled ({students.length}):</div>
        <div className="space-y-2">
          {students.slice(0, 3).map((student, index) => (
            <div key={student._id || index} className="flex items-center gap-3 p-2 bg-muted/30 rounded-lg">
              <div className="w-6 h-6 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                <span className="text-blue-700 dark:text-blue-300 text-xs font-semibold">
                  {student.name?.charAt(0) || student.email?.charAt(0) || "S"}
                </span>
              </div>
              <span className="text-sm text-foreground truncate">{student.name || "Student"}</span>
            </div>
          ))}
          {students.length > 3 && (
            <div className="text-sm text-muted-foreground">+{students.length - 3} more students</div>
          )}
        </div>
      </div>
    )
  }

  const renderPagination = () => {
    if (stats.totalPages <= 1) return null

    return (
      <div className="flex items-center justify-between mt-6 pt-4 border-t">
        <div className="text-sm text-muted-foreground">
          Page {stats.currentPage} of {stats.totalPages}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={!stats.hasPrevPage}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={!stats.hasNextPage}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Sidebar side={side} className="border-r w-80 lg:w-96" {...props}>
      <SidebarHeader className="p-6">
        <div className="flex items-center gap-4 mb-6">
          
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              {user?.publicMetadata?.role === "teacher" ? "My Sessions" : "My Learning"}
            </h2>
            <p className="text-sm text-muted-foreground ">
              {user?.publicMetadata?.role === "teacher" ? "Teaching schedule" : "Enrolled sessions"}
            </p>
                              <div className="ml-32 -my-10">
                                <SignedOut>
                                <SignInButton mode="modal">
                                  <Button variant="outline" className="w-full" onClick={() => setIsOpen(false)}>
                                    Sign In
                                  </Button>
                                </SignInButton>
                              </SignedOut>
                              <SignedIn>
                                <div className="flex justify-center" style={{ touchAction: 'manipulation' }}>
  <UserButton 
    afterSignOutUrl="/" 
    appearance={{
      elements: {
        userButtonAvatarBox: {
          width: '40px',
          height: '40px'
        }
      }
    }}
  />
</div>
                              </SignedIn>
                              </div>
          </div>
        </div>

        {user?.publicMetadata?.role === "teacher" && (
          <Button className="w-full" onClick={handleCreateSession}>
            <Plus className="w-4 h-4 mr-2" />
            Create New Session
          </Button>
        )}
      </SidebarHeader>

      <SidebarContent className="px-6">
        {/* Quick Stats */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-base font-medium">Quick Stats</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <Card className="p-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-foreground">{stats.total}</div>
                  <div className="text-sm text-muted-foreground">Total Sessions</div>
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.upcoming}</div>
                  <div className="text-sm text-muted-foreground">Upcoming</div>
                </div>
              </Card>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Sessions List */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-base font-medium">Sessions</SidebarGroupLabel>
          <SidebarGroupContent>
            {loading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <Card key={i} className="p-4">
                    <Skeleton className="h-5 w-3/4 mb-3" />
                    <Skeleton className="h-4 w-full mb-2" />
                    <Skeleton className="h-4 w-1/2" />
                  </Card>
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <Card className="p-6 text-center">
                <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-sm text-muted-foreground mb-4">
                  {searchTerm || filter !== "all" || selectedDate
                    ? "No sessions match your current filters"
                    : "No sessions found"}
                </p>
                {user?.publicMetadata?.role === "teacher" && !searchTerm && filter === "all" && !selectedDate && (
                  <Button onClick={handleCreateSession}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Your First Session
                  </Button>
                )}
              </Card>
            ) : (
              <div className="space-y-4">
                {sessions.map((session) => (
                  <Card
                    key={session._id}
                    className="p-4 hover:shadow-lg transition-all duration-200 cursor-pointer border-l-4 border-l-primary/20 hover:border-l-primary"
                    onClick={() => handleViewDetails(session._id)}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 pr-3">
                          <h4 className="text-base font-semibold text-foreground mb-1 line-clamp-2">{session.topic}</h4>
                          {session.similarityScore !== undefined && (
                            <div className="text-sm text-blue-600 dark:text-blue-400 mb-2">
                              AI Match: {Math.round(session.similarityScore * 100)}%
                            </div>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation()
                                handleViewDetails(session._id)
                              }}
                            >
                              <Eye className="w-4 h-4 mr-2" />
                              View Details
                            </DropdownMenuItem>
                            {user?.publicMetadata?.role === "teacher" && (
                              <>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleEditSession(session._id)
                                  }}
                                >
                                  <Edit className="w-4 h-4 mr-2" />
                                  Edit Session
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteSession(session._id)
                                  }}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Delete Session
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <Badge className={`${getStatusColor(session.status)} text-sm px-3 py-1`}>
                        {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                      </Badge>

                      <div className="space-y-2">
                        <div className="flex items-center gap-3 text-sm text-foreground">
                          <Calendar className="w-4 h-4 text-primary" />
                          <span>{formatDate(session.schedule?.date)}</span>
                        </div>

                        <div className="flex items-center gap-3 text-sm text-foreground">
                          <Clock className="w-4 h-4 text-primary" />
                          <span>{formatTimeSlot(session)}</span>
                        </div>

                        {session.meetingLink && (
                          <div className="flex items-center gap-3 text-sm text-foreground">
                            <LinkIcon className="w-4 h-4 text-primary" />
                            <a
                              href={session.meetingLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Join Meeting
                            </a>
                          </div>
                        )}

                        <Collapsible>
                          <CollapsibleTrigger
                            className="flex items-center gap-3 text-sm text-foreground hover:text-primary transition-colors w-full"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleSessionExpansion(session._id)
                            }}
                          >
                            <Users className="w-4 h-4 text-primary" />
                            <span>
                              {session.totalStudents || 0} student{session.totalStudents !== 1 ? "s" : ""} enrolled
                            </span>
                            {session.totalStudents > 0 && (
                              <ChevronDown className="w-4 h-4 text-muted-foreground ml-auto" />
                            )}
                          </CollapsibleTrigger>

                          <CollapsibleContent className="mt-3">{renderEnrolledStudents(session)}</CollapsibleContent>
                        </Collapsible>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                        <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                          <span className="text-primary-foreground text-sm font-semibold">
                            {session.teacherId?.name?.charAt(0) || "T"}
                          </span>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {session.teacherId?.name || "Unknown Instructor"}
                          </div>
                          <div className="text-xs text-muted-foreground">Instructor</div>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}

                {renderPagination()}
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-6">
        {stats.total > 0 && (
          <div className="text-sm text-muted-foreground text-center">
            Showing {sessions.length} of {stats.total} sessions
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
