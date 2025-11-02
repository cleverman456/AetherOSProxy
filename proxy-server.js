// proxy-server.js
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

// CORS headers
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

// Proxy route
app.get("/proxy", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.send("No URL specified.");

  try {
    const response = await axios.get(targetUrl, { responseType: "arraybuffer" });
    const contentType = response.headers["content-type"];

    if (contentType && contentType.includes("text/html")) {
      // Rewrite HTML to proxy all assets
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
      // Send binary content
      res.setHeader("Content-Type", contentType);
      res.send(response.data);
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Error fetching URL.");
  }
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
