"use client"

import { usePathname } from "next/navigation"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"

const PAGE_TITLES: Record<string, string> = {
  "/": "Register webhook",
  "/webhooks": "Webhooks",
  "/credentials": "Credentials",
}

export function PageBreadcrumb() {
  const pathname = usePathname()
  const title = PAGE_TITLES[pathname] ?? "Dalux Webhooks"

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbPage>{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
