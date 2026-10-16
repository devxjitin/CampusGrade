// lucide-react v1 dropped brand/logo icons (Github, Twitter, etc.) — this is
// a real break hit while porting Profile.jsx (frontend-legacy pinned the
// older lucide-react@^0.368.0 which still had it). Rather than downgrade a
// major version, use a minimal inline SVG with the same className API.
export default function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 4.99 3.24 9.22 7.74 10.72.56.1.77-.24.77-.54 0-.27-.01-1.17-.01-2.12-3.15.58-3.97-.77-4.22-1.47-.14-.36-.75-1.47-1.28-1.77-.44-.24-1.07-.82-.02-.84.99-.02 1.7.91 1.93 1.29 1.13 1.9 2.93 1.37 3.65 1.04.11-.79.44-1.32.8-1.62-2.79-.32-5.71-1.4-5.71-6.22 0-1.37.49-2.5 1.29-3.38-.13-.32-.56-1.61.12-3.35 0 0 1.06-.34 3.47 1.29a11.9 11.9 0 0 1 6.32 0c2.41-1.63 3.47-1.29 3.47-1.29.68 1.74.25 3.03.12 3.35.8.88 1.29 2 1.29 3.38 0 4.83-2.93 5.9-5.72 6.22.45.39.84 1.15.84 2.33 0 1.68-.02 3.04-.02 3.46 0 .3.2.65.77.54A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}
