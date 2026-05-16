export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Accept",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return json({ error: "Missing ?url= parameter" }, 400);
    }

    // Try backends in order
    const result = await tryBackends(targetUrl);

    if (result) {
      return json(result, 200);
    }
    return json({ error: "所有后端均无法解析该链接，请检查链接有效性" }, 502);
  }
};

async function tryBackends(videoUrl) {
  // Backend 1: tikwm (TikTok/Douyin, Cloudflare network may bypass protection)
  try {
    const data = await tikwm(videoUrl);
    if (data) return data;
  } catch (e) { console.log("tikwm failed:", e.message); }

  // Backend 2: api.douyin.wtf (specialized Douyin/TikTok/Bilibili)
  try {
    const data = await douyinwtf(videoUrl);
    if (data) return data;
  } catch (e) { console.log("douyinwtf failed:", e.message); }

  return null;
}

// ── tikwm backend ──
async function tikwm(videoUrl) {
  const apiUrl = "https://www.tikwm.com/api/?hd=1&url=" + encodeURIComponent(videoUrl);
  const res = await fetch(apiUrl, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });

  if (!res.ok) throw new Error("tikwm status " + res.status);

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) throw new Error("tikwm returned HTML (likely blocked)");

  const data = await res.json();
  if (!data || data.code !== 0 || !data.data) throw new Error("tikwm parse fail: " + (data && data.msg || "no data"));

  const d = data.data;
  return {
    title: d.title || "",
    cover: d.cover || "",
    video_url: d.wmplay || d.play || d.hdplay || "",
    author: (d.author && (d.author.nickname || d.author)) || "",
    duration: d.duration || 0
  };
}

// ── api.douyin.wtf backend ──
async function douyinwtf(videoUrl) {
  const apiUrl = "https://api.douyin.wtf/api/hybrid/video_data?url="
    + encodeURIComponent(videoUrl) + "&minimal=false";

  const res = await fetch(apiUrl, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });

  if (!res.ok) throw new Error("douyinwtf status " + res.status);

  const data = await res.json();

  // Check for error response
  if (data.detail && data.detail.code === 400) throw new Error("douyinwtf returned 400");

  const info = (data.data && data.data["视频信息"]) || data.data || data;

  const rawUrl = typeof info === "string" ? info
    : (info["无水印链接"] || info["无水印下载地址"] || info["视频下载地址"]
      || info.watermark_free_url || info.download_url || info.video_url
      || info.play || info.wmplay || info.hdplay);

  if (!rawUrl) throw new Error("no video URL in douyinwtf response");

  return {
    title: info["标题"] || info.title || info.desc || "",
    cover: info["封面"] || info.cover || info.thumbnail || "",
    video_url: rawUrl,
    author: info["作者"] || info.author || info.nickname || "",
    duration: info["时长"] || info.duration || ""
  };
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60"
    }
  });
}
