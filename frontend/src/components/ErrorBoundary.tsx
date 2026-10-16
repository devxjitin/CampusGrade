"use client";

// Ported from frontend-legacy/src/components/ErrorBoundary.jsx
import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error Boundary caught:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="card p-10 max-w-md text-center animate-fadeIn">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-gray-500 text-sm mb-6">
              An unexpected error occurred. This has been logged for investigation.
            </p>
            {this.state.error && (
              <div className="mb-6 p-3 bg-gray-100 rounded-lg text-left">
                <code className="text-xs text-red-600 break-all">{this.state.error.message}</code>
              </div>
            )}
            <div className="flex gap-3 justify-center">
              <button onClick={this.handleRetry} className="btn btn-primary">
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </button>
              <button onClick={() => (window.location.href = "/")} className="btn btn-outline">
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
