import { createApp } from '../server/app.js';

// Vercel invokes the app for each request; it must never open a listening port.
const app = createApp({ serverless: true, serveFrontend: false });

export default function handler(req, res) {
  // Keep the Express route independent of how the platform rewrites req.url.
  const url = new URL(req.url, 'http://localhost');
  const route = url.searchParams.get('__api_path');
  if (route !== null) {
    url.searchParams.delete('__api_path');
    const query = url.searchParams.toString();
    req.url = `/api/${route}${query ? `?${query}` : ''}`;
  }
  return app(req, res);
}
