/** Where the desktop app's installer and portable exe are published. */
export const RELEASES_URL = 'https://github.com/hotdog-Studio/Open-Macro-Builder/releases'

/**
 * A link to the GitHub releases page, for the browser version only: the desktop app is what it
 * offers, and inside the desktop app the window refuses to leave the page (electron/main.ts).
 * Opens in a new tab so unsaved edits stay where they are.
 */
export function DownloadLink({ className, children = 'Download' }: Readonly<{ className?: string; children?: string }>) {
  return (
    <a
      href={RELEASES_URL}
      target="_blank"
      rel="noreferrer"
      title="Get the desktop app for Windows from GitHub Releases"
      className={className}
    >
      {children}
    </a>
  )
}
