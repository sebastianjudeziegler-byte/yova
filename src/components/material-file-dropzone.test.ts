import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MaterialFileDropzone, materialUploadStatus } from "./material-file-dropzone";
import { MATERIAL_FILE_ACCEPT } from "@/lib/materials/formats";

describe("learning material file picker", () => {
  it("lets learners select PowerPoint slides directly", () => {
    const markup = renderToStaticMarkup(createElement(MaterialFileDropzone, {
      busy: false,
      onFiles: () => undefined,
    }));
    expect(markup).toContain(`accept="${MATERIAL_FILE_ACCEPT}"`);
    expect(markup).toContain("PowerPoint (.pptx)");
    expect(markup).toContain("10 MB each");
  });

  it("announces the active file and actual stage while preventing a second upload", () => {
    const uploadStatus = materialUploadStatus({
      filename: "Class 1B.pptx",
      fileIndex: 2,
      fileCount: 3,
      stage: "uploading",
    });
    const markup = renderToStaticMarkup(createElement(MaterialFileDropzone, {
      busy: true,
      uploadStatus,
      onFiles: () => undefined,
    }));
    expect(markup).toContain("Uploading file 2 of 3: Class 1B.pptx");
    expect(markup).toContain('role="status" aria-live="polite"');
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain("Reading files");
  });
});
