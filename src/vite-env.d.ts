/// <reference types="vite/client" />
/// <reference types="chrome" />

/**
 * CRXJS turns `import url from './thing?script'` into the built output's
 * filename, which is what chrome.scripting.executeScript needs — the hashed
 * name isn't knowable at author time.
 */
declare module '*?script' {
  const src: string
  export default src
}

declare module '*?script&module' {
  const src: string
  export default src
}
