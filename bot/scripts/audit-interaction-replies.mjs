// Flags `catch` blocks that call interaction.reply() while the matching `try`
// already acknowledged the interaction (reply/defer/update): a second reply
// throws InteractionAlreadyReplied and the member sees nothing. Use
// respondInPlaceSafe() (bot/interaction-reply.js) in those handlers.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export function findUnsafeCatchReplies(source) {
  const hits = [];
  const re =
    /try\s*\{([\s\S]*?)\}\s*catch\s*(\([^)]*\))?\s*\{([\s\S]*?)\n\s*\}/g;
  let m;
  while ((m = re.exec(source))) {
    const [, body, , handler] = m;
    const acknowledged =
      /interaction\.(deferReply|deferUpdate|reply|update)\(/.test(body);
    const unguarded =
      /interaction\.reply\(/.test(handler) &&
      !/deferred|replied|respondInPlace|isRepliable/.test(handler);
    if (acknowledged && unguarded)
      hits.push(source.slice(0, m.index).split("\n").length);
  }
  return hits;
}

export function auditDirectory(root) {
  const results = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (["node_modules", "data", "scripts"].includes(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".js") && !name.endsWith(".test.js")) {
        for (const line of findUnsafeCatchReplies(readFileSync(path, "utf8")))
          results.push(`${relative(root, path)}:${line}`);
      }
    }
  })(root);
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = auditDirectory(fileURLToPath(new URL("..", import.meta.url)));
  console.log(
    JSON.stringify({ valid: results.length === 0, unsafe: results }, null, 2),
  );
  process.exitCode = results.length ? 1 : 0;
}
