import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FirebaseApp from './FirebaseApp'

describe('Firebase app setup', () => {
  it('does not open a budget until the Firebase project is configured', () => {
    render(<FirebaseApp />)

    expect(screen.getByRole('heading', { name: 'Connect your Firebase project' }))
      .toBeInTheDocument()
    expect(screen.getByText('VITE_FIREBASE_API_KEY')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument()
  })
})
