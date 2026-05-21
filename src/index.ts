import { getAssetFromKV, MethodNotAllowedError, NotFoundError } from '@cloudflare/kv-asset-handler';

type Env = {
  __STATIC_CONTENT_MANIFEST?: string;
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };
};

// MIME type mappings
const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function getMimeType(pathname: string): string {
  const ext = pathname.substring(pathname.lastIndexOf('.')).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function setContentType(response: Response, pathname: string): Response {
  const mimeType = getMimeType(pathname);
  const headers = new Headers(response.headers);
  headers.set('Content-Type', mimeType);
  headers.set('Cache-Control', pathname === '/index.html' 
    ? 'max-age=0, no-cache, no-store, must-revalidate'
    : 'max-age=3600, public'
  );
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    try {
      // Try to get the asset using KV asset handler
      const options = env.__STATIC_CONTENT_MANIFEST 
        ? { ASSET_MANIFEST: env.__STATIC_CONTENT_MANIFEST }
        : {};
        
      const response = await getAssetFromKV(
        {
          request,
          waitUntil: () => {},
        },
        options
      );
      
      return setContentType(response, url.pathname);
    } catch (e) {
      // For SPA routing: serve index.html for non-asset requests
      if (e instanceof NotFoundError && !url.pathname.includes('.')) {
        // No file extension means it's likely a route, serve index.html
        try {
          const indexRequest = new Request(
            new URL('/index.html', url).toString(),
            request
          );
          
          const options = env.__STATIC_CONTENT_MANIFEST 
            ? { ASSET_MANIFEST: env.__STATIC_CONTENT_MANIFEST }
            : {};
            
          const response = await getAssetFromKV(
            {
              request: indexRequest,
              waitUntil: () => {},
            },
            options
          );
          
          return setContentType(response, '/index.html');
        } catch (indexError) {
          return new Response('Not Found', { 
            status: 404,
            headers: { 'Content-Type': 'text/plain' }
          });
        }
      } else if (e instanceof MethodNotAllowedError) {
        return new Response('Method Not Allowed', { status: 405 });
      }
      
      // Log the error for debugging
      console.error('Asset fetch error:', e);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};
