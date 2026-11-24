import { lookup } from "node:dns/promises";
import https from "node:https";
import { spawn } from "node:child_process";
import {
  ffmpegOpusArgs,
  isPlayableAudioContentType,
  isPublicIpv4,
  validateAudioUrl,
} from "./audio-source-policy.js";

export async function resolvePublicAudioIpv4(host, dnsLookup = lookup) {
  const records = await dnsLookup(host, { all: true, verbatim: true });
  const ipv4 = records.filter((record) => record.family === 4);
  if (!ipv4.length || ipv4.some((record) => !isPublicIpv4(record.address))) {
    throw new Error(
      "La source audio ne résout pas exclusivement vers une adresse IPv4 publique autorisée.",
    );
  }
  return ipv4[0].address;
}

export async function openAuthorizedAudioStream(sourceUrl, allowedHosts, options = {}) {
  const url = validateAudioUrl(sourceUrl, allowedHosts);
  const ipv4 = await resolvePublicAudioIpv4(url.hostname, options.dnsLookup ?? lookup);
  const requestFactory = options.request ?? https.request;
  const spawnProcess = options.spawn ?? spawn;
  const ffmpegPath = options.ffmpegPath ?? process.env.PND_FFMPEG_PATH ?? "ffmpeg";
  const timeoutMs = options.timeoutMs ?? 15_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    let response;
    let transcoder;

    const stop = () => {
      response?.destroy();
      request?.destroy();
      transcoder?.stdin?.destroy();
      if (transcoder && transcoder.exitCode === null) transcoder.kill("SIGTERM");
    };
    const fail = (error) => {
      if (settled) {
        transcoder?.stdout?.destroy(new Error("audio_stream_failed"));
        return;
      }
      settled = true;
      stop();
      reject(error instanceof Error ? error : new Error("audio_source_failed"));
    };

    request = requestFactory(
      {
        protocol: "https:",
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { accept: "audio/*, application/octet-stream" },
        timeout: timeoutMs,
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions?.all) callback(null, [{ address: ipv4, family: 4 }]);
          else callback(null, ipv4, 4);
        },
      },
      (incoming) => {
        response = incoming;
        if (incoming.statusCode !== 200) {
          incoming.resume();
          fail(new Error("audio_source_http_status"));
          return;
        }
        if (!isPlayableAudioContentType(incoming.headers["content-type"])) {
          incoming.resume();
          fail(new Error("audio_source_content_type"));
          return;
        }

        transcoder = spawnProcess(ffmpegPath, ffmpegOpusArgs(options.audioFilter ?? null), {
          stdio: ["pipe", "pipe", "ignore"],
          windowsHide: true,
        });
        transcoder.once("error", fail);
        transcoder.once("close", (code) => {
          if (code !== 0) fail(new Error("audio_transcoder_exit"));
        });
        transcoder.stdout.once("error", fail);
        transcoder.stdout.once("readable", () => {
          if (settled) return;
          settled = true;
          resolve({ stream: transcoder.stdout, stop });
        });
        incoming.once("error", fail);
        transcoder.stdin.once("error", fail);
        incoming.pipe(transcoder.stdin);
      },
    );

    request.once("error", fail);
    request.setTimeout?.(timeoutMs, () => request.destroy(new Error("audio_source_timeout")));
    request.end();
  });
}
