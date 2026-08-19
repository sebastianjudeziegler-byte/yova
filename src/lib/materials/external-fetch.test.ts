import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));

import { ExternalSourceError, fetchArticleSource } from "@/lib/materials/external-fetch";

describe("external article network boundary", () => {
  beforeEach(() => {
    mocks.lookup.mockReset();
    mocks.request.mockReset();
  });

  it("pins the HTTPS connection to the exact public address set that passed validation", async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      // A second system resolution would simulate a rebinding answer. The
      // transport must never ask for it.
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    let connectedAddress = "";
    mocks.request.mockImplementation((_url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      expect(options.agent).toBe(false);
      expect(options.lookup).toBeTypeOf("function");
      options.lookup?.("article.example", { all: false, family: 0 }, (error, address) => {
        expect(error).toBeNull();
        connectedAddress = typeof address === "string" ? address : address[0]?.address ?? "";
      });
      return requestThatResponds(callback, response({
        body: "<title>Public lesson</title><article>A useful public lesson.</article>",
      }));
    });

    const article = await fetchArticleSource("https://article.example/lesson");

    expect(article).toMatchObject({
      canonicalUrl: "https://article.example/lesson",
      title: "Public lesson",
      text: "A useful public lesson.",
    });
    expect(connectedAddress).toBe("93.184.216.34");
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it("rejects an entire DNS answer when any candidate is private", async () => {
    mocks.lookup.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);

    await expect(fetchArticleSource("https://mixed.example/article")).rejects.toThrow(
      "YOVA could not verify this as a public article link.",
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("revalidates every redirect target and never connects to a private answer", async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.8", family: 4 }]);
    mocks.request.mockImplementation((_url: URL, _options: RequestOptions, callback: (response: IncomingMessage) => void) => (
      requestThatResponds(callback, response({
        statusCode: 302,
        headers: { location: "https://internal.example/private" },
      }))
    ));

    await expect(fetchArticleSource("https://article.example/start")).rejects.toThrow(
      "YOVA could not verify this as a public article link.",
    );
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it("rejects an oversized redirect URL before resolving or requesting it", async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    mocks.request.mockImplementation((_url: URL, _options: RequestOptions, callback: (response: IncomingMessage) => void) => (
      requestThatResponds(callback, response({
        statusCode: 302,
        headers: { location: `https://article.example/${"a".repeat(2_100)}` },
      }))
    ));

    await expect(fetchArticleSource("https://article.example/start")).rejects.toThrow(
      "This article URL is too long to import safely.",
    );
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it("bounds a plaintext hostname to the persisted response title contract", async () => {
    const hostname = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.example`;
    mocks.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    mocks.request.mockImplementation((_url: URL, _options: RequestOptions, callback: (response: IncomingMessage) => void) => (
      requestThatResponds(callback, response({
        body: "A useful plaintext lesson.",
        headers: { "content-type": "text/plain; charset=utf-8" },
      }))
    ));

    const article = await fetchArticleSource(`https://${hostname}/lesson`);

    expect(article.title).toHaveLength(180);
    expect(hostname.startsWith(article.title)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "192.0.2.10",
    "198.18.0.1",
    "203.0.113.10",
    "::1",
    "fc00::1",
    "64:ff9b:1::1",
    "2001:db8::1",
  ])("rejects non-public address %s", async (address) => {
    mocks.lookup.mockResolvedValueOnce([{ address, family: address.includes(":") ? 6 : 4 }]);

    await expect(fetchArticleSource("https://blocked.example/article")).rejects.toBeInstanceOf(ExternalSourceError);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

function response({
  body = "",
  headers = { "content-type": "text/html; charset=utf-8" },
  statusCode = 200,
}: {
  body?: string;
  headers?: Record<string, string>;
  statusCode?: number;
} = {}) {
  const message = Readable.from(body ? [Buffer.from(body)] : []) as IncomingMessage;
  message.statusCode = statusCode;
  message.headers = headers;
  return message;
}

function requestThatResponds(
  callback: (response: IncomingMessage) => void,
  message: IncomingMessage,
) {
  const request = new EventEmitter() as ClientRequest;
  request.end = (() => queueMicrotask(() => callback(message))) as ClientRequest["end"];
  return request;
}
