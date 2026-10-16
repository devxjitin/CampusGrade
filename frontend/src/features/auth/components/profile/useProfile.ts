"use client";

import { useEffect, useState } from "react";
import { getProfile, updateProfile } from "@/features/auth/api";
import { getCachedUser, isAdminRole, setCachedUser, type SessionUser } from "@/lib/session";
import { useGitHubStats } from "./useGitHubStats";

export interface ProfileFormData {
  name?: string;
  email?: string;
  bio?: string;
  avatar?: string;
  role?: string;
  roll_no?: string;
  batch_year?: string;
  github_username?: string;
  leetcode_username?: string;
  assignments?: Array<{ course: string; subjects: string[] }>;
}


export const useProfile = () => {
  const [user, setUser] = useState<ProfileFormData | null>(null);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<ProfileFormData>({});
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const [saving, setSaving] = useState(false);
  const [imageError, setImageError] = useState(false);

  const {
    profile,
    repos,
    totalStars,
    topLanguages,
    activityHeatmap,
    loading: ghLoading,
    error: ghError,
  } = useGitHubStats(!editing ? formData.github_username : null);
  const hasGitHubLinked = Boolean(formData.github_username);
  const showGitHubData = !editing && hasGitHubLinked && !ghLoading && !ghError && profile;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const profileData = (await getProfile()) as ProfileFormData;
        const normalized: ProfileFormData = { ...profileData };
        if (!normalized.batch_year) normalized.batch_year = "2025 '1";
        setUser(normalized);
        setFormData(normalized);
      } catch (err) {
        console.error("Failed to load profile", err);
      }
    };
    fetchData();
  }, []);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: (formData.name || "").trim(),
        bio: (formData.bio || "").trim(),
      };
      if (!isAdminRole(user.role)) {
        payload.github_username = (formData.github_username || "").trim().replace(/^@/, "");
        if (user.role === "student") {
          payload.leetcode_username = (formData.leetcode_username || "").trim().replace(/^@/, "");
        }
      }

      await updateProfile(payload);

      const normalized: ProfileFormData = { ...formData, ...payload };
      setUser(normalized);
      setFormData(normalized);
      setEditing(false);
      setMessageType("success");
      setMessage("Profile updated successfully!");

      const cached = getCachedUser();
      if (cached) {
        setCachedUser({ ...cached, name: normalized.name, avatar: normalized.avatar } as SessionUser);
      }

      setTimeout(() => setMessage(""), 3000);
    } catch (err: unknown) {
      setMessageType("error");
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to update profile.";
      setMessage(message);
    } finally {
      setSaving(false);
    }
  };

  return {
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
  };
};

