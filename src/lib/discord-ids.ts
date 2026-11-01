/** Discord snowflakes accepted from trusted API payloads and user input. */
export function isDiscordSnowflake(value: string): boolean {
  return /^\d{5,25}$/.test(value);
}
