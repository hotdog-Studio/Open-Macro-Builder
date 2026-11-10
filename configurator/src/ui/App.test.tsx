/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { App } from './App'

it('renders the app name', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Open Macro Builder' })).toBeTruthy()
})
