import React from 'react';
// Both card types use the same SVG so font metrics cannot shift the ellipsis.
export const MobileMoreButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function MobileMoreButton({ className = '', ...props }, ref) {
  return React.createElement(
    'button',
    { ...props, ref, type: 'button', className: `mobile-more-button ${className}` },
    React.createElement(
      'svg',
      { 'aria-hidden': true, viewBox: '0 0 20 20', fill: 'currentColor' },
      [4, 10, 16].map((cx) => React.createElement('circle', { key: cx, cx, cy: 10, r: 1.5 })),
    ),
  );
});
