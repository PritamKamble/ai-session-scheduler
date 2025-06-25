import { twMerge } from 'tailwind-merge';

export function Skeleton({ className, width, height }: { className?: string; width?: number | string; height?: number | string }) {
  return (
    <div
      className={twMerge('animate-pulse rounded-md bg-gray-200 dark:bg-gray-700', className)}
      style={{ width, height }}
      aria-busy="true"
      aria-label="Loading..."
    />
  );
} 