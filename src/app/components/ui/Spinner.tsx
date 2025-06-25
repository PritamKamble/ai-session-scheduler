import { Loader2 } from 'lucide-react';

export function Spinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <span className="inline-flex items-center" role="status" aria-live="polite">
      <Loader2 className="animate-spin h-6 w-6 text-primary" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
} 