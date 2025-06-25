import { forwardRef } from 'react';
import { twMerge } from 'tailwind-merge';
import { Loader2 } from 'lucide-react';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

const base =
  'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';

const variants = {
  primary:
    'bg-primary text-white hover:bg-primary-dark shadow-card',
  secondary:
    'bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700',
  danger:
    'bg-red-600 text-white hover:bg-red-700',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'primary', loading, leftIcon, rightIcon, children, ...props },
    ref
  ) => (
    <button
      ref={ref}
      className={twMerge(base, variants[variant], className)}
      aria-busy={loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="animate-spin mr-2 h-5 w-5" aria-hidden />
      ) : (
        leftIcon && <span className="mr-2">{leftIcon}</span>
      )}
      <span>{children}</span>
      {rightIcon && !loading && <span className="ml-2">{rightIcon}</span>}
    </button>
  )
);
Button.displayName = 'Button'; 