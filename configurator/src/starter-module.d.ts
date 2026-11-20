// Made by starterPlugin (scripts/starter.mjs): the repository's starter files, base64-encoded.
declare module 'virtual:omb-starter' {
  const files: { path: string; base64: string }[]
  export default files
}

// Made by starterPlugin too: the starter's version and the fingerprint of each of its files, a few
// kilobytes. loadStarterIndex imports it dynamically, so the build puts it in a small chunk of its own.
declare module 'virtual:omb-starter-index' {
  // The shape of StarterIndex (core/update/fingerprint.ts); an ambient module may not import a relative path.
  const index: { version: string; files: Record<string, string> }
  export default index
}
