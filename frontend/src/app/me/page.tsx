import { redirect } from "next/navigation"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { qwbeFetch } from "@/lib/qwbe"

function Unavailable({ message }: { message: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Identity unavailable</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  )
}

export default async function MePage() {
  // Same function the proxy uses: it reads the cookie and attaches the header.
  const result = await qwbeFetch("auth/me")
  if (result.clearCookie) {
    // A dead token rides on every later call until it is cleared, and a server
    // component cannot write a cookie, so the logout handler clears it on the
    // way to /login.
    redirect("/api/logout")
  }
  if (result.status !== 200) return <Unavailable message={result.body} />
  const me = JSON.parse(result.body) as Record<string, unknown>

  return (
    // flex-1, not min-h-svh: the shell's top bar is part of the page now, and a full
    // viewport height under it would push the card below the fold.
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardDescription>Signed in as</CardDescription>
          <CardTitle>{String(me.username ?? "user")}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Signing out lives in the account menu, on every page. A second button here
              would say the same thing twice, and leave two controls with the
              same accessible name for anyone reading the page by name. */}
          <p className="text-sm text-muted-foreground">
            Your qwbe user, as this app sees it.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
