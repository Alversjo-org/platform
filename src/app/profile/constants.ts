// Kept out of actions.ts: a 'use server' file may only export async functions,
// and this constant needs to be importable by both the action and its test.
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
