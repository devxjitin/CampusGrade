// TanStack Query hooks for the five academic-structure CRUD resources
// (programs, batches, sections, subjects). Their
// backend routes and frontend-legacy pages are structurally identical —
// list/create/update/delete against /admin/<resource> — so this file is a
// small factory instead of five near-duplicate hook files. This is the
// reference pattern for wrapping the rest of the split-out feature api.ts
// files in TanStack Query as more pages are migrated off raw axios calls
// (see the original implementation plan Sprint 7, item 5, and the original migration plan Phase 4).
//
// Sprint 7: moved from src/hooks/useAcademicStructure.ts into
// src/features/academics/queries.ts (feature-folder reorg); the query-key
// shape is now the plan's centralised `academicsKeys` factory instead of
// each resource inlining its own `[resource, params]` tuple.
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { createBatch, createCourse, createSection, createSubject, deleteBatch, deleteCourse, deleteSection, deleteSubject, getBatches, getCourses, getSections, getSubjects, updateBatch, updateCourse, updateSection, updateSubject } from "./api";

export const academicsKeys = {
  all: ["academics"] as const,
  courses: (params?: Record<string, unknown>) => [...academicsKeys.all, "courses", params ?? {}] as const,
  batches: (params?: Record<string, unknown>) => [...academicsKeys.all, "batches", params ?? {}] as const,
  sections: (params?: Record<string, unknown>) => [...academicsKeys.all, "sections", params ?? {}] as const,
  subjects: (params?: Record<string, unknown>) => [...academicsKeys.all, "subjects", params ?? {}] as const,
} as const;

const RESOURCE_KEY: Record<string, (params?: Record<string, unknown>) => readonly unknown[]> = {
  courses: academicsKeys.courses,
  batches: academicsKeys.batches,
  sections: academicsKeys.sections,
  subjects: academicsKeys.subjects,
};

export interface AcademicRecord {
  id: string;
  name?: string;
  [key: string]: unknown;
}

/** Legacy responses vary between resource envelopes, {items: [...]}, and a bare array — normalize once. */
function normalizeListResponse(data: unknown, key: string): AcademicRecord[] {
  if (Array.isArray(data)) return data as AcademicRecord[];
  const record = data as Record<string, unknown> | undefined;
  const value = record?.[key] ?? record?.items;
  return Array.isArray(value) ? (value as AcademicRecord[]) : [];
}

interface ResourceApi<CreateInput, UpdateInput> {
  list: (params?: Record<string, unknown>) => Promise<unknown>;
  create: (data: CreateInput) => Promise<unknown>;
  update: (id: string, data: UpdateInput) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
}

function createResourceHooks<CreateInput, UpdateInput>(resource: string, api: ResourceApi<CreateInput, UpdateInput>, listKey: string) {
  const queryKey = RESOURCE_KEY[resource];

  function useList(params?: Record<string, unknown>, options?: Partial<UseQueryOptions<AcademicRecord[]>>) {
    return useQuery({
      queryKey: queryKey(params),
      queryFn: async () => normalizeListResponse(await api.list(params), listKey),
      ...options,
    });
  }

  function useCreate() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (data: CreateInput) => api.create(data),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [...academicsKeys.all, resource] }),
    });
  }

  function useUpdate() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, data }: { id: string; data: UpdateInput }) => api.update(id, data),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [...academicsKeys.all, resource] }),
    });
  }

  function useDelete() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => api.remove(id),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [...academicsKeys.all, resource] }),
    });
  }

  return { useList, useCreate, useUpdate, useDelete };
}

export const courseHooks = createResourceHooks(
  "courses",
  { list: getCourses, create: createCourse, update: updateCourse, remove: deleteCourse },
  "courses",
);

export const batchHooks = createResourceHooks(
  "batches",
  { list: getBatches, create: createBatch, update: updateBatch, remove: deleteBatch },
  "batches",
);

export const sectionHooks = createResourceHooks(
  "sections",
  { list: getSections, create: createSection, update: updateSection, remove: deleteSection },
  "sections",
);

export const subjectHooks = createResourceHooks(
  "subjects",
  { list: getSubjects, create: createSubject, update: updateSubject, remove: deleteSubject },
  "subjects",
);
