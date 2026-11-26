import { useEffect, useState } from 'react'
import type { FolderAccess } from '../core/folder/types'
import type { TemplateLookup } from '../core/icons/generate'
import type { Rgba } from '../core/icons/rgba'
import { useApp } from '../state/store'
import { encodePng } from './iconCodec'
import { loadTemplates } from './iconFiles'

/**
 * The folder's own templates (img/template) for the sizes, once read; null while they are being read. The preview
 * and the written files both draw with them, so what is shown is what is written.
 */
export function useTemplates(folder: FolderAccess, sizes: readonly string[]): TemplateLookup | null {
  const [loaded, setLoaded] = useState<{ key: string; lookup: TemplateLookup } | null>(null)
  const key = sizes.join(',')
  useEffect(() => {
    let live = true
    loadTemplates(folder, key.split(',').filter(Boolean))
      .then((lookup) => {
        if (live) setLoaded({ key, lookup })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [folder, key])
  return loaded?.key === key ? loaded.lookup : null
}

/**
 * A picture of the opened folder as an object URL, read again whenever `version` changes (after the tab wrote
 * it). Unlike useAsset it keeps nothing between uses, so a file that was just overwritten shows as it is now.
 * Null while it is being read and when the file is missing.
 */
export function useDiskImage(path: string | null, version: number): string | null {
  const { state } = useApp()
  const folder = state.screen === 'edit' ? state.folder : null
  const [loaded, setLoaded] = useState<{ path: string; version: number; url: string | null } | null>(null)

  useEffect(() => {
    if (!folder || path === null) return
    let live = true
    let made: string | null = null
    folder
      .readBytes(path)
      .catch(() => null)
      .then((bytes) => {
        if (!live) return
        made = bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' })) : null
        setLoaded({ path, version, url: made })
      })
      .catch(() => undefined)
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [folder, path, version])

  return loaded?.path === path && loaded.version === version ? loaded.url : null
}

/** Object URLs for freshly composed pictures, made by the same PNG encoder the files are written with. */
export function useImageUrls(images: ReadonlyMap<string, Rgba>): ReadonlyMap<string, string> {
  const [urls, setUrls] = useState<{ of: ReadonlyMap<string, Rgba>; urls: ReadonlyMap<string, string> } | null>(null)

  useEffect(() => {
    let live = true
    const made: string[] = []
    const encode = async () => {
      const result = new Map<string, string>()
      for (const [name, image] of images) {
        const bytes = await encodePng(image)
        if (!live) return
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
        made.push(url)
        result.set(name, url)
      }
      setUrls({ of: images, urls: result })
    }
    encode().catch(() => undefined)
    return () => {
      live = false
      for (const url of made) URL.revokeObjectURL(url)
    }
  }, [images])

  return urls?.of === images ? urls.urls : new Map()
}
