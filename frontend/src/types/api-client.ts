import type { AxiosRequestConfig, AxiosResponse } from "axios";

import { api } from "@/lib/http";
import type { paths } from "@/types/api";

type ApiMethod = "get" | "post" | "put" | "patch" | "delete";
type ApiPath = keyof paths;

type Operation<Path extends ApiPath, Method extends ApiMethod> =
  Method extends keyof paths[Path] ? paths[Path][Method] : never;

type Responses<Path extends ApiPath, Method extends ApiMethod> =
  Operation<Path, Method> extends { responses: infer Value } ? Value : never;

type RequestBody<Path extends ApiPath, Method extends ApiMethod> =
  Operation<Path, Method> extends { requestBody: { content: infer Content } }
    ? Content extends { "application/json": infer Body }
      ? Body
      : Content extends { "multipart/form-data": infer Body }
        ? Body
        : unknown
    : unknown;

type SuccessResponse<Values> = Values extends Record<number, unknown>
  ? Values[Extract<keyof Values, 200 | 201 | 202 | 204>]
  : never;

type JsonContent<Value> = Value extends { content: infer Content }
  ? Content extends { "application/json": infer Body }
    ? Body
    : Content extends { "application/problem+json": infer Body }
      ? Body
      : unknown
  : unknown;

// Several legacy FastAPI routes still omit response_model, so their generated
// OpenAPI content is literally `unknown`. Keep those call sites compatible
// while retaining generated response types everywhere the schema has one.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LegacyUntypedResponse = any;

type WithLegacyFallback<Value> = unknown extends Value ? LegacyUntypedResponse : Value;

/** Successful JSON response generated from the backend OpenAPI schema. */
export type ApiResponse<Path extends ApiPath, Method extends ApiMethod> = WithLegacyFallback<
  JsonContent<SuccessResponse<Responses<Path, Method>>>
>;

export type ApiRequestBody<Path extends ApiPath, Method extends ApiMethod> = WithLegacyFallback<
  RequestBody<Path, Method>
>;

/**
 * Typed transport facade. The first generic is the OpenAPI template path;
 * `url` remains the concrete runtime URL so path parameters can be expanded
 * normally. Interceptors continue to live on the shared Axios instance.
 */
export const request = {
  get: async <Path extends ApiPath>(url: string, config?: AxiosRequestConfig) =>
    (await api.get<ApiResponse<Path, "get">>(url, config)).data,
  post: async <Path extends ApiPath>(url: string, data?: ApiRequestBody<Path, "post"> | FormData, config?: AxiosRequestConfig) =>
    (await api.post<ApiResponse<Path, "post">>(url, data, config)).data,
  put: async <Path extends ApiPath>(url: string, data?: ApiRequestBody<Path, "put"> | FormData, config?: AxiosRequestConfig) =>
    (await api.put<ApiResponse<Path, "put">>(url, data, config)).data,
  patch: async <Path extends ApiPath>(url: string, data?: ApiRequestBody<Path, "patch"> | FormData, config?: AxiosRequestConfig) =>
    (await api.patch<ApiResponse<Path, "patch">>(url, data, config)).data,
  delete: async <Path extends ApiPath>(url: string, config?: AxiosRequestConfig) =>
    (await api.delete<ApiResponse<Path, "delete">>(url, config)).data,
  rawGet: async <Path extends ApiPath>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<ApiResponse<Path, "get">>> =>
    api.get<ApiResponse<Path, "get">>(url, config),
};
