import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { X, MoreHorizontal } from "lucide-react";
import { useRef, type ReactNode } from "react";
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const returnFocus = useRef(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal ${wide ? "wide" : ""}`}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (
              returnFocus.current?.isConnected &&
              !returnFocus.current.closest("[inert], [hidden]")
            ) {
              event.preventDefault();
              returnFocus.current.focus();
            } else {
              const navigation = document.querySelector<HTMLElement>(
                '[aria-controls="workspace-navigation"]',
              );
              if (navigation?.getClientRects().length) {
                event.preventDefault();
                navigation.focus();
              }
            }
          }}
        >
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Menu({
  label = "More options",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="icon-button" aria-label={label}>
        <MoreHorizontal size={19} />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="menu" sideOffset={6} align="end">
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
export function MenuItem({
  children,
  action,
  danger = false,
}: {
  children: ReactNode;
  action: () => void;
  danger?: boolean;
}) {
  return (
    <Dropdown.Item
      className={`menu-item ${danger ? "danger" : ""}`}
      onSelect={action}
    >
      {children}
    </Dropdown.Item>
  );
}

/** Native button semantics, with one shared visual vocabulary. */
export function Button({
  variant = "primary",
  pending = false,
  className = "",
  disabled,
  ...props
}: import("react").ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "destructive";
  pending?: boolean;
}) {
  return (
    <button
      {...props}
      className={`button ${variant} ${className}`}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
    />
  );
}

/** The accessible name is required; the icon stays visually compact in a 44px target. */
export function IconButton({
  className = "",
  ...props
}: import("react").ComponentProps<"button"> & { "aria-label": string }) {
  return <button {...props} className={`icon-button ${className}`} />;
}

/** Static metadata. Use a button for a badge that changes a view. */
export function Badge({
  tone = "neutral",
  className = "",
  ...props
}: import("react").ComponentProps<"span"> & {
  tone?: "neutral" | "accent" | "info";
}) {
  return <span {...props} className={`badge ${tone} ${className}`} />;
}
