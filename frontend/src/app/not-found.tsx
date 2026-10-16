"use client";

// Ported from frontend-legacy/src/pages/NotFound.jsx. Next.js renders this
// automatically for any unmatched route (App Router's not-found convention),
// replacing the legacy catch-all <Route path="*" element={<NotFound />} />.
import { useRouter } from "next/navigation";
import { Home, ArrowLeft, Search } from "lucide-react";

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center max-w-md animate-fadeInUp">
        <div className="relative mb-8">
          <h1 className="text-[140px] font-black text-gray-100 leading-none select-none">404</h1>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-20 h-20 bg-primary-50 rounded-full flex items-center justify-center">
              <Search className="w-10 h-10 text-primary-500" />
            </div>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-3">Page Not Found</h2>
        <p className="text-gray-500 mb-8 leading-relaxed">The page you are looking for does not exist or has been moved. Let us get you back on track.</p>

        <div className="flex gap-3 justify-center">
          <button onClick={() => router.back()} className="btn btn-outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Return to previous page
          </button>
          <button onClick={() => router.push("/")} className="btn btn-primary">
            <Home className="w-4 h-4 mr-2" />
            Home
          </button>
        </div>
      </div>
    </div>
  );
}
