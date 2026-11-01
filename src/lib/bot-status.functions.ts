import { createServerFn } from "@tanstack/react-start";
import { requireOwner } from "./discord.server";

export const getRuntimeStatus = createServerFn({ method: "GET" }).handler(async () => {
  await requireOwner();
  const { readRuntimeStatus } = await import("./bot-status.server");
  return readRuntimeStatus();
});