import { createServerFn } from "@tanstack/react-start";
import { requireOwner } from "./discord.server";
import { readServerAnalytics } from "./server-analytics.server";
import { parseAnalyticsInput } from "./server-analytics";

export const getServerAnalytics = createServerFn({ method: "GET" })
  .inputValidator(parseAnalyticsInput)
  .handler(async ({ data }) => {
    await requireOwner();
    return readServerAnalytics(data.guildId);
  });