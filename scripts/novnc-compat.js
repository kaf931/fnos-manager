// noVNC 1.7.0 waits for an optional hardware video probe at module evaluation.
// Embedded WebViews can leave that promise pending forever. Standard VNC
// encodings remain available when H.264 is not advertised by this client.
export function adaptNoVncBrowser(source) {
  const probe = 'supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport();';
  if (source.split(probe).length !== 2) throw new Error('Unexpected noVNC browser module');
  return source.replace(
    probe,
    '// NAS Manager: do not block module loading on the optional H.264 hardware probe.\n' +
      'supportsWebCodecsH264Decode = false;',
  );
}
