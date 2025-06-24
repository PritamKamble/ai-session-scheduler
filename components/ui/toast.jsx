// components/ui/toast.jsx
"use client"

import React, { useState, useEffect } from 'react';

// Toast context
const ToastContext = React.createContext();

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = (toast) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((currentToasts) => [...currentToasts, { ...toast, id }]);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      removeToast(id);
    }, 5000);
  };

  const removeToast = (id) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
  };

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            {...toast}
            onDismiss={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Toast component
function Toast({ title, description, variant = 'default', onDismiss }) {
  const variantClasses = {
    default: 'bg-white border-gray-200',
    destructive: 'bg-red-100 border-red-200 text-red-800',
    success: 'bg-green-100 border-green-200 text-green-800',
    warning: 'bg-yellow-100 border-yellow-200 text-yellow-800',
  };

  return (
    <div
      className={`${variantClasses[variant]} relative w-full max-w-sm p-4 rounded-lg border shadow-lg`}
    >
      <div className="flex items-start">
        <div className="flex-1">
          {title && <h3 className="font-medium">{title}</h3>}
          {description && <p className="text-sm mt-1">{description}</p>}
        </div>
        <button
          onClick={onDismiss}
          className="ml-4 text-gray-500 hover:text-gray-700"
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Hook to use toast
export function useToast() {
  const context = React.useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}