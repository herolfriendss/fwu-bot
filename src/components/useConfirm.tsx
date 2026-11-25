import { useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Ask = { title: string; description?: string; confirm?: string; danger?: boolean };

/** Replaces the browser confirm() with the site's own dialog. `ask` resolves to true on confirm. */
export function useConfirm() {
  const [open, setOpen] = useState<Ask | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const finish = (ok: boolean) => { resolver.current?.(ok); resolver.current = null; setOpen(null); };
  const ask = (options: Ask) => new Promise<boolean>((resolve) => { resolver.current?.(false); resolver.current = resolve; setOpen(options); });
  const dialog = (
    <AlertDialog open={open !== null} onOpenChange={(value) => { if (!value) finish(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{open?.title}</AlertDialogTitle>
          {open?.description && <AlertDialogDescription>{open.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction className={open?.danger ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined} onClick={() => finish(true)}>{open?.confirm ?? "Confirmer"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { ask, dialog };
}
