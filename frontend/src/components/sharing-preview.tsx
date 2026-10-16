"use client"

// The Sharing card of a record the backend does not have (a demo record):
// the same place and layout as SharingPanel, read-only, marked DEMO, every
// control disabled. It renders from constants alone and sends no request.

import { ALL_LEVELS, CAPABILITY_NOTE, LEVEL_LABELS } from "@/components/sharing-panel"
import { MockTag } from "@/components/mock-tag"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export function SharingPreview({ reason }: { reason: string }) {
  return (
    <Card aria-label="Sharing (preview)">
      <CardHeader>
        <CardTitle>
          Sharing
          <MockTag>demo</MockTag>
        </CardTitle>
        <CardDescription>{reason}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">Shared with: none</p>
        <fieldset disabled className="flex flex-col gap-3 border-t pt-4">
          <legend className="sr-only">Share this record</legend>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Share with</span>
            <Button type="button" size="sm" aria-pressed>
              User
            </Button>
          </div>
          <Input className="w-64" placeholder="@username" aria-label="Username" />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {ALL_LEVELS.map((level) => (
              <label key={level} className="flex items-center gap-1 text-muted-foreground">
                <input type="radio" name="sharing-preview-level" defaultChecked={level === "total"} />
                {LEVEL_LABELS[level]}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{CAPABILITY_NOTE}</p>
          <Button type="button" size="sm" className="self-start">
            Share
          </Button>
        </fieldset>
      </CardContent>
    </Card>
  )
}
