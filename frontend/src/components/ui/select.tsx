import { useState, useRef, useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

interface SelectContextValue {
  value: string;
  onValueChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

let ctx: SelectContextValue | null = null;

function Select({
  value = "",
  onValueChange,
  children,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  ctx = { value, onValueChange: onValueChange ?? (() => {}), open, setOpen };
  return <div className="relative">{children}</div>;
}

function SelectTrigger({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const c = ctx!;

  useEffect(() => {
    if (!c.open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) {
        c.setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [c.open]);

  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      onClick={() => c.setOpen(!c.open)}
    >
      {children}
      <ChevronDown className="h-4 w-4 opacity-50" />
    </button>
  );
}

function SelectValue({ placeholder }: { placeholder?: string }) {
  const c = ctx!;
  return <span>{c.value || placeholder || ""}</span>;
}

function SelectContent({ children, className }: { children: ReactNode; className?: string }) {
  const c = ctx!;
  if (!c.open) return null;
  return (
    <div
      className={cn(
        "absolute z-50 mt-1 w-full min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95",
        className
      )}
    >
      <div className="p-1">{children}</div>
    </div>
  );
}

function SelectItem({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const c = ctx!;
  return (
    <div
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 px-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
        c.value === value && "bg-accent text-accent-foreground",
        className
      )}
      onClick={() => {
        c.onValueChange(value);
        c.setOpen(false);
      }}
    >
      {children}
    </div>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
