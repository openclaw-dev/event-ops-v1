import { Construction } from 'lucide-react';

interface ComingSoonProps {
  title: string;
  description?: string;
  issue?: string;
}

/**
 * Placeholder for pages that are spec'd but not yet built.
 * Replace with real content when the relevant issue ships.
 */
export function ComingSoon({
  title,
  description,
  issue,
}: ComingSoonProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Construction className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {issue && (
          <p className="text-xs text-muted-foreground/60">Coming in {issue}</p>
        )}
      </div>
    </div>
  );
}
