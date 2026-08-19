import "server-only";

import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { IncomingMessage } from "node:http";
import { extractReadableArticle } from "@/lib/materials/external-source";

const MAX_REMOTE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_URL_CHARACTERS = 2_000;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const BLOCKED_NETWORKS = createBlockedNetworkLists();

type PublicUrl = {
  url: URL;
  addresses: LookupAddress[];
};

export class ExternalSourceError extends Error {}

export async function fetchArticleSource(value: string) {
  let current = await validatePublicUrl(value);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await requestPinnedUrl(current);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = firstHeader(response, "location");
      response.destroy();
      if (!location || redirectCount === MAX_REDIRECTS) throw new ExternalSourceError("This article redirected too many times.");
      current = await validatePublicUrl(new URL(location, current.url).toString());
      continue;
    }
    if (status < 200 || status >= 300) {
      response.destroy();
      throw new ExternalSourceError("YOVA could not open this public article.");
    }

    const contentType = firstHeader(response, "content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      response.destroy();
      throw new ExternalSourceError("This link is not a readable article page. Try the article itself or upload a PDF.");
    }
    const declaredBytes = Number(firstHeader(response, "content-length") ?? 0);
    if (declaredBytes > MAX_REMOTE_BYTES) {
      response.destroy();
      throw new ExternalSourceError("This article page is too large to import safely.");
    }
    const html = await readBoundedText(response);
    const article = contentType.includes("text/plain")
      ? { title: current.url.hostname.slice(0, 180), text: html.slice(0, 50_000), truncated: html.length > 50_000 }
      : extractReadableArticle(html, current.url.toString());
    return { ...article, canonicalUrl: current.url.toString() };
  }
  throw new ExternalSourceError("YOVA could not follow this article link.");
}

export async function fetchYouTubeTitle(canonicalUrl: string) {
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", canonicalUrl);
  endpoint.searchParams.set("format", "json");
  const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new ExternalSourceError("YOVA could not read this YouTube video title.");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("title" in body) || typeof body.title !== "string") {
    throw new ExternalSourceError("YOVA could not verify this YouTube video.");
  }
  return body.title.trim().slice(0, 180) || "YouTube video";
}

async function validatePublicUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ExternalSourceError("Enter a complete public article URL.");
  }
  if (url.protocol !== "https:") throw new ExternalSourceError("For safety, article links must use HTTPS.");
  if (url.username || url.password || url.port) throw new ExternalSourceError("This article URL is not supported.");
  if (url.toString().length > MAX_SOURCE_URL_CHARACTERS) throw new ExternalSourceError("This article URL is too long to import safely.");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new ExternalSourceError("Private network links cannot be imported.");
  const hostname = unbracketHostname(url.hostname);
  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new ExternalSourceError("YOVA could not verify this as a public article link.");
  }
  return { url, addresses: deduplicateAddresses(addresses) } satisfies PublicUrl;
}

function isPrivateAddress(address: string) {
  const family = isIP(address);
  if (!family) return true;
  return family === 4
    ? BLOCKED_NETWORKS.ipv4.check(address, "ipv4")
    : BLOCKED_NETWORKS.ipv6.check(address, "ipv6");
}

async function requestPinnedUrl(target: PublicUrl) {
  const options: RequestOptions = {
    agent: false,
    headers: {
      Accept: "text/html,text/plain;q=0.9",
      "Accept-Encoding": "identity",
      "User-Agent": "YOVA-Learning-Material/1.0",
    },
    lookup: pinnedLookup(target.addresses),
    method: "GET",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };

  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpsRequest(target.url, options, resolve);
    request.once("error", reject);
    request.end();
  });
}

function pinnedLookup(addresses: LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const eligible = addresses.filter((candidate) => matchesRequestedFamily(candidate, options));
    if (!eligible.length) {
      const error = new Error("No validated address matched the requested network family.") as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, "", 0);
      return;
    }
    if (options.all) callback(null, eligible);
    else callback(null, eligible[0].address, eligible[0].family);
  };
}

function matchesRequestedFamily(candidate: LookupAddress, options: LookupOptions) {
  const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : Number(options.family ?? 0);
  return family === 0 || candidate.family === family;
}

function firstHeader(response: IncomingMessage, name: string) {
  const value = response.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readBoundedText(response: IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of response) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.byteLength;
    if (total > MAX_REMOTE_BYTES) {
      response.destroy();
      throw new ExternalSourceError("This article page is too large to import safely.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function deduplicateAddresses(addresses: LookupAddress[]) {
  return addresses.filter((candidate, index) => addresses.findIndex(
    (other) => other.address === candidate.address && other.family === candidate.family,
  ) === index);
}

function unbracketHostname(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function createBlockedNetworkLists() {
  // Keep the families in separate lists. Node treats IPv4 checks as mapped
  // IPv6 addresses when both families share a BlockList, which would make the
  // intentionally blocked ::ffff:0:0/96 range reject every ordinary IPv4.
  const blocked = { ipv4: new BlockList(), ipv6: new BlockList() };
  const ipv4: Array<[string, number]> = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
    ["224.0.0.0", 4], ["240.0.0.0", 4],
  ];
  const ipv6: Array<[string, number]> = [
    ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
    ["2001::", 32], ["2001:2::", 48], ["2001:10::", 28], ["2001:20::", 28],
    ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
  ];
  for (const [network, prefix] of ipv4) blocked.ipv4.addSubnet(network, prefix, "ipv4");
  for (const [network, prefix] of ipv6) blocked.ipv6.addSubnet(network, prefix, "ipv6");
  return blocked;
}
