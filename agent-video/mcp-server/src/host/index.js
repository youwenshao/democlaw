// Video host provider registry. A host provider takes the finished video file
// and returns a playback location:
//
//   async upload(videoPath, options) -> { url, ...extra }
//
// Selected at call time via the `providers.host` config.

import * as mux from "./mux.js";
import * as local from "./local.js";
import * as s3 from "./s3.js";

const PROVIDERS = {
  mux,
  local,
  s3,
};

export function getHostProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown host provider "${name}". Available: ${Object.keys(PROVIDERS).join(", ")}`
    );
  }
  return provider;
}
