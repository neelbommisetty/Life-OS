"use client";

import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export interface DialogProps extends ComponentPropsWithoutRef<"dialog"> {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "full";
  variant?: "modal" | "sheet";
  hideCloseButton?: boolean;
  panelClassName?: string;
}

export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = "md",
  variant = "modal",
  className,
  hideCloseButton = false,
  panelClassName,
  ...props
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isClosing, setIsClosing] = useState(false);

  // Synchronize dialog open state with props
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
        setIsClosing(false);
      }
    } else {
      if (dialog.open && !isClosing) {
        // If it's open and we just got closed via props, trigger close animation
        handleClose();
      }
    }
  }, [isOpen]);

  const handleClose = () => {
    setIsClosing(true);
    // Wait for animation to finish
    // Sheet slide-out might need slightly longer/different timing, but 200ms is standard for now
    setTimeout(() => {
      dialogRef.current?.close();
      setIsClosing(false);
      onClose();
    }, 200);
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      handleClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      e.preventDefault(); // Prevent default browser close to handle animation
      handleClose();
    }
  };

  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
    "3xl": "max-w-3xl",
    "4xl": "max-w-4xl",
    full: "max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]",
  };

  const sheetSizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
    "3xl": "max-w-3xl",
    "4xl": "max-w-4xl",
    full: "max-w-full",
  };

  const isSheet = variant === "sheet";

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        "fixed inset-0 z-50 p-0 m-0 w-full h-full max-w-none max-h-none bg-transparent backdrop:bg-black/50 backdrop:backdrop-blur-sm",
        isOpen && !isClosing ? "animate-in fade-in-0" : "",
        isClosing ? "animate-out fade-out-0" : "",
        // Layout: Modal is flex centered, Sheet is flex right
        "open:flex",
        isSheet ? "justify-end items-stretch" : "items-center justify-center",
        className
      )}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      {...props}
    >
      <div
        className={cn(
          "relative w-full bg-card text-card-foreground shadow-xl overflow-hidden flex flex-col",
          // Modal styles
          !isSheet && [
            "rounded-xl border mx-4",
            sizeClasses[size],
            isOpen && !isClosing ? "animate-scale-in" : "",
            isClosing ? "animate-scale-out" : ""
          ],
          // Sheet styles
          isSheet && [
            "h-full border-l rounded-l-xl",
            sheetSizeClasses[size],
            isOpen && !isClosing ? "animate-slide-in-right" : "",
            isClosing ? "animate-slide-out-right" : ""
          ],
          panelClassName
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || !hideCloseButton) && (
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
            <div className="flex flex-col gap-1">
              {title && (
                <h2 className="text-lg font-semibold leading-none tracking-tight">
                  {title}
                </h2>
              )}
              {description && (
                <p className="text-sm text-muted-foreground">{description}</p>
              )}
            </div>
            {!hideCloseButton && (
              <button
                onClick={handleClose}
                className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </dialog>
  );
}
