"use client"

import { useState, useEffect } from "react"
import { Calendar, Clock, Users, Filter, Search, Plus, MoreHorizontal, Eye, Edit, Trash2, UserCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useUser } from "@clerk/nextjs"
import Link from "next/link"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

const ModernSessionsPage = () => {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all")
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedDate, setSelectedDate] = useState("")
  const [includeAvailability, setIncludeAvailability] = useState(false)
  const [expandedSessions, setExpandedSessions] = useState(new Set())
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    scheduled: 0,
    completed: 0,
    cancelled: 0,
    upcoming: 0,
    today: 0
  })
  
  const router = useRouter()
  const { isLoaded, user } = useUser()

  useEffect(() => {
    if (isLoaded && user) {
      fetchSessions()
    }
  }, [filter, selectedDate, includeAvailability, isLoaded, user])

  const fetchSessions = async () => {
    try {
      setLoading(true)
      
      if (!user) return
      
      // Build query parameters
      const params = new URLSearchParams()
      if (filter !== "all") params.append("status", filter)
      if (selectedDate) {
        const formattedDate = new Date(selectedDate).toISOString().split('T')[0]
        params.append("date", formattedDate)
      }
      if (searchTerm) params.append("topic", searchTerm)
      if (includeAvailability) params.append("includeAvailability", "true")
      
      // Add user context
      const userRole = user.publicMetadata?.role
      params.append("userId", user.id)
      params.append("userRole", userRole)
      
      const response = await fetch(`/api/sessions?${params.toString()}`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to fetch sessions")
      }
      
      const data = await response.json()
      setSessions(data.data || [])
      
      // Update stats from API aggregation data
      setStats({
        total: data.aggregation?.total || 0,
        pending: data.aggregation?.byStatus?.pending || 0,
        scheduled: data.aggregation?.byStatus?.scheduled || 0,
        completed: data.aggregation?.byStatus?.completed || 0,
        cancelled: data.aggregation?.byStatus?.cancelled || 0,
        upcoming: data.aggregation?.upcomingSessions || 0,
        today: data.aggregation?.todaySessions || 0
      })
    } catch (error) {
      console.error("Error fetching sessions:", error)
      toast.error(error.message || "Failed to load sessions")
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
    const session = sessions.find(s => s._id === sessionId)
    if (!session) return
    
    // Check if user is the teacher of this session (handles both MongoDB _id and Clerk ID)
    if ((session.teacherId._id && session.teacherId._id.toString() !== user.id) && 
        (session.teacherId.clerkId && session.teacherId.clerkId !== user.id)) {
      toast.error("You can only edit your own sessions")
      return
    }
    
    router.push(`/sessions/${sessionId}/edit`)
  }

  const handleDeleteSession = async (sessionId) => {
    try {
      const session = sessions.find(s => s._id === sessionId)
      if (!session) return
      
      // Check permissions (handles both MongoDB _id and Clerk ID)
      if ((session.teacherId._id && session.teacherId._id.toString() !== user.id) && 
          (session.teacherId.clerkId && session.teacherId.clerkId !== user.id)) {
        toast.error("You can only delete your own sessions")
        return
      }
      
      const response = await fetch(`/api/sessions?sessionId=${sessionId}`, {
        method: "DELETE"
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
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const formatTimeSlot = (session) => {
    if (!session.schedule) return "No time set"
    return `${session.schedule.startTime || ''} - ${session.schedule.endTime || ''}`
  }

  const handleSearch = (e) => {
    e.preventDefault()
    fetchSessions()
  }

  const renderEnrolledStudents = (session) => {
    const students = session.studentIds || []
    
    if (students.length === 0) {
      return (
        <div className="text-sm text-muted-foreground italic">
          No students enrolled yet
        </div>
      )
    }

    return (
      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground mb-2">
          Enrolled Students ({students.length}):
        </div>
        <div className="space-y-2">
          {students.map((student, index) => (
            <div key={student._id || index} className="flex items-center gap-3 p-2 bg-muted/30 rounded-lg">
              <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                <span className="text-blue-700 dark:text-blue-300 text-xs font-semibold">
                  {student.name?.charAt(0) || student.email?.charAt(0) || "S"}
                </span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  {student.name || "Student"}
                </p>
                {student.email && (
                  <p className="text-xs text-muted-foreground">
                    {student.email}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary rounded-2xl shadow-lg">
                <Calendar className="w-7 h-7 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-4xl font-bold text-foreground mb-2">
                  {user?.publicMetadata?.role === "teacher" ? "My Teaching Sessions" : "My Learning Sessions"}
                </h1>
                <p className="text-muted-foreground text-lg">
                  {user?.publicMetadata?.role === "teacher" 
                    ? "Manage your teaching schedule" 
                    : "View your enrolled sessions"}
                </p>
                <Link href="/dashboard">
                  <p className="text-zinc-500 lg:text-md text-sm tracking-tighter hover:underline">Back to dashboard</p>
                </Link>
              </div>
            </div>

            {user?.publicMetadata?.role === "teacher" && (
              <Button size="lg" className="shadow-lg" onClick={handleCreateSession}>
                <Plus className="w-5 h-5 mr-2" />
                Create Session
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-foreground mb-1">{stats.total}</div>
                <div className="text-muted-foreground text-sm">Total Sessions</div>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-amber-600 dark:text-amber-400 mb-1">{stats.pending}</div>
                <div className="text-muted-foreground text-sm">Pending</div>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-1">{stats.scheduled}</div>
                <div className="text-muted-foreground text-sm">Scheduled</div>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mb-1">{stats.completed}</div>
                <div className="text-muted-foreground text-sm">Completed</div>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-red-600 dark:text-red-400 mb-1">{stats.cancelled}</div>
                <div className="text-muted-foreground text-sm">Cancelled</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Additional Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-foreground mb-1">{stats.upcoming}</div>
                  <div className="text-muted-foreground text-sm">Upcoming Sessions</div>
                </div>
                <Calendar className="w-8 h-8 text-primary" />
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-foreground mb-1">{stats.today}</div>
                  <div className="text-muted-foreground text-sm">Today's Sessions</div>
                </div>
                <Clock className="w-8 h-8 text-primary" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Search */}
        <Card className="mb-8 shadow-sm">
          <CardContent className="p-6">
            <form onSubmit={handleSearch} className="flex flex-col lg:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
                <Input
                  type="text"
                  placeholder="Search sessions by topic..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="flex gap-4">
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger className="w-48">
                    <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>

                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-48"
                />

                <Button type="submit" variant="outline">
                  Apply Filters
                </Button>
              </div>
            </form>

            {user?.publicMetadata?.role === "teacher" && (
              <div className="mt-4 flex items-center">
                <input
                  type="checkbox"
                  id="includeAvailability"
                  checked={includeAvailability}
                  onChange={(e) => setIncludeAvailability(e.target.checked)}
                  className="mr-2"
                />
                <label htmlFor="includeAvailability" className="text-sm text-muted-foreground">
                  Include availability data
                </label>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sessions Grid */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <Skeleton className="h-6 w-3/4 mb-4" />
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-1/2 mb-6" />
                  <Skeleton className="h-10 w-full rounded-xl" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Calendar className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-foreground mb-2">No sessions found</h3>
              <p className="text-muted-foreground mb-4">
                {user?.publicMetadata?.role === "teacher"
                  ? "You haven't created any sessions yet."
                  : "You haven't joined any sessions yet."}
              </p>
              {user?.publicMetadata?.role === "teacher" && (
                <Button onClick={handleCreateSession}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Session
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {sessions.map((session) => (
              <Card
                key={session._id}
                className="group hover:shadow-xl transition-all duration-300 hover:scale-[1.02] border-2 hover:border-primary/20"
              >
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-foreground mb-3 group-hover:text-primary transition-colors">
                        {session.topic}
                      </h3>
                      <Badge className={`${getStatusColor(session.status)} border font-medium`}>
                        {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                      </Badge>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => handleViewDetails(session._id)}>
                          <Eye className="w-4 h-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        {user?.publicMetadata?.role === "teacher" && (
                          <>
                            <DropdownMenuItem onClick={() => handleEditSession(session._id)}>
                              <Edit className="w-4 h-4 mr-2" />
                              Edit Session
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleDeleteSession(session._id)}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>

                <CardContent className="pt-0">
                  {session.notes && (
                    <p className="text-muted-foreground text-sm mb-6 line-clamp-2">{session.notes}</p>
                  )}

                  <div className="space-y-4 mb-6">
                    <div className="flex items-center gap-3 text-foreground">
                      <Calendar className="w-4 h-4 text-primary" />
                      <span className="text-sm">{formatDate(session.schedule?.date)}</span>
                    </div>

                    <div className="flex items-center gap-3 text-foreground">
                      <Clock className="w-4 h-4 text-primary" />
                      <span className="text-sm">
                        {formatTimeSlot(session)}
                        {session.schedule?.timezone && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="ml-2 text-xs text-muted-foreground">
                                  ({session.schedule.timezone})
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Timezone</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </span>
                    </div>

                    <Collapsible>
                      <CollapsibleTrigger 
                        className="flex items-center gap-3 text-foreground hover:text-primary transition-colors w-full"
                        onClick={() => toggleSessionExpansion(session._id)}
                      >
                        <Users className="w-4 h-4 text-primary" />
                        <span className="text-sm">
                          {session.totalStudents || 0} student{session.totalStudents !== 1 ? "s" : ""}
                        </span>
                        {session.totalStudents > 0 && (
                          <UserCheck className="w-3 h-3 text-muted-foreground ml-auto" />
                        )}
                      </CollapsibleTrigger>
                      
                      <CollapsibleContent className="mt-3 pl-7">
                        {renderEnrolledStudents(session)}
                      </CollapsibleContent>
                    </Collapsible>

                    {includeAvailability && session.hasTeacherAvailability && (
                      <div className="flex items-center gap-3 text-foreground">
                        <Badge variant="outline" className="text-xs">
                          {session.availabilityOptions?.length || 0} availability slots
                        </Badge>
                      </div>
                    )}

                    {includeAvailability && session.hasStudentPreferences && (
                      <div className="flex items-center gap-3 text-foreground">
                        <Badge variant="outline" className="text-xs">
                          {session.studentPreferencesCount || 0} student preferences
                        </Badge>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-xl border">
                    <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
                      <span className="text-primary-foreground text-sm font-semibold">
                        {session.teacherId?.name?.charAt(0) || "T"}
                      </span>
                    </div>
                    <div>
                      <p className="text-foreground font-medium text-sm">
                        {session.teacherId?.name || "Unknown Instructor"}
                      </p>
                      <p className="text-muted-foreground text-xs">Lead Instructor</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ModernSessionsPage