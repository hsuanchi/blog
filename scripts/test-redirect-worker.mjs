import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../cloudflare/redirect-worker.js";

const report = JSON.parse(
  await readFile(new URL("../reports/url-migration.json", import.meta.url), "utf8")
);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (request) => new Response(`passthrough:${new URL(request.url).pathname}`, { status: 299 });

async function expectRedirect(source, destination) {
  const response = await worker.fetch(new Request(source));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), destination);
}

await expectRedirect(
  "https://www.maxlist.xyz/2020/04/14/shopee-crawler/?utm_source=legacy",
  "https://www.maxlist.xyz/post/shopee-crawler/?utm_source=legacy"
);
await expectRedirect(
  "http://maxlist.xyz/2020/04/14/shopee-crawler/?utm_source=legacy",
  "https://www.maxlist.xyz/post/shopee-crawler/?utm_source=legacy"
);
await expectRedirect(
  "https://www.maxlist.xyz/wp-content/uploads/2023/06/%E6%95%B8%E6%93%9A%E5%88%86%E6%9E%90-google-trends-%E5%88%86%E6%9E%90-768x428.jpg",
  "https://www.maxlist.xyz/image/%E6%95%B8%E6%93%9A%E5%88%86%E6%9E%90-google-trends-%E5%88%86%E6%9E%90-768x428.jpg"
);
await expectRedirect(
  "https://www.maxlist.xyz/wp-content/uploads/woocommerce-placeholder.webp",
  "https://www.maxlist.xyz/image/woocommerce-placeholder.webp"
);

const passthrough = await worker.fetch(new Request("https://www.maxlist.xyz/post/shopee-crawler/"));
assert.equal(passthrough.status, 299);
assert.equal(await passthrough.text(), "passthrough:/post/shopee-crawler/");

for (const mapping of [...report.posts, ...report.articleAliases, ...report.images]) {
  const source = new URL(mapping.oldPath, "https://www.maxlist.xyz");
  const destination = new URL(mapping.newPath, "https://www.maxlist.xyz");
  const response = await worker.fetch(new Request(source));
  assert.equal(response.status, 301, mapping.oldPath);
  const actual = new URL(response.headers.get("location"));
  assert.equal(actual.origin, destination.origin, mapping.oldPath);
  assert.equal(decodeURIComponent(actual.pathname), decodeURIComponent(destination.pathname), mapping.oldPath);
  assert.equal(actual.search, destination.search, mapping.oldPath);
}

globalThis.fetch = originalFetch;
console.log(
  `Cloudflare redirect Worker tests passed for ${report.posts.length} posts, ` +
    `${report.articleAliases.length} article aliases, and ${report.images.length} legacy image URLs.`
);
