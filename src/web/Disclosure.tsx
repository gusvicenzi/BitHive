import { useState, type ReactNode } from 'react';
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="miner-disclosure" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>{label}</summary>{open && children}</details>;
}
