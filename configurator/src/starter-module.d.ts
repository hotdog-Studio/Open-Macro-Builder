// Made by starterPlugin (scripts/starter.mjs): the repository's starter files, base64-encoded.
declare module 'virtual:omb-starter' {
  const files: { path: string; base64: string }[]
  export default files
}

// Made by starterPlugin too: the starter's version and the fingerprint of each of its files, small
// enough to sit in the main chunk.
declare module 'virtual:omb-starter-index' {
  // The shape of StarterIndex (core/update/fingerprint.ts); an ambient module may not import a relative path.
  const index: { version: string; files: Record<string, string> }
  export default index
}
