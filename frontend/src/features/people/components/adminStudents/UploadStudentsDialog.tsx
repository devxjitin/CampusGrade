"use client";

import { Dialog, FileDropzone } from "@/components/ui";
import type { AdminStudentsModel } from "./useAdminStudents";

export const UploadStudentsDialog = ({ model }: { model: AdminStudentsModel }) => {
  const {
    showUploadModal,
    handleCloseUploadModal,
    handleStudentImportPreview,
    handleStudentImportCommit,
    uploadFile,
    setUploadFile,
    uploadError,
    uploadResult,
    isUploading,
    uploadAction,
    setUploadError,
    setUploadResult,
    setUploadAction
  } = model;
  return (
<Dialog
        open={showUploadModal}
        onClose={isUploading ? undefined : handleCloseUploadModal}
        title="Import students"
        description="Required columns: name, email, roll_no. Academic and contact columns are optional."
        size="lg"
      >
        <form onSubmit={handleStudentImportPreview} className="space-y-4">
          {uploadError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{uploadError}</div>}

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Import file</label>
            <FileDropzone
              accept=".csv,.xlsx"
              file={uploadFile}
              title="Choose a CSV or Excel file"
              description="Drag and drop a .csv or .xlsx file, or browse from your device."
              onChange={(file) => {
                setUploadError("");
                setUploadResult(null);
                setUploadAction("");
                setUploadFile(file);
              }}
            />
          </div>

          {uploadResult?.summary && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
              <h4 className="text-sm font-semibold text-slate-800">Validation Summary (No DB write yet)</h4>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-lg bg-white p-3 text-center shadow-sm">
                  <p className="text-xs text-slate-500">Total</p>
                  <p className="text-xl font-bold text-slate-900">{uploadResult.summary.total_rows}</p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3 text-center shadow-sm">
                  <p className="text-xs text-emerald-700">Added</p>
                  <p className="text-xl font-bold text-emerald-700">{uploadResult.summary.added}</p>
                </div>
                <div className="rounded-lg bg-amber-50 p-3 text-center shadow-sm">
                  <p className="text-xs text-amber-700">Duplicates</p>
                  <p className="text-xl font-bold text-amber-700">{uploadResult.summary.duplicates}</p>
                </div>
                <div className="rounded-lg bg-rose-50 p-3 text-center shadow-sm">
                  <p className="text-xs text-rose-700">Invalid</p>
                  <p className="text-xl font-bold text-rose-700">{uploadResult.summary.invalid}</p>
                </div>
              </div>

              {((uploadResult.duplicate_rows?.length ?? 0) > 0 || (uploadResult.invalid_rows?.length ?? 0) > 0) && (
                <div className="mt-4 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  {[...(uploadResult.duplicate_rows || []), ...(uploadResult.invalid_rows || [])].slice(0, 20).map((item, index) => (
                    <p key={`${item.row_number}-${index}`} className="text-slate-700">
                      Row {item.row_number}: {(item.reasons || []).join(", ")}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
            <button type="button" onClick={handleCloseUploadModal} className="btn btn-outline" disabled={isUploading}>
              Close
            </button>
            <button type="submit" className="btn btn-outline" disabled={isUploading || !uploadFile}>
              {isUploading && uploadAction === "preview" ? "Validating..." : "Validate File"}
            </button>
            <button type="button" onClick={handleStudentImportCommit} className="btn btn-primary" disabled={isUploading || !uploadResult?.dry_run}>
              {isUploading && uploadAction === "submit" ? "Submitting..." : "Submit Import"}
            </button>
          </div>
        </form>
      </Dialog>
  );
};
