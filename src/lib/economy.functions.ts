import { createServerFn } from "@tanstack/react-start";
import { requireOwner } from "./discord.server";

export const getEconomySnapshots = createServerFn({ method: "GET" }).handler(async () => {
  await requireOwner();
  const { readEconomySnapshots } = await import("./economy.server");
  return readEconomySnapshots();
});
