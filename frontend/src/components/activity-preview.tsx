"use client"

// The Activity card of a record the backend does not have (a demo record):
// the same layout as ActivityFeed, read-only, marked DEMO, the comment box
// disabled. It renders from constants alone and sends no request.

import { TEXTAREA_CLASS } from "@/components/activity-feed"
import { MockTag } from "@/components/mock-tag"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"

export function ActivityPreview({ reason }: { reason: string }) {
  return (
    <Card aria-label="Activity (preview)">
      <CardHeader>
        <CardTitle>
          Activity
          <MockTag>demo</MockTag>
        </CardTitle>
        <CardDescription>{reason}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <fieldset disabled className="flex flex-col gap-2">
          <Label htmlFor="activity-preview-comment">Add a comment</Label>
          <textarea id="activity-preview-comment" className={TEXTAREA_CLASS} rows={3} />
          <Button type="button" size="sm" className="self-start">
            Comment
          </Button>
        </fieldset>
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      </CardContent>
    </Card>
  )
}
