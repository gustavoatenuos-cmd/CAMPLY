import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClientLogo } from './ClientLogo';
import React from 'react';

describe('ClientLogo', () => {
  it('renders initials when logoUrl is absent', () => {
    render(<ClientLogo name="Test Client" />);
    expect(screen.getByText('TC')).toBeInTheDocument();
  });

  it('renders an image when logoUrl is provided', () => {
    render(<ClientLogo name="Test Client" logoUrl="https://example.com/logo.png" />);
    const img = screen.getByAltText('Logo Test Client');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
  });

  it('falls back to initials when the image fails to load', () => {
    render(<ClientLogo name="Fallback Client" logoUrl="https://example.com/bad.png" />);
    const img = screen.getByAltText('Logo Fallback Client');
    
    // Simulate image error
    fireEvent.error(img);
    
    expect(screen.getByText('FC')).toBeInTheDocument();
    expect(screen.queryByAltText('Logo Fallback Client')).not.toBeInTheDocument();
  });
});
