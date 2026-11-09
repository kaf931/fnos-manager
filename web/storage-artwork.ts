import React from 'react';
import scan from './assets/brand/storage-scan.png';
import space from './assets/brand/storage-space.png';
import duplicates from './assets/brand/storage-duplicates.png';
const artwork = { scan, space, duplicates };
export const StorageArtwork = ({ kind }: { kind: string }) =>
  React.createElement('img', {
    className: 'storage-artwork',
    src: artwork[kind as keyof typeof artwork] || scan,
    alt: '',
    width: 256,
    height: 256,
    decoding: 'async',
  });
