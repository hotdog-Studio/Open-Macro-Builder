import { useEffect, useId, useState, type ReactNode } from 'react'
import type { LangId } from '../core/languages'
import { LINKS } from '../core/links'
import { useApp } from '../state/store'
import { LINK, Strong } from './prose'

// The guide for someone who has never seen code. Names of things on screen are bold, keys to press
// are drawn as keys, and file names and anything typed are set in code, so a reader can tell
// which words to look for and which to type.

function Kbd({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <kbd className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-100">
      {children}
    </kbd>
  )
}

function Code({ children }: Readonly<{ children: ReactNode }>) {
  return <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[12px] text-zinc-100">{children}</code>
}

function Outside({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <a className={LINK} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

function Step({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="mt-8 space-y-3">
      <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
      {children}
    </section>
  )
}

function Bullets({ children }: Readonly<{ children: ReactNode }>) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-zinc-500">{children}</ul>
}

interface Choice {
  ahk: boolean
  ps: boolean
}

function WhatYouNeed({ folderName }: Readonly<{ folderName: string | null }>) {
  return (
    <Step title="1. What you need">
      <Bullets>
        <li>A PC with Windows.</li>
        <li>
          A keypad, or a spare keyboard, whose keys can be set to send F13 to F24. Those are function keys past F12.
          Windows knows them but ordinary keyboards do not have them, so they are free for the macropad to use. Keypads
          sold as programmable can usually do this, with VIA, QMK or the maker's own software.
        </li>
        <li>
          A folder for Open Macro Builder to live in.{' '}
          {folderName === null ? (
            <>
              Press <Strong>Create new folder…</Strong> and the app makes one, with the scripts, the icons and an
              example layout in it.
            </>
          ) : (
            <>You have one open: {folderName}.</>
          )}{' '}
          When a later version of this app carries newer scripts than your folder, it offers to update them, and it
          replaces a script you changed only if you tick it.
        </li>
      </Bullets>
    </Step>
  )
}

/** The two sentences about AutoHotkey v2 on this PC: neither when the desktop app cannot tell. */
function InstalledNote({ installed }: Readonly<{ installed: readonly LangId[] | null }>) {
  if (installed === null) return null
  return <p>{installed.includes('ahk') ? 'AutoHotkey v2 is already installed on this PC.' : 'AutoHotkey v2 was not found on this PC.'}</p>
}

function ChooseVersion({
  folderName,
  installed,
}: Readonly<{ folderName: string | null; installed: readonly LangId[] | null }>) {
  return (
    <Step title="2. Choose a version">
      <p>
        The macropad comes in two versions. They do the same job and read the same layout, so you can change your mind
        later. Run one at a time, because both take the same keys.
      </p>
      <h4 className="pt-1 font-semibold text-zinc-100">AutoHotkey</h4>
      <p>
        AutoHotkey is a free program for automating Windows. It does not come with Windows or with this app, so you
        install it yourself before you start the macropad. Download it from{' '}
        <Outside href={LINKS.autohotkey}>autohotkey.com/download</Outside> and run the installer. Get version 2: the
        macropad does not run on version 1.
      </p>
      <InstalledNote installed={installed} />
      <h4 className="pt-1 font-semibold text-zinc-100">PowerShell</h4>
      <p>PowerShell is already part of Windows. There is nothing to install.</p>
      {folderName !== null && (
        <p>
          Tick the one you chose under <Strong>I run</Strong>, at the top of this window.
        </p>
      )}
    </Step>
  )
}

function SetUpKeypad() {
  return (
    <Step title="3. Set up your keypad">
      <p>
        Open the software that came with your keypad and set each key to send one of F13 to F24. Set one more key to
        send Scroll Lock. That is the <Kbd>Fn</Kbd> key, the one you hold to switch layers. Another key will do: you can
        change it on the <Strong>Pad shape</Strong> tab.
      </p>
    </Step>
  )
}

function DesignPad() {
  return (
    <Step title="4. Design your pad">
      <p>Your folder starts with an example layout, so you can skip this step and try the example first.</p>
      <p>
        On <Strong>Pad shape</Strong>, arrange the keys the way they sit on your keypad. Select a key to say which
        keyboard key it sends, or press <Strong>Capture by pressing it</Strong> and then the key on your pad. On{' '}
        <Strong>Layers</Strong>, choose which key selects each layer. A layer is one set of macros, such as Media or
        Chrome. On <Strong>Macros</Strong>, pick a layer and drag commands from the list onto its keys.
      </p>
      <p>
        Press <Strong>Save config.json</Strong> when you are done.
      </p>
    </Step>
  )
}

/** Explorer hides known file endings by default, so the files read main and launch there. */
function HiddenEndings({ choice }: Readonly<{ choice: Choice }>) {
  if (choice.ahk && choice.ps) {
    return (
      <>
        Windows may hide the endings and show the files as <Code>main</Code> and <Code>launch</Code>.
      </>
    )
  }
  return (
    <>
      Windows may hide the ending and show the file as <Code>{choice.ps ? 'launch' : 'main'}</Code>.
    </>
  )
}

function StartMacropad({ choice }: Readonly<{ choice: Choice }>) {
  return (
    <Step title="5. Start the macropad">
      <p>
        Open your folder in File Explorer.
        {choice.ahk && (
          <>
            {' '}
            For AutoHotkey, open the <Code>ahk</Code> folder and double-click <Code>main.ahk</Code>.
          </>
        )}
        {choice.ps && (
          <>
            {' '}
            For PowerShell, open the <Code>powershell</Code> folder and double-click <Code>launch.vbs</Code>.
          </>
        )}{' '}
        <HiddenEndings choice={choice} />
      </p>
      <p>
        A hotdog icon appears beside the clock, at the right-hand end of the taskbar. It may be hidden behind the small ^
        arrow there. While the icon is there, the macropad is running.
      </p>
    </Step>
  )
}

function TryIt() {
  return (
    <Step title="6. Try it">
      <p>
        Hold the <Kbd>Fn</Kbd> key. An overlay appears with your layers on it. Still holding <Kbd>Fn</Kbd>, press the key
        of the layer you want, then let go. Each key now runs the macro it has on that layer.
      </p>
    </Step>
  )
}

function AfterChange({ desktop }: Readonly<{ desktop: boolean }>) {
  return (
    <Step title="7. After you change something">
      <p>
        The macropad reads your layout when it starts, so it needs a restart to pick up a change. Save here, then start
        the macropad again as in step 5. The new one replaces the one that was running.
        {desktop && (
          <>
            {' '}
            While a macropad started from this folder is running, saving in this app offers{' '}
            <Strong>Reload macropad</Strong>, which restarts it for you. A macropad started from another folder is not
            found.
          </>
        )}
      </p>
    </Step>
  )
}

/** The file to drag: one version's, or both when both are ticked. */
function StartupFile({ choice }: Readonly<{ choice: Choice }>) {
  if (choice.ahk && choice.ps) {
    return (
      <>
        <Code>main.ahk</Code> (or <Code>launch.vbs</Code>)
      </>
    )
  }
  return <Code>{choice.ps ? 'launch.vbs' : 'main.ahk'}</Code>
}

function StartWithWindows({ choice }: Readonly<{ choice: Choice }>) {
  return (
    <Step title="8. Start it with Windows, if you like">
      <p>
        Press <Kbd>Windows</Kbd> + <Kbd>R</Kbd>, type <Code>shell:startup</Code> and press <Kbd>Enter</Kbd>. A folder
        opens, and whatever is in it starts when you sign in. Drag <StartupFile choice={choice} /> into that folder with
        the right mouse button and choose <Strong>Create shortcuts here</Strong>.
      </p>
    </Step>
  )
}

function Troubleshooting({ choice }: Readonly<{ choice: Choice }>) {
  return (
    <Step title="If something does not work">
      <Bullets>
        <li>
          A key does nothing. Check that the hotdog icon is beside the clock, and that the key on your keypad sends one of
          F13 to F24.
        </li>
        {choice.ahk && (
          <li>
            Double-clicking <Code>main.ahk</Code> opens Notepad, or Windows asks which app to use. That means Windows
            does not know the file, usually because AutoHotkey is not installed.
          </li>
        )}
        <li>
          You switched version and the keys still act as before. Both versions may be running. Right-click each hotdog
          icon and choose <Strong>Exit</Strong>, then start the one you want.
        </li>
      </Bullets>
    </Step>
  )
}

function ShareCommand() {
  return (
    <Step title="Share a command">
      <p>
        The <Strong>Commands</Strong> tab shows the code behind every command, and you can write your own there. If you
        write one that other people could use, the project would like to have it.
      </p>
      <p>
        A folder this app set up is a plain copy, so it cannot send changes back. To contribute you need git, the tool
        the project uses to keep and share its changes. Clone the project with it:
      </p>
      <p>
        <code className="block select-all overflow-x-auto rounded bg-zinc-800 px-3 py-2 font-mono text-[12px] whitespace-nowrap text-zinc-100">
          git clone https://github.com/hotdog-Studio/Open-Macro-Builder.git
        </code>
      </p>
      <p>
        Drop your <Code>local</Code> folder into the clone, and your layout and your own commands come with you. Open the
        clone here with <Strong>Open folder</Strong>, create your command with <Strong>New file</Strong> as a{' '}
        <Strong>Shared</Strong> file, and send it as a pull request on GitHub. The{' '}
        <Outside href={LINKS.contributing}>contributing guide</Outside> says how.
      </p>
    </Step>
  )
}

/**
 * What the desktop app found installed, asked when the guide shows and again whenever the window
 * gets the focus back, because the reader may have gone off to install AutoHotkey. A browser cannot
 * tell and a failed check gives nothing, so both leave null. An answer that comes after the guide is
 * gone, or after a newer answer was asked for, is dropped.
 */
function useInstalled(): readonly LangId[] | null {
  const { actions } = useApp()
  const [installed, setInstalled] = useState<readonly LangId[] | null>(null)
  useEffect(() => {
    let gone = false
    let asked = 0
    const ask = () => {
      const mine = ++asked
      void actions.installedLanguages().then((found) => {
        if (!gone && mine === asked) setInstalled(found)
      })
    }
    ask()
    window.addEventListener('focus', ask)
    return () => {
      gone = true
      window.removeEventListener('focus', ask)
    }
  }, [actions])
  return installed
}

/**
 * `folderName` is null while no folder is open (the start screen). `languages` are the versions
 * ticked under I run; the instructions that differ between the two follow them.
 */
export function GetStarted({
  folderName,
  languages,
}: Readonly<{ folderName: string | null; languages: readonly LangId[] }>) {
  const { platform } = useApp()
  const installed = useInstalled()
  const heading = useId()
  const choice: Choice = { ahk: languages.includes('ahk'), ps: languages.includes('ps') }
  return (
    <article aria-labelledby={heading} className="mx-auto max-w-3xl pb-10 leading-relaxed text-zinc-300">
      <h2 id={heading} className="mb-4 text-xl font-semibold text-zinc-100">
        Get started
      </h2>
      <div className="space-y-3">
        <p>
          Open Macro Builder turns a spare keypad into a pad of shortcuts. A key can open a program or press a keyboard
          shortcut for you, and the pad has several layers of keys to switch between.
        </p>
        <p>
          It has two parts. This app is where you design the pad. The macropad is a small program that sits in the
          background and does the work when you press a key. This app presses nothing itself, so the macropad has to be
          running for your keys to do anything.
        </p>
      </div>
      <WhatYouNeed folderName={folderName} />
      <ChooseVersion folderName={folderName} installed={installed} />
      <SetUpKeypad />
      <DesignPad />
      <StartMacropad choice={choice} />
      <TryIt />
      <AfterChange desktop={platform === 'electron'} />
      <StartWithWindows choice={choice} />
      <Troubleshooting choice={choice} />
      <ShareCommand />
    </article>
  )
}
