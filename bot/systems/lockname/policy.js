export function canProtectNickname({
  actorId,
  ownerId,
  targetId,
  targetIsOwner = false,
  actorIsGuildOwner = false,
  actorRolePosition,
  targetRolePosition,
  botRolePosition,
  actorCanManageNicknames,
  botCanManageNicknames,
  privileged,
}) {
  if (!actorId || !ownerId || !privileged || !actorCanManageNicknames || !botCanManageNicknames) return false;
  if (targetIsOwner || actorId === targetId) return false;
  if (targetRolePosition == null || botRolePosition == null || targetRolePosition >= botRolePosition) return false;
  if (!actorIsGuildOwner && (actorRolePosition == null || targetRolePosition >= actorRolePosition)) return false;
  return true;
}

export function protectedNicknameRestore(currentNickname, protectedNickname) {
  return { shouldRestore: currentNickname !== protectedNickname, nickname: protectedNickname };
}
