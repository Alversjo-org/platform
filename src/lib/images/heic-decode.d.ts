// heic-decode ships without types.
declare module 'heic-decode' {
  type Decoded = { width: number; height: number; data: Uint8ClampedArray };
  export default function decode(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<Decoded>;
}
