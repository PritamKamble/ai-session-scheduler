import React, { useState } from 'react'
import { Send, Menu, Calendar, MessageSquare, Settings, Bell, Home, Users, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const Sidebar = () => {
    const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeItem, setActiveItem] = useState("dashboard")

    const sidebarItems = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "schedules", label: "Schedules", icon: Calendar, badge: "2" },
  ]
  return (
    <div className="h-full bg-muted/30 border-r">
      <nav className="p-2 sm:p-4 space-y-1 sm:space-y-2">
        {sidebarItems.map((item) => (
          <Button
            key={item.id}
            variant={activeItem === item.id ? "secondary" : "ghost"}
            className={cn(
              "w-full justify-start gap-2 sm:gap-3 h-9 sm:h-10 text-sm sm:text-base px-2 sm:px-3",
              activeItem === item.id && "bg-primary/10 text-primary",
            )}
            onClick={() => {
              setActiveItem(item.id)
              setSidebarOpen(false)
            }}
          >
            <item.icon className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
            <span className="truncate">{item.label}</span>
            {item.badge && (
              <Badge variant="secondary" className="ml-auto h-4 sm:h-5 px-1.5 sm:px-2 text-xs flex-shrink-0">
                {item.badge}
              </Badge>
            )}
          </Button>
        ))}
      </nav>
    </div>
  )
}

export default Sidebar