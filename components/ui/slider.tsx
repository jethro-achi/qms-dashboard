"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

// Base UI slider composed into a single shadcn-style component. Supports one or
// more thumbs (a `value`/`defaultValue` array). Squared corners on the track to
// match the app's sharp-edged controls.
function Slider({
  className,
  defaultValue,
  value,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [0],
    [value, defaultValue]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Control
        data-slot="slider-control"
        className="flex w-full items-center py-2"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative h-1.5 w-full grow overflow-hidden rounded-none bg-muted"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className="absolute h-full rounded-none bg-primary"
          />
          {values.map((_, i) => (
            <SliderPrimitive.Thumb
              key={i}
              index={i}
              data-slot="slider-thumb"
              className="block size-4 shrink-0 rounded-none border border-primary bg-background shadow-sm transition-[color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50"
            />
          ))}
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
