import { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

export function Card({
  children,
  className,
  header,
  footer,
}: {
  children: ReactNode;
  className?: string;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className={twMerge('bg-white dark:bg-gray-900 rounded-xl shadow-card p-6', className)}>
      {header && <div className="mb-4 border-b pb-2 font-semibold text-lg">{header}</div>}
      <div>{children}</div>
      {footer && <div className="mt-4 border-t pt-2">{footer}</div>}
    </div>
  );
} 