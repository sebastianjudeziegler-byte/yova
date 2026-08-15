import { describe, expect, it, vi } from "vitest";

import { verifyEmailCodeThenRestoreAccount } from "@/lib/auth/post-verification";

describe("post-verification account restore", () => {
  it("opens a fresh root page after the email code is verified", async () => {
    const verifyCode = vi.fn().mockResolvedValue(undefined);
    const replace = vi.fn();

    await verifyEmailCodeThenRestoreAccount(verifyCode, { replace });

    expect(verifyCode).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("does not leave the verification screen when verification fails", async () => {
    const verificationError = new Error("expired code");
    const replace = vi.fn();

    await expect(verifyEmailCodeThenRestoreAccount(
      () => Promise.reject(verificationError),
      { replace },
    )).rejects.toBe(verificationError);

    expect(replace).not.toHaveBeenCalled();
  });
});
