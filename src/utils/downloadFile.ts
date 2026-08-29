import { Platform } from 'react-native';

// Triggers a browser file-save dialog for the given Blob. Deliberately does
// NOT attach the temporary <a> to the document. This app's root HTML
// document (+html.tsx) renders the routed screen directly as a child of
// <body> with no wrapper div in between, so React owns body's child list
// directly - appending/removing a node there, even briefly, raced with
// React's own handling of the click event and threw a hydration-mismatch
// error (React error #418) after the download had already fired. A
// detached anchor's .click() still triggers the browser's download prompt
// without ever touching a DOM subtree React manages.
export function downloadBlob(filename: string, blob: Blob) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
