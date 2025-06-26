"use client"

import { useState, useEffect } from "react"
import { Calendar, Clock, Users, Filter, Search, Plus, MoreHorizontal, Eye, Edit, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

const ModernSessionsPage = () => {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all")
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedDate, setSelectedDate] = useState("")
  const router = useRouter()

  useEffect(() => {
    fetchSessions()
  }, [filter, selectedDate])

  const fetchSessions = async () => {
    try {
      setLoading(true)
      
      // Build query parameters based on current filters
      const params = new URLSearchParams()
      if (filter !== "all") {
        params.append("status", filter)
      }
      if (selectedDate) {
        params.append("date", selectedDate)
      }
      
      const response = await fetch(`/api/sessions?${params.toString()}`)
      if (!response.ok) {
        throw new Error("Failed to fetch sessions")
      }
      
      const data = await response.json()
      setSessions(data.data || [])
    } catch (error) {
      console.error("Error fetching sessions:", error)
      toast.error("Failed to load sessions")
    } finally {
      setLoading(false)
    }
  }

  const handleCreateSession = () => {
    router.push("/sessions/create")
  }

  const handleViewDetails = (sessionId) => {
    router.push(`/sessions/${sessionId}`)
  }

  const handleEditSession = (sessionId) => {
    router.push(`/sessions/${sessionId}/edit`)
  }

  const handleDeleteSession = async (sessionId) => {
    try {
      const response = await fetch(`/api/sessions?sessionId=${sessionId}`, {
        method: "DELETE"
      })
      
      if (!response.ok) {
        throw new Error("Failed to delete session")
      }
      
      toast.success("Session deleted successfully")
      fetchSessions() // Refresh the list
    } catch (error) {
      console.error("Error deleting session:", error)
      toast.error("Failed to delete session")
    }
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
      case "coordinated":
        return "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800"
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

  const filteredSessions = sessions.filter(
    (session) =>
      session.topic.toLowerCase().includes(searchTerm.toLowerCase()) ||
      session.teacherId?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  ).filter((session) => {
    if (filter === "all") return true
    if (filter === "coordinated") return session.status === "coordinated"
    return session.status === filter
  })
  
  // Update stats to include coordinated status if needed
  const stats = {
    total: sessions.length,
    pending: sessions.filter((s) => s.status === "pending").length,
    scheduled: sessions.filter((s) => s.status === "scheduled").length,
    completed: sessions.filter((s) => s.status === "completed").length,
    cancelled: sessions.filter((s) => s.status === "cancelled").length,
    coordinated: sessions.filter((s) => s.status === "coordinated").length,
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
                <h1 className="text-4xl font-bold text-foreground mb-2">Session Management</h1>
                <p className="text-muted-foreground text-lg">Organize and track your learning sessions</p>
              </div>
            </div>

            <Button size="lg" className="shadow-lg" onClick={handleCreateSession}>
              <Plus className="w-5 h-5 mr-2" />
              Create Session
            </Button>
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

        {/* Filters and Search */}
        <Card className="mb-8 shadow-sm">
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
                <Input
                  type="text"
                  placeholder="Search sessions by topic or instructor..."
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
                    <SelectItem value="coordinated">Coordinated</SelectItem>
                  </SelectContent>
                </Select>

                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-48"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sessions Grid */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="h-6 bg-muted rounded mb-4"></div>
                  <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                  <div className="h-4 bg-muted rounded w-1/2"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredSessions.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Calendar className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-foreground mb-2">No sessions found</h3>
              <p className="text-muted-foreground">Try adjusting your filters or create a new session.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredSessions.map((session) => (
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
                        <DropdownMenuItem onClick={() => handleEditSession(session._id)}>
                          <Edit className="w-4 h-4 mr-2" />
                          Edit Session
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-destructive"
                          onClick={() => handleDeleteSession(session._id)}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
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
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-foreground">
                      <Users className="w-4 h-4 text-primary" />
                      <span className="text-sm">
                        {session.studentIds?.length || 0} student{session.studentIds?.length !== 1 ? "s" : ""}
                      </span>
                    </div>
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