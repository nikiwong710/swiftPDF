import { getAssetFromKV, MethodNotAllowedError, NotFoundError } from '@cloudflare/kv-asset-handler';

type Env = {
  __STATIC_CONTENT_MANIFEST: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    try {
      // Try to get the asset
      return await getAssetFromKV(
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
