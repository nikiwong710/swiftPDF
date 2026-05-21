import { getAssetFromKV, MethodNotAllowedError, NotFoundError } from '@cloudflare/kv-asset-handler';

type Env = {
  __STATIC_CONTENT_MANIFEST: string;
};

// MIME type mappings
const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function getMimeType(pathname: string): string {
  const ext = pathname.substring(pathname.lastIndexOf('.')).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    try {
      // Try to get the asset
      const response = await getAssetFromKV(
        {
          request,
          waitUntil: () => {},
        },
        {
          ASSET_MANIFEST: env.__STATIC_CONTENT_MANIFEST,
          cacheControl: {
            default: 'max-age=3600',
            'index.html': 'max-age=0, no-cache, no-store, must-revalidate',
          },
        }
      );
      
      // Ensure correct MIME type for JavaScript files
      const mimeType = getMimeType(url.pathname);
      if (response.ok && (url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs'))) {
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        });
      }
      
      return response;
    } catch (e) {
      // For SPA routing: serve index.html for non-asset requests
      if (e instanceof NotFoundError && !url.pathname.includes('.')) {
        // No file extension means it's likely a route, serve index.html
        try {
          return await getAssetFromKV(
            {
              request: new Request(new URL('/index.html', url).toString(), request),
              waitUntil: () => {},
            },
            {
              ASSET_MANIFEST: env.__STATIC_CONTENT_MANIFEST,
              cacheControl: {
                'index.html': 'max-age=0, no-cache, no-store, must-revalidate',
              },
            }
          );
        } catch {
          return new Response('Not Found', { status: 404 });
        }
      } else if (e instanceof MethodNotAllowedError) {
        return new Response('Method Not Allowed', { status: 405 });
      }
      return new Response('Not Found', { status: 404 });
    }
  },
};
