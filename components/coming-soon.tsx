// components/coming-soon.tsx
// Placeholder card for authenticated sections whose feature is still being
// built out. Keeps navigation coherent (no 404s) while the real page lands.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This section is under construction.
        </CardContent>
      </Card>
    </div>
  )
}
