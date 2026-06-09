// Mux host provider. Uploads the video and returns a stream.mux.com playback URL.

import { readFileSync } from "fs";
import { sleep } from "../session.js";

export async function upload(videoPath, options = {}) {
  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    throw new Error("MUX_TOKEN_ID and MUX_TOKEN_SECRET must be set");
  }

  const auth = `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString("base64")}`;

  const createResponse = await fetch("https://api.mux.com/video/v1/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({
      new_asset_settings: {
        playback_policy: ["public"],
        video_quality: options.videoQuality || "basic",
      },
      cors_origin: "*",
    }),
  });

  const uploadData = await createResponse.json();
  const uploadUrl = uploadData.data.url;
  const uploadId = uploadData.data.id;

  const videoBuffer = readFileSync(videoPath);
  await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: videoBuffer,
  });

  await sleep(5000);

  const uploadStatusResponse = await fetch(
    `https://api.mux.com/video/v1/uploads/${uploadId}`,
    { headers: { Authorization: auth } }
  );
  const uploadStatus = await uploadStatusResponse.json();
  const assetId = uploadStatus.data.asset_id;

  const assetResponse = await fetch(
    `https://api.mux.com/video/v1/assets/${assetId}`,
    { headers: { Authorization: auth } }
  );
  const assetData = await assetResponse.json();
  const playbackId = assetData.data.playback_ids[0].id;

  return {
    url: `https://stream.mux.com/${playbackId}`,
    assetId,
    playbackId,
  };
}
