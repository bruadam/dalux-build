"use client"

import * as React from "react"
import Link from "next/link"
import { RowsIcon, WebhooksLogoIcon, ClockIcon } from "@phosphor-icons/react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"

const navMain = [
  {
    title: "Register webhook",
    url: "/",
    icon: <WebhooksLogoIcon />,
  },
  {
    title: "Jobs",
    url: "#",
    icon: <ClockIcon />,
    disabled: true,
  },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <RowsIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Dalux Webhooks</span>
                  <span className="truncate text-xs">Monitor registration</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
