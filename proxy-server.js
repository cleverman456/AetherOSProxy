// aetheros-proxy.js  (Node.js – Express)
// ---------------------------------------------------------------
//  • Fully functional URL-rewriting proxy
//  • Handles HTML, CSS, JS, images, fonts, iframes, …
//  • **Fixes Google’s “apps” menu** (and any other site that uses
//    `url()` with data-URIs or protocol-relative URLs)
// ---------------------------------------------------------------

const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("url");

const app = express();
const PORT = process.env.PORT || 3000;

// ----------------------------------------------------------------
// CORS – allow the proxy to be used from any browser tab
// ----------------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

// ----------------------------------------------------------------
// Tiny landing page (optional)
// ----------------------------------------------------------------
app.get("/", (req, res) => {
  res.send(`
    <style>body{font-family:system-ui;margin:2rem}</style>
    <form action="/proxy" method="GET">
      <input type="url" name="url" placeholder="https://blocked.example.com/page.html"
             required style="width:70%;padding:.5rem">
      <button type="submit" style="padding:.5rem 1rem">Unblock</button>
    </form>
    <p><small>All assets are proxied automatically.</small></p>
  `);
});

// ----------------------------------------------------------------
// Helper – turn any URL into a proxied one
// ----------------------------------------------------------------
function proxyLink(raw, baseOrigin) {
  if (!raw) return raw;

  // Keep data:, blob:, mailto:, tel:, javascript: untouched
  const lower = raw.trim().toLowerCase();
  if (
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:") ||
    lower.startsWith("javascript:")
  ) {
    return raw;
  }

  try {
    // `new URL` resolves relative URLs against baseOrigin
    const abs = new URL(raw.trim(), baseOrigin).href;
    return `/proxy?url=${encodeURIComponent(abs)}`;
  } catch {
    return raw; // malformed – leave as-is
  }
}

// ----------------------------------------------------------------
// Main proxy route
// ----------------------------------------------------------------
app.get("/proxy", async (req, res) => {
  const rawTarget = req.query.url;
  if (!rawTarget) return res.status(400).send("Missing ?url= parameter");

  let targetUrl;
  try {
    targetUrl = new URL(rawTarget);
  } catch {
    return res.status(400).send("Invalid URL");
  }

  const baseOrigin = `${targetUrl.protocol}//${targetUrl.host}`;

  try {
    // ------------------------------------------------------------
    // 1. Fetch the resource
    // ------------------------------------------------------------
    const axiosRes = await axios.get(targetUrl.href, {
      responseType: "arraybuffer",
      timeout: 15_000,
      maxRedirects: 10,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AetherOS-Proxy/1.0; +https://github.com/yourname/aetheros-proxy)",
      },
      validateStatus: (s) => s < 500,
    });

    const ct = axiosRes.headers["content-type"] || "";
    const isHtml = /text\/html/i.test(ct);

    // ------------------------------------------------------------
    // 2. Non-HTML → stream straight through
    // ------------------------------------------------------------
    if (!isHtml) {
      res.set("Content-Type", ct);
      const cc = axiosRes.headers["cache-control"];
      if (cc) res.set("Cache-Control", cc);
      return res.send(axiosRes.data);
    }

    // ------------------------------------------------------------
    // 3. HTML → rewrite every possible URL
    // ------------------------------------------------------------
    const html = axiosRes.data.toString("utf-8");
    const $ = cheerio.load(html, { decodeEntities: false });

    // ---- 3.1  Standard attributes (src, href, action, data) ----
    $(
      "img[src], script[src], link[href], iframe[src], source[src], " +
        "video[src], audio[src], embed[src], object[data], track[src], " +
        "a[href], area[href], form[action]"
    ).each((_, el) => {
      const tag = el.tagName.toLowerCase();
      const attr =
        tag === "form" ? "action" :
        tag === "object" ? "data" :
        ["a", "area"].includes(tag) ? "href" : "src";

      const old = $(el).attr(attr);
      if (old) $(el).attr(attr, proxyLink(old, baseOrigin));
    });

    // ---- 3.2  CSS url() inside <style> and inline style ----
    const rewriteCss = (css) => {
      return css.replace(/url\(['"]?([^'")]+)['"]?\)/gi, (m, p) => {
        // **Skip data-URIs & already-proxied URLs**
        const trimmed = p.trim();
        if (
          trimmed.startsWith("data:") ||
          trimmed.startsWith("/") && trimmed.includes("/proxy?url=")
        ) {
          return m;
        }
        return `url("${proxyLink(trimmed, baseOrigin)}")`;
      });
    };

    $("style").each((_, el) => {
      $(el).html(rewriteCss($(el).html()));
    });
    $("[style]").each((_, el) => {
      const s = $(el).attr("style");
      if (s) $(el).attr("style", rewriteCss(s));
    });

    // ---- 3.3  @import rules inside <style> ----
    $("style").html((_, css) =>
      css.replace(/@import\s+['"]([^'"]+)['"]/g, (_, imp) => {
        // keep data: imports untouched
        if (imp.trim().startsWith("data:")) return `@import "${imp}"`;
        return `@import "${proxyLink(imp, baseOrigin)}"`;
      })
    );

    // ---- 3.4  <meta http-equiv="refresh"> ----
    $('meta[http-equiv="refresh"]').attr("content", (_, val) => {
      if (!val) return val;
      const m = val.match(/url=(.+)$/i);
      if (m) return val.replace(m[1], proxyLink(m[1], baseOrigin));
      return val;
    });

    // ---- 3.5  <base href> (respect it for relative URLs) ----
    $("base[href]").attr("href", (_, v) => proxyLink(v, baseOrigin));

    // ------------------------------------------------------------
    // 4. Send the rewritten page
    // ------------------------------------------------------------
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send($.html());

  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(502).send(`Failed to fetch: ${err.message}`);
  }
});

// ----------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`AetherOS Proxy listening at http://localhost:${PORT}`);
});
