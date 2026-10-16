"use client"

// Echo: the general activity feed across every cube that records activity,
// newest first, filtered by cube. The same ActivityFeed the detail pages use;
// the kernel hides every row whose target the caller may not read.

import { useEffect, useState } from "react"

import { ActivityFeed } from "@/components/activity-feed"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fetchActivityCubes, type ActivityCube } from "@/lib/echo"

// "all" is the Select's stand-in for no filter: Radix refuses an empty string
// as an item value.
const ALL = "all"

export function EchoFeed() {
  const [cube, setCube] = useState(ALL)
  // The filter's options come from the live catalogue (GET /settings/cubes),
  // so a cube from any pack can be filtered to. Until it answers, or when it
  // refuses, only "All cubes" is offered and the refusal is printed beside
  // the select: the feed itself is never narrowed silently.
  const [cubes, setCubes] = useState<ActivityCube[]>([])
  const [cubesError, setCubesError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void fetchActivityCubes().then((result) => {
      if (!alive) return
      if (result.ok) setCubes(result.value)
      else setCubesError(result.message)
    })
    return () => {
      alive = false
    }
  }, [])
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="echo-cube">Cube</Label>
        <Select value={cube} onValueChange={setCube}>
          <SelectTrigger id="echo-cube" className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All cubes</SelectItem>
            {cubes.map((c) => (
              <SelectItem key={c.name} value={c.name}>
                {c.entity}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {cubesError && (
          <p role="alert" className="text-sm text-destructive">
            Cube list unavailable: {cubesError}
          </p>
        )}
      </div>
      <ActivityFeed cube={cube === ALL ? undefined : cube} title="Activity" />
    </>
  )
}
