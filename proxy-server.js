// AetherOS Proxy Backend
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

// Allow cross-origin requests
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

// Proxy route
app.get("/proxy", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.send("No URL specified.");

  try {
    // Fetch the target URL
    const response = await axios.get(targetUrl, { responseType: "arraybuffer" });
    const contentType = response.headers["content-type"];

    // HTML content: rewrite assets
    if (contentType && contentType.includes("text/html")) {
      let html = response.data.toString("utf-8");
      const $ = cheerio.load(html);

      $("img, script, link, iframe").each((i, el) => {
        const attr = $(el).is("link") ? "href" : "src";
        let src = $(el).attr(attr);
        if (src && !src.startsWith("data:") && !src.startsWith("http")) {
          const base = new URL(targetUrl);
          src = new URL(src, base).href;
        }
        if (src) $(el).attr(attr, `/proxy?url=${encodeURIComponent(src)}`);
      });

      res.send($.html());
    } else {
      // Non-HTML content (images, JS, CSS, fonts)
      res.setHeader("Content-Type", contentType);
      res.send(response.data);
    }
  } catch (err) {
    console.error("Error fetching:", err.message);
    res.status(500).send("Error fetching URL.");
  }
});

app.listen(PORT, () => console.log(`AetherOS proxy running on port ${PORT}`));
