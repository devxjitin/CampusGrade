"use client";

import { useCallback, useEffect, useState } from "react";
import type { GitHubProfile, GitHubRepo, GitHubStatsState } from "./shared";

export const useGitHubStats = (username?: string | null) => {
  const [data, setData] = useState<GitHubStatsState>({
    profile: null,
    repos: [],
    totalStars: 0,
    topLanguages: [],
    activity: { commits: 0, prs: 0, issues: 0, total: 0 },
    activityHeatmap: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGitHubData = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    setError(null);
    try {
      const [profileRes, reposRes, eventsRes] = await Promise.all([
        fetch(`https://api.github.com/users/${username}`),
        fetch(`https://api.github.com/users/${username}/repos?sort=stars&per_page=100&direction=desc`),
        fetch(`https://api.github.com/users/${username}/events/public?per_page=100`),
      ]);

      if (!profileRes.ok) throw new Error(profileRes.status === 404 ? "GitHub user not found" : "Failed to fetch GitHub data");

      const profileData = (await profileRes.json()) as GitHubProfile;
      const reposData = reposRes.ok ? await reposRes.json() : [];
      const eventsData = eventsRes.ok ? await eventsRes.json() : [];

      const repoList: GitHubRepo[] = Array.isArray(reposData) ? reposData : [];
      const topRepos = repoList.slice(0, 4);

      let stars = 0;
      const langCounts: Record<string, number> = {};

      repoList.forEach((repo) => {
        stars += repo.stargazers_count || 0;
        if (repo.language) {
          langCounts[repo.language] = (langCounts[repo.language] || 0) + 1;
        }
      });

      const totalLangCount = Object.values(langCounts).reduce((a, b) => a + b, 0);
      const sortedLangs = Object.entries(langCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([name, count]) => ({ name, percent: ((count / totalLangCount) * 100).toFixed(1) }));

      let commits = 0;
      let prs = 0;
      let issues = 0;
      const eventList: Array<{ type: string; payload?: { size?: number }; created_at: string }> = Array.isArray(eventsData)
        ? eventsData
        : [];

      const dayCounts = new Array(30).fill(0);
      const now = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);

      eventList.forEach((ev) => {
        if (ev.type === "PushEvent") {
          commits += ev.payload?.size || 0;
        } else if (ev.type === "PullRequestEvent") {
          prs++;
        } else if (ev.type === "IssuesEvent") {
          issues++;
        }

        const evDate = new Date(ev.created_at);
        if (evDate >= thirtyDaysAgo) {
          const diffTime = Math.abs(now.getTime() - evDate.getTime());
          const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
          const dayIndex = 29 - diffDays;
          if (dayIndex >= 0 && dayIndex < 30) dayCounts[dayIndex]++;
        }
      });

      setData({
        profile: profileData,
        repos: topRepos,
        totalStars: stars,
        topLanguages: sortedLangs,
        activity: { commits, prs, issues, total: eventList.length },
        activityHeatmap: dayCounts,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load GitHub profile");
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchGitHubData();
  }, [fetchGitHubData]);

  return { ...data, loading, error };
};


