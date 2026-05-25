-- Storage bucket for KB document uploads.
-- Private: all reads/writes go through the service-role client or signed URLs.
-- File size limit (5 MB) is enforced here AND in the upload route handler.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kb',
  'kb',
  false,
  5242880,  -- 5 MB in bytes
  ARRAY[
    'text/plain',
    'text/markdown',
    'application/json',
    'application/pdf',
    'application/octet-stream'  -- browsers sometimes send .md with this MIME
  ]
)
ON CONFLICT (id) DO NOTHING;
