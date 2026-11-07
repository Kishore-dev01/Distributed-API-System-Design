# CDN Design Notes

In production, place a CDN (CloudFront, Fastly, or Cloudflare) in front of object storage.

## Recommended Flow

1. Client requests static/media asset from CDN URL.
2. CDN checks edge cache.
3. On cache miss, CDN fetches from object storage origin (S3/MinIO gateway).
4. CDN returns response and caches using cache-control headers.

## Cache Strategy

- Immutable assets: `Cache-Control: public, max-age=31536000, immutable`
- User-generated media: shorter TTL, optional signed URL.
- Invalidation: versioned object keys preferred over manual purge.

## Security

- Keep storage bucket private.
- Allow origin access only from CDN identity.
- Use signed URLs or signed cookies for restricted files.
