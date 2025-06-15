export function Footer() {
  return (
    <footer className="w-full border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-6 mt-12">
      <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-2 px-4 text-sm text-gray-500 dark:text-gray-400">
        <div>
          <span>© {new Date().getFullYear()} LinkCode Scheduler</span>
          <span className="mx-2">·</span>
          <a href="https://www.mongodb.com/licensing/server-side-public-license" target="_blank" rel="noopener noreferrer" className="hover:underline">SSPL License</a>
        </div>
        <div className="flex gap-4">
          <a href="/docs" className="hover:underline">Docs</a>
          <a href="/support" className="hover:underline">Support</a>
          <a href="https://github.com/pritamkamble/linkcode-scheduler" target="_blank" rel="noopener noreferrer" className="hover:underline">GitHub</a>
        </div>
      </div>
    </footer>
  );
} 