export function resolveDialogTarget<T extends { id: string }>(
  members: T[],
  params: { edit?: string; roles?: string },
): T | undefined {
  return members.find((m) => m.id === params.edit || m.id === params.roles);
}
