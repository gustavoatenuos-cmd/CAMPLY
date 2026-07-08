import React, { useState } from 'react';

export interface ClientLogoProps {
  name: string;
  logoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function ClientLogo({ name, logoUrl, size = 'md', className = '' }: ClientLogoProps) {
  const [imgError, setImgError] = useState(false);

  const getInitials = (name: string) => {
    if (!name) return '??';
    
    // Ignore small words
    const ignoreList = ['da', 'de', 'do', 'das', 'dos', 'e'];
    const parts = name.trim().split(' ').filter(p => !ignoreList.includes(p.toLowerCase()));
    
    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    
    // Max 2 initials
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const sizeClasses = {
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
    xl: 'w-16 h-16 text-xl',
  };

  const baseClasses = "flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 font-bold";
  const mergedClasses = `${baseClasses} ${sizeClasses[size]} ${className}`;

  if (logoUrl && !imgError) {
    return (
      <div className={mergedClasses}>
        <img 
          src={logoUrl} 
          alt={`Logo ${name}`}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  // Fallback to initials
  return (
    <div className={`${mergedClasses} bg-gradient-to-br from-brand-surface to-brand-ink text-brand-green`} title={name}>
      {getInitials(name)}
    </div>
  );
}
