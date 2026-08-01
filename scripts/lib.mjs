import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const ORIGIN = "https://www.maxlist.xyz";
export const SITE_HOSTS = new Set(["maxlist.xyz", "www.maxlist.xyz"]);

export async function ensureDir(directory) {
  await mkdir(directory, { recursive: true });
}

export async function writeFileEnsured(file, contents) {
  await ensureDir(path.dirname(file));
  await writeFile(file, contents);
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchWithRetry(url, options = {}) {
  const attempts = options.attempts ?? 4;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "user-agent": "MaxList-Static-Migration/1.0 (+https://www.maxlist.xyz/)",
          accept: options.accept ?? "*/*"
        },
        signal: AbortSignal.timeout(options.timeout ?? 45_000)
      });

      if (response.ok || (options.allowNotFound && response.status === 404)) {
        return response;
      }

      if (response.status < 500 && response.status !== 429) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await sleep(400 * 2 ** (attempt - 1));
    }
  }

  throw new Error(`Unable to fetch ${url}: ${lastError?.message ?? "unknown error"}`);
}

export async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

export function normalizeSiteUrl(input, base = ORIGIN) {
  const url = new URL(input, base);
  if (!SITE_HOSTS.has(url.hostname)) return url;
  url.protocol = "https:";
  url.hostname = "www.maxlist.xyz";
  url.port = "";
  url.hash = "";
  return url;
}

export function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'");
}

export function sitemapLocations(xml) {
  return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((match) =>
    decodeXml(match[1].trim())
  );
}

export function safePathname(pathname) {
  return pathname
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

export function pageOutputPath(outputRoot, pageUrl) {
  const url = normalizeSiteUrl(pageUrl);
  let pathname = safePathname(url.pathname);
  if (pathname === "/") return path.join(outputRoot, "index.html");
  if (pathname.endsWith("/")) pathname += "index.html";
  else if (!path.extname(pathname)) pathname += "/index.html";
  return path.join(outputRoot, pathname.replace(/^\/+/, ""));
}

export function assetOutputPath(outputRoot, assetUrl) {
  const url = normalizeSiteUrl(assetUrl);
  return path.join(outputRoot, safePathname(url.pathname).replace(/^\/+/, ""));
}

export function isSameSite(input, base = ORIGIN) {
  try {
    return SITE_HOSTS.has(new URL(input, base).hostname);
  } catch {
    return false;
  }
}
