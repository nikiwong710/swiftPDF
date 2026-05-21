import { getAssetFromKV, MethodNotAllowedError, NotFoundError } from '@cloudflare/kv-asset-handler';

type Env = {
  __STATIC_CONTENT_MANIFEST: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
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
      if (e instanceof NotFoundError) {
        return new Response('Not Found', { status: 404 });
      } else if (e instanceof MethodNotAllowedError) {
        return new Response('Method Not Allowed', { status: 405 });
      }
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};
