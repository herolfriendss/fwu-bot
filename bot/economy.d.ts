export function grantPnd(guildId: string, userId: string, amount: number, reason?: string): number;
export function pndBalance(guildId: string, userId: string): { balance: number; bank: number };
export function handleEconomyMessage(message: unknown): Promise<boolean>;
export function handleEconomyInteraction(interaction: unknown): Promise<boolean>;
export function recoverBlackjackGames(): number;
export function economySnapshot(
  guildId: string,
  guild?: {
    name?: string;
    members?: { cache?: Map<string, { displayName?: string }> };
    roles?: { cache?: Map<string, { name?: string }> };
  } | null,
): {
  guildId: string;
  guildName: string | null;
  totalBalance: number;
  walletCount: number;
  ledgerCount: number;
  dailyClaims: number;
  activeGames: number;
  topWallets: { userId: string; displayName: string | null; balance: number }[];
  shopItems: { roleId: string; roleName: string | null; price: number }[];
  capturedAt: string;
};
