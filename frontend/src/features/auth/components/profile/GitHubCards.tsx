"use client";

import { BookOpen, ExternalLink, Star, User as UserIcon, Users } from "lucide-react";
import type { GitHubProfile, GitHubRepo } from "./shared";

const LANG_COLORS: Record<string, string> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#701516",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Jupyter: "#DA5B0B",
};

export const GitHubIdentityCard = ({ profile }: { profile: GitHubProfile }) => (
  <div className="card bg-white border border-gray-100 rounded-[2rem] p-5 lg:p-6 flex flex-col shadow-sm h-full">
    <div className="flex items-start gap-4 mb-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={profile.avatar_url} alt={profile.login} className="w-14 h-14 lg:w-16 lg:h-16 rounded-[1rem] border border-gray-200 shadow-sm" />
      <div className="flex-1 min-w-0">
        <h3 className="text-lg font-bold text-gray-900 [overflow-wrap:anywhere]">{profile.name || profile.login}</h3>
        <a href={profile.html_url} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-500 hover:text-blue-600 [overflow-wrap:anywhere] flex items-center gap-1">
          @{profile.login} <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
    {profile.bio ? (
      <p className="text-[13px] text-gray-600 [overflow-wrap:anywhere] gap-2 mb-4">{profile.bio}</p>
    ) : (
      <p className="text-[13px] text-gray-400 italic mb-4">No bio provided</p>
    )}

    <div className="grid grid-cols-3 gap-2 mt-2">
      <div className="bg-gray-50 rounded-xl p-3 text-center flex flex-col items-center justify-center gap-1.5">
        <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
          <BookOpen className="w-4.5 h-4.5 text-gray-600" />
        </div>
        <p className="text-lg font-extrabold text-gray-900 leading-none">{profile.public_repos}</p>
        <p className="text-gray-500 text-[9px] uppercase font-bold tracking-wider">Repos</p>
      </div>
      <div className="bg-gray-50 rounded-xl p-3 text-center flex flex-col items-center justify-center gap-1.5">
        <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
          <Users className="w-4.5 h-4.5 text-blue-600" />
        </div>
        <p className="text-lg font-extrabold text-blue-600 leading-none">{profile.followers}</p>
        <p className="text-gray-500 text-[9px] uppercase font-bold tracking-wider">Followers</p>
      </div>
      <div className="bg-gray-50 rounded-xl p-3 text-center flex flex-col items-center justify-center gap-1.5">
        <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
          <UserIcon className="w-4.5 h-4.5 text-gray-700" />
        </div>
        <p className="text-lg font-extrabold text-gray-900 leading-none">{profile.following}</p>
        <p className="text-gray-500 text-[9px] uppercase font-bold tracking-wider">Following</p>
      </div>
    </div>
  </div>
);

export const GitHubReposCard = ({ repos }: { repos: GitHubRepo[] }) => (
  <div className="card bg-white border border-gray-100 rounded-[2rem] p-5 lg:p-6 flex flex-col shadow-sm h-full">
    <h4 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
      <BookOpen className="w-4 h-4 text-gray-400" /> Top Repositories
    </h4>
    <div className="flex flex-col flex-1 gap-3 justify-center min-h-[220px]">
      {repos.length > 0 ? (
        repos.map((repo) => (
          <a
            key={repo.id}
            href={repo.html_url}
            target="_blank"
            rel="noreferrer"
            className="group p-3 md:p-4 border border-gray-100 rounded-[1.25rem] bg-gray-50/50 hover:border-gray-200 transition-all flex items-center justify-between"
          >
            <div className="flex flex-col min-w-0 pr-3">
              <span className="text-[14px] font-bold text-gray-900 [overflow-wrap:anywhere] group-hover:text-blue-500 transition-colors">{repo.name}</span>
              {repo.language && (
                <span className="flex items-center gap-1.5 text-[12px] text-gray-500 mt-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: LANG_COLORS[repo.language] || "#8b949e" }} />
                  {repo.language}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="flex items-center gap-1 text-[13px] font-bold text-gray-600 bg-white px-2 py-1 rounded-lg border border-gray-200">
                <Star className="w-3.5 h-3.5 text-amber-400" /> {repo.stargazers_count}
              </span>
            </div>
          </a>
        ))
      ) : (
        <div className="flex items-center justify-center h-full text-sm text-gray-500">No public repositories</div>
      )}
    </div>
  </div>
);

export const GitHubImpactCard = ({
  totalStars,
  topLanguages,
}: {
  totalStars: number;
  topLanguages: Array<{ name: string; percent: string }>;
}) => (
  <div className="card bg-white border border-gray-100 rounded-[2rem] p-5 lg:p-6 flex flex-col shadow-sm h-full">
    <h4 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
      <Star className="w-4 h-4 text-amber-400" /> Impact & Tech Stack
    </h4>

    <div className="flex items-center gap-4 mb-6 mt-2">
      <div className="w-14 h-14 rounded-[1.25rem] bg-amber-50 flex items-center justify-center">
        <Star className="w-7 h-7 text-amber-500" />
      </div>
      <div>
        <p className="text-4xl font-black text-gray-900 leading-none">{totalStars}</p>
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mt-1">Total Stars Earned</p>
      </div>
    </div>

    <div className="flex-1 flex flex-col justify-end min-h-[160px] pb-2">
      <p className="text-[11px] font-bold text-gray-500 uppercase mb-3">Top Languages Used</p>
      <div className="flex flex-col justify-between gap-4">
        {topLanguages.length > 0 ? (
          topLanguages.map((lang) => (
            <div key={lang.name} className="flex flex-col gap-2">
              <div className="flex justify-between items-center text-[12px] font-bold">
                <span className="text-gray-700 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: LANG_COLORS[lang.name] || "#8b949e" }} />
                  {lang.name}
                </span>
                <span className="text-gray-500">{lang.percent}%</span>
              </div>
              <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${lang.percent}%`, backgroundColor: LANG_COLORS[lang.name] || "#8b949e" }}
                />
              </div>
            </div>
          ))
        ) : (
          <div className="text-[13px] text-gray-500 text-center">No language data</div>
        )}
      </div>
    </div>
  </div>
);


