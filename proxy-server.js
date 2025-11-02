// AetherOS Proxy Backend – fully functional URL-rewriting proxy
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const URL = require("url").URL;

const app = express();
const PORT = process.env.PORT || 3000;

// CORS for browser use
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

// Optional: tiny UI
app.get("/", (req, res) => {
  res.send(`
    <style>body{font-family:system-ui;margin:2rem}</style>
    <form action="/proxy" method="GET">
      <input type="url" name="url" placeholder="https://blocked.example.com/page.html" required style="width:70%;padding:0.5rem">
      <button type="submit" style="padding:0.5rem 1rem">Unblock</button>
    </form>
    <p><small>Tip: All assets (CSS, JS, images, fonts, iframes) are proxied automatically.</small></p>
  `);
});

// ————————————————————————————————————————————————————————————————
// Main proxy route: /proxy?url=<any-url>
app.get("/proxy", async (req, res) => {
  const rawTarget = req.query.url;
  if (!rawTarget) return res.status(400).send("Missing ?url= parameter");

  let targetUrl;
  try {
    targetUrl = new URL(rawTarget);
  } catch (e) {
    return res.status(400).send("Invalid URL");
  }

  const baseOrigin = `${targetUrl.protocol}//${targetUrl.host}`;

  try {
    // Fetch with axios (follow redirects, binary support)
    const axiosRes = await axios.get(targetUrl.href, {
      responseType: "arraybuffer",
      timeout: 15_000,
      maxRedirects: 10,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AetherOS-Proxy/1.0; +https://github.com/yourname/aetheros-proxy)",
      },
      validateStatus: (status) => status < 500, // don't throw on 4xx
    });

    const contentType = axiosRes.headers["content-type"] || "";
    const isHtml = /text\/html/i.test(contentType);

    // ——————————————————— NON-HTML (images, css, js, fonts…) ———————————————————
    if (!isHtml) {
      res.set("Content-Type", contentType);
      const cacheControl = axiosRes.headers["cache-control"];
      if (cacheControl) res.set("Cache-Control", cacheControl);
      return res.send(axiosRes.data);
    }

    // ——————————————————————— HTML: REWRITE ALL URLs ———————————————————————
    let html = axiosRes.data.toString("utf-8");
    const $ = cheerio.load(html, { decodeEntities: false });

    // Helper: turn any src/href into a proxied URL
    const proxyLink = (link) => {
      if (!link) return link;
      if (link.startsWith("data:") || link.startsWith("blob:")) return link;
      try {
        const absolute = new URL(link.trim(), baseOrigin).href;
        return `/proxy?url=${encodeURIComponent(absolute)}`;
      } catch {
        return link; // malformed – leave as-is
      }
    };

    // 1. Standard attributes: src, href, data, etc.
    $("img[src], script[src], link[href], iframe[src], source[src], video[src], audio[src], embed[src], object[data], track[src], a[href], area[href], form[action]")
      .each((_, el) => {
        const tag = el.tagName.toLowerCase();
        const attr = ["a", "area", "form"].includes(tag)
          ? tag === "form" ? "action" : "href"
          : ["object"].includes(tag) ? "data" : "src";

        const oldVal = $(el).attr(attr);
        if (oldVal) $(el).attr(attr, proxyLink(oldVal));
      });

    // 2. CSS url() inside <style> and style attributes
    const rewriteCssUrls = (css) => {
      return css.replace(/url\(['"]?([^'")]+)['"]?\)/gi, (match, urlPart) => {
        return `url("${proxyLink(urlPart)}")`;
      });
    };

    $("style").each((_, el) => {
      const css = $(el).html();
      $(el).html(rewriteCssUrls(css));
    });

    $("[style]").each((_, el) => {
      const style = $(el).attr("style");
      if (style) $(el).attr("style", rewriteCssUrls(style));
    });

    // 3. @import rules inside <style>
    $("style").html((_, css) =>
      css.replace(/@import\s+['"]([^'"]+)['"]/g, (_, imp) => `@import "${proxyLink(imp)}"`)
    );

    // 4. <meta> refresh / redirect
    $('meta[http-equiv="refresh"]').attr("content", (i, val) => {
      if (!val) return val;
      const match = val.match(/url=(.+)$/i);
      if (match) return val.replace(match[1], proxyLink(match[1]));
      return val;
    });

    // 5. Base tag (if present, respect it for relative URLs)
    const $base = $("base[href]");
    if ($base.length) {
      const baseHref = $base.attr("href");
      $base.attr("href", proxyLink(baseHref));
    }

    // Send rewritten HTML
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send($.html());

  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(502).send(`Failed to fetch: ${err.message}`);
  }
});

// ————————————————————————————————————————————————————————————————
app.listen(PORT, () => {
  console.log(`AetherOS Proxy running on http://localhost:${PORT}`);
});
