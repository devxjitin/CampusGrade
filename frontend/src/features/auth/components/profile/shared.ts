export interface GitHubRepo {
  id: number;
  name: string;
  html_url: string;
  language?: string;
  stargazers_count: number;
}

export interface GitHubProfile {
  login: string;
  name?: string;
  avatar_url: string;
  html_url: string;
  bio?: string;
  public_repos: number;
  followers: number;
  following: number;
}

export interface GitHubStatsState {
  profile: GitHubProfile | null;
  repos: GitHubRepo[];
  totalStars: number;
  topLanguages: Array<{ name: string; percent: string }>;
  activity: { commits: number; prs: number; issues: number; total: number };
  activityHeatmap: number[];
}


