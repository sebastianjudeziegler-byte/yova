"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Upload } from "lucide-react";
import { MATERIAL_FILE_ACCEPT, MATERIAL_FORMAT_LABEL } from "@/lib/materials/formats";
import type { MaterialUploadProgress } from "@/lib/materials/intake";

type MaterialFileDropzoneProps = {
  busy: boolean;
  disabled?: boolean;
  uploadStatus?: string;
  onFiles: (files: File[]) => void | Promise<void>;
};

export function materialUploadStatus(progress: MaterialUploadProgress | null): string | undefined {
  if (!progress) return undefined;
  const action = { preparing: "Preparing", uploading: "Uploading", reading: "Reading" }[progress.stage];
  return `${action} file ${progress.fileIndex} of ${progress.fileCount}: ${progress.filename}`;
}

export function MaterialFileDropzone({ busy, disabled = false, uploadStatus, onFiles }: MaterialFileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const unavailable = busy || disabled;

  const resetDragState = () => {
    dragDepth.current = 0;
    setDragging(false);
  };

  const submitFiles = (files: File[]) => {
    if (unavailable || files.length === 0) return;
    void onFiles(files);
  };

  const onDragEnter = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (unavailable) return;
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (unavailable) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files);
    resetDragState();
    submitFiles(files);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLabelElement>) => {
    if (unavailable || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    inputRef.current?.click();
  };

  return (
    <label
      className={`upload-dropzone ${dragging ? "drag-active" : ""} ${unavailable ? "disabled" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!unavailable) event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      tabIndex={unavailable ? -1 : 0}
      aria-label="Upload learning materials. Choose files or drag and drop them here."
      aria-disabled={unavailable}
    >
      <span className="upload-dropzone-icon"><Upload size={22} /></span>
      <span>
        <strong role="status" aria-live="polite" aria-atomic="true">{busy ? uploadStatus ?? "Preparing files…" : dragging ? "Drop files to add them" : "Choose files or drag them here"}</strong>
        <small>{MATERIAL_FORMAT_LABEL} · up to 5 files · 10 MB each</small>
      </span>
      <input
        ref={inputRef}
        aria-label="Choose learning materials"
        type="file"
        multiple
        accept={MATERIAL_FILE_ACCEPT}
        disabled={unavailable}
        onChange={(event) => {
          submitFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </label>
  );
}
