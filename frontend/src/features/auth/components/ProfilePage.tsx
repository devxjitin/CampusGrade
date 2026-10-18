"use client";

// Ported from frontend-legacy/src/pages/Profile.jsx.
//
// The GitHub stats widgets call the public GitHub REST API directly from
// the browser (as legacy did) — that traffic doesn't go through lib/api.ts.
// GitHub response shapes are typed loosely here; tightening them isn't a
// CampusGrade API concern so it's not worth generating types for.
import {
  BookOpen,
  Calendar,
  Code2,
  ExternalLink,
  Loader2,
  Star,
  User as UserIcon,
} from "lucide-react";
import GithubIcon from "@/components/icons/GithubIcon";
import { isAdminRole } from "@/lib/session";

import { GitHubIdentityCard, GitHubImpactCard, GitHubReposCard } from "./profile/GitHubCards";
import { GitHubContributionCard } from "./profile/GitHubContributionCard";
import { useProfile } from "./profile/useProfile";
import { ProfileInformationCard } from "./profile/ProfileInformationCard";
export default function ProfilePage() {
  const {
    user,
    editing,
    setEditing,
    formData,
    setFormData,
    message,
    messageType,
    saving,
    imageError,
    setImageError,
    profile,
    repos,
    totalStars,
    topLanguages,
    activityHeatmap,
    ghLoading,
    ghError,
    hasGitHubLinked,
    showGitHubData,
    handleSave
  } = useProfile();

  if (!user) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <>
      {message && (
        <div
          className={`mb-4 max-w-7xl mx-auto rounded-xl p-3 animate-fadeIn text-center font-medium ${
            messageType === "error" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
          }`}
        >
          {message}
        </div>
      )}

      <div className="max-w-7xl mx-auto pb-12">
        <div className="relative w-full rounded-[2rem] bg-white border border-gray-100 shadow-sm mb-6">
          <div className="h-36 w-full rounded-t-[2rem] bg-gray-900 relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-400 via-transparent to-transparent" />
          </div>

          <div className="px-6 md:px-12 pb-8 relative -mt-16 flex flex-col md:flex-row items-center md:items-end gap-6">
            <div className="group relative w-32 h-32 md:w-36 md:h-36 flex-shrink-0 z-10">
              {formData.avatar && !imageError ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={formData.avatar}
                  alt="Profile"
                  onError={() => setImageError(true)}
                  className="w-full h-full rounded-full border-4 border-white object-cover bg-white shadow-md"
                />
              ) : (
                <div className="flex w-full h-full items-center justify-center rounded-full bg-gray-100 text-5xl font-bold text-gray-400 shadow-md border-4 border-white">
                  {formData.name?.charAt(0)?.toUpperCase()}
                </div>
              )}
            </div>

            <div className="flex-1 text-center md:text-left mt-2 md:mt-16 md:mb-1">
              <h1 className="text-3xl font-bold text-gray-900 flex items-center justify-center md:justify-start gap-2">{formData.name}</h1>
              <p className="text-sm font-medium text-gray-500 mt-1">{formData.email}</p>

              <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 mt-4">
                {user.role === "student" && formData.roll_no && (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-blue-50/50 text-blue-700 rounded-full text-xs font-bold border border-blue-100">
                    <UserIcon className="w-3.5 h-3.5" /> {formData.roll_no}
                  </span>
                )}
                {user.role === "student" && formData.batch_year && (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-bold border border-gray-200">
                    <Calendar className="w-3.5 h-3.5" /> {formData.batch_year}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-stretch">
          <ProfileInformationCard
            user={user}
            formData={formData}
            setFormData={setFormData}
            editing={editing}
            setEditing={setEditing}
            saving={saving}
            handleSave={handleSave}
          />
          {isAdminRole(user.role) ? (
            <div className="xl:col-span-2 card flex min-h-80 flex-col items-center justify-center rounded-[2rem] border border-gray-100 bg-white p-8 text-center shadow-sm">
              <UserIcon className="h-10 w-10 text-primary-600" />
              <h2 className="mt-4 text-xl font-black text-gray-900">Administrator profile</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-gray-500">
                Keep your account identity and bio up to date. Developer-profile links and skills are intentionally unavailable for administrator accounts.
              </p>
            </div>
          ) : (
            <div className="xl:col-span-2 grid grid-cols-1 lg:grid-cols-2 auto-rows-fr gap-6">
              {showGitHubData ? (
                <GitHubIdentityCard profile={profile!} />
              ) : (
                <div className="card bg-white rounded-[2rem] p-8 text-center border border-dashed border-gray-200 flex flex-col items-center justify-center h-full min-h-[320px]">
                  {ghLoading ? <Loader2 className="animate-spin text-primary-500 w-7 h-7" /> : <GithubIcon className="w-9 h-9 text-gray-400" />}
                  <p className="font-bold text-base text-gray-900 mt-3">GitHub Identity</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {editing
                      ? "Save profile changes to refresh this card."
                      : !hasGitHubLinked
                        ? "Link your GitHub username in Profile Information."
                        : ghError || "Loading GitHub identity..."}
                  </p>
                </div>
              )}

              {showGitHubData ? (
                <GitHubContributionCard activityHeatmap={activityHeatmap} />
              ) : (
                <div className="card bg-white rounded-[2rem] p-8 text-center border border-dashed border-gray-200 flex flex-col items-center justify-center h-full min-h-[320px]">
                  <Calendar className="w-9 h-9 text-gray-400" />
                  <p className="font-bold text-base text-gray-900 mt-3">Contribution Calendar</p>
                  <p className="text-sm text-gray-500 mt-1">Calendar tiles appear once GitHub data is available.</p>
                </div>
              )}

              {showGitHubData ? (
                <GitHubReposCard repos={repos} />
              ) : (
                <div className="card bg-white rounded-[2rem] p-8 text-center border border-dashed border-gray-200 flex flex-col items-center justify-center h-full min-h-[300px]">
                  <BookOpen className="w-9 h-9 text-gray-400" />
                  <p className="font-bold text-base text-gray-900 mt-3">Top Repositories</p>
                  <p className="text-sm text-gray-500 mt-1">No repository data to display yet.</p>
                </div>
              )}

              {showGitHubData ? (
                <GitHubImpactCard totalStars={totalStars} topLanguages={topLanguages} />
              ) : (
                <div className="card bg-white rounded-[2rem] p-8 text-center border border-dashed border-gray-200 flex flex-col items-center justify-center h-full min-h-[300px]">
                  <Star className="w-9 h-9 text-gray-400" />
                  <p className="font-bold text-base text-gray-900 mt-3">Impact & Tech Stack</p>
                  <p className="text-sm text-gray-500 mt-1">Language and star metrics will appear here.</p>
                </div>
              )}

              {user.role === "student" && (
                <div className="card rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm lg:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
                      <Code2 className="h-5 w-5 text-amber-700" />
                      LeetCode profile
                    </h3>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${formData.leetcode_username ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {formData.leetcode_username ? "Linked" : "Not linked"}
                    </span>
                  </div>
                  {formData.leetcode_username ? (
                    <div className="mt-5">
                      <p className="text-2xl font-black text-slate-900">@{formData.leetcode_username}</p>
                      <p className="mt-1 text-xs text-slate-500">Your profile details update here as you edit this handle.</p>
                      <a
                        href={`https://leetcode.com/u/${formData.leetcode_username.replace(/^@/, "")}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-amber-700 hover:text-amber-800"
                      >
                        Open LeetCode profile <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  ) : (
                    <p className="mt-5 text-sm leading-6 text-slate-500">Add a LeetCode username in Profile Information to show your live profile link here.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
