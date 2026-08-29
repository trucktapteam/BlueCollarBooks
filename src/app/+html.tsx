import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';

// Root HTML shell for every web page (static export only - this file runs
// in Node during `expo export`, no DOM/browser APIs here). Individual
// routes set their own <title>/description/canonical/robots via
// `import { Head } from 'expo-router/head'` in the route itself - what's
// here is only the stuff that's genuinely the same on every page:
// charset/viewport, favicon, theme color, and the site-wide social tags
// (og:site_name, twitter:card) that a per-page <Head> can safely coexist
// with since they're not meant to vary page to page.
export default function Root({ children }: { children: React.ReactNode }) {
  // This is only required for server-side rendering.
  const { bodyAttributes, bodyNodes, htmlAttributes, headNodes } = useServerDocumentContext();

  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content="#111111" />
        <link rel="icon" href="/favicon.png" />

        <meta property="og:site_name" content="Blue Collar Books" />
        <meta name="twitter:card" content="summary_large_image" />

        {/*
          Disable body scrolling on web. This makes ScrollView components work closer to how they do on native.
          However, body scrolling is often nice to have for mobile web. If you want to enable it, remove this line.
        */}
        <ScrollViewStyleReset />

        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
