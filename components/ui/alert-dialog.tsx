"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

// A confirmation dialog for destructive / irreversible actions. Unlike a plain
// Dialog it does not close on a backdrop click or Escape — the user must make an
// explicit choice. Built on Base UI's alert-dialog, styled to match the app.
function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>
) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogPortal(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Portal>
) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Backdrop>) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 z-[60] bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-sm",
        className
      )}
      {...props}
    />
  )
}

const contentVariants = cva(
  "fixed top-1/2 left-1/2 z-[60] flex w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 border bg-popover bg-clip-padding p-6 text-popover-foreground shadow-xl transition duration-200 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
  {
    variants: {
      size: {
        sm: "max-w-sm",
        default: "max-w-md",
        lg: "max-w-lg",
      },
    },
    defaultVariants: { size: "default" },
  }
)

function AlertDialogContent({
  className,
  size,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Popup> &
  VariantProps<typeof contentVariants>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(contentVariants({ size }), className)}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-base font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

// Cancel button — closes the dialog with no side effect.
function AlertDialogClose({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Close>) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-close"
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  )
}

// Confirm button — closes the dialog and runs its onClick. Defaults to the
// destructive style since this dialog guards destructive actions.
function AlertDialogActionButton({
  className,
  variant = "destructive",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Close> & {
  variant?: "default" | "destructive" | "secondary"
}) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-action"
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
  AlertDialogActionButton,
}
