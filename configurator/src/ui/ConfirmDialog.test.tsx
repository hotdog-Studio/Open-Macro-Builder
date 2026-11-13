/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

afterEach(cleanup)

describe('ConfirmDialog', () => {
  it('Escape cancels, and other keys do not', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog title="Sure?" onCancel={onCancel} choices={[{ label: 'Yes', onChoose: () => {} }]} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('has no Cancel button and ignores Escape when the question cannot be cancelled', () => {
    const onChoose = vi.fn()
    render(<ConfirmDialog title="Sure?" choices={[{ label: 'Yes', onChoose }]} />)
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Sure?' })).toBeTruthy()
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('stops listening for Escape once it is closed', () => {
    const onCancel = vi.fn()
    const { unmount } = render(<ConfirmDialog title="Sure?" onCancel={onCancel} choices={[]} />)
    unmount()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })
})
